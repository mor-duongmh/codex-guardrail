// lib/tokenize.mjs
// Tách command string của shell thành các lệnh con để rule soi được.
// Cố ý KHÔNG phải shell parser đầy đủ: đủ để bắt tai nạn và agent hớ hênh,
// không đủ để chống người cố tình lách (spec mục 15, giới hạn 1).

// Export vì `argv.mjs` phải bóc ĐÚNG tập trình thông dịch này. Hai bản danh sách
// shell ở hai file là đúng lớp bug "sửa một chỗ quên chỗ kia" mà cả tokenize.mjs
// lẫn argv.mjs đều có comment cảnh báo.
// `pwsh`/`powershell` có mặt vì team có dev Windows, và `pwsh ./deploy.ps1` là
// dạng gọi chuẩn ở đó. Chúng không có nhánh `-c` (PowerShell dùng `-Command`)
// nên với parseCommand chúng chỉ là hai entry không khớp — không mất gì.
export const SHELL_WRAPPERS = new Set([
  'bash', 'sh', 'zsh', 'dash', 'ksh', 'pwsh', 'powershell',
]);
const MAX_DEPTH = 3;

export function basename(token) {
  const t = String(token ?? '').replace(/^["']+|["']+$/g, '');
  const parts = t.split(/[/\\]/);
  return parts[parts.length - 1];
}

// `platform` là THAM SỐ có mặc định, không đọc thẳng process.platform bên trong:
// nhánh win32 phải test được từ macOS/Linux. Không tham số hoá thì nhánh đó chỉ
// được kiểm trên CI Windows, tức nó hỏng lại mà 6/9 cell còn lại vẫn xanh — đúng
// cách lỗ này lọt qua cả Plan 1.
export function tokenize(segment, platform = process.platform) {
  const out = [];
  let cur = '';
  let has = false;
  let quote = null;
  const backslashEscapes = platform !== 'win32';
  for (let i = 0; i < segment.length; i++) {
    const c = segment[i];
    if (quote) {
      if (c === quote) { quote = null; continue; }
      cur += c; has = true; continue;
    }
    if (c === '"' || c === "'") { quote = c; has = true; continue; }
    // Trên Windows `\` KHÔNG phải ký tự escape (cmd.exe/PowerShell) mà là dấu
    // phân cách đường dẫn. Nuốt nó ở đây xoá sạch đường dẫn native: đo được
    // `cat C:\Users\me\.aws\credentials` cho argv `C:Usersme.awscredentials`,
    // nên normalizePath không bao giờ thấy dấu `\` nào để đổi thành `/`, và MỌI
    // rule khớp đường dẫn bị vô hiệu trên Windows.
    //
    // Nếu dev Windows dùng Git Bash (nơi `\` THẬT là escape) thì nhánh này giữ
    // lại dấu `\`, normalizePath đổi thành `/`, và đường dẫn khớp pattern deny —
    // tức lệch về phía CHẶN. Đó là hướng sai an toàn cho một deny-list.
    if (c === '\\' && backslashEscapes && i + 1 < segment.length) {
      cur += segment[++i]; has = true; continue;
    }
    if (/\s/.test(c)) { if (has) { out.push(cur); cur = ''; has = false; } continue; }
    cur += c; has = true;
  }
  if (has) out.push(cur);
  return out;
}

export function splitSegments(command) {
  const segs = [];
  let cur = '';
  let quote = null;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote) { cur += c; if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") { quote = c; cur += c; continue; }
    if (c === '\\' && i + 1 < command.length) { cur += c + command[++i]; continue; }
    const two = command.slice(i, i + 2);
    if (two === '&&' || two === '||') { segs.push(cur); cur = ''; i++; continue; }
    if (c === ';' || c === '|' || c === '\n' || c === '&') { segs.push(cur); cur = ''; continue; }
    cur += c;
  }
  segs.push(cur);
  return segs.map(s => s.trim()).filter(Boolean);
}

function stripAssignments(argv) {
  let i = 0;
  if (argv[i] === 'env') i++;
  while (i < argv.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(argv[i])) i++;
  return argv.slice(i);
}

function substitutions(segment) {
  const found = [];
  const re = /\$\(([^()]*)\)|`([^`]*)`/g;
  let m;
  while ((m = re.exec(segment)) !== null) found.push(m[1] ?? m[2]);
  return found.filter(s => s && s.trim());
}

// Cụm cờ ngắn mang THÂN LỆNH. `bash -lc "..."`, `zsh -ic "..."`,
// `bash -euxc "..."` đều đưa thân lệnh vào token ngay sau cụm, y như `-c` đứng
// riêng. Khớp tuyệt đối `-c` bỏ lọt hết các dạng đó — đo được:
// `bash -c "aws s3 ls"` bị chặn còn `bash -lc "aws s3 ls"` LỌT, tức đi vòng
// toàn bộ deny-list. `-lc` không phải dạng lách hiếm, nó là dạng chuẩn khi cần
// shell login.
//
// Chữ `c` phải là chữ THƯỜNG: `-C` của bash là noclobber, và token sau nó là
// TÊN FILE script chứ không phải thân lệnh — bóc nó ra rồi parse như một lệnh
// là sinh segment giả, tức mở đường chặn oan.
//
// Trả về MỌI cụm khớp, không chỉ cụm đầu: nếu một cụm khác đứng trước `-c` thật
// thì "lấy cụm đầu tiên" sẽ bóc sai token và BỎ LỌT đúng thân lệnh cần soi.
// Soi thêm một token vô hại chỉ tốn một lần parse, còn bỏ lọt là mất verdict.
// Bắt đầu từ 1 vì argv[0] là chính trình thông dịch.
const SHELL_COMMAND_FLAG = /^-[A-Za-z]*c[A-Za-z]*$/;

function shellCommandBodies(argv) {
  const out = [];
  for (let i = 1; i < argv.length; i += 1) {
    if (SHELL_COMMAND_FLAG.test(argv[i]) && argv[i + 1]) out.push(argv[i + 1]);
  }
  return out;
}

export function parseCommand(command, depth = 0, platform = process.platform) {
  if (typeof command !== 'string' || depth > MAX_DEPTH) return [];
  const subs = [];
  for (const seg of splitSegments(command)) {
    const argv = stripAssignments(tokenize(seg, platform));
    if (argv.length > 0) subs.push({ argv, raw: seg });

    for (const inner of substitutions(seg)) {
      subs.push(...parseCommand(inner, depth + 1, platform));
    }

    if (argv.length === 0) continue;
    const bin = basename(argv[0]);
    const inners = [];
    if (SHELL_WRAPPERS.has(bin)) {
      inners.push(...shellCommandBodies(argv));
    } else if (bin === 'eval') {
      inners.push(argv.slice(1).join(' '));
    }
    for (const inner of inners) {
      if (inner) subs.push(...parseCommand(inner, depth + 1, platform));
    }
  }
  return subs;
}
