// lib/argv.mjs
// Bóc các lớp "bọc" quanh lệnh thật để rule soi được lệnh hữu hiệu.
// Tách ra khỏi infra.mjs vì đây là logic AN TOÀN mà nhiều rule đều cần: giữ hai
// bản riêng thì đúng lớp bug "sửa một chỗ quên chỗ kia" — Task 7 đã phải vá
// wrapper/keyword cho infra, Task 8 gặp lại y nguyên ở git-workflow.

import { basename } from './tokenize.mjs';

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
function unwrapGrouping(token) {
  return token.replace(/^[({]+/, '').replace(/[)};]+$/, '');
}

// parseCommand không strip các token "bọc" này, nên nếu chỉ soi argv[0] thì
// `npx wrangler deploy` lọt — mà đó mới là cách gọi CHUẨN của
// vercel/wrangler/supabase/flyctl, tức 4/21 entry trong denyBinaries gần như
// không được cưỡng chế. Tập này cố ý hẹp: mỗi token ở đây phải là thứ KHÔNG
// bao giờ là lệnh thật, nếu không sẽ sinh chặn oan.
// Cố ý KHÔNG có `command`: `command -v psql` là lệnh dò công cụ vô hại và rất
// phổ biến, đưa vào là chặn oan.
const WRAPPERS = new Set(['sudo', 'doas', 'npx', 'bunx', 'pnpx', 'time', 'nice']);

// Dạng wrapper 2 token. Chỉ ăn khi token thứ hai đúng là subcommand chạy-lệnh,
// nên `npm test` / `pnpm build` không bị coi là wrapper.
const WRAPPER_PAIRS = new Map([
  ['npm', new Set(['exec'])],
  ['pnpm', new Set(['dlx', 'exec'])],
  ['yarn', new Set(['dlx', 'exec'])],
  ['bun', new Set(['x'])],
]);

// Bóc dải wrapper ở đầu segment để lộ ra lệnh hữu hiệu. KHÔNG soi mọi token
// trong argv: làm thế thì `grep -rn terraform docs/` và `echo aws` bị chặn oan.
// Chỉ bỏ flag SAU khi đã thấy wrapper (flag đó là của wrapper, vd `npx -y`).
// Giới hạn đã biết: wrapper có flag mang giá trị (`sudo -u root psql`) sẽ dừng
// ở giá trị đó và lọt — chấp nhận lọt hơn là đoán bừa flag nào ăn giá trị.
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
  let stripped = false;
  while (i < argv.length) {
    if (SHELL_KEYWORDS.has(argv[i])) { i += 1; continue; }
    const bin = basename(argv[i]);
    if (WRAPPERS.has(bin)) { i += 1; stripped = true; continue; }
    const seconds = WRAPPER_PAIRS.get(bin);
    if (seconds && argv[i + 1] && seconds.has(argv[i + 1])) { i += 2; stripped = true; continue; }
    if (stripped && argv[i].startsWith('-')) { i += 1; continue; }
    break;
  }
  const out = argv.slice(i);
  if (out.length > 0) {
    const bare = unwrapGrouping(out[0]);
    if (bare) out[0] = bare;
  }
  return out;
}
