import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../bin/guardrail.mjs', import.meta.url));

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'guardrail-cli-'));
  mkdirSync(join(dir, '.git'));
  return dir;
}

// timeout: hook treo là hỏng nặng như hook cho qua — Codex sẽ đứng chờ. Có
// timeout thì test ĐỎ thay vì treo cả suite.
function run(payloadStr, cwd, extraEnv = {}) {
  return spawnSync(process.execPath, [BIN, 'hook'], {
    input: payloadStr, encoding: 'utf8', timeout: 15000,
    env: {
      ...process.env,
      GUARDRAIL_AUDIT_PATH: join(cwd, 'audit.jsonl'),
      CODEX_GUARDRAIL_ALLOW: '',
      ...extraEnv,
    },
  });
}

const payload = (cwd, command) => JSON.stringify({
  hook_event_name: 'PreToolUse', tool_name: 'Bash', cwd, tool_input: { command },
});

test('exit 0 cho lệnh vô hại', () => {
  const dir = repo();
  const r = run(payload(dir, 'npm test'), dir);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, '');
});

test('deny in JSON ra stdout, vẫn exit 0', () => {
  const dir = repo();
  const r = run(payload(dir, 'terraform apply'), dir);
  assert.equal(r.status, 0, 'exit code không phải kênh chặn — phải luôn 0');
  const out = JSON.parse(r.stdout).hookSpecificOutput;
  assert.equal(out.hookEventName, 'PreToolUse');
  assert.equal(out.permissionDecision, 'deny');
  assert.ok(out.permissionDecisionReason.includes('infra.deny-binary'));
  // Codex nối `. Command: <lệnh>` ngay sau reason.
  assert.ok(!/[.\n]$/.test(out.permissionDecisionReason));
});

test('stdin rỗng vẫn deny qua JSON, exit 0', () => {
  const dir = repo();
  const r = run('', dir);
  assert.equal(r.status, 0);
  assert.equal(
    JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, 'deny');
});

test('escape đi qua process.env thật của CLI', () => {
  // Nếu bin truyền `{}` thay vì process.env vào runHook thì escape chết âm
  // thầm và chỉ test end-to-end này thấy.
  const dir = repo();
  const r = run(payload(dir, 'terraform apply'), dir,
    { CODEX_GUARDRAIL_ALLOW: 'infra.deny-binary' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.ok(r.stderr.includes('bị bỏ qua'));
});

test('không có subcommand thì in cách dùng và exit 1', () => {
  const r = spawnSync(process.execPath, [BIN], { encoding: 'utf8', input: '', timeout: 15000 });
  assert.equal(r.status, 1);
  assert.ok(r.stderr.includes('Cách dùng'));
});

test('subcommand lạ cũng in cách dùng và exit 1', () => {
  const r = spawnSync(process.execPath, [BIN, 'hooook'], { encoding: 'utf8', input: '', timeout: 15000 });
  assert.equal(r.status, 1);
  assert.ok(r.stderr.includes('Cách dùng'));
});

test('deny dài không bị cắt cụt trên pipe', async () => {
  // Trên macOS stdout dạng pipe ghi KHÔNG ĐỒNG BỘ, và `process.exit(0)` ngay
  // sau write phá handle trước khi libuv đẩy xong. Đã đo trên máy này: bản
  // dùng process.exit(0) chỉ giao 8192 byte đầu dù reader đọc ngay. Mất stdout
  // là mất CHÍNH CÁI DENY, và Codex thấy JSON hỏng thì CHO LỆNH CHẠY. Đường
  // dẫn dài đẩy reason vượt 8192 để test chạm được vào ngưỡng đó.
  const dir = repo();
  const longPath = 'deep/'.repeat(4000) + '.env';
  const child = spawn(process.execPath, [BIN, 'hook'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, GUARDRAIL_AUDIT_PATH: join(dir, 'audit.jsonl'), CODEX_GUARDRAIL_ALLOW: '' },
  });
  child.stdin.end(payload(dir, `cat ${longPath}`));

  let out = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (c) => { out += c; });
  child.stderr.resume();

  const code = await new Promise((res) => child.on('close', res));
  assert.equal(code, 0);
  assert.ok(out.length > 8192, `stdout bị cắt: chỉ nhận ${out.length} byte`);
  const parsed = JSON.parse(out).hookSpecificOutput;
  assert.equal(parsed.permissionDecision, 'deny');
  assert.ok(parsed.permissionDecisionReason.includes('secrets.read-path'));
});
