// lib/argv.mjs
// Bóc các lớp "bọc" quanh lệnh thật để rule soi được lệnh hữu hiệu.
// Tách ra khỏi infra.mjs vì đây là logic AN TOÀN mà nhiều rule đều cần: giữ hai
// bản riêng thì đúng lớp bug "sửa một chỗ quên chỗ kia" — Task 7 đã phải vá
// wrapper/keyword cho infra, Task 8 gặp lại y nguyên ở git-workflow.

import { basename, SHELL_WRAPPERS } from './tokenize.mjs';

// splitSegments tách theo `;`/`&&`/`|` nên từ khoá điều khiển rơi vào ĐẦU
// segment: `for f in *.sql; do psql -f $f; done` cho segment `do psql -f $f`,
// khiến basename(argv[0]) thành `do`. Không bỏ qua dải này thì TOÀN BỘ denylist
// không được cưỡng chế bên trong bất kỳ vòng lặp hay nhóm lệnh nào.
// `if`/`while`/`until` mở ĐIỀU KIỆN, và điều kiện là một lệnh chạy thật:
// `if git push --force; then echo ok; fi` và `if psql -l; then ...` đều cho
// segment bắt đầu bằng từ khoá, nên thiếu ba token này thì cả rule git lẫn rule
// infra không được cưỡng chế ở vị trí điều kiện — đúng một lỗ với dải `do`.
// Khớp TUYỆT ĐỐI theo token, nên `do_something --flag` / `thenable --x` /
// `ifconfig` / `iftop -i en0` / `docker` là lệnh thật và không bị ảnh hưởng.
// Không có binary nào tên đúng `if`, `while`, `until`, `do`, `then` — đó là từ
// khoá của shell, không phải file thi hành.
const SHELL_KEYWORDS = new Set([
  'if', 'while', 'until', 'do', 'then', 'else', 'elif', '{', '(', '!',
]);

// Ngoặc nhóm lệnh dính liền token vì tokenize không coi chúng là ranh giới:
// `(psql -l)` cho argv[0] = `(psql`, còn `(cd /app && rm -rf /)` cho token cuối
// `/)` — dấu `)` đó phá neo `$` của pattern rm nên `rm -rf /` lọt.
// Hậu tố nhóm lệnh. Tách ra vì lớp ký tự này dùng ở BA chỗ và phải giống nhau
// TUYỆT ĐỐI — lệch một ký tự là lệch verdict, đúng lớp bug "sửa một chỗ quên chỗ
// kia" mà file này sinh ra để chặn. (infra.mjs cố ý dùng biến thể có thêm `\s`
// vì nó bóc trên chuỗi đã join, không phải trên một token.)
export function stripGroupSuffix(token) {
  return token.replace(/[)};]+$/, '');
}

function unwrapGrouping(token) {
  return stripGroupSuffix(token.replace(/^[({]+/, ''));
}

// Cùng dấu ngoặc đó, nhưng ở token CUỐI của argv: `(cd /r && git push --force)`
// cho token `--force)`, `(cd /r && git push)` cho `push)`,
// `(rm codex-guardrail.json)` cho `codex-guardrail.json)`. Cả cờ, subcommand lẫn
// đường dẫn đều lệch nên so khớp chính xác trượt. Trong shell thật dấu đó KHÔNG
// thuộc tham số nên bóc là đúng nghĩa; nếu nó thật sự nằm trong message
// (`-m "abc (1)"`) thì chỉ lệch phần hiển thị, không đổi verdict vì pattern
// message kết bằng `.+`.
// Ở đây chứ không phải trong từng rule: git-workflow và self-protect đã có hai
// bản y HỆT nhau, đúng lớp bug "sửa một chỗ quên chỗ kia" mà file này sinh ra để
// chặn. (infra.mjs bóc trên CHUỖI đã join, với `\s` thêm trong lớp ký tự — hành
// vi KHÁC, nên cố ý không gộp vào đây.)
export function stripTrailingGroup(argv) {
  if (argv.length === 0) return argv;
  const last = stripGroupSuffix(argv[argv.length - 1]);
  return last ? [...argv.slice(0, -1), last] : argv.slice(0, -1);
}

// parseCommand không strip các token "bọc" này, nên nếu chỉ soi argv[0] thì
// `npx wrangler deploy` lọt — mà đó mới là cách gọi CHUẨN của
// vercel/wrangler/supabase/flyctl, tức 4/21 entry trong denyBinaries gần như
// không được cưỡng chế. Tập này cố ý hẹp: mỗi token ở đây phải là thứ KHÔNG
// bao giờ là lệnh thật, nếu không sẽ sinh chặn oan.
// Cố ý KHÔNG có `command`: `command -v psql` là lệnh dò công cụ vô hại và rất
// phổ biến, đưa vào là chặn oan.
// Trình thông dịch shell vào đây vì `bash ./scripts/deploy.sh prod` để nguyên thì
// argv[0] là `bash`, và MỌI rule khớp theo lệnh thật đều trượt — đo được: nó đi
// vòng cả nhóm deploy. Bóc wrapper chỉ PHƠI RA lệnh thật nên nó chỉ có thể làm
// rule cưỡng chế NHIỀU hơn, không thể cho qua nhiều hơn; với 4 nhóm deny-list
// đang có thì đó là hướng đúng.
//
// Dạng `-c` KHÔNG bị ảnh hưởng: thân của `bash -c "psql -l"` được parseCommand
// phát thành một segment RIÊNG (nhánh SHELL_WRAPPERS trong parseCommand), độc lập
// với WRAPPERS. Đo được: `bash -c "psql -l"` vẫn bị chặn sau thay đổi này.
//
// `source` và `.` là builtin của shell, không phải file thi hành, nên chúng không
// nằm trong SHELL_WRAPPERS (tập đó dùng cho nhánh `-c`) mà thêm trực tiếp ở đây.
// `.` an toàn vì basename của `./deploy.sh` là `deploy.sh`, không phải `.`.
//
// Nhóm thứ hai (`xargs`...`watch`) là các wrapper chạy-lệnh KHÔNG phải shell.
// Đo được trước khi thêm: `env`/`sudo`/`nice`/`time`/`npx` bóc được, còn cả sáu
// dạng này đi vòng toàn bộ denyBinaries với `aws s3 ls`. Chúng đủ điều kiện của
// tập này vì không cái nào là lệnh thật cần chạy — mỗi cái chỉ bọc một lệnh
// khác, nên bóc ra chỉ PHƠI RA lệnh thật.
//
// `command` vẫn cố ý ĐỨNG NGOÀI, xem đoạn trên: `command -v psql` là lệnh dò
// công cụ vô hại và rất phổ biến. Đó là cái giá đã cân: `command aws s3 ls`
// lọt, nhưng thêm vào là chặn oan một lệnh dev gõ hằng ngày.
const WRAPPERS = new Set([
  'sudo', 'doas', 'npx', 'bunx', 'pnpx', 'time', 'nice',
  'xargs', 'timeout', 'gtimeout', 'nohup', 'exec', 'stdbuf', 'watch',
  ...SHELL_WRAPPERS, 'source', '.',
]);

// Dạng wrapper 2 token. Chỉ ăn khi token thứ hai đúng là subcommand chạy-lệnh,
// nên `npm test` / `pnpm build` không bị coi là wrapper.
const WRAPPER_PAIRS = new Map([
  ['npm', new Set(['exec'])],
  ['pnpm', new Set(['dlx', 'exec'])],
  ['yarn', new Set(['dlx', 'exec'])],
  ['bun', new Set(['x'])],
]);

// Cờ MANG GIÁ TRỊ, theo TỪNG wrapper. Cần thiết vì bỏ cờ mà không bỏ giá trị
// của nó thì giá trị bị coi là lệnh: `sudo -u postgres psql` dừng ở `postgres`
// nên bin thành "postgres" và TOÀN BỘ denyBinaries không được cưỡng chế — mà
// `sudo -u postgres psql` là cách gọi CHUẨN của psql, không phải dạng lách hiếm.
//
// Phải theo TỪNG wrapper, KHÔNG được gộp một tập dùng chung: `-p` của `sudo` là
// `--prompt` (mang giá trị) còn `-p` của `time` là POSIX portable output (KHÔNG
// mang giá trị), nên tập gộp sẽ làm `time -p psql` coi `psql` là giá trị của
// `-p` rồi LỌT. Đổi một lỗ thành một lỗ khác thì không phải sửa.
//
// `time` cố ý KHÔNG có entry: dạng hay gặp là builtin của shell, chỉ nhận `-p`.
const WRAPPER_VALUE_FLAGS = new Map([
  ['sudo', new Set(['-u', '--user', '-g', '--group', '-h', '--host', '-p', '--prompt',
    '-C', '--close-from', '-U', '--other-user', '-r', '--role', '-t', '--type'])],
  ['doas', new Set(['-u', '-C'])],
  ['nice', new Set(['-n', '--adjustment'])],
  ['npx', new Set(['-p', '--package', '-c', '--call'])],
  ['bunx', new Set(['-p', '--package'])],
  ['pnpx', new Set(['-p', '--package'])],
  ['npm', new Set(['-p', '--package', '-c', '--call'])],
  ['pnpm', new Set(['-p', '--package', '-c', '--call'])],
  ['yarn', new Set(['-p', '--package'])],
  ['bun', new Set(['-p', '--package'])],
  ['xargs', new Set(['-n', '--max-args', '-L', '--max-lines', '-P', '--max-procs',
    '-I', '--replace', '-i', '-d', '--delimiter', '-E', '-s', '--max-chars', '-a',
    '--arg-file'])],
  ['timeout', new Set(['-s', '--signal', '-k', '--kill-after'])],
  ['gtimeout', new Set(['-s', '--signal', '-k', '--kill-after'])],
  ['stdbuf', new Set(['-i', '--input', '-o', '--output', '-e', '--error'])],
  ['watch', new Set(['-n', '--interval'])],
]);

// Wrapper ăn một POSITIONAL, không phải cờ: `timeout 5 aws s3 ls`. Bỏ cờ không
// đủ — token `5` không bắt đầu bằng `-` nên vòng lặp DỪNG ở đó, bin thành `5`,
// và toàn bộ denyBinaries không được cưỡng chế.
//
// Khớp theo HÌNH DẠNG token, không theo SỐ LƯỢNG positional: `timeout aws s3 ls`
// là cách gọi sai (thiếu duration nên lệnh không chạy được), nhưng nếu bỏ theo
// số lượng thì `aws` bị ăn và cả denylist trượt — đổi một lỗ thành một lỗ khác.
// Mẫu này chỉ ăn token không thể là tên binary.
const WRAPPER_POSITIONAL = new Map([
  ['timeout', /^\d+(?:\.\d+)?[smhd]?$/],
  ['gtimeout', /^\d+(?:\.\d+)?[smhd]?$/],
]);

// Bóc dải wrapper ở đầu segment để lộ ra lệnh hữu hiệu. KHÔNG soi mọi token
// trong argv: làm thế thì `grep -rn terraform docs/` và `echo aws` bị chặn oan.
// Chỉ bỏ flag SAU khi đã thấy wrapper (flag đó là của wrapper, vd `npx -y`).
export function effectiveArgv(rawArgv) {
  const argv = rawArgv.slice();
  // Bóc ngoặc TRƯỚC vòng lặp: nếu không, `(sudo psql -l)` dừng ở `(sudo` và
  // wrapper không được bóc. Chỉ nhận kết quả KHÁC RỖNG: `{` đứng riêng phải
  // giữ nguyên để SHELL_KEYWORDS bắt, chứ không biến thành token rỗng.
  if (argv.length > 0) {
    const bare = unwrapGrouping(argv[0]);
    if (bare) argv[0] = bare;
  }
  let i = 0;
  // Giữ TÊN wrapper vừa bóc, không chỉ một cờ boolean: cần nó để biết tập cờ
  // mang giá trị nào đang áp dụng (xem WRAPPER_VALUE_FLAGS).
  let lastWrapper = null;
  while (i < argv.length) {
    if (SHELL_KEYWORDS.has(argv[i])) { i += 1; continue; }
    const bin = basename(argv[i]);
    if (WRAPPERS.has(bin)) { i += 1; lastWrapper = bin; continue; }
    const seconds = WRAPPER_PAIRS.get(bin);
    if (seconds && argv[i + 1] && seconds.has(argv[i + 1])) { i += 2; lastWrapper = bin; continue; }
    if (lastWrapper && argv[i].startsWith('-')) {
      // Dạng `--user=postgres` gộp giá trị vào cùng token nên chỉ bỏ 1 (token đó
      // không có trong set). Dạng tách rời `--user postgres` phải bỏ CẢ giá trị,
      // nếu không giá trị bị coi là lệnh. `sudo -u` mà thiếu giá trị thì bỏ 1 và
      // argv rỗng — cả 4 rule đều đã chặn nhánh argv rỗng.
      const takesValue = WRAPPER_VALUE_FLAGS.get(lastWrapper)?.has(argv[i]) ?? false;
      i += takesValue && i + 1 < argv.length ? 2 : 1;
      continue;
    }
    // SAU nhánh cờ, vì cờ đứng trước positional: `timeout --signal=TERM 5 aws`.
    if (lastWrapper && WRAPPER_POSITIONAL.get(lastWrapper)?.test(argv[i])) {
      i += 1;
      continue;
    }
    break;
  }
  const out = argv.slice(i);
  if (out.length > 0) {
    const bare = unwrapGrouping(out[0]);
    if (bare) out[0] = bare;
  }
  return out;
}
