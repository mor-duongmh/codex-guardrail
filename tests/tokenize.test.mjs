import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand, basename } from '../lib/tokenize.mjs';

const bins = (cmd) => parseCommand(cmd).map(s => basename(s.argv[0]));

test('lệnh thường', () => {
  assert.deepEqual(bins('psql -h localhost'), ['psql']);
});

test('đường dẫn tuyệt đối vẫn ra basename', () => {
  assert.deepEqual(bins('/usr/bin/psql -l'), ['psql']);
});

test('bỏ tiền tố env và biến gán', () => {
  assert.deepEqual(bins('env FOO=1 psql'), ['psql']);
  assert.deepEqual(bins('FOO=1 BAR=2 psql'), ['psql']);
});

test('giải bash -c', () => {
  assert.ok(bins('bash -c "psql -l"').includes('psql'));
});

test('giải eval', () => {
  assert.ok(bins('eval "psql -l"').includes('psql'));
});

test('quote rời vẫn ra psql', () => {
  assert.deepEqual(bins("p''sql"), ['psql']);
  assert.deepEqual(bins('p"s"ql'), ['psql']);
});

test('backslash escape', () => {
  assert.deepEqual(bins('ps\\ql'), ['psql']);
});

test('tách theo ; && || | và newline', () => {
  assert.deepEqual(bins('ls && psql'), ['ls', 'psql']);
  assert.deepEqual(bins('ls | grep x'), ['ls', 'grep']);
  assert.deepEqual(bins('ls\npsql'), ['ls', 'psql']);
  assert.deepEqual(bins('ls; psql'), ['ls', 'psql']);
  assert.deepEqual(bins('ls || psql'), ['ls', 'psql']);
});

test('command substitution cũng được phân tích', () => {
  assert.ok(bins('$(which psql) -l').includes('which'));
});

test('không lặp vô hạn khi lồng sâu', () => {
  assert.ok(parseCommand('bash -c "bash -c \\"bash -c ls\\""').length <= 8);
});

test('chuỗi rỗng hoặc null trả mảng rỗng', () => {
  assert.deepEqual(parseCommand(''), []);
  assert.deepEqual(parseCommand('   '), []);
  assert.deepEqual(parseCommand(null), []);
});

test('giữ raw để rule khác soi redirection', () => {
  const subs = parseCommand('echo x > .env');
  assert.ok(subs[0].raw.includes('>'));
});

test('tách 3 lệnh với && (payload thật Codex)', () => {
  assert.deepEqual(
    bins('pwd && rg -n --fixed-strings \'dong hai\' sua.txt && ls -ld xoa.txt'),
    ['pwd', 'rg', 'ls']
  );
  assert.deepEqual(
    bins('rm -- xoa.txt && rg -n \'x\' sua.txt && test ! -e xoa.txt'),
    ['rm', 'rg', 'test']
  );
});
