// tests/policy.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergePolicy, loadPolicy, loadDefaultPolicy, findProjectRoot, PolicyError }
  from '../lib/policy.mjs';

function repo(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'guardrail-'));
  mkdirSync(join(dir, '.git'));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return dir;
}

test('default policy có mọi nhóm rule', () => {
  const p = loadDefaultPolicy();
  for (const k of ['secrets','infra','git','convention','quality','net','deps','selfProtect']) {
    assert.ok(k in p, `thiếu nhóm ${k}`);
  }
});

test('mảng được hợp, không bị thay thế', () => {
  const out = mergePolicy(
    { infra: { denyBinaries: ['psql', 'aws'] } },
    { infra: { denyBinaries: ['mongosh', 'psql'] } }
  );
  assert.deepEqual(out.infra.denyBinaries, ['psql', 'aws', 'mongosh']);
});

test('object lồng merge đệ quy, mảng bên trong vẫn hợp', () => {
  const out = mergePolicy(
    { infra: { ssh: { denyHosts: ['a'], inspectRemoteCommand: true } } },
    { infra: { ssh: { denyHosts: ['b'] } } }
  );
  assert.deepEqual(out.infra.ssh.denyHosts, ['a', 'b']);
  assert.equal(out.infra.ssh.inspectRemoteCommand, true);
});

test('vô hướng bị ghi đè, chuỗi rỗng tắt rule', () => {
  const out = mergePolicy(
    { git: { commitMessagePattern: '^x' } },
    { git: { commitMessagePattern: '' } }
  );
  assert.equal(out.git.commitMessagePattern, '');
});

test('khoá mới của dự án được thêm vào', () => {
  const out = mergePolicy({ infra: {} }, { infra: { allowBinaries: ['psql'] } });
  assert.deepEqual(out.infra.allowBinaries, ['psql']);
});

test('findProjectRoot đi lên tới .git', () => {
  const dir = repo();
  mkdirSync(join(dir, 'src', 'deep'), { recursive: true });
  assert.equal(findProjectRoot(join(dir, 'src', 'deep')), dir);
});

test('không có codex-guardrail.json thì dùng default kèm cảnh báo', () => {
  const { policy, source, warnings } = loadPolicy(repo());
  assert.equal(source, null);
  assert.ok(warnings.length > 0);
  assert.ok(policy.infra.denyBinaries.includes('psql'));
});

test('projectRoot null thì dùng default kèm cảnh báo', () => {
  const { source, warnings } = loadPolicy(null);
  assert.equal(source, null);
  assert.ok(warnings.some(w => w.includes('.git')));
});

test('JSON sai cú pháp thì ném PolicyError, KHÔNG âm thầm dùng default', () => {
  const dir = repo({ 'codex-guardrail.json': '{ "infra": ' });
  assert.throws(() => loadPolicy(dir), PolicyError);
});

test('policy dự án merge vào, deny mặc định vẫn còn', () => {
  const dir = repo({
    'codex-guardrail.json': JSON.stringify({ infra: { allowBinaries: ['psql'] } })
  });
  const { policy, source } = loadPolicy(dir);
  assert.ok(source.endsWith('codex-guardrail.json'));
  assert.ok(policy.infra.allowBinaries.includes('psql'));
  assert.ok(policy.infra.denyBinaries.includes('psql'));
});

test('override với null thay vì object ở field có trong default thì throw PolicyError', () => {
  const dir = repo({
    'codex-guardrail.json': JSON.stringify({ selfProtect: null })
  });
  assert.throws(() => loadPolicy(dir), PolicyError);
});

test('override top-level không phải object thì throw PolicyError', () => {
  const dir = repo({
    'codex-guardrail.json': JSON.stringify(false)
  });
  assert.throws(() => loadPolicy(dir), PolicyError);
});

test('override với object đúng kiểu vẫn merge được (hồi quy)', () => {
  const dir = repo({
    'codex-guardrail.json': JSON.stringify({
      infra: { allowBinaries: ['newbin'] }
    })
  });
  const { policy } = loadPolicy(dir);
  assert.ok(Array.isArray(policy.infra.allowBinaries));
  assert.ok(policy.infra.allowBinaries.includes('newbin'));
  assert.ok(policy.infra.denyBinaries.includes('psql'));
});
