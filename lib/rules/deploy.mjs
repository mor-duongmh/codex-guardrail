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
import { normalizePath } from '../glob.mjs';
import { ALLOW, deny } from '../result.mjs';

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

export function evaluate(ctx, policy) {
  if (!ctx.command) return ALLOW;

  const cfg = policy.deploy ?? {};
  const entries = cfg.entrypoints ?? [];
  const targets = cfg.targets ?? [];
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
  }

  return ALLOW;
}
