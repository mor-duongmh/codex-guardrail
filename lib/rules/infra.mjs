// lib/rules/infra.mjs
// Deny-list công cụ database/cloud + nhánh riêng cho ssh/scp.
// Đây là rule CHẶN: chặn oan là chế độ hỏng tệ nhất (dev sẽ tắt guardrail,
// guardrail bị tắt bảo vệ được 0 thứ). Khi phải cân giữa "lọt một ca hiếm"
// và "chặn oan một lệnh phổ biến", chỗ nào cũng chọn lọt.

import { parseCommand, basename } from '../tokenize.mjs';
import { globToRegExp, normalizePath, matchesAny } from '../glob.mjs';
import { ALLOW, deny } from '../result.mjs';
import { effectiveArgv } from '../argv.mjs';

const SSH_BINS = new Set(['ssh', 'scp']);

// Flag của ssh nhận một giá trị đứng sau — phải bỏ qua khi đi tìm token host.
const SSH_FLAGS_WITH_VALUE = new Set([
  '-p', '-i', '-o', '-F', '-l', '-J', '-b', '-c', '-D', '-E', '-e',
  '-I', '-L', '-m', '-O', '-Q', '-R', '-S', '-W', '-w',
]);

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
