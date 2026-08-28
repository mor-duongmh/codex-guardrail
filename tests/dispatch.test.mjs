import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runHook, denyMessage } from '../lib/dispatch.mjs';
import { readEntries } from '../lib/audit.mjs';

// Chốt audit path NGAY khi nạp module: record() đọc process.env, nên một test
// đi qua đường deny mà chưa gọi repo() sẽ ghi vào ~/.codex/ của người chạy.
process.env.GUARDRAIL_AUDIT_PATH = join(
  mkdtempSync(join(tmpdir(), 'guardrail-dispatch-sink-')), 'audit.jsonl');

function repo(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'guardrail-dispatch-'));
  mkdirSync(join(dir, '.git'));
  for (const [n, b] of Object.entries(files)) writeFileSync(join(dir, n), b);
  process.env.GUARDRAIL_AUDIT_PATH = join(dir, 'audit.jsonl');
  return dir;
}

const payload = (cwd, command) => JSON.stringify({
  hook_event_name: 'PreToolUse', tool_name: 'Bash', cwd,
  tool_input: { command },
});

const patchPayload = (cwd, ...patchLines) => JSON.stringify({
  hook_event_name: 'PreToolUse', tool_name: 'apply_patch', cwd,
  tool_input: {
    command: ['*** Begin Patch', ...patchLines, '*** End Patch'].join('\n'),
  },
});

// Lý do deny nằm trong JSON ở stdout. stderr chỉ dùng cho cảnh báo phụ (escape, rule chất lượng lỗi).
const reasonOf = (r) =>
  JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason;

test('lệnh vô hại thì allow và không in gì', () => {
  const r = runHook(payload(repo(), 'npm test'), {});
  assert.equal(r.decision, 'allow');
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, '');
});

test('lệnh vi phạm thì deny và lý do nói đủ ba điều', () => {
  const r = runHook(payload(repo(), 'psql -l'), {});
  assert.equal(r.decision, 'deny');
  const why = reasonOf(r);
  assert.ok(why.includes('infra.deny-binary'));
  assert.ok(why.includes('Vì sao'));
  assert.ok(why.includes('Làm gì tiếp'));
  assert.ok(why.includes('CODEX_GUARDRAIL_ALLOW=infra.deny-binary'));
  // Codex nối `. Command: <lệnh>` ngay sau reason.
  assert.ok(!/[.\n]$/.test(why), 'reason không được kết thúc bằng dấu chấm hay newline');
});

test('deny cũng trả đúng khung JSON mà Codex đọc', () => {
  const r = runHook(payload(repo(), 'psql -l'), {});
  const out = JSON.parse(r.stdout).hookSpecificOutput;
  assert.equal(out.hookEventName, 'PreToolUse');
  assert.equal(out.permissionDecision, 'deny');
});

test('stdin rỗng thì deny fail-closed', () => {
  const r = runHook('', {});
  assert.equal(r.decision, 'deny');
  assert.ok(reasonOf(r).includes('fail-closed'));
});

test('reason fail-closed cũng không kết thúc bằng dấu chấm hay newline', () => {
  // Codex nối `. Command: ...` vào MỌI reason, kể cả reason fail-closed.
  assert.ok(!/[.\n]$/.test(reasonOf(runHook('', {}))));
  const dir = repo({ 'codex-guardrail.json': '{ "infra": ' });
  assert.ok(!/[.\n]$/.test(reasonOf(runHook(payload(dir, 'npm test'), {}))));
});

test('policy hỏng thì deny, KHÔNG âm thầm dùng default', () => {
  const dir = repo({ 'codex-guardrail.json': '{ "infra": ' });
  const r = runHook(payload(dir, 'npm test'), {});
  assert.equal(r.decision, 'deny');
  assert.ok(reasonOf(r).includes('codex-guardrail.json'));
});

test('escape đúng ruleId thì cho qua và cảnh báo', () => {
  const r = runHook(payload(repo(), 'psql -l'), { CODEX_GUARDRAIL_ALLOW: 'infra.deny-binary' });
  assert.equal(r.decision, 'allow');
  assert.equal(r.stdout, '');
  assert.ok(r.stderr.includes('bị bỏ qua'));
});

test('escape ghi audit với decision="escaped", không phải "denied"', () => {
  const dir = repo();
  runHook(payload(dir, 'psql -l'), { CODEX_GUARDRAIL_ALLOW: 'infra.deny-binary' });
  const rows = readEntries();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].decision, 'escaped');
  assert.equal(rows[0].ruleId, 'infra.deny-binary');
  assert.equal(rows[0].event, 'PreToolUse');
  assert.equal(rows[0].tool, 'Bash');
});

test('deny ghi audit với decision="denied"', () => {
  const dir = repo();
  runHook(payload(dir, 'psql -l'), {});
  const rows = readEntries();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].decision, 'denied');
  assert.equal(rows[0].ruleId, 'infra.deny-binary');
});

test('allow không ghi audit (log khỏi phình)', () => {
  repo();
  runHook(payload(process.cwd(), 'npm test'), {});
  assert.equal(readEntries().length, 0);
});

test('escape sai ruleId thì vẫn chặn', () => {
  const r = runHook(payload(repo(), 'psql -l'), { CODEX_GUARDRAIL_ALLOW: 'git.no-verify' });
  assert.equal(r.decision, 'deny');
});

test('escape không nhận wildcard', () => {
  const r = runHook(payload(repo(), 'psql -l'), { CODEX_GUARDRAIL_ALLOW: '*' });
  assert.equal(r.decision, 'deny');
});

test('event hoặc tool không khai rule thì exit 0 ngay', () => {
  const raw = JSON.stringify({
    hook_event_name: 'PreCompact', tool_name: 'whatever', cwd: '/tmp', tool_input: {},
  });
  assert.equal(runHook(raw, {}).decision, 'allow');
});

test('lối tắt no-rule về TRƯỚC khi nạp policy', () => {
  // Bằng chứng HÀNH VI cho lối tắt độ trễ (§13): policy hỏng thì đường có rule
  // fail-closed, nhưng event không khai rule nào vẫn allow — nghĩa là chưa hề
  // đọc tới file policy. Mỗi lần gọi hook là một process Node mới nên lối tắt
  // này là toàn bộ phần tiết kiệm được.
  const dir = repo({ 'codex-guardrail.json': '{ "infra": ' });
  const raw = JSON.stringify({
    hook_event_name: 'PreCompact', tool_name: 'Bash', cwd: dir, tool_input: {},
  });
  assert.equal(runHook(raw, {}).decision, 'allow');
});

test('event lạ trên tool có rule cũng allow ngay', () => {
  // REGISTRY tra theo event TRƯỚC rồi mới tới tool: PostToolUse chưa khai rule nào.
  const raw = JSON.stringify({
    hook_event_name: 'PostToolUse', tool_name: 'Bash', cwd: '/tmp',
    tool_input: { command: 'psql -l' },
  });
  assert.equal(runHook(raw, {}).decision, 'allow');
});

test('selfprotect chạy trước infra', () => {
  const r = runHook(payload(repo(), 'CODEX_GUARDRAIL_ALLOW=x psql -l'), {});
  assert.ok(reasonOf(r).includes('selfprotect.escape-inline'));
});

test('hai rule cùng chặn: selfprotect thắng infra', () => {
  // Đã đo: lệnh này trúng CẢ selfprotect.hooks-file (~ là tổ tiên của
  // ~/.codex/hooks.json) LẪN infra.deny-pattern. ruleId báo ra phải theo
  // thứ tự rule, vì nó là khoá escape mà người dùng sẽ gõ.
  const r = runHook(payload(repo(), ['rm -', 'rf ~'].join('')), {});
  const why = reasonOf(r);
  assert.equal(r.decision, 'deny');
  assert.ok(why.includes('selfprotect.hooks-file'), why);
  assert.ok(!why.includes('infra.deny-pattern'), why);
});

test('hai rule cùng chặn: secrets thắng infra', () => {
  // Đã đo: trúng cả secrets.read-path lẫn infra.deny-binary. Cặp này kiểm
  // đúng khớp secrets→infra, chỗ mà test selfprotect ở trên không chạm tới.
  const r = runHook(payload(repo(), 'cat .env && psql -l'), {});
  const why = reasonOf(r);
  assert.ok(why.includes('secrets.read-path'), why);
  assert.ok(!why.includes('infra.deny-binary'), why);
});

test('rule git có được wire vào registry', () => {
  // git đứng CUỐI nên dễ bị quên khai; lệnh này chỉ git chặn.
  const r = runHook(payload(repo(), 'git commit --no-verify -m "feat: x"'), {});
  assert.equal(r.decision, 'deny');
  assert.ok(reasonOf(r).includes('git.no-verify'));
});

test('apply_patch sửa codex-guardrail.json thì deny selfprotect.policy-file', () => {
  const dir = repo();
  const r = runHook(
    patchPayload(dir, '*** Update File: codex-guardrail.json', '@@', '-  "a": 1', '+  "a": 2'),
    {});
  assert.equal(r.decision, 'deny');
  assert.ok(reasonOf(r).includes('selfprotect.policy-file'), reasonOf(r));
});

test('apply_patch ghi .env thì deny secrets — rule secrets có wire cho apply_patch', () => {
  const dir = repo();
  const r = runHook(patchPayload(dir, '*** Update File: .env', '@@', '+SECRET=1'), {});
  assert.equal(r.decision, 'deny');
  assert.ok(reasonOf(r).includes('secrets.'), reasonOf(r));
});

test('apply_patch vô hại thì allow', () => {
  const dir = repo();
  const r = runHook(patchPayload(dir, '*** Update File: src/app.mjs', '@@', '+const a = 1;'), {});
  assert.equal(r.decision, 'allow');
  assert.equal(r.stderr, '');
});

// ctx phải có `projectRoot`: golden này ghim khuôn BÌNH THƯỜNG. Từ khi deny
// message thêm cảnh báo "đang chạy policy mặc định" cho ca projectRoot=null, một
// ctx rỗng `{}` sẽ kéo theo cảnh báo đó và golden không còn ghim khuôn nào rõ
// ràng. Ca degraded có hai test riêng ngay bên dưới, cả hai chiều.
test('denyMessage giữ đúng khuôn (golden)', () => {
  const msg = denyMessage(
    { ruleId: 'infra.deny-binary', reason: 'LÝ DO', hint: 'GỢI Ý' },
    { projectRoot: '/x/demo', cwd: '/x/demo' },
  );
  assert.equal(msg,
`✗ guardrail chặn: infra.deny-binary

  Vì sao: LÝ DO
  Làm gì tiếp: GỢI Ý

  Escape một lần (người gõ, không phải agent):
    export CODEX_GUARDRAIL_ALLOW=infra.deny-binary
  Nới vĩnh viễn: thêm vào codex-guardrail.json rồi mở PR (file có CODEOWNERS)`);
});

test('thiếu codex-guardrail.json thì KHÔNG cảnh báo ra stderr', () => {
  // Lệch có ý thức so với spec §10: hook là tiến trình sống ngắn, không giữ
  // được "đã cảnh báo trong session này", nên in ra sẽ nhiễu ở MỌI tool call
  // và dev học cách bỏ qua stderr của guardrail. `guardrail doctor` báo việc này.
  const r = runHook(payload(repo(), 'npm test'), {});
  assert.equal(r.stderr, '');
});

// Mắt nối cuối: ctx CÓ permissionMode (lib/context.mjs) và audit GHI ĐƯỢC nó
// (lib/audit.mjs), nhưng vô nghĩa nếu dispatch không truyền qua. Test này tồn tại
// vì hai test kia đều xanh mà chuỗi vẫn có thể hở đúng ở giữa.
test('dispatch ghi permissionMode vào audit log', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'guardrail-disp-pm-'));
  const auditPath = join(dir, 'audit.jsonl');
  const ev = JSON.stringify({
    hook_event_name: 'PreToolUse', tool_name: 'Bash',
    tool_input: { command: 'psql -l' }, cwd: process.cwd(),
    permission_mode: 'bypassPermissions',
  });
  const prev = process.env.GUARDRAIL_AUDIT_PATH;
  process.env.GUARDRAIL_AUDIT_PATH = auditPath;
  try {
    runHook(ev, { env: {} });
    const e = JSON.parse(readFileSync(auditPath, 'utf8').trim().split('\n').at(-1));
    assert.equal(e.decision, 'denied');
    assert.equal(e.permissionMode, 'bypassPermissions',
      'dispatch không truyền permissionMode từ ctx vào audit entry');
  } finally {
    if (prev === undefined) delete process.env.GUARDRAIL_AUDIT_PATH;
    else process.env.GUARDRAIL_AUDIT_PATH = prev;
  }
});

// Chẩn đoán §11.7: trong phiên Codex THẬT, repo và branch đều null dù người dùng
// chạy Codex TỪ thư mục dự án (có .git). findProjectRoot đã được kiểm là đúng —
// từ thư mục dự án và thư mục con đều tìm ra root, từ ~ thì trả null.
//
// Nên còn hai khả năng, và ghi `cwd` vào log phân biệt được ngay:
//   cwd KHÔNG phải thư mục dự án -> vấn đề ở giá trị Codex gửi
//   cwd ĐÚNG mà repo vẫn null    -> .git không đọc được từ tiến trình hook
//                                    (Codex doctor báo "sandbox restricted fs")
//
// Hệ quả của null không nhỏ: loadPolicy(null) chỉ trả policy MẶC ĐỊNH, tức
// codex-guardrail.json của dự án không bao giờ được đọc, và toàn bộ cơ chế nới
// policy qua PR có CODEOWNERS là vô hiệu.
test('dispatch ghi cwd vào audit log để chẩn đoán projectRoot=null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'guardrail-disp-cwd-'));
  const auditPath = join(dir, 'audit.jsonl');
  const ev = JSON.stringify({
    hook_event_name: 'PreToolUse', tool_name: 'Bash',
    tool_input: { command: 'psql -l' }, cwd: '/some/where/else',
  });
  const prev = process.env.GUARDRAIL_AUDIT_PATH;
  process.env.GUARDRAIL_AUDIT_PATH = auditPath;
  try {
    runHook(ev, { env: {} });
    const e = JSON.parse(readFileSync(auditPath, 'utf8').trim().split('\n').at(-1));
    assert.equal(e.cwd, '/some/where/else', 'không ghi cwd — mất khả năng chẩn đoán');
    assert.equal(e.repo, null, 'cwd ngoài repo thì repo phải null');
  } finally {
    if (prev === undefined) delete process.env.GUARDRAIL_AUDIT_PATH;
    else process.env.GUARDRAIL_AUDIT_PATH = prev;
  }
});

// Đo được trên máy thật: người dùng mở Codex từ home nên payload có
// `cwd: "/Users/haiduong"`, và `pwd` trong phiên đó xác nhận đúng là home. Nghĩa
// là findProjectRoot trả null ĐÚNG, không phải bug.
//
// Nhưng hint của rule thì SAI trong ngữ cảnh đó: nó bảo "thêm vào
// infra.allowBinaries trong codex-guardrail.json rồi mở PR", trong khi file đó
// KHÔNG được đọc khi projectRoot là null. Người dùng sẽ sửa file, mở PR, được
// duyệt — và không gì thay đổi. Chỉ người ta làm một việc vô ích là tệ hơn không
// chỉ gì cả.
test('deny message nói rõ đang chạy policy mặc định khi không có project root', () => {
  const ev = JSON.stringify({
    hook_event_name: 'PreToolUse', tool_name: 'Bash',
    tool_input: { command: 'psql -l' }, cwd: tmpdir(),
  });
  const out = runHook(ev, { env: {} }).stdout;
  const reason = JSON.parse(out).hookSpecificOutput.permissionDecisionReason;
  assert.match(reason, /POLICY MẶC ĐỊNH/, `thiếu cảnh báo chế độ giảm năng lực:\n${reason}`);
  assert.ok(reason.includes(tmpdir()), 'phải in cwd thật để người dùng đối chiếu');
  assert.match(reason, /KHÔNG được đọc/, 'phải nói file policy không được đọc');
});

// Chiều ngược lại: có project root thì KHÔNG được thêm cảnh báo đó — nếu không
// mọi deny trong dự án đều mang một đoạn nhiễu vô nghĩa, và dev học cách bỏ qua.
test('có project root thì deny message không mang cảnh báo đó', () => {
  const ev = JSON.stringify({
    hook_event_name: 'PreToolUse', tool_name: 'Bash',
    tool_input: { command: 'psql -l' }, cwd: process.cwd(),
  });
  const out = runHook(ev, { env: {} }).stdout;
  const reason = JSON.parse(out).hookSpecificOutput.permissionDecisionReason;
  assert.ok(!reason.includes('POLICY MẶC ĐỊNH'), `cảnh báo xuất hiện oan:\n${reason}`);
});

// --- `ask` là quyết định hạng nhất (Task 2) -----------------------------------
// Registry tiêm qua tham số có mặc định, cùng nếp DI đã dùng ở `parseCommand`
// (platform) và `inferPolicy` (runGit): không phải export REGISTRY ra chỉ để test.

const askPayload = (cwd, command, mode) => JSON.stringify({
  hook_event_name: 'PreToolUse', tool_name: 'Bash', cwd,
  ...(mode === undefined ? {} : { permission_mode: mode }),
  tool_input: { command },
});

const fakeRule = (result) => ({ evaluate: () => result });
const reg = (...groups) => ({ PreToolUse: { Bash: groups } });

const ASK = { decision: 'ask', ruleId: 'deploy.undeclared-destination', reason: 'đẩy tới 1.2.3.4', hint: 'xác nhận' };
const DENY = { decision: 'deny', ruleId: 'infra.deny-binary', reason: 'psql bị chặn', hint: 'dùng cách khác' };
const decisionOf = (r) => JSON.parse(r.stdout).hookSpecificOutput.permissionDecision;

test('ask phát ra permissionDecision ask ở chế độ có người trả lời', () => {
  for (const mode of ['default', 'acceptEdits', 'plan']) {
    const r = runHook(askPayload(repo(), 'scp a b:/c', mode), {},
      reg(['deploy', fakeRule(ASK)]));
    assert.equal(r.decision, 'ask', mode);
    assert.equal(decisionOf(r), 'ask', mode);
    assert.match(reasonOf(r), /deploy\.undeclared-destination/);
  }
});

test('ask hạ về deny ở chế độ không có ai bấm', () => {
  for (const mode of ['dontAsk', 'bypassPermissions']) {
    const r = runHook(askPayload(repo(), 'scp a b:/c', mode), {},
      reg(['deploy', fakeRule(ASK)]));
    assert.equal(r.decision, 'deny', mode);
    assert.equal(decisionOf(r), 'deny', mode);
  }
});

test('permissionMode thiếu thì ask hạ về deny', () => {
  // context.mjs cố ý để null chứ không đoán 'default'. Đoán 'default' là đoán
  // rằng có prompt, tức lệch về phía CHO QUA ở đúng chỗ không được lệch.
  const r = runHook(askPayload(repo(), 'scp a b:/c', undefined), {},
    reg(['deploy', fakeRule(ASK)]));
  assert.equal(r.decision, 'deny');
});

test('chế độ lạ thì ask hạ về deny — allow-list, không phải deny-list', () => {
  const r = runHook(askPayload(repo(), 'scp a b:/c', 'chế-độ-codex-thêm-sau-này'), {},
    reg(['deploy', fakeRule(ASK)]));
  assert.equal(r.decision, 'deny');
});

test('deny THẮNG ask kể cả khi ask đến trước', () => {
  // deploy chạy TRƯỚC infra. Nếu ask trả về ngay thì một ask của deploy sẽ che
  // một deny của infra — biến lệnh phải chặn thành lệnh chỉ cần bấm OK.
  const r = runHook(askPayload(repo(), 'scp a b:/c', 'default'), {},
    reg(['deploy', fakeRule(ASK)], ['infra', fakeRule(DENY)]));
  assert.equal(r.decision, 'deny');
  assert.match(reasonOf(r), /infra\.deny-binary/);
});

test('ask ghi audit với decision="asked"', () => {
  const dir = repo();
  runHook(askPayload(dir, 'scp a b:/c', 'default'), {}, reg(['deploy', fakeRule(ASK)]));
  const entries = readEntries(join(dir, 'audit.jsonl'));
  assert.equal(entries.length, 1);
  assert.equal(entries[0].decision, 'asked');
  assert.equal(entries[0].ruleId, 'deploy.undeclared-destination');
});

test('escape đúng ruleId thì ask cũng bị bỏ qua', () => {
  const r = runHook(askPayload(repo(), 'scp a b:/c', 'default'),
    { CODEX_GUARDRAIL_ALLOW: 'deploy.undeclared-destination' },
    reg(['deploy', fakeRule(ASK)]));
  assert.equal(r.decision, 'allow');
});

test('message của ask không mang khuôn của deny', () => {
  const r = runHook(askPayload(repo(), 'scp a b:/c', 'default'), {},
    reg(['deploy', fakeRule(ASK)]));
  const why = reasonOf(r);
  assert.ok(!why.includes('guardrail chặn'), 'ask không phải một lệnh bị chặn');
  assert.ok(why.includes('cần xác nhận'));
  assert.ok(!/[.\n]$/.test(why), 'reason không được kết thúc bằng dấu chấm hay newline');
});
