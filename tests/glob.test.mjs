import test from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { globToRegExp, normalizePath, matchesAny } from '../lib/glob.mjs';
import { ALLOW, deny } from '../lib/result.mjs';

const hit = (pattern, token) => globToRegExp(pattern).test(normalizePath(token));

test('**/ khớp cả ở gốc và trong thư mục con', () => {
  assert.ok(hit('**/.env', '.env'));
  assert.ok(hit('**/.env', 'src/.env'));
  assert.ok(hit('**/.env', '/Users/x/app/.env'));
});

test('**/.env.* khớp biến thể nhưng không khớp .env trơn', () => {
  assert.ok(hit('**/.env.*', '.env.production'));
  assert.equal(hit('**/.env.*', '.env'), false);
});

test('* không vượt dấu gạch chéo', () => {
  assert.ok(hit('src/*.ts', 'src/a.ts'));
  assert.equal(hit('src/*.ts', 'src/deep/a.ts'), false);
});

test('~ được mở thành home', () => {
  assert.ok(hit('~/.ssh/**', `${homedir()}/.ssh/id_rsa`));
  assert.ok(hit('~/.ssh/**', '~/.ssh/id_rsa'));
});

test('dấu chấm được escape, không thành ký tự đại diện', () => {
  assert.equal(hit('**/.env', 'xenv'), false);
});

test('normalizePath bỏ quote và đổi backslash thành slash', () => {
  assert.equal(normalizePath('"src\\a.ts"'), 'src/a.ts');
});

test('matchesAny', () => {
  const res = [globToRegExp('**/*.pem'), globToRegExp('**/.env')];
  assert.ok(matchesAny(normalizePath('certs/server.pem'), res));
  assert.equal(matchesAny(normalizePath('src/a.ts'), res), false);
});

test('ALLOW là hằng đóng băng, deny sinh đủ bốn khoá', () => {
  assert.equal(ALLOW.decision, 'allow');
  assert.ok(Object.isFrozen(ALLOW));
  const d = deny('infra.deny-binary', 'vì sao', 'làm gì');
  assert.deepEqual(Object.keys(d).sort(), ['decision', 'hint', 'reason', 'ruleId']);
});

test('normalizePath với home Windows không còn chứa backslash', () => {
  const winHome = 'C:\\Users\\Duong';
  const result = normalizePath('~/x', winHome);
  assert.equal(result, 'C:/Users/Duong/x');
  assert.equal(result.includes('\\'), false);
});

test('globToRegExp với home Windows khớp đúng path đã normalize', () => {
  const winHome = 'C:\\Users\\Duong';
  const pattern = globToRegExp('~/.aws/credentials', winHome);
  const path = normalizePath('C:\\Users\\Duong\\.aws\\credentials', winHome);
  assert.ok(pattern.test(path), 'pattern should match normalized windows path');
});

test('home chứa escape sequence nguy hiểm (\\d) phải khớp literal', () => {
  const winHomeWithDangerousSeq = 'C:\\dev';
  const pattern = globToRegExp('~/**/*.env', winHomeWithDangerousSeq);
  const path = normalizePath('C:\\dev\\app\\.env', winHomeWithDangerousSeq);
  assert.ok(pattern.test(path), 'regex should match literal path, not interpret \\d as digit class');
});
