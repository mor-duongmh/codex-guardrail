import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarize, formatStats } from '../lib/stats.mjs';

const SOURCE = fileURLToPath(new URL('../', import.meta.url));
const BIN = join(SOURCE, 'bin', 'guardrail.mjs');

const entries = [
  { decision: 'denied', ruleId: 'infra.deny-binary' },
  { decision: 'denied', ruleId: 'infra.deny-binary' },
  { decision: 'escaped', ruleId: 'infra.deny-binary' },
  { decision: 'denied', ruleId: 'git.protected-branch' },
];

test('gộp theo ruleId, đếm riêng denied và escaped', () => {
  const { rows, total } = summarize(entries);
  assert.equal(total, 4);
  const infra = rows.find(r => r.ruleId === 'infra.deny-binary');
  assert.equal(infra.denied, 2);
  assert.equal(infra.escaped, 1);
  const git = rows.find(r => r.ruleId === 'git.protected-branch');
  assert.equal(git.denied, 1);
  assert.equal(git.escaped, 0);
});

test('sắp giảm dần theo tổng số lần bắn', () => {
  assert.equal(summarize(entries).rows[0].ruleId, 'infra.deny-binary');
});

test('rule chỉ bị escape vẫn xếp theo TỔNG, không bị đẩy xuống cuối', () => {
  const rows = summarize([
    { decision: 'denied', ruleId: 'it' },
    { decision: 'escaped', ruleId: 'nhieu' },
    { decision: 'escaped', ruleId: 'nhieu' },
    { decision: 'escaped', ruleId: 'nhieu' },
  ]).rows;
  assert.equal(rows[0].ruleId, 'nhieu');
  assert.equal(rows[0].denied, 0);
  assert.equal(rows[0].escaped, 3);
});

test('dòng thiếu ruleId vẫn được đếm vào tổng', () => {
  const { rows, total } = summarize([{ decision: 'denied' }, { decision: 'escaped' }]);
  assert.equal(total, 2);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].ruleId, '(không rõ)');
  assert.equal(rows[0].denied, 1);
  assert.equal(rows[0].escaped, 1);
});

test('log rỗng thì nói rõ chưa có dữ liệu', () => {
  const out = formatStats(summarize([]));
  assert.ok(out.includes('chưa có'));
  // Log rỗng có hai nghĩa trái ngược; phải chỉ sang doctor chứ không để người
  // đọc tự chọn nghĩa dễ chịu hơn.
  assert.ok(out.includes('guardrail doctor'));
});

test('formatStats in đủ ruleId và số đếm', () => {
  const out = formatStats(summarize(entries));
  assert.ok(out.includes('infra.deny-binary'));
  assert.ok(out.includes('git.protected-branch'));
  assert.ok(out.includes('Tổng 4 lần ghi'));
  const row = out.split('\n').find(l => l.startsWith('infra.deny-binary'));
  assert.match(row, /^infra\.deny-binary\s+2\s+1$/);
});

test('cột rule rộng theo ruleId dài nhất, không cắt tên', () => {
  const long = 'selfprotect.mot-cai-ruleid-rat-dai';
  const out = formatStats(summarize([{ decision: 'denied', ruleId: long }]));
  assert.ok(out.includes(long));
  const [head, row] = out.split('\n');
  assert.equal(head.indexOf('chặn'), row.indexOf('1') - 3);
});

// --- CLI thật: spawnSync vào bin/guardrail.mjs ----------------------------

function runStats(auditPath, extraEnv = {}) {
  const home = mkdtempSync(join(tmpdir(), 'guardrail-stats-home-'));
  return spawnSync(process.execPath, [BIN, 'stats'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: home,
      CODEX_HOME: home,
      GUARDRAIL_AUDIT_PATH: auditPath,
      ...extraEnv,
    },
  });
}

test('CLI stats đọc audit log được tiêm và thoát 0', () => {
  const dir = mkdtempSync(join(tmpdir(), 'guardrail-stats-'));
  const p = join(dir, 'audit.jsonl');
  writeFileSync(p, `${entries.map(e => JSON.stringify(e)).join('\n')}\n`);
  const res = runStats(p);
  assert.equal(res.status, 0);
  assert.ok(res.stdout.includes('infra.deny-binary'));
  assert.ok(res.stdout.includes('Tổng 4 lần ghi'));
});

test('CLI stats với log chưa tồn tại vẫn thoát 0 và nói chưa có dữ liệu', () => {
  const dir = mkdtempSync(join(tmpdir(), 'guardrail-stats-'));
  const res = runStats(join(dir, 'chua-co.jsonl'));
  assert.equal(res.status, 0);
  assert.ok(res.stdout.includes('chưa có dữ liệu'));
});

test('CLI stats bỏ qua dòng hỏng chứ không chết', () => {
  const dir = mkdtempSync(join(tmpdir(), 'guardrail-stats-'));
  const p = join(dir, 'audit.jsonl');
  writeFileSync(p, `${JSON.stringify(entries[0])}\nkhong-phai-json\n`
    + `${JSON.stringify(entries[3])}\n`);
  const res = runStats(p);
  assert.equal(res.status, 0);
  assert.ok(res.stdout.includes('Tổng 2 lần ghi'));
});
