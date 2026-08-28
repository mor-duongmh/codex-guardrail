// lib/rules/deploy.mjs
// Allow-list: deploy chỉ chạy khi đích được NÊU RÕ và đã được khai trước.
//
// Khác 4 nhóm kia ở một điểm quyết định: nhóm này liệt kê cái ĐƯỢC PHÉP, nên khi
// thiếu dữ liệu dự án nó không có gì để cưỡng chế — kể cả cò súng cũng mất. Đó là
// vì sao `deploy.no-project-root` cần một cò súng nằm ở policy MẶC ĐỊNH, không
// phải ở policy dự án.
//
// Nhóm này KHÔNG chứa tên công cụ nào: mỗi dự án deploy một kiểu, nên kiến thức
// dự án thuộc codex-guardrail.json. Một danh sách vercel|netlify|... trong logic
// rule là chỗ phải bảo trì vô hạn.

import { parseCommand, tokenize } from '../tokenize.mjs';
import { effectiveArgv } from '../argv.mjs';
import { normalizePath, globToRegExp, matchesAny } from '../glob.mjs';
import { ALLOW, deny } from '../result.mjs';
import { currentBranch as defaultCurrentBranch } from './git-workflow.mjs';

// So khớp đường dẫn phải bỏ `./` dẫn đầu và đổi `\` thành `/`: `./scripts/deploy.sh`,
// `scripts/deploy.sh` và `scripts\deploy.sh` là CÙNG một file, mà dev Windows gõ
// dạng thứ ba. normalizePath đã lo dấu `\` và `~`; `./` phải bỏ sau đó vì
// normalizePath không chạm tới nó.
function normToken(t) {
  return normalizePath(t).replace(/^\.\//, '').replace(/\/+$/, '');
}

// Entrypoint khớp theo TIỀN TỐ NHIỀU TOKEN, không phải argv[0]: `npm run deploy`
// cho argv ["npm","run","deploy",...] nên khớp argv[0] sẽ trượt hoàn toàn.
//
// Export để test được chỗ nối nền tảng: từ macOS, parseCommand nuốt dấu `\` nên
// `evaluate('scripts\\deploy.sh')` không kiểm được hành vi Windows. Test nạp
// thẳng argv mà tokenize win32 sinh ra vào đây. Bốn rule còn lại không export
// helper nào — đây là điểm lệch có chủ ý, đổi lấy một nhánh Windows test được từ
// mọi nền tảng thay vì chỉ trên 3 cell CI Windows.
export function matchEntry(argv, entries) {
  const norm = argv.map(normToken);
  for (const entry of entries) {
    const et = tokenize(entry).map(normToken).filter(Boolean);
    if (et.length === 0 || et.length > norm.length) continue;
    if (et.every((t, i) => t === norm[i])) {
      return { entry, rest: argv.slice(et.length) };
    }
  }
  return null;
}

// Quét TOÀN BỘ tham số, so cả token nguyên và phần sau dấu `=` đầu tiên. Nhờ vậy
// `prod`, `--env=prod`, `--env prod`, `ENV=prod` đều ra cùng kết quả, và schema
// không cần trường `targetArg` nào để mỗi dự án khai sai.
//
// So khớp CHÍNH XÁC cả token, không phải `includes`: `prod.json` không được tính
// là đích `prod`. Ca mơ hồ lệch về phía chặn.
function targetsIn(rest, names) {
  const found = new Set();
  for (const tok of rest) {
    if (names.has(tok)) { found.add(tok); continue; }
    const i = tok.indexOf('=');
    if (i > 0) {
      const v = tok.slice(i + 1);
      if (names.has(v)) found.add(v);
    }
  }
  return [...found];
}

function describeTargets(targets) {
  const listed = targets
    .map(t => (t.branches?.length ? `${t.name} (${t.branches.join(', ')})` : t.name))
    .filter(Boolean)
    .join(', ');
  return listed || '(chưa khai đích nào)';
}

// Chỉ soi argv[0] — tức thứ ĐANG ĐƯỢC THI HÀNH — không soi mọi token. Soi mọi
// token thì `cat scripts/deploy.sh`, `git diff scripts/deploy.sh`,
// `chmod +x scripts/deploy.sh` đều bị chặn oan, mà đó là những lệnh dev gõ liên
// tục khi làm việc VỚI script deploy. Đo được: 13/13 lệnh không-thi-hành qua.
function looksLikeDeployScript(argv, res) {
  return argv.length > 0 && matchesAny(normToken(argv[0]), res);
}

// `currentBranch` là tham số thứ 3 CÓ MẶC ĐỊNH, cùng nếp DI của `parseCommand`
// (platform) và `inferPolicy` (runGit). Nó spawn `git`, nên test tiêm được bản giả
// mà không phải dựng repo thật — và quan trọng hơn, test ĐẾM ĐƯỢC số lần gọi để
// chứng minh đường allow không trả phí spawn.
export function evaluate(ctx, policy, currentBranch = defaultCurrentBranch) {
  if (!ctx.command) return ALLOW;

  const cfg = policy.deploy ?? {};
  const entries = cfg.entrypoints ?? [];
  const targets = cfg.targets ?? [];

  // Chạy TRƯỚC mọi rule khác của nhóm, và trước cả cửa "chưa khai thì no-op":
  // khi projectRoot null thì `entries` LUÔN rỗng (loadPolicy(null) chỉ trả policy
  // mặc định), nên đặt sau cửa đó là rule này không bao giờ chạy được.
  //
  // Đây là chỗ duy nhất trong nhóm dùng dữ liệu MẶC ĐỊNH làm cò súng. Bắt buộc
  // như vậy: allow-list mà cò súng cũng là dữ liệu dự án thì mất policy là cưỡng
  // chế con số không, chứ không phải chặn tất cả.
  if (!ctx.projectRoot) {
    const detectRes = (cfg.detectScripts ?? []).map(g => globToRegExp(g));
    if (detectRes.length > 0) {
      for (const sub of parseCommand(ctx.command)) {
        if (looksLikeDeployScript(effectiveArgv(sub.argv), detectRes)) {
          return deny('deploy.no-project-root',
            `không tìm được .git từ cwd (${ctx.cwd}), nên codex-guardrail.json không được đọc — guardrail không biết dự án này được deploy đi đâu`,
            'mở Codex TỪ thư mục dự án rồi thử lại');
        }
      }
    }
    return ALLOW;
  }

  if (entries.length === 0) return ALLOW;   // dự án chưa khai -> no-op hoàn toàn

  const names = new Set(targets.map(t => t.name).filter(Boolean));
  const listed = describeTargets(targets);

  for (const sub of parseCommand(ctx.command)) {
    const argv = effectiveArgv(sub.argv);
    if (argv.length === 0) continue;

    const hit = matchEntry(argv, entries);
    if (!hit) continue;

    const found = targetsIn(hit.rest, names);

    if (found.length > 1) {
      return deny('deploy.ambiguous-target',
        `lệnh nêu ${found.length} đích (${found.join(', ')}) — không xác định được branch rule nào áp`,
        'deploy tuần tự, mỗi lệnh một đích');
    }

    if (found.length === 0) {
      // Phân biệt "không nêu gì" với "nêu một thứ lạ" bằng: có token nào KHÔNG bắt
      // đầu bằng `-`. Đây là HEURISTIC, không phải suy luận chắc chắn — nó KHÔNG
      // đổi quyết định (cả hai đều chặn), chỉ đổi hint và ruleId người dùng gõ để
      // escape. Ghi ra vì một heuristic không ghi ra là một heuristic sẽ bị người
      // sau tưởng là định lý.
      //
      // `--` của `npm run deploy -- xyz` bắt đầu bằng `-` nên bị bỏ qua đúng, và
      // `xyz` mới là token được báo.
      const stray = hit.rest.find(t => !t.startsWith('-'));
      if (stray) {
        return deny('deploy.undeclared-target',
          `đích "${stray}" chưa được khai trong codex-guardrail.json. Đích đã khai: ${listed}`,
          'hỏi người dùng chọn một trong các đích đã khai, rồi gọi lại kèm tên đó');
      }
      if (cfg.requireExplicitTarget === false) continue;
      return deny('deploy.no-target',
        `${hit.entry} được gọi mà không chỉ định deploy lên đâu. Đích đã khai: ${listed}`,
        'hỏi người dùng deploy lên môi trường nào, rồi gọi lại kèm tên đó');
    }

    // Từ đây: đúng MỘT đích đã khai.
    const target = targets.find(t => t.name === found[0]);

    // requireHumanEscape kiểm TRƯỚC branch, và thứ tự này có test riêng. Nó là
    // cửa lùi khi `ask` không dùng được, và nó không phụ thuộc branch. Kiểm sau
    // branch thì một đích hệ-quả-cao trên branch sai sẽ báo branch-mismatch, người
    // dùng chuyển branch, rồi tưởng là đã xong — trong khi cái cần là một con
    // người xác nhận.
    if (target?.requireHumanEscape) {
      // ruleId phải chứa TÊN đích. Dùng chung một `deploy.high-consequence` thì
      // một lần escape mở cho MỌI đích hệ quả cao, mà cả điểm của nó là mở đúng
      // một đích.
      return deny(`deploy.target.${target.name}`,
        `${target.name} là đích hệ quả cao, cần người xác nhận chứ không để agent tự quyết`,
        `hỏi người dùng có thật sự muốn deploy ${target.name}. Nếu có, HỌ tự gõ trong shell rồi mở lại Codex:  export CODEX_GUARDRAIL_ALLOW=deploy.target.${target.name}`);
    }

    const wants = target?.branches ?? [];
    if (wants.length === 0) continue;   // đích không khai branches -> không kiểm

    // currentBranch spawn `git`, nên chỉ gọi khi lệnh ĐÃ khớp entrypoint VÀ đã có
    // đúng một đích hợp lệ. Deploy là việc hiếm; hook chạy trên MỌI tool call, nên
    // spawn trên đường allow là trả phí cho việc không xảy ra.
    const branch = currentBranch(ctx.cwd);
    const branchRes = wants.map(b => globToRegExp(b));
    if (!branch || !matchesAny(branch, branchRes)) {
      // `!branch` cũng chặn: không biết branch thì không kết luận được là hợp lệ,
      // và deploy không hoàn tác được nên "chưa biết" phải nghĩa là "không".
      return deny('deploy.branch-mismatch',
        `branch hiện tại (${branch ?? 'không xác định được'}) không khớp branch cho phép của đích "${target.name}": ${wants.join(', ')}`,
        'chuyển sang branch hợp lệ rồi deploy lại, hoặc sửa deploy.targets trong codex-guardrail.json rồi mở PR (file có CODEOWNERS)');
    }
  }

  return ALLOW;
}
