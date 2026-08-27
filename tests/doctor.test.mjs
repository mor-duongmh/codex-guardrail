import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { diagnose } from '../lib/doctor.mjs';
import { install } from '../lib/install.mjs';

const SOURCE = fileURLToPath(new URL('../', import.meta.url));
const BIN = join(SOURCE, 'bin', 'guardrail.mjs');

// MỌI test đi qua CODEX_HOME trỏ vào thư mục tạm. Không test nào được đọc/ghi
// ~/.codex thật: doctor đọc config.toml, và config.toml thật của người dùng có
// token trong đó.
function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'guardrail-doctor-'));
  process.env.CODEX_HOME = dir;
  process.env.GUARDRAIL_AUDIT_PATH = join(dir, 'audit.jsonl');
  return dir;
}

function repo(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'guardrail-doctor-repo-'));
  mkdirSync(join(dir, '.git'));
  for (const [n, b] of Object.entries(files)) writeFileSync(join(dir, n), b);
  return dir;
}

// Khoá trust đúng dạng đã đo trên ~/.codex/config.toml thật:
//   [hooks.state."<hooks.json>:<event_snake>:<group>:<hook>"]
// Hash là giá trị giả — doctor cố tình không kiểm hash, và test phải phản ánh
// đúng giới hạn đó chứ không giả vờ kiểm được.
function writeTrust(home, indices, { codexHooks = true } = {}) {
  const body = indices
    .map(([gi, hi]) => `[hooks.state."${join(home, 'hooks.json')}:pre_tool_use:${gi}:${hi}"]\n`
      + `trusted_hash = "sha256:${'0'.repeat(64)}"\n`)
    .join('\n');
  writeFileSync(join(home, 'config.toml'),
    `[features]\ncodex_hooks = ${codexHooks}\n\n[hooks.state]\n\n${body}`);
}

// Nền "wiring đã lành": cài xong và có đủ bản ghi trust, nên ok=true. Cần nền
// này để mỗi assert ok=false bên dưới thực sự kiểm ĐÚNG nguyên nhân của nó —
// không có nó thì nhánh "chưa được cài" đã hạ ok sẵn và assert nào cũng xanh,
// kể cả khi code quên hạ ok. (Đo bằng mutation: hai assert từng sống sót vì thế.)
function healthy() {
  const home = sandbox();
  install({ sourceDir: SOURCE });
  writeTrust(home, [[0, 0], [1, 0]]);
  return home;
}

// --- những gì plan Step 1 yêu cầu ------------------------------------------

test('chưa cài thì ok=false và nói rõ thiếu gì', () => {
  sandbox();
  const res = diagnose(repo());
  assert.equal(res.ok, false);
  assert.ok(res.lines.join('\n').includes('chưa được cài'));
});

test('đã cài thì in đường dẫn runtime và số entry', () => {
  const home = sandbox();
  install({ sourceDir: SOURCE });
  const out = diagnose(repo()).lines.join('\n');
  assert.ok(out.includes(join(home, 'guardrail')));
  assert.ok(out.includes('Entry hook: 2 mục'));
});

test('báo rule convention đang tắt vì thiếu lintCommand', () => {
  sandbox();
  const out = diagnose(repo()).lines.join('\n');
  assert.ok(out.includes('convention.lint'));
  assert.ok(out.includes('lintCommand'));
  assert.ok(out.includes('✗ convention.lint — TẮT'));
});

test('báo đang dùng policy mặc định khi repo chưa có file policy', () => {
  sandbox();
  assert.ok(diagnose(repo()).lines.join('\n').includes('mặc định'));
});

test('báo nguồn policy khi repo đã có file', () => {
  sandbox();
  const dir = repo({ 'codex-guardrail.json': '{}' });
  assert.ok(diagnose(dir).lines.join('\n').includes('codex-guardrail.json'));
});

test('policy hỏng thì doctor báo lỗi chứ không ném', () => {
  sandbox();
  const dir = repo({ 'codex-guardrail.json': '{ "infra": ' });
  const res = diagnose(dir);
  assert.equal(res.ok, false);
  assert.ok(res.lines.join('\n').includes('sai cú pháp'));
});

// --- trust: nhánh CHÍNH, chạy cho mọi máy chưa gõ /hooks -------------------

test('cài xong nhưng chưa có bản ghi trust thì ok=false và hướng dẫn /hooks', () => {
  sandbox();
  install({ sourceDir: SOURCE });
  const res = diagnose(repo());
  const out = res.lines.join('\n');
  assert.equal(res.ok, false);
  // Literal dán cứng, không import hằng số: sửa lời văn mà test vẫn xanh thì
  // test này không bảo vệ gì cả.
  assert.ok(out.includes('✗ Hook đã cài nhưng CHƯA được Codex tin cậy — guardrail đang KHÔNG chặn gì.'));
  assert.ok(out.includes('Không có bản ghi trust cho 2/2 entry'));
  assert.ok(out.includes('Gõ: /hooks'));
});

test('không có bản ghi trust thì TUYỆT ĐỐI không in dấu tick đã tin cậy', () => {
  sandbox();
  install({ sourceDir: SOURCE });
  const out = diagnose(repo()).lines.join('\n');
  assert.ok(!out.includes('✓ Có bản ghi trust'));
  assert.ok(!/✓[^\n]*tin cậy/.test(out));
});

test('có đủ bản ghi trust thì ok=true nhưng vẫn nói rõ không kiểm được hash', () => {
  const home = sandbox();
  install({ sourceDir: SOURCE });
  writeTrust(home, [[0, 0], [1, 0]]);
  const res = diagnose(repo());
  const out = res.lines.join('\n');
  assert.equal(res.ok, true);
  assert.ok(out.includes('⚠ Có bản ghi trust cho đủ 2 entry của guardrail.'));
  assert.ok(out.includes('KHÔNG kiểm được hash'));
  // Ngay cả nhánh tốt nhất cũng không được in ✓ cho trust.
  assert.ok(!/✓[^\n]*bản ghi trust/.test(out));
  assert.ok(!out.includes('CHƯA được Codex tin cậy'));
});

test('thiếu bản ghi trust cho một entry vẫn là chưa tin cậy', () => {
  const home = sandbox();
  install({ sourceDir: SOURCE });
  writeTrust(home, [[0, 0]]);
  const res = diagnose(repo());
  assert.equal(res.ok, false);
  assert.ok(res.lines.join('\n').includes('Không có bản ghi trust cho 1/2 entry'));
});

test('bản ghi trust ở SAI vị trí không được tính là đã tin cậy', () => {
  const home = sandbox();
  // Hai group của tool khác chiếm index 0 và 1, nên entry của guardrail nằm ở 2 và 3.
  writeFileSync(join(home, 'hooks.json'), JSON.stringify({
    hooks: {
      PreToolUse: [
        { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo tool-khac-a' }] },
        { matcher: 'Read', hooks: [{ type: 'command', command: 'echo tool-khac-b' }] },
      ],
    },
  }));
  install({ sourceDir: SOURCE });
  writeTrust(home, [[0, 0], [1, 0]]);
  const res = diagnose(repo());
  assert.equal(res.ok, false);
  assert.ok(res.lines.join('\n').includes('Không có bản ghi trust cho 2/2 entry'));
});

test('bản ghi trust ở ĐÚNG vị trí lệch thì được tính', () => {
  const home = sandbox();
  writeFileSync(join(home, 'hooks.json'), JSON.stringify({
    hooks: {
      PreToolUse: [
        { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo tool-khac-a' }] },
        { matcher: 'Read', hooks: [{ type: 'command', command: 'echo tool-khac-b' }] },
      ],
    },
  }));
  install({ sourceDir: SOURCE });
  writeTrust(home, [[2, 0], [3, 0]]);
  const res = diagnose(repo());
  assert.equal(res.ok, true);
  assert.ok(res.lines.join('\n').includes('⚠ Có bản ghi trust cho đủ 2 entry'));
});

test('config.toml thiếu file thì cảnh báo không xác định được, không báo ✓', () => {
  const home = sandbox();
  install({ sourceDir: SOURCE });
  rmSync(join(home, 'config.toml'));
  const res = diagnose(repo());
  const out = res.lines.join('\n');
  assert.equal(res.ok, false);
  assert.ok(out.includes('⚠ Không xác định được trạng thái tin cậy'));
  assert.ok(out.includes('không có file'));
  assert.ok(!/✓[^\n]*tin cậy/.test(out));
});

test('config.toml không đọc được thì cũng cảnh báo, không báo ✓', () => {
  const home = sandbox();
  install({ sourceDir: SOURCE });
  rmSync(join(home, 'config.toml'));
  mkdirSync(join(home, 'config.toml'));
  const res = diagnose(repo());
  const out = res.lines.join('\n');
  assert.equal(res.ok, false);
  assert.ok(out.includes('⚠ Không xác định được trạng thái tin cậy'));
  assert.ok(!/✓[^\n]*tin cậy/.test(out));
});

test('codex_hooks = false thì báo Codex đang tắt toàn bộ hook', () => {
  const home = sandbox();
  install({ sourceDir: SOURCE });
  writeTrust(home, [[0, 0], [1, 0]], { codexHooks: false });
  const res = diagnose(repo());
  const out = res.lines.join('\n');
  assert.equal(res.ok, false);
  assert.ok(out.includes('✗ codex_hooks = false'));
  assert.ok(out.includes('TẮT toàn bộ hook'));
});

test('entry của guardrail bị gỡ khỏi hooks.json thì doctor phát hiện', () => {
  const home = sandbox();
  install({ sourceDir: SOURCE });
  writeFileSync(join(home, 'hooks.json'), JSON.stringify({ hooks: { PreToolUse: [] } }));
  const res = diagnose(repo());
  const out = res.lines.join('\n');
  assert.equal(res.ok, false);
  assert.ok(out.includes('2/2 entry của guardrail KHÔNG còn trong'));
  assert.ok(out.includes('thiếu: PreToolUse / Bash'));
});

test('hooks.json hỏng JSON thì doctor báo chứ không ném', () => {
  const home = sandbox();
  install({ sourceDir: SOURCE });
  writeFileSync(join(home, 'hooks.json'), '{ "hooks": ');
  const res = diagnose(repo());
  assert.equal(res.ok, false);
  assert.ok(res.lines.join('\n').includes('✗ Không đọc được'));
});

test('sidecar hỏng thì doctor báo chứ không ném', () => {
  const home = sandbox();
  install({ sourceDir: SOURCE });
  writeFileSync(join(home, '.guardrail-installed.json'), '{ "entries": ');
  const res = diagnose(repo());
  assert.equal(res.ok, false);
  assert.ok(res.lines.join('\n').includes('không đọc được'));
});

test('sidecar thiếu entries thì doctor báo chứ không ném', () => {
  const home = sandbox();
  install({ sourceDir: SOURCE });
  writeFileSync(join(home, '.guardrail-installed.json'), '{"version":"x"}');
  const res = diagnose(repo());
  assert.equal(res.ok, false);
  assert.ok(res.lines.join('\n').includes('thiếu danh sách entries'));
});

// --- rule nào đang tắt và vì sao ------------------------------------------

test('selfprotect đếm theo object map, không báo 0 mẫu', () => {
  sandbox();
  const out = diagnose(repo()).lines.join('\n');
  // selfProtect.protectedPaths là object map ruleId -> mảng glob. Lấy `.length`
  // của object cho undefined, và bản nháp trong plan in ra "0 mẫu đường dẫn" —
  // doctor báo rule đang tắt trong khi nó đang chạy.
  assert.ok(out.includes('✓ selfprotect  — 4 nhóm, 5 mẫu đường dẫn'));
  assert.ok(!out.includes('selfprotect  — 0'));
});

test('nhóm selfprotect có globs không phải mảng thì bị báo là TẮT', () => {
  sandbox();
  const dir = repo({
    'codex-guardrail.json': JSON.stringify({
      selfProtect: { protectedPaths: { 'my.rule': 'oops' } },
    }),
  });
  const res = diagnose(dir);
  const out = res.lines.join('\n');
  assert.equal(res.ok, false);
  assert.ok(out.includes('✗ selfprotect/my.rule — TẮT'));
  // Nhóm mặc định vẫn phải còn nguyên, không bị nhóm chết kéo theo.
  assert.ok(out.includes('✓ selfprotect  — 4 nhóm'));
});

test('git.commitMessagePattern rỗng thì báo check message đang tắt', () => {
  sandbox();
  const dir = repo({ 'codex-guardrail.json': JSON.stringify({ git: { commitMessagePattern: '' } }) });
  const out = diagnose(dir).lines.join('\n');
  assert.ok(out.includes('✗ git.commit-message — TẮT'));
});

test('mặc định thì git.commit-message đang bật', () => {
  sandbox();
  assert.ok(diagnose(repo()).lines.join('\n').includes('✓ git.commit-message — ^(feat|fix'));
});

test('lintCommand có giá trị vẫn không được in ✓ vì bản này chưa có rule convention', () => {
  sandbox();
  const dir = repo({
    'codex-guardrail.json': JSON.stringify({ convention: { lintCommand: 'npm run lint' } }),
  });
  const out = diagnose(dir).lines.join('\n');
  assert.ok(out.includes('⚠ convention.lint — đã cấu hình "npm run lint"'));
  assert.ok(out.includes('KHÔNG được chạy'));
  assert.ok(!out.includes('✓ convention.lint'));
});

test('in số dòng audit log từ đường dẫn được tiêm', () => {
  const home = sandbox();
  const p = join(home, 'audit.jsonl');
  writeFileSync(p, `${JSON.stringify({ decision: 'denied', ruleId: 'a' })}\n`
    + `${JSON.stringify({ decision: 'escaped', ruleId: 'b' })}\n`);
  const out = diagnose(repo()).lines.join('\n');
  assert.ok(out.includes(`Audit log: ${p} (2 dòng)`));
});

test('không tìm được .git thì cảnh báo chứ không ném', () => {
  sandbox();
  const bare = mkdtempSync(join(tmpdir(), 'guardrail-doctor-bare-'));
  const res = diagnose(bare);
  // Có thể tìm thấy .git của một repo cha ngoài /var/folders; chỉ khẳng định
  // doctor không ném và vẫn liệt kê rule.
  assert.ok(res.lines.join('\n').includes('Rule đang hiệu lực:'));
});

// --- ok=false phải đến từ ĐÚNG nguyên nhân của nó -------------------------

test('nền wiring lành thì ok=true — mốc cho các test hạ ok bên dưới', () => {
  healthy();
  assert.equal(diagnose(repo()).ok, true);
});

test('policy hỏng hạ ok kể cả khi wiring đã lành', () => {
  healthy();
  const res = diagnose(repo({ 'codex-guardrail.json': '{ "infra": ' }));
  assert.equal(res.ok, false);
  assert.ok(res.lines.join('\n').includes('sai cú pháp'));
});

test('nhóm selfprotect chết hạ ok kể cả khi wiring đã lành', () => {
  healthy();
  const res = diagnose(repo({
    'codex-guardrail.json': JSON.stringify({
      selfProtect: { protectedPaths: { 'my.rule': 'oops' } },
    }),
  }));
  assert.equal(res.ok, false);
  assert.ok(res.lines.join('\n').includes('✗ selfprotect/my.rule — TẮT'));
});

test('section hooks.state không có trusted_hash thì KHÔNG phải bản ghi trust', () => {
  const home = sandbox();
  install({ sourceDir: SOURCE });
  const hooks = join(home, 'hooks.json');
  // Codex có thể ghi lại một mục nó đã thấy mà người dùng KHÔNG cấp tin cậy.
  // Đếm section thay vì đếm trusted_hash sẽ biến đúng cái đó thành "đã tin cậy".
  writeFileSync(join(home, 'config.toml'), '[features]\ncodex_hooks = true\n\n'
    + `[hooks.state."${hooks}:pre_tool_use:0:0"]\nenabled = false\n\n`
    + `[hooks.state."${hooks}:pre_tool_use:1:0"]\nenabled = false\n`);
  const res = diagnose(repo());
  assert.equal(res.ok, false);
  assert.ok(res.lines.join('\n').includes('Không có bản ghi trust cho 2/2 entry'));
});

// --- CLI thật: spawnSync vào bin/guardrail.mjs ----------------------------

function runCli(args, home, cwd) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: home,
      CODEX_HOME: home,
      GUARDRAIL_AUDIT_PATH: join(home, 'audit.jsonl'),
    },
  });
}

test('CLI doctor thoát 1 và in cảnh báo trust khi chưa cấp tin cậy', () => {
  const home = sandbox();
  install({ sourceDir: SOURCE });
  const res = runCli(['doctor'], home, repo());
  assert.equal(res.status, 1);
  assert.ok(res.stdout.includes('CHƯA được Codex tin cậy'));
  assert.ok(res.stdout.includes('Gõ: /hooks'));
  assert.ok(res.stdout.endsWith('\n'));
});

test('CLI doctor thoát 0 khi đã có đủ bản ghi trust', () => {
  const home = sandbox();
  install({ sourceDir: SOURCE });
  writeTrust(home, [[0, 0], [1, 0]]);
  const res = runCli(['doctor'], home, repo());
  assert.equal(res.status, 0);
  assert.ok(res.stdout.includes('Có bản ghi trust cho đủ 2 entry'));
});

test('CLI doctor thoát 1 khi chưa cài', () => {
  const home = sandbox();
  const res = runCli(['doctor'], home, repo());
  assert.equal(res.status, 1);
  assert.ok(res.stdout.includes('chưa được cài'));
});

test('CLI doctor không in lại nội dung config.toml', () => {
  const home = sandbox();
  install({ sourceDir: SOURCE });
  const secret = 'ghp_khongduocinraday1234567890';
  const cfg = join(home, 'config.toml');
  writeFileSync(cfg, `${readFileSync(cfg, 'utf8')}\n[auth]\ntoken = "${secret}"\n`);
  const res = runCli(['doctor'], home, repo());
  assert.ok(!res.stdout.includes(secret));
  assert.ok(!res.stderr.includes(secret));
});
