import test from 'node:test';
import assert from 'node:assert/strict';
import { redact, findSecretKinds } from '../lib/redact.mjs';

test('che AWS access key id', () => {
  const out = redact('aws key AKIAIOSFODNN7EXAMPLE done');
  assert.ok(!out.includes('AKIAIOSFODNN7EXAMPLE'));
  assert.ok(out.includes('AKIA***'));
});

test('che OpenAI-style key', () => {
  assert.ok(!redact('sk-abcdefghijklmnopqrstuvwxyz0123').includes('abcdefghij'));
});

test('che GitHub token', () => {
  assert.ok(!redact('ghp_abcdefghijklmnopqrstuvwxyz0123').includes('abcdefghij'));
});

test('che JWT', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcDEF123';
  assert.ok(!redact(`token ${jwt}`).includes('eyJzdWIi'));
});

test('che private key block', () => {
  const pem = '-----BEGIN RSA PRIVATE KEY-----\nAAAA\n-----END RSA PRIVATE KEY-----';
  assert.equal(redact(pem), '***private-key***');
});

test('không đụng text vô hại', () => {
  assert.equal(redact('psql -h localhost -U app'), 'psql -h localhost -U app');
});

test('findSecretKinds trả tên loại', () => {
  assert.deepEqual(findSecretKinds('AKIAIOSFODNN7EXAMPLE'), ['aws-access-key-id']);
  assert.deepEqual(findSecretKinds('không có gì'), []);
});

test('chuỗi rỗng hoặc null an toàn', () => {
  assert.equal(redact(''), '');
  assert.equal(redact(null), '');
});

test('che URL userinfo - postgresql', () => {
  const cmd = 'psql postgresql://admin:S3cr3tPw@db.prod:5432/app';
  assert.ok(!redact(cmd).includes('S3cr3tPw'));
  assert.ok(redact(cmd).includes('admin:***@'));
});

test('che password flag -p mysql', () => {
  const cmd = 'mysql -uroot -pMyP4ssw0rd app_db';
  assert.ok(!redact(cmd).includes('MyP4ssw0rd'));
  assert.ok(redact(cmd).includes('-p***'));
});

test('che env assignment AWS_SECRET_ACCESS_KEY', () => {
  const cmd = 'AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCY aws s3 ls';
  assert.ok(!redact(cmd).includes('wJalrXUtnFEMI'));
  assert.ok(redact(cmd).includes('AWS_SECRET_ACCESS_KEY=***'));
});

test('che Authorization Bearer header', () => {
  const cmd = 'curl -H "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc.def" api';
  assert.ok(!redact(cmd).includes('eyJhbGciOiJIUzI1NiJ9'));
  assert.ok(redact(cmd).includes('Authorization: Bearer ***'));
});

test('findSecretKinds tìm multiple loại', () => {
  const cmd = 'AWS_SECRET_ACCESS_KEY=secret postgresql://user:pass@host ghp_abcdefghijklmnopqrst';
  const kinds = findSecretKinds(cmd);
  assert.ok(kinds.includes('env-sensitive'));
  assert.ok(kinds.includes('url-userinfo'));
  assert.ok(kinds.includes('github-token'));
});
