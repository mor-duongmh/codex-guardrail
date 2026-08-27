import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
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

test('denyMessage giữ đúng khuôn (golden)', () => {
  const msg = denyMessage(
    { ruleId: 'infra.deny-binary', reason: 'LÝ DO', hint: 'GỢI Ý' }, {}
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
