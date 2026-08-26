// lib/rules/infra.mjs
// Deny-list công cụ database/cloud + nhánh riêng cho ssh/scp.
// Đây là rule CHẶN: chặn oan là chế độ hỏng tệ nhất (dev sẽ tắt guardrail,
// guardrail bị tắt bảo vệ được 0 thứ). Khi phải cân giữa "lọt một ca hiếm"
// và "chặn oan một lệnh phổ biến", chỗ nào cũng chọn lọt.

import { parseCommand, basename } from '../tokenize.mjs';
import { globToRegExp, normalizePath, matchesAny } from '../glob.mjs';
import { ALLOW, deny } from '../result.mjs';

const SSH_BINS = new Set(['ssh', 'scp']);

// Flag của ssh nhận một giá trị đứng sau — phải bỏ qua khi đi tìm token host.
const SSH_FLAGS_WITH_VALUE = new Set([
  '-p', '-i', '-o', '-F', '-l', '-J', '-b', '-c', '-D', '-E', '-e',
  '-I', '-L', '-m', '-O', '-Q', '-R', '-S', '-W', '-w',
]);

// splitSegments tách theo `;`/`&&`/`|` nên từ khoá điều khiển rơi vào ĐẦU
// segment: `for f in *.sql; do psql -f $f; done` cho segment `do psql -f $f`,
// khiến basename(argv[0]) thành `do`. Không bỏ qua dải này thì TOÀN BỘ denylist
// không được cưỡng chế bên trong bất kỳ vòng lặp hay nhóm lệnh nào.
// Khớp TUYỆT ĐỐI theo token, nên `do_something --flag` / `thenable --x` là lệnh
// thật và không bị ảnh hưởng.
const SHELL_KEYWORDS = new Set(['do', 'then', 'else', 'elif', '{', '(', '!']);

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
function effectiveArgv(rawArgv) {
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

function stripUser(host) {
  return host.replace(/^[^@]*@/, '');
}

// Hostname DNS không phân biệt hoa thường (RFC 4343) và FQDN hợp lệ có thể mang
// dấu chấm gốc ở cuối. Không chuẩn hoá thì `ssh PROD` / `ssh prod.` thoát
// denyHosts chỉ bằng cách giữ Shift. Rủi ro chặn oan bằng 0: case-insensitive
// đúng là đặc tả hostname, nên không có host thật nào bị chặn thêm.
function normalizeHost(host) {
  return normalizePath(String(host).toLowerCase()).replace(/\.+$/, '');
}

function sshParts(argv) {
  let i = 1;
  while (i < argv.length) {
    const a = argv[i];
    if (SSH_FLAGS_WITH_VALUE.has(a)) { i += 2; continue; }
    if (a.startsWith('-')) { i += 1; continue; }
    break;
  }
  const target = argv[i] ? stripUser(argv[i]) : null;
  const remote = argv.slice(i + 1).join(' ').trim();
  return { target, remote: remote.length > 0 ? remote : null };
}

function scpHosts(argv) {
  return argv
    .slice(1)
    .filter(a => !a.startsWith('-') && a.includes(':'))
    .map(a => stripUser(a.split(':')[0]))
    .filter(Boolean);
}

const HINT_BINARY = 'Nếu dự án thật sự cần công cụ này, thêm nó vào '
  + 'infra.allowBinaries trong codex-guardrail.json rồi mở PR (file có CODEOWNERS).';

export function evaluate(ctx, policy) {
  if (!ctx.command) return ALLOW;

  const cfg = policy.infra ?? {};
  const denyBin = new Set(cfg.denyBinaries ?? []);
  const allowBin = new Set(cfg.allowBinaries ?? []);
  const sshCfg = cfg.ssh ?? {};
  const denyHostRes = (sshCfg.denyHosts ?? []).map(h => globToRegExp(normalizeHost(h)));

  // denyPatterns khớp theo TIỀN TỐ của lệnh hữu hiệu từng segment, không phải
  // regex trên ctx.command thô. Chạy trên chuỗi thô thì `git commit -m "docker
  // system prune is dangerous"` bị chặn oan; neo vào đầu lệnh thì văn bản nằm
  // trong tham số không bao giờ khớp, mà `sudo docker system prune` vẫn chặn.
  const denyPatternRes = (cfg.denyPatterns ?? []).map(src => ({
    src,
    re: new RegExp('^(?:' + src + ')'),
  }));

  for (const sub of parseCommand(ctx.command)) {
    const argv = effectiveArgv(sub.argv);
    if (argv.length === 0) continue;
    const bin = basename(argv[0]);

    // Nối lại bằng một space: quote đã bị tokenize bóc, nên `\s+` trong pattern
    // vẫn khớp mà không phụ thuộc khoảng trắng gốc.
    // Bóc `)`/`}`/`;` ở cuối: chúng dính vào token cuối của nhóm lệnh
    // (`(cd /app && rm -rf /)`) và phá neo `$` của các pattern rm.
    const effective = argv.join(' ').replace(/[)};\s]+$/, '');
    for (const { src, re } of denyPatternRes) {
      if (re.test(effective)) {
        return deny('infra.deny-pattern',
          `Lệnh khớp mẫu bị chặn "${src}" — đây là thao tác không hoàn tác được.`,
          'Làm thủ công ngoài phiên Codex nếu thật sự cần.');
      }
    }

    if (SSH_BINS.has(bin)) {
      const hosts = bin === 'scp' ? scpHosts(argv) : [sshParts(argv).target];
      for (const host of hosts) {
        if (host && matchesAny(normalizeHost(host), denyHostRes)) {
          return deny('infra.ssh-deny-host',
            `Host "${host}" nằm trong infra.ssh.denyHosts — không được chạm, kể cả chỉ để xem.`,
            'Nếu đây là host an toàn, sửa infra.ssh.denyHosts trong codex-guardrail.json.');
        }
      }

      if (bin === 'ssh' && sshCfg.inspectRemoteCommand !== false) {
        const { remote } = sshParts(argv);
        if (remote) {
          // Tắt inspectRemoteCommand ở lần gọi lồng để chống đệ quy vô hạn.
          const inner = evaluate(
            { ...ctx, tool: 'Bash', command: remote },
            { ...policy, infra: { ...cfg, ssh: { ...sshCfg, inspectRemoteCommand: false } } }
          );
          if (inner.decision === 'deny') {
            return deny('infra.ssh-remote-command',
              `Lệnh chạy trên host qua ssh vi phạm ${inner.ruleId}: ${inner.reason}`,
              inner.hint);
          }
        }
      }
      continue;
    }

    if (denyBin.has(bin) && !allowBin.has(bin)) {
      return deny('infra.deny-binary',
        `"${bin}" là công cụ thao tác database/cloud — Codex không được tự chạy.`,
        HINT_BINARY);
    }
  }

  return ALLOW;
}
