import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, appendFileSync, statSync, chmodSync } from 'node:fs';
import { tmpdir, platform } from 'node:os';
import { join } from 'node:path';

function freshAudit() {
  const dir = mkdtempSync(join(tmpdir(), 'guardrail-audit-'));
  process.env.GUARDRAIL_AUDIT_PATH = join(dir, 'audit.jsonl');
  return process.env.GUARDRAIL_AUDIT_PATH;
}

test('ghi một dòng JSONL có ts và ruleId', async () => {
  const p = freshAudit();
  const { record } = await import('../lib/audit.mjs');
  record({ decision: 'denied', ruleId: 'infra.deny-binary', event: 'PreToolUse',
           tool: 'Bash', repo: 'demo', branch: 'feat/x', command: 'psql -l' });
  const lines = readFileSync(p, 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  const e = JSON.parse(lines[0]);
  assert.equal(e.ruleId, 'infra.deny-binary');
  assert.equal(e.decision, 'denied');
  assert.ok(typeof e.ts === 'string' && e.ts.includes('T'));
});

test('command được redact trước khi ghi', async () => {
  const p = freshAudit();
  const { record } = await import('../lib/audit.mjs');
  record({ decision: 'denied', ruleId: 'x',
           command: 'curl -H "Bearer sk-abcdefghijklmnopqrstuvwxyz01"' });
  assert.ok(!readFileSync(p, 'utf8').includes('abcdefghij'));
});

test('nối thêm dòng, không ghi đè', async () => {
  const p = freshAudit();
  const { record } = await import('../lib/audit.mjs');
  record({ decision: 'denied', ruleId: 'a' });
  record({ decision: 'escaped', ruleId: 'b' });
  assert.equal(readFileSync(p, 'utf8').trim().split('\n').length, 2);
});

test('đường dẫn không ghi được thì KHÔNG ném', async () => {
  process.env.GUARDRAIL_AUDIT_PATH = '/khong-ton-tai-chac-chan/audit.jsonl';
  const { record } = await import('../lib/audit.mjs');
  assert.doesNotThrow(() => record({ decision: 'denied', ruleId: 'x' }));
});

test('readEntries bỏ qua dòng hỏng', async () => {
  const p = freshAudit();
  const { record, readEntries } = await import('../lib/audit.mjs');
  record({ decision: 'denied', ruleId: 'a' });
  appendFileSync(p, 'không phải json\n');
  record({ decision: 'denied', ruleId: 'b' });
  assert.equal(readEntries().length, 2);
});

test('file có quyền 0o600, directory có quyền 0o700 (POSIX only)', async () => {
  if (platform() === 'win32') return; // Bỏ qua Windows
  const p = freshAudit();
  const dir = join(p, '..');
  const { record } = await import('../lib/audit.mjs');

  // Setup: chmod directory thành 0o755 để verify record() đặt lại thành 0o700
  chmodSync(dir, 0o755);

  record({ decision: 'denied', ruleId: 'x' });

  const fileStat = statSync(p);
  const dirStat = statSync(dir);

  // Kiểm tra quyền file là 0o600 (rw-------)
  const fileMode = fileStat.mode & parseInt('777', 8);
  assert.equal(fileMode, 0o600, `expected file mode 0o600, got 0o${fileMode.toString(8)}`);

  // Kiểm tra quyền directory là 0o700 (rwx------)
  const dirMode = dirStat.mode & parseInt('777', 8);
  assert.equal(dirMode, 0o700, `expected dir mode 0o700, got 0o${dirMode.toString(8)}`);
});
