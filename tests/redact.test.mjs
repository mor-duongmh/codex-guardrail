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

test('LỘ: psql --password cách bằng space không được che', () => {
  const cmd = 'psql -h prod-db --password S3cr3tPw -U admin app';
  const out = redact(cmd);
  assert.ok(!out.includes('S3cr3tPw'), 'S3cr3tPw phải được che');
});

test('LỘ: mysqldump --password space không được che', () => {
  const cmd = 'mysqldump --password MyP4ssw0rd db';
  const out = redact(cmd);
  assert.ok(!out.includes('MyP4ssw0rd'), 'MyP4ssw0rd phải được che');
});

test('che-thừa: npm run build --production không thay đổi', () => {
  const cmd = 'npm run build --production';
  assert.equal(redact(cmd), cmd);
});

test('che-thừa: aws --profile không thay đổi', () => {
  const cmd = 'aws --profile prod s3 ls';
  assert.equal(redact(cmd), cmd);
});

test('che-thừa: git clone --progress không thay đổi', () => {
  const cmd = 'git clone --progress url';
  assert.equal(redact(cmd), cmd);
});

test('che: make -parallelism=5 (flag dài bị che do ambiguity)', () => {
  const cmd = 'make -parallelism=5';
  assert.ok(!redact(cmd).includes('parallelism'));
  assert.ok(redact(cmd).includes('-p***'));
});

test('findSecretKinds case-insensitive cho env variable', () => {
  assert.deepEqual(findSecretKinds('aws_secret_access_key=abc123'), ['env-sensitive']);
  assert.deepEqual(findSecretKinds('AWS_SECRET_ACCESS_KEY=abc123'), ['env-sensitive']);
});

test('che: mysql -psecret (lowercase)', () => {
  const cmd = 'mysql -psecret';
  assert.ok(!redact(cmd).includes('secret'));
  assert.ok(redact(cmd).includes('-p***'));
});

test('che: mysql -psecret123 với user', () => {
  const cmd = 'mysql -uroot -psecret123 db';
  assert.ok(!redact(cmd).includes('secret123'));
  assert.ok(redact(cmd).includes('-p***'));
});

test('che: mysql -p9pass (số đầu)', () => {
  const cmd = 'mysql -p9pass db';
  assert.ok(!redact(cmd).includes('9pass'));
  assert.ok(redact(cmd).includes('-p***'));
});

test('che: psql --password dạng flag rõ', () => {
  const cmd = 'psql -h prod-db --password S3cr3tPw -U admin app';
  assert.ok(!redact(cmd).includes('S3cr3tPw'));
  assert.ok(redact(cmd).includes('--password ***'));
});

test('che: mysqldump --password=pass dạng equals', () => {
  const cmd = 'mysqldump --password=P4ss99 db';
  assert.ok(!redact(cmd).includes('P4ss99'));
  assert.ok(redact(cmd).includes('--password=***'));
});

test('che: terraform -parallelism=5 (flag dài bị che do ambiguity)', () => {
  const cmd = 'terraform apply -parallelism=5';
  assert.ok(!redact(cmd).includes('parallelism'));
  assert.ok(redact(cmd).includes('-p***'));
});

test('che-thừa: terraform -var=foo không thay đổi', () => {
  const cmd = 'terraform apply -var=foo';
  assert.equal(redact(cmd), cmd);
});

test('che-thừa: aws --profile=prod không thay đổi', () => {
  const cmd = 'aws --profile=prod s3 ls';
  assert.equal(redact(cmd), cmd);
});

test('che-thừa: psql -p 5432 (cổng) không thay đổi', () => {
  const cmd = 'psql -p 5432 -h db -l';
  assert.equal(redact(cmd), cmd);
});
