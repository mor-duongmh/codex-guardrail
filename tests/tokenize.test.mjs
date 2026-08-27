import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand, basename } from '../lib/tokenize.mjs';

// platform mặc định 'darwin', KHÔNG lấy process.platform: các test dưới đây
// khẳng định hành vi của shell POSIX, nên chúng phải nói rõ điều đó. Để mặc
// định theo máy chạy thì cùng một test lại kiểm hai hành vi khác nhau tuỳ OS —
// đúng cách test `backslash escape` đỏ trên CI Windows sau khi tokenizer thôi
// coi `\` là escape trên win32.
const bins = (cmd, platform = 'darwin') =>
  parseCommand(cmd, 0, platform).map(s => basename(s.argv[0]));

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

test('backslash escape (POSIX)', () => {
  assert.deepEqual(bins('ps\\ql', 'darwin'), ['psql']);
});

// Cùng input, nền tảng khác, kết quả PHẢI khác: trên Windows `\` là dấu phân
// cách đường dẫn nên `ps\ql` là đường dẫn tới binary `ql`, không phải `psql`.
test('backslash KHÔNG escape trên win32', () => {
  assert.deepEqual(bins('ps\\ql', 'win32'), ['ql']);
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

// CI ma trận (lần chạy đầu tiên) cho 11 test đỏ trên cả 3 cell Windows. Nguyên
// nhân gốc của nhóm lớn nhất: `\` là ký tự escape của shell POSIX, nên tokenizer
// NUỐT nó — mà đường dẫn Windows đầy `\`. Đo được trên chính máy này:
//
//   cat C:\Users\runneradmin\.aws\credentials
//   argv -> ["cat","C:Usersrunneradmin.awscredentials"]
//
// `normalizePath` CÓ đổi `\` thành `/`, nhưng nó không bao giờ được thấy dấu `\`
// nào. Hệ quả không phải "test khó tính" mà là: trên Windows, MỌI rule khớp
// đường dẫn đều bị vô hiệu bằng cách dùng đường dẫn native.
//
// Nền tảng được TIÊM, không đọc thẳng process.platform trong test: nếu không thì
// nhánh win32 chỉ được kiểm trên CI Windows, tức nó có thể hỏng lại mà 8/9 cell
// còn lại vẫn xanh — đúng cách lỗ này lọt qua Plan 1.
const BS = String.fromCharCode(92);

test('win32: dấu \\ trong đường dẫn được giữ nguyên', () => {
  const cmd = `cat C:${BS}Users${BS}me${BS}.aws${BS}credentials`;
  const argv = parseCommand(cmd, 0, 'win32')[0].argv;
  assert.equal(argv[1], `C:${BS}Users${BS}me${BS}.aws${BS}credentials`,
    'đường dẫn Windows bị tokenizer ăn mất dấu \\');
});

test('posix: dấu \\ vẫn là escape, không đổi hành vi cũ', () => {
  const cmd = `cat foo${BS} bar`;
  const argv = parseCommand(cmd, 0, 'darwin')[0].argv;
  assert.deepEqual(argv, ['cat', 'foo bar'],
    'escape của POSIX phải giữ nguyên — đổi nó là hồi quy trên máy dev Linux/macOS');
});

test('win32: quote vẫn hoạt động, và \\ trong quote vẫn literal', () => {
  const cmd = `cat "C:${BS}Program Files${BS}app${BS}.env"`;
  const argv = parseCommand(cmd, 0, 'win32')[0].argv;
  assert.equal(argv[1], `C:${BS}Program Files${BS}app${BS}.env`);
});

// basename phải cắt được cả hai loại dấu phân cách, vì rule dùng nó để lấy tên
// binary và trên Windows đường dẫn binary dùng `\`.
test('basename cắt được cả / và \\', () => {
  assert.equal(basename(`C:${BS}Program Files${BS}nodejs${BS}node.exe`), 'node.exe');
  assert.equal(basename('/usr/local/bin/psql'), 'psql');
});

// Chứng nhân end-to-end cho đúng lỗ đã đo: đường dẫn Windows tới credential phải
// chuẩn hoá về dạng khớp được pattern `~/.aws/**`.
test('win32: đường dẫn native tới credential chuẩn hoá về dạng khớp pattern', async () => {
  const { normalizePath, globToRegExp } = await import('../lib/glob.mjs');
  const home = `C:${BS}Users${BS}me`;
  const cmd = `cat ${home}${BS}.aws${BS}credentials`;
  const argv = parseCommand(cmd, 0, 'win32')[0].argv;
  const re = globToRegExp('~/.aws/**', home);
  assert.ok(re.test(normalizePath(argv[1], home)),
    `không khớp: ${normalizePath(argv[1], home)} vs ${re.source}`);
});
