// tests/install.test.mjs
// MỌI test ở đây thao tác trên thư mục tạm qua CODEX_HOME. Không test nào được
// đọc/ghi ~/.codex thật — file đó là cấu hình hook đang chạy của người dùng.
// Dòng ngay dưới đặt CODEX_HOME TRƯỚC khi import lib, nên kể cả test nào quên
// gọi sandbox() thì đích vẫn là thư mục tạm.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync, rmSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.CODEX_HOME = mkdtempSync(join(tmpdir(), 'guardrail-install-default-'));

const {
  install, uninstall, checkNode, enableCodexHooks, mergeHooks,
  sidecarPath, installDir, codexHome,
} = await import('../lib/install.mjs');

const SOURCE = fileURLToPath(new URL('../', import.meta.url));
const CLI = fileURLToPath(new URL('../bin/guardrail.mjs', import.meta.url));

// Khối hướng dẫn /hooks được dán NGUYÊN VĂN vào test, không import từ lib.
// Nếu assert lấy hằng số từ chính lib thì sửa lời văn trong lib vẫn xanh —
// assert đó không kiểm gì cả.
const TRUST_BLOCK = `⚠ Còn MỘT bước bạn phải tự làm — guardrail chưa chạy nếu thiếu bước này.

  Codex bỏ qua mọi hook chưa được cấp tin cậy, và không báo gì cả.

  1. Mở Codex CLI
  2. Gõ: /hooks
  3. Duyệt và cấp tin cậy (grant trust) cho các mục codex-guardrail

  Chỉ phải làm MỘT LẦN. Sửa codex-guardrail.json về sau không làm mất tin cậy,
  vì rule nằm trong file policy chứ không nằm trong lệnh hook.

  Kiểm lại bằng: guardrail doctor`;

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'guardrail-install-'));
  process.env.CODEX_HOME = dir;
  // Chốt an toàn: nếu điểm tiêm hỏng thì test phải đỏ ở đây, chứ không âm thầm
  // đi ghi vào ~/.codex thật.
  assert.equal(codexHome(), dir);
  assert.ok(!dir.startsWith(join(homedir(), '.codex')));
  return dir;
}

function hooksOf(home) {
  return JSON.parse(readFileSync(join(home, 'hooks.json'), 'utf8'));
}

test('codexHome đọc CODEX_HOME, không bao giờ ghi ra ~/.codex trong test', () => {
  const dir = sandbox();
  assert.equal(codexHome(), dir);
  assert.equal(installDir(), join(dir, 'guardrail'));
  assert.equal(sidecarPath(), join(dir, '.guardrail-installed.json'));
});

test('checkNode từ chối bản dưới 20', () => {
  assert.equal(checkNode('v18.19.0').ok, false);
  assert.equal(checkNode('v20.11.0').ok, true);
  assert.equal(checkNode('v22.3.0').ok, true);
});

test('enableCodexHooks thêm mục features khi chưa có', () => {
  const out = enableCodexHooks('model = "gpt-5.4"\n');
  assert.ok(out.includes('[features]'));
  assert.ok(out.includes('codex_hooks = true'));
  assert.ok(out.startsWith('model = "gpt-5.4"\n'));
});

test('enableCodexHooks bật lại khi đang false, không đụng khoá khác', () => {
  const out = enableCodexHooks('[features]\ncodex_hooks = false\njs_repl = false\n');
  assert.ok(out.includes('codex_hooks = true'));
  assert.ok(!out.includes('codex_hooks = false'));
  assert.ok(out.includes('js_repl = false'));
});

test('enableCodexHooks không nhân bản khi đã true', () => {
  const src = '[features]\ncodex_hooks = true\n';
  assert.equal(enableCodexHooks(src), src);
});

test('mergeHooks giữ nguyên entry sẵn có', () => {
  const existing = {
    hooks: {
      SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: 'morkit.sh' }] }],
    },
  };
  const out = mergeHooks(existing, [
    { event: 'PreToolUse', matcher: 'Bash', command: 'node g.mjs hook' },
  ]);
  assert.equal(out.hooks.SessionStart.length, 1);
  assert.equal(out.hooks.SessionStart[0].hooks[0].command, 'morkit.sh');
  assert.equal(out.hooks.PreToolUse.length, 1);
});

test('mergeHooks không sửa object đầu vào', () => {
  const existing = { hooks: { SessionStart: [] } };
  mergeHooks(existing, [{ event: 'PreToolUse', matcher: 'Bash', command: 'x' }]);
  assert.equal(existing.hooks.PreToolUse, undefined);
});

test('install ghi hooks.json, sidecar, và copy runtime', () => {
  const home = sandbox();
  writeFileSync(join(home, 'config.toml'), 'model = "gpt-5.4"\n');
  const res = install({ sourceDir: SOURCE });
  assert.equal(res.ok, true);
  const hooks = hooksOf(home);
  assert.ok(hooks.hooks.PreToolUse.length >= 2);
  assert.ok(existsSync(sidecarPath()));
  assert.ok(existsSync(join(installDir(), 'bin', 'guardrail.mjs')));
  assert.ok(existsSync(join(installDir(), 'policy', 'default.json')));
  assert.ok(existsSync(join(installDir(), 'lib', 'dispatch.mjs')));
  assert.ok(readFileSync(join(home, 'config.toml'), 'utf8').includes('codex_hooks = true'));
});

// Task 0 đã ĐO tên tool thật: `Bash` và `apply_patch`. Matcher `shell` là tên
// suy đoán trong tài liệu cũ; wire sai matcher thì hook không bao giờ chạy và
// Codex không báo gì — đúng chế độ hỏng im lặng mà guardrail phải tránh.
test('matcher là Bash và apply_patch, không có shell', () => {
  const home = sandbox();
  install({ sourceDir: SOURCE });
  const groups = hooksOf(home).hooks.PreToolUse;
  const matchers = groups.map(g => g.matcher).sort();
  assert.deepEqual(matchers, ['Bash', 'apply_patch']);
  const raw = readFileSync(join(home, 'hooks.json'), 'utf8');
  assert.ok(!/"matcher":\s*"shell"/.test(raw));
  for (const g of groups) {
    assert.equal(g.hooks[0].type, 'command');
    assert.ok(g.hooks[0].command.includes(join(installDir(), 'bin', 'guardrail.mjs')));
    assert.ok(g.hooks[0].command.endsWith(' hook'));
  }
});

test('install chạy lại không nhân bản entry', () => {
  const home = sandbox();
  install({ sourceDir: SOURCE });
  const first = readFileSync(join(home, 'hooks.json'), 'utf8');
  const res = install({ sourceDir: SOURCE });
  assert.equal(res.ok, true);
  assert.equal(readFileSync(join(home, 'hooks.json'), 'utf8'), first);
  assert.equal(hooksOf(home).hooks.PreToolUse.length, 2);
});

test('install không phá hooks.json đang có nội dung và có backup', () => {
  const home = sandbox();
  writeFileSync(join(home, 'hooks.json'), JSON.stringify({
    hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'morkit.sh' }] }] },
  }));
  install({ sourceDir: SOURCE });
  const hooks = hooksOf(home);
  assert.equal(hooks.hooks.SessionStart[0].hooks[0].command, 'morkit.sh');
  assert.ok(existsSync(join(home, 'hooks.json.bak')));
  assert.equal(
    JSON.parse(readFileSync(join(home, 'hooks.json.bak'), 'utf8')).hooks.PreToolUse,
    undefined,
  );
});

test('install giữ entry PreToolUse của tool khác cùng matcher Bash', () => {
  const home = sandbox();
  writeFileSync(join(home, 'hooks.json'), JSON.stringify({
    hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'other.sh' }] }] },
  }));
  install({ sourceDir: SOURCE });
  const groups = hooksOf(home).hooks.PreToolUse;
  assert.equal(groups.length, 3);
  assert.ok(groups.some(g => g.hooks[0].command === 'other.sh'));
});

test('install báo thành công MỘT NỬA và in nguyên khối hướng dẫn /hooks', () => {
  sandbox();
  const res = install({ sourceDir: SOURCE });
  assert.equal(res.ok, true);
  assert.equal(res.trustNotice, TRUST_BLOCK);
  const tail = res.messages[res.messages.length - 1];
  assert.match(tail, /MỘT NỬA|một nửa|còn một bước|còn MỘT bước/i);
});

test('không có output nào dạy dev tắt cơ chế trust', () => {
  sandbox();
  const res = install({ sourceDir: SOURCE });
  const all = [...res.messages, res.trustNotice, ...uninstall().messages].join('\n');
  assert.ok(!/bypass/i.test(all));
  assert.ok(!/dangerous/i.test(all));
  for (const file of ['lib/install.mjs', 'bin/guardrail.mjs']) {
    const src = readFileSync(join(SOURCE, file), 'utf8');
    assert.ok(!/bypass/i.test(src), `${file} nhắc tới cờ bypass trust`);
    assert.ok(!/dangerous/i.test(src), `${file} nhắc tới cờ bypass trust`);
  }
});

test('uninstall gỡ đúng entry của mình, giữ entry người khác', () => {
  const home = sandbox();
  writeFileSync(join(home, 'hooks.json'), JSON.stringify({
    hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'other.sh' }] }] },
  }));
  install({ sourceDir: SOURCE });
  const res = uninstall();
  assert.equal(res.ok, true);
  const hooks = hooksOf(home);
  assert.equal(hooks.hooks.PreToolUse.length, 1);
  assert.equal(hooks.hooks.PreToolUse[0].hooks[0].command, 'other.sh');
  assert.equal(existsSync(installDir()), false);
  assert.equal(existsSync(sidecarPath()), false);
});

test('uninstall xoá luôn khoá event khi không còn entry nào', () => {
  const home = sandbox();
  install({ sourceDir: SOURCE });
  uninstall();
  assert.deepEqual(hooksOf(home).hooks, {});
});

test('uninstall không đụng codex_hooks trong config.toml', () => {
  const home = sandbox();
  writeFileSync(join(home, 'config.toml'), 'model = "gpt-5.4"\n');
  install({ sourceDir: SOURCE });
  uninstall();
  assert.ok(readFileSync(join(home, 'config.toml'), 'utf8').includes('codex_hooks = true'));
});

test('uninstall khi chưa cài thì báo rõ, không ném', () => {
  sandbox();
  const res = uninstall();
  assert.equal(res.ok, false);
  assert.ok(res.messages.join(' ').includes('chưa được cài'));
});

test('uninstall không tạo hooks.json mới khi người dùng chưa có file đó', () => {
  const home = sandbox();
  install({ sourceDir: SOURCE });
  // Người dùng xoá tay hooks.json giữa hai lần chạy: uninstall không được tạo lại rác.
  rmSync(join(home, 'hooks.json'));
  const res = uninstall();
  assert.equal(res.ok, true);
  assert.equal(existsSync(join(home, 'hooks.json')), false);
});

test('hooks.json hỏng JSON: install từ chối và KHÔNG ghi gì', () => {
  const home = sandbox();
  const broken = '{ "hooks": { "SessionStart": [ } }';
  writeFileSync(join(home, 'hooks.json'), broken);
  const before = readdirSync(home).sort();
  const res = install({ sourceDir: SOURCE });
  assert.equal(res.ok, false);
  assert.match(res.messages.join('\n'), /JSON/);
  assert.equal(readFileSync(join(home, 'hooks.json'), 'utf8'), broken);
  assert.deepEqual(readdirSync(home).sort(), before);
  assert.equal(existsSync(installDir()), false);
  assert.equal(existsSync(join(home, 'hooks.json.bak')), false);
  assert.equal(existsSync(sidecarPath()), false);
});

test('hooks.json hỏng JSON: uninstall từ chối, giữ nguyên file và runtime', () => {
  const home = sandbox();
  install({ sourceDir: SOURCE });
  const broken = '{ oops';
  writeFileSync(join(home, 'hooks.json'), broken);
  const res = uninstall();
  assert.equal(res.ok, false);
  assert.match(res.messages.join('\n'), /JSON/);
  assert.equal(readFileSync(join(home, 'hooks.json'), 'utf8'), broken);
  assert.ok(existsSync(installDir()));
  assert.ok(existsSync(sidecarPath()));
});

test('hooks.json đúng JSON nhưng sai hình dạng: install từ chối, không ghi', () => {
  const home = sandbox();
  const weird = '{"hooks": [1, 2, 3]}';
  writeFileSync(join(home, 'hooks.json'), weird);
  const res = install({ sourceDir: SOURCE });
  assert.equal(res.ok, false);
  assert.equal(readFileSync(join(home, 'hooks.json'), 'utf8'), weird);
  assert.equal(existsSync(installDir()), false);
});

test('install từ chối khi nguồn trùng đích, không tự xoá bản đang chạy', () => {
  sandbox();
  install({ sourceDir: SOURCE });
  const res = install({ sourceDir: installDir() });
  assert.equal(res.ok, false);
  assert.ok(existsSync(join(installDir(), 'bin', 'guardrail.mjs')));
});

test('sidecar ghi lại đúng entry đã thêm', () => {
  sandbox();
  install({ sourceDir: SOURCE });
  const car = JSON.parse(readFileSync(sidecarPath(), 'utf8'));
  assert.equal(car.version, JSON.parse(readFileSync(join(SOURCE, 'package.json'), 'utf8')).version);
  assert.equal(car.entries.length, 2);
  assert.deepEqual(car.entries.map(e => e.matcher).sort(), ['Bash', 'apply_patch']);
  assert.ok(Date.parse(car.installedAt) > 0);
});

test('sidecar hỏng: uninstall báo rõ, không đoán bừa entry để xoá', () => {
  const home = sandbox();
  install({ sourceDir: SOURCE });
  writeFileSync(sidecarPath(), 'not json');
  const before = readFileSync(join(home, 'hooks.json'), 'utf8');
  const res = uninstall();
  assert.equal(res.ok, false);
  assert.equal(readFileSync(join(home, 'hooks.json'), 'utf8'), before);
  assert.ok(existsSync(installDir()));
});

// CLI đi qua ĐƯỜNG THẬT: spawn bin/guardrail.mjs, đọc stdout/exit code như Codex
// và người dùng thấy. Gọi hàm trực tiếp không kiểm được việc bin có in khối
// hướng dẫn hay có trả exit code đúng.
test('CLI install: exit 0, in khối hướng dẫn /hooks, không dạy tắt trust', () => {
  const home = mkdtempSync(join(tmpdir(), 'guardrail-cli-'));
  const r = spawnSync(process.execPath, [CLI, 'install'], {
    env: { ...process.env, CODEX_HOME: home }, encoding: 'utf8',
  });
  assert.equal(r.status, 0);
  assert.ok(r.stdout.includes(TRUST_BLOCK), `stdout thiếu khối hướng dẫn:\n${r.stdout}`);
  assert.ok(!/bypass/i.test(r.stdout + r.stderr));
  assert.ok(existsSync(join(home, 'hooks.json')));
  assert.ok(statSync(join(home, 'guardrail', 'bin', 'guardrail.mjs')).isFile());
});

test('CLI uninstall khi chưa cài: exit 1 và nói rõ lý do', () => {
  const home = mkdtempSync(join(tmpdir(), 'guardrail-cli-'));
  const r = spawnSync(process.execPath, [CLI, 'uninstall'], {
    env: { ...process.env, CODEX_HOME: home }, encoding: 'utf8',
  });
  assert.equal(r.status, 1);
  assert.match(r.stdout + r.stderr, /chưa được cài/);
});

test('CLI install rồi uninstall: hooks.json sạch, exit 0 cả hai lần', () => {
  const home = mkdtempSync(join(tmpdir(), 'guardrail-cli-'));
  const env = { ...process.env, CODEX_HOME: home };
  assert.equal(spawnSync(process.execPath, [CLI, 'install'], { env, encoding: 'utf8' }).status, 0);
  const r = spawnSync(process.execPath, [CLI, 'uninstall'], { env, encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.deepEqual(JSON.parse(readFileSync(join(home, 'hooks.json'), 'utf8')).hooks, {});
  assert.equal(existsSync(join(home, 'guardrail')), false);
});

test('CLI hook vẫn chạy được từ bản đã copy vào CODEX_HOME', () => {
  const home = mkdtempSync(join(tmpdir(), 'guardrail-cli-'));
  const env = { ...process.env, CODEX_HOME: home };
  assert.equal(spawnSync(process.execPath, [CLI, 'install'], { env, encoding: 'utf8' }).status, 0);
  const copied = join(home, 'guardrail', 'bin', 'guardrail.mjs');
  const payload = JSON.stringify({
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'echo hello' },
    cwd: SOURCE,
  });
  const r = spawnSync(process.execPath, [copied, 'hook'], { input: payload, encoding: 'utf8' });
  assert.equal(r.status, 0);
});
