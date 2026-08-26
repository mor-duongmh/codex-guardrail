// lib/rules/self-protect.mjs
// Chặn agent tự nới policy, tháo hook, hoặc tự phát escape cho chính nó.
// Không có rule này thì mọi rule khác chỉ là gợi ý.
//
// Đây là rule CHẶN, và nó chặn quanh đúng những file mà TÀI LIỆU của dự án phải
// nhắc tên (§9 spec bắt README ghi rõ cách escape). Nên hai nguyên tắc:
//   1. Phân biệt ĐỌC và GHI theo NGHĨA của tham số, không theo tên binary. Đọc
//      policy của chính mình là việc bình thường và hữu ích; `sed -n` và
//      `cp <policy> <chỗ khác>` là ĐỌC dù `sed`/`cp` có khả năng ghi.
//   2. Nhắc TÊN biến escape trong văn bản không phải là escape. Khớp substring
//      trên chuỗi thô làm guardrail chặn chính việc viết tài liệu cho nó.

import { parseCommand, basename } from '../tokenize.mjs';
import { globToRegExp, normalizePath, matchesAny } from '../glob.mjs';
import { ALLOW, deny } from '../result.mjs';
import { effectiveArgv } from '../argv.mjs';

const ESCAPE_VAR = 'CODEX_GUARDRAIL_ALLOW';

// Chỉ nhận dạng GÁN BIẾN ở ĐẦU lệnh — đó là dạng duy nhất thật sự đặt biến cho
// tiến trình con. `git commit -m "... CODEX_GUARDRAIL_ALLOW ..."` và
// `grep -rn CODEX_GUARDRAIL_ALLOW README.md` chỉ NHẮC TÊN biến, và neo `^` loại
// chúng ra. Cho phép `env` / `export` đứng trước, và cho phép các biến khác gán
// trước nó (`FOO=1 CODEX_GUARDRAIL_ALLOW=x cmd`).
// Không cần tự đi tìm `bash -c` / `$(...)`: parseCommand đã đệ quy vào đó và
// `sub.raw` của lệnh lồng bắt đầu ĐÚNG ở phần gán biến.
const ESCAPE_ASSIGN = new RegExp(
  '^(?:env|export)?\\s*(?:[A-Za-z_][A-Za-z0-9_]*=\\S*\\s+)*' + ESCAPE_VAR + '=',
);

// Binary mà MỌI tham số đường dẫn đều là đích ghi.
// `mv` nằm đây vì `mv <policy> <chỗ khác>` cũng làm mất policy khỏi vị trí cũ,
// khác `cp` là bản gốc vẫn còn.
const WRITE_ANY_ARG = new Set(['tee', 'truncate', 'patch', 'ln', 'rm', 'mv']);

// Binary chỉ ghi vào tham số CUỐI (đích). `cp <policy> /tmp/backup.json` là sao
// lưu policy — việc hữu ích, chặn là chặn oan.
const WRITE_LAST_ARG = new Set(['cp', 'install']);

// Message chặn phải nói ba điều: vi phạm gì, vì sao, làm gì tiếp (§13). "Vì sao"
// khác nhau theo nhóm, nên giữ theo nhóm luôn.
const GROUP_MESSAGE = {
  'selfprotect.policy-file': {
    noun: 'file policy của guardrail',
    hint: 'Nới policy là việc của người: sửa codex-guardrail.json rồi mở PR — file này có '
      + 'CODEOWNERS nên lead phải duyệt.',
  },
  'selfprotect.hooks-file': {
    noun: 'khai báo hook của Codex',
    hint: 'Sửa file này là tháo guardrail. Bật/tắt hook là việc của người, làm bằng tay '
      + 'ngoài phiên Codex.',
  },
  'selfprotect.install-dir': {
    noun: 'thư mục cài guardrail',
    hint: 'Cập nhật hoặc gỡ guardrail là việc của người, làm bằng tay ngoài phiên Codex.',
  },
};
const MESSAGE_FALLBACK = {
  noun: 'đường dẫn được bảo vệ trong selfProtect.protectedPaths',
  hint: 'Sửa nó là việc của người, không phải của agent.',
};

// Đích của redirect GHI trong một token, hoặc null nếu token không phải redirect.
// Đọc từ TOKEN đã tách chứ không phải chuỗi thô: token CÓ khoảng trắng thì chắc
// chắn là chuỗi đã nháy (shell tách token theo khoảng trắng), nên
// `echo "a > codex-guardrail.json"` không bao giờ bị coi là redirect.
// Bắt cả dạng dính liền `>f`, `2>f`, `x>f` — `echo '{}'>codex-guardrail.json`
// không có khoảng trắng nào mà vẫn ghi thật.
// Giới hạn không vá được: tokenize bỏ quote nên `grep '>codex-guardrail.json'`
// cho ĐÚNG một token như redirect thật. Chấp nhận chặn oan ca đó.
function outRedirect(token) {
  if (/\s/.test(token)) return null;
  const i = token.indexOf('>');
  if (i < 0) return null;
  let j = i + 1;
  if (token[j] === '>') j += 1;
  if (token[j] === '|') j += 1; // `>|` của bash (ghi đè noclobber)
  return { attached: token.slice(j), bare: j === token.length };
}

// Redirect ĐỌC (`<`, `<<EOF`, `<file`) không phải ghi — bỏ qua cả toán tử lẫn
// đích, nếu không nó sẽ chiếm chỗ "tham số cuối" của cp/install.
const IN_REDIR = /^[0-9]*<{1,3}-?(.*)$/;

// Ngoặc đóng của nhóm lệnh dính vào token CUỐI vì tokenize không coi nó là ranh
// giới: `(rm codex-guardrail.json)` cho token `codex-guardrail.json)`, và dấu đó
// phá khớp glob. infra.mjs và git-workflow.mjs đã phải xử lý y hệt.
function stripTrailingGroup(argv) {
  if (argv.length === 0) return argv;
  const last = argv[argv.length - 1].replace(/[)};]+$/, '');
  return last ? [...argv.slice(0, -1), last] : argv.slice(0, -1);
}

// Một lượt duyệt argv, trả về đích của redirect ghi và các tham số vị trí.
function scanArgv(argv) {
  const outTargets = [];
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    const out = outRedirect(t);
    if (out) {
      if (!out.bare) outTargets.push(out.attached);
      else if (i + 1 < argv.length) outTargets.push(argv[++i]);
      continue;
    }
    const m = IN_REDIR.exec(t);
    if (m) {
      if (!m[1] && i + 1 < argv.length) i += 1;
      continue;
    }
    if (i === 0) continue; // argv[0] là binary, không phải tham số
    if (t.startsWith('-')) continue;
    positionals.push(t);
  }
  return { outTargets, positionals };
}

// `sed` chỉ ghi khi có `-i` / `--in-place`. Cụm short flag cũng tính (`-ni`), và
// `-i.bak` mang suffix backup ngay trong token. Trong toàn bộ short flag của
// GNU/BSD sed chỉ `-i` chứa chữ `i`, nên không có chặn oan.
function hasInPlace(argv) {
  return argv.slice(1).some((t) => {
    if (t === '--in-place' || t.startsWith('--in-place=')) return true;
    if (!t.startsWith('-') || t.startsWith('--')) return false;
    return t.slice(1).split(/[.=]/)[0].includes('i');
  });
}

// Đích ghi của một lệnh, theo NGHĨA của từng binary.
function writeTargets(argv) {
  const { outTargets, positionals } = scanArgv(argv);
  const bin = basename(argv[0]);
  const targets = [...outTargets];

  if (WRITE_ANY_ARG.has(bin)) targets.push(...positionals);
  else if (WRITE_LAST_ARG.has(bin) && positionals.length > 0) {
    targets.push(positionals[positionals.length - 1]);
  } else if (bin === 'sed' && hasInPlace(argv)) targets.push(...positionals);
  else if (bin === 'dd') {
    // dd chỉ ghi qua `of=`; `if=` là đọc. Không bóc tiền tố thì `of=` là một lỗ
    // vì token `of=codex-guardrail.json` không khớp glob đường dẫn nào.
    for (const t of argv.slice(1)) {
      const m = /^of=(.+)$/.exec(t);
      if (m) targets.push(m[1]);
    }
  }
  return targets;
}

function readGroups(policy) {
  const raw = policy.selfProtect?.protectedPaths;
  if (raw === undefined || raw === null) return [];
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    // Ném để dispatcher fail-closed (§10). Trả ALLOW ở đây nghĩa là mất toàn bộ
    // self-protection mà không ai biết.
    throw new Error(
      'selfProtect.protectedPaths phải là object map ruleId -> mảng glob, '
      + 'ví dụ {"selfprotect.policy-file": ["**/codex-guardrail.json"]}',
    );
  }
  return Object.entries(raw)
    .filter(([, globs]) => Array.isArray(globs) && globs.length > 0)
    // Gọi qua lambda: `globs.map(globToRegExp)` truyền INDEX vào tham số `home`
    // của globToRegExp, nên mọi pattern `~/...` từ phần tử thứ hai trở đi nở ra
    // sai và không khớp gì. Đã đo: `rm ~/.codex/hooks.json` lọt.
    .map(([ruleId, globs]) => ({ ruleId, res: globs.map((g) => globToRegExp(g)) }));
}

export function evaluate(ctx, policy) {
  const groups = readGroups(policy);
  if (groups.length === 0) return ALLOW;

  // ruleId là KHOÁ CỦA ESCAPE (`CODEX_GUARDRAIL_ALLOW=<ruleId>`), nên nhóm
  // đường dẫn phải trả ruleId riêng: gộp lại thì người chỉ muốn sửa
  // codex-guardrail.json của dự án (đã có CODEOWNERS làm tầng hai) được cấp
  // luôn quyền sửa ~/.codex/hooks.json, tức quyền THÁO HOOK — thứ không có tầng
  // nào chắn. Map path→ruleId nằm trong policy JSON (§12).
  const classify = (token) => {
    const p = normalizePath(token);
    for (const g of groups) if (matchesAny(p, g.res)) return g.ruleId;
    return null;
  };

  const denyPath = (ruleId, token, what) => {
    const msg = GROUP_MESSAGE[ruleId] ?? MESSAGE_FALLBACK;
    return deny(ruleId, `${what} "${token}" — đây là ${msg.noun}.`, msg.hint);
  };

  if (ctx.tool === 'apply_patch') {
    for (const f of ctx.patchFiles ?? []) {
      const ruleId = classify(f);
      if (ruleId) return denyPath(ruleId, f, 'apply_patch định sửa');
    }
    return ALLOW;
  }

  if (!ctx.command) return ALLOW;

  // `>|` (ghi đè noclobber của bash) bị splitSegments cắt ở dấu `|`, nên đích
  // ghi rơi sang segment sau và không rule nào thấy. Chuẩn hoá cách viết toán
  // tử TRƯỚC khi tách; không phải khớp đường dẫn trên chuỗi thô. Nếu `>|` nằm
  // trong chuỗi đã nháy thì token vẫn có khoảng trắng nên vẫn không bị coi là
  // redirect.
  const command = ctx.command.replace(/>\s*\|/g, '>');

  for (const sub of parseCommand(command)) {
    if (ESCAPE_ASSIGN.test(sub.raw)) {
      return deny('selfprotect.escape-inline',
        `Lệnh tự đặt ${ESCAPE_VAR} — agent không được tự phát escape cho chính nó.`,
        `Escape chỉ hợp lệ khi người export ${ESCAPE_VAR} trong shell trước khi mở Codex.`);
    }

    // Bóc wrapper/keyword: không bóc thì `sudo rm codex-guardrail.json` cho
    // bin="sudo" và `for f in a; do rm ...; done` cho bin="do" — cả hai lọt.
    const argv = stripTrailingGroup(effectiveArgv(sub.argv));
    if (argv.length === 0) continue;

    for (const target of writeTargets(argv)) {
      const ruleId = classify(target);
      if (ruleId) return denyPath(ruleId, target, 'Lệnh định ghi vào');
    }
  }

  return ALLOW;
}
