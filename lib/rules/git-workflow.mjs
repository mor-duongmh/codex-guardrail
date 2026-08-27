// lib/rules/git-workflow.mjs
// Chặn thao tác git phá lịch sử / bỏ qua review, và commit-push trực tiếp lên
// branch được bảo vệ.
// Đây là rule CHẶN, và nó chặn đúng `git commit`/`git push` — chặn oan ở đây
// làm dev KHÔNG LÀM VIỆC ĐƯỢC, nên ngưỡng còn khắt khe hơn các rule khác:
// chỗ nào phải chọn giữa "lọt một ca hiếm" và "chặn oan một lệnh phổ biến",
// chỗ đó chọn lọt.

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { parseCommand, basename } from '../tokenize.mjs';
import { globToRegExp, matchesAny } from '../glob.mjs';
import { ALLOW, deny } from '../result.mjs';
import { effectiveArgv, stripTrailingGroup } from '../argv.mjs';

// Codex nối `. Command: <lệnh>` NGAY SAU reason, nên reason phình theo dữ liệu
// người dùng cung cấp sẽ ra một khối chữ không đọc được trên terminal. Message
// commit là trường DUY NHẤT trong Plan 1 mà reason nhúng dữ liệu không có giới
// hạn trên (các reason khác nhúng token đường dẫn, vốn bị PATH_MAX chặn).
// Giữ 200 ký tự đầu: đủ để dev nhận ra commit nào, và giữ reason ở cỡ ổn định.
const MESSAGE_MAX = 200;

function ellipsize(text, max = MESSAGE_MAX) {
  const s = String(text ?? '');
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

export function currentBranch(cwd) {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || null;
  } catch {
    return null;
  }
}

// Global option của git ĂN một giá trị đứng sau. Không nhảy qua giá trị thì
// `git -C /repo push --force` cho subcommand = "/repo" (giá trị của -C), và MỌI
// kiểm gate theo subcommand bị bỏ: force-push lọt, protected-branch không chạy.
// Dạng `--x=y` giữ giá trị trong cùng token nên nhánh startsWith('-') đã phủ.
const GLOBAL_WITH_VALUE = new Set([
  '-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path',
  '--super-prefix', '--config-env',
]);

// Cờ mang message dạng short gộp. `m` phải ở CUỐI cụm mới là cờ ăn token sau,
// nên khớp `-m`, `-am`, `-nm`, `-sam`. `git commit -am` là dạng cực phổ biến mà
// so khớp `-m` chính xác thì trượt hoàn toàn.
const SHORT_MESSAGE = /^-[A-Za-z]*m$/;

// Một lượt duyệt duy nhất, trả về đủ thứ cần cho mọi kiểm phía sau.
function parseGitArgs(args) {
  const repoDirs = [];
  const flags = [];
  const positionals = [];
  let verb = '';
  let message = null;
  let i = 0;

  // Giai đoạn 1: global option đứng TRƯỚC subcommand.
  for (; i < args.length; i++) {
    const a = args[i];
    if (GLOBAL_WITH_VALUE.has(a)) {
      if (a === '-C' && args[i + 1] !== undefined) repoDirs.push(args[i + 1]);
      i += 1;
      continue;
    }
    if (a.startsWith('-')) continue;
    verb = a;
    break;
  }

  // Giai đoạn 2: chỉ token SAU subcommand mới là cờ của subcommand đó.
  // Cố ý KHÔNG đưa GIÁ TRỊ của cờ vào `flags`: message của `-m` là một token
  // duy nhất (quote đã bị tokenize bóc), nên `git commit -m "--force is
  // banned"` sẽ trông y như một cờ thật và bị chặn oan.
  for (i += 1; i < args.length; i++) {
    const a = args[i];
    // Tham số vị trí của subcommand (remote, refspec, pathspec). GIÁ TRỊ của cờ
    // mang message KHÔNG vào đây vì nhánh dưới đã nhảy qua nó.
    if (!a.startsWith('-')) { positionals.push(a); continue; }
    flags.push(a);
    if (a.startsWith('--message=')) { message = a.slice('--message='.length); continue; }
    if (a === '--message' || SHORT_MESSAGE.test(a)) {
      message = args[i + 1] ?? null;
      i += 1;
    }
  }

  return { verb, flags, message, repoDirs, positionals };
}

// git nhận cùng một ý nghĩa dưới nhiều dạng: short (`-f`), short gộp (`-fd`),
// long (`--force`), long mang giá trị (`--force-with-lease=<ref>`). So khớp
// token chính xác thì cả ba dạng sau đều lọt.
function hasFlag(flags, shorts, longs) {
  return flags.some(f => {
    // Chỉ so phần trước `=`: `--force-with-lease=refs/heads/x` vẫn là --force-with-lease.
    if (f.startsWith('--')) return longs.includes(f.split('=')[0]);
    // Chỉ [A-Za-z] mới là cụm cờ, nên `-5` của `git log -5` không bị tách chữ.
    return /^-[A-Za-z]+$/.test(f) && [...f.slice(1)].some(c => shorts.includes(c));
  });
}

export function evaluate(ctx, policy, deps = {}) {
  if (!ctx.command) return ALLOW;
  const cfg = policy.git ?? {};
  const branchOf = deps.currentBranch ?? currentBranch;

  let needsBranchCheck = false;
  let repoCwd = ctx.cwd;

  for (const sub of parseCommand(ctx.command)) {
    // effectiveArgv bóc wrapper (`sudo git ...`) và từ khoá shell (`do git ...`).
    // Không bóc thì lọc theo basename(argv[0]) loại sạch chúng TRƯỚC khi kiểm
    // bất cứ thứ gì — đúng lỗ Task 7 đã vá cho infra, nên dùng chung một hàm.
    const argv = stripTrailingGroup(effectiveArgv(sub.argv));
    if (argv.length === 0) continue;
    const bin = basename(argv[0]);
    if (bin !== 'git' && bin !== 'gh') continue;
    const args = argv.slice(1);

    if (bin === 'gh') {
      // Khớp theo VỊ TRÍ subcommand, không phải "argv có chứa token merge":
      // `gh pr list --search merge` là lệnh đọc thuần và sẽ bị chặn oan.
      const positionals = args.filter(a => !a.startsWith('-'));
      if (positionals[0] === 'pr' && positionals[1] === 'merge') {
        return deny('git.pr-merge',
          'gh pr merge sẽ merge PR mà không đi qua review của người.',
          'Để người merge trên giao diện GitHub sau khi review.');
      }
      continue;
    }

    const { verb, flags, message, repoDirs, positionals } = parseGitArgs(args);

    // `-n` là --no-verify của `git commit` NHƯNG là --dry-run của `git push`.
    // Gộp hai nghĩa lại là chặn oan `git push -n`, một lệnh xem trước vô hại.
    if (hasFlag(flags, verb === 'commit' ? 'n' : '', ['--no-verify'])) {
      return deny('git.no-verify',
        '--no-verify bỏ qua git hook của dự án, tức bỏ qua chính lớp kiểm tra trước commit.',
        'Sửa cho hook chạy xanh thay vì bỏ qua nó.');
    }

    // `--mirror` đẩy MỌI ref và xoá ref trên remote không còn ở local, tức là
    // force-push toàn bộ repo. Rủi ro chặn oan gần bằng 0: nó không xuất hiện
    // trong luồng dev thường, chỉ dùng khi di chuyển repo.
    if (verb === 'push'
      && hasFlag(flags, 'fd', ['--force', '--force-with-lease', '--delete', '--mirror'])) {
      return deny('git.dangerous-flag',
        'push kèm --force / --force-with-lease / --delete / --mirror ghi đè lịch sử trên remote.',
        'Nếu cần sửa lịch sử, làm thủ công và tự chịu trách nhiệm ngoài phiên Codex.');
    }
    // `git push origin :feat/x` là dạng viết TƯƠNG ĐƯƠNG CHÍNH XÁC với
    // `git push origin --delete feat/x` — refspec có source rỗng nghĩa là "xoá
    // ref đích trên remote". Chặn `--delete` mà bỏ dạng này thì chính rule vừa
    // cam kết đã có đường lách.
    // Chỉ khớp dấu hai chấm ĐỨNG ĐẦU token: `HEAD:refs/heads/x` và
    // `feat/x:feat/x` có dấu hai chấm ở GIỮA, là push thường và phải cho qua.
    if (verb === 'push' && positionals.some(a => a.startsWith(':') && a.length > 1)) {
      return deny('git.dangerous-flag',
        'refspec dạng ":<ref>" xoá ref trên remote, đúng bằng push --delete.',
        'Xoá branch/tag trên remote là việc của người, làm ngoài phiên Codex.');
    }
    // Tiền tố `+` của refspec CHÍNH LÀ force: theo đặc tả git,
    // `git push origin +A:B` cập nhật ref đích kể cả khi không fast-forward,
    // tức force-push đúng ref đó. Rule vừa cam kết chặn `--force`, nên bỏ dạng
    // này là để nguyên đường lách mà chính tài liệu git chỉ cho người bị chặn ở
    // dạng cờ.
    // `+` đứng ĐẦU refspec không có nghĩa nào khác nên chặn oan gần bằng 0.
    // Chỉ khớp `git push`: `git fetch origin +refs/heads/*:refs/remotes/...`
    // chỉ ghi đè remote-tracking ref ở LOCAL, vô hại và cực phổ biến.
    if (verb === 'push' && positionals.some(a => a.startsWith('+') && a.length > 1)) {
      return deny('git.dangerous-flag',
        'refspec dạng "+<src>:<dst>" force-push ref đó, đúng bằng push --force.',
        'Nếu cần sửa lịch sử, làm thủ công và tự chịu trách nhiệm ngoài phiên Codex.');
    }
    if (verb === 'reset' && hasFlag(flags, '', ['--hard'])) {
      return deny('git.dangerous-flag',
        'reset --hard xoá thay đổi chưa commit, không lấy lại được.',
        'Dùng git stash nếu chỉ muốn dọn tạm.');
    }
    // Cần CẢ force và -d, và phải KHÔNG phải chạy thử: hint của chính rule này
    // bảo dev xem trước bằng `git clean -nd`, nên chặn `-nfd` là tự mâu thuẫn
    // trong khi dry-run không xoá gì cả.
    if (verb === 'clean'
      && hasFlag(flags, 'f', ['--force'])
      && hasFlag(flags, 'd', [])
      && !hasFlag(flags, 'n', ['--dry-run'])) {
      return deny('git.dangerous-flag',
        'clean -fd xoá vĩnh viễn file chưa được track.',
        'Xem trước bằng git clean -nd rồi tự xoá thủ công.');
    }
    if (verb === 'filter-branch') {
      return deny('git.dangerous-flag',
        'filter-branch viết lại toàn bộ lịch sử.',
        'Việc này phải do người làm, có thông báo cho cả team.');
    }
    if (verb === 'tag' && hasFlag(flags, 'd', ['--delete'])) {
      return deny('git.dangerous-flag',
        'tag -d xoá tag, có thể phá bản release đã pin.',
        'Xoá tag là việc của người phụ trách release.');
    }

    // message === null nghĩa là không tìm thấy cờ mang message — `git commit`
    // mở editor, `--amend --no-edit`, `-F file` đều hợp lệ. Suy ra "message
    // rỗng nên chặn" là chặn oan.
    if (verb === 'commit' && message !== null && (cfg.commitMessagePattern ?? '') !== '') {
      if (!new RegExp(cfg.commitMessagePattern).test(message)) {
        return deny('git.commit-message',
          `Message "${ellipsize(message)}" không khớp quy ước commit của dự án.`,
          'Dùng conventional commits, ví dụ: feat(api): thêm endpoint tạo đơn');
      }
    }

    if ((verb === 'commit' || verb === 'push') && !needsBranchCheck) {
      needsBranchCheck = true;
      // `git -C /other` làm việc trên repo KHÁC cwd, nên hỏi branch của cwd là
      // hỏi sai repo — vừa chặn oan (cwd trên main, /other trên feature) vừa
      // lọt (ngược lại). Nhiều `-C` cộng dồn, đúng như git.
      if (repoDirs.length > 0) repoCwd = resolve(ctx.cwd ?? '.', ...repoDirs);
    }
  }

  // Sau cùng vì nó spawn `git`: hook chạy trên MỌI tool call, ngân sách
  // p95 < 150ms, và mỗi lần chạy là một process mới.
  if (needsBranchCheck) {
    // Gọi qua lambda: `.map(globToRegExp)` truyền INDEX của Array.map vào tham
    // số `home`, nên pattern `~/...` nở ra sai. Ở đây hiện VÔ HẠI vì tên branch
    // không bắt đầu bằng `~`, nhưng giữ dạng sai là mời người đọc sau copy lại —
    // đúng dạng đã làm secrets.denyPaths mất hiệu lực.
    const protectedRes = (cfg.protectedBranches ?? []).map((b) => globToRegExp(b));
    const branch = branchOf(repoCwd);
    if (branch && matchesAny(branch, protectedRes)) {
      return deny('git.protected-branch',
        `Đang đứng trên branch được bảo vệ "${branch}" — không commit/push trực tiếp.`,
        'Tạo feature branch: git switch -c feat/<tên-việc> rồi commit lại.');
    }
  }

  return ALLOW;
}
