import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../../lib/rules/secrets.mjs';
import { loadDefaultPolicy } from '../../lib/policy.mjs';

const P = loadDefaultPolicy();
const shell = (command) => ({ tool: 'Bash', command, patchFiles: [] });
const patch = (files) => ({ tool: 'apply_patch', command: null, patchFiles: files });

test('chặn đọc .env bất kể động từ', () => {
  for (const cmd of ['cat .env', 'head -5 .env', 'less src/.env', 'code .env']) {
    assert.equal(evaluate(shell(cmd), P).ruleId, 'secrets.read-path', cmd);
  }
});

test('cho phép .env.example', () => {
  assert.equal(evaluate(shell('cat .env.example'), P).decision, 'allow');
});

test('chặn .env.production', () => {
  assert.equal(evaluate(shell('cat .env.production'), P).ruleId, 'secrets.read-path');
});

test('chặn khoá riêng và credential', () => {
  for (const cmd of ['cat certs/server.pem', 'cat ~/.ssh/id_rsa', 'cat ~/.aws/credentials']) {
    assert.equal(evaluate(shell(cmd), P).decision, 'deny', cmd);
  }
});

test('chặn xả env nhưng không chặn env có tham số', () => {
  assert.equal(evaluate(shell('env'), P).ruleId, 'secrets.env-dump');
  assert.equal(evaluate(shell('printenv'), P).ruleId, 'secrets.env-dump');
  assert.equal(evaluate(shell('env FOO=1 npm test'), P).decision, 'allow');
});

test('chặn đọc secret manager', () => {
  for (const cmd of [
    'aws secretsmanager get-secret-value --secret-id x',
    'gcloud secrets versions access latest --secret=x',
    'vault read secret/x',
    'kubectl get secret my-secret -o yaml',
  ]) {
    assert.equal(evaluate(shell(cmd), P).ruleId, 'secrets.manager-read', cmd);
  }
});

test('chặn ghi vào file nhạy cảm qua apply_patch', () => {
  assert.equal(evaluate(patch(['.env']), P).ruleId, 'secrets.write-path');
  assert.equal(evaluate(patch(['src/a.ts']), P).decision, 'allow');
});

test('lệnh không liên quan thì cho qua', () => {
  assert.equal(evaluate(shell('npm test'), P).decision, 'allow');
  assert.equal(evaluate(shell(''), P).decision, 'allow');
  assert.equal(evaluate({ tool: 'Bash', command: null, patchFiles: [] }, P).decision, 'allow');
});

test('message deny nói đủ ba điều', () => {
  const r = evaluate(shell('cat .env'), P);
  assert.ok(r.reason.length > 0);
  assert.ok(r.hint.length > 0);
  assert.ok(r.reason.includes('.env'));
});

test('không chặn oan khi tên file chỉ nằm trong câu văn', () => {
  assert.equal(evaluate(shell('git commit -m "thêm .env vào gitignore"'), P).decision, 'allow');
});
