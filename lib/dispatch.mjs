// lib/dispatch.mjs
// Ghép 4 rule thành một quyết định. Không đọc stdin, không exit — bin/ làm việc đó.
import { basename as pathBasename } from 'node:path';
import { buildContext, ContextError } from './context.mjs';
import { loadPolicy, PolicyError } from './policy.mjs';
import { record } from './audit.mjs';
import * as selfProtect from './rules/self-protect.mjs';
import * as secrets from './rules/secrets.mjs';
import * as infra from './rules/infra.mjs';
import * as gitWorkflow from './rules/git-workflow.mjs';
import { currentBranch } from './rules/git-workflow.mjs';

// Rule an toàn ném exception thì fail-closed (§10). Ở Plan 1 cả 4 group đều an
// toàn nên nhánh fail-open bên dưới KHÔNG THỂ chạm tới — nó nằm sẵn cho rule
// chất lượng của Plan 2 (`convention`, `quality`), thứ không được khoá cả phiên
// làm việc chỉ vì một bug trong lint.
const SAFETY_GROUPS = new Set(['selfprotect', 'secrets', 'infra', 'git']);

// Thứ tự trong mảng LÀ thứ tự chạy, và nó quyết định hai thứ: ngân sách độ trễ
// (rẻ trước, `git` cuối vì có thể spawn `git`) và ruleId nào được báo khi hai
// rule cùng chặn — ruleId đó là khoá escape người dùng sẽ gõ, nên phải là rule
// nghiêm trọng nhất.
const REGISTRY = {
  PreToolUse: {
    Bash: [
      ['selfprotect', selfProtect],
      ['secrets', secrets],
      ['infra', infra],
      ['git', gitWorkflow],
    ],
    apply_patch: [
      ['selfprotect', selfProtect],
      ['secrets', secrets],
    ],
  },
};

export function denyMessage(result, _ctx) {
  // KHÔNG kết thúc bằng dấu chấm hay newline: Codex nối `. Command: <lệnh>` ngay sau reason,
  // để nguyên sẽ ra `CODEOWNERS).. Command:` (Task 0 quan sát được).
  return `✗ guardrail chặn: ${result.ruleId}

  Vì sao: ${result.reason}
  Làm gì tiếp: ${result.hint}

  Escape một lần (người gõ, không phải agent):
    export CODEX_GUARDRAIL_ALLOW=${result.ruleId}
  Nới vĩnh viễn: thêm vào codex-guardrail.json rồi mở PR (file có CODEOWNERS)`;
}

// Deny đi qua JSON, KHÔNG qua exit code. Task 0 chỉ xác nhận exit 0+JSON và exit 2 là chặn thật;
// exit 3 chưa từng được kiểm và có thể bị Codex coi là hook lỗi rồi CHO LỆNH CHẠY. Nên fail-closed
// cũng deny qua JSON — an toàn hơn đúng-về-lý-thuyết.
//
// NỢ: hookEventName hardcode 'PreToolUse'. Chấp nhận được vì REGISTRY chỉ khai
// PreToolUse, và trên đường fail-closed thì buildContext đã NÉM — ta chưa biết
// event thật nên không có gì khác để điền. Khi thêm PostToolUse vào REGISTRY,
// deny() phải nhận event từ ctx và đường fail-closed phải tự đoán lấy event
// (parse thô rawStdin, hoặc giữ 'PreToolUse' làm mặc định an toàn nhất).
function deny(reason, stderr = '') {
  return {
    decision: 'deny',
    stdout: JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    }),
    stderr,
  };
}

const allow = (stderr = '') => ({ decision: 'allow', stdout: '', stderr });

function failClosed(err) {
  return deny(
    `✗ guardrail fail-closed: ${err.message}\n`
    + '  Guardrail chặn vì không xác định được tình huống. Sửa nguyên nhân rồi thử lại',
  );
}

export function runHook(rawStdin, env = {}) {
  let ctx;
  try {
    ctx = buildContext(rawStdin, env);
  } catch (err) {
    if (err instanceof ContextError) return failClosed(err);
    throw err;
  }

  // Lối tắt của ngân sách độ trễ (§13): mỗi lần gọi hook là một process Node
  // MỚI nên cache trong tiến trình vô dụng, và loadPolicy đọc file mỗi lần.
  // Event/tool không khai rule nào thì về ngay, TRƯỚC khi nạp policy.
  const rules = REGISTRY[ctx.event]?.[ctx.tool] ?? [];
  if (rules.length === 0) return allow();

  let policy;
  try {
    // BỎ `warnings` có ý thức (lệch so với spec §10). Hook sống ngắn, không giữ
    // được trạng thái "đã cảnh báo trong session này", nên in ra sẽ thành cảnh
    // báo ở MỌI tool call — nhiễu tới mức dev học cách bỏ qua stderr của
    // guardrail, làm hỏng luôn message chặn thật. `guardrail doctor` là chỗ báo
    // đang chạy policy mặc định.
    ({ policy } = loadPolicy(ctx.projectRoot));
  } catch (err) {
    if (err instanceof PolicyError) return failClosed(err);
    throw err;
  }

  let stderr = '';
  const repo = ctx.projectRoot ? pathBasename(ctx.projectRoot) : null;

  for (const [group, mod] of rules) {
    let res;
    try {
      res = mod.evaluate(ctx, policy);
    } catch (err) {
      if (SAFETY_GROUPS.has(group)) return failClosed(err);
      stderr += `⚠ guardrail: rule ${group} lỗi, bỏ qua: ${err.message}\n`;
      continue;
    }
    if (res.decision !== 'deny') continue;

    // currentBranch spawn `git` nên chỉ gọi trên đường deny/escaped — đường
    // allow (đa số tuyệt đối các tool call) không được trả phí đó.
    const common = {
      ruleId: res.ruleId, event: ctx.event, tool: ctx.tool,
      repo, branch: currentBranch(ctx.cwd), command: ctx.command ?? undefined,
      // `?? undefined` chứ không `?? null`: JSON.stringify bỏ undefined, nên dòng
      // log của một Codex không gửi trường này KHÔNG có khoá `permissionMode` —
      // phân biệt được "Codex không gửi" với "Codex gửi null". Cần cho quyết định
      // `ask` ở spec deploy §3.9, và trước mắt để BIẾT chế độ thật của máy dev
      // mà không phải dựng phiên spike.
      permissionMode: ctx.permissionMode ?? undefined,
      // Ghi cwd để chẩn đoán ca `repo`/`branch` null trong phiên Codex THẬT dù
      // người dùng chạy Codex TỪ thư mục dự án. findProjectRoot đã kiểm là đúng
      // (từ thư mục dự án và thư mục con đều ra root, từ ~ ra null), nên còn hai
      // khả năng và trường này phân biệt được:
      //   cwd không phải thư mục dự án -> giá trị Codex gửi trỏ chỗ khác
      //   cwd đúng mà repo vẫn null    -> .git không đọc được từ tiến trình hook
      // Hệ quả của null KHÔNG nhỏ: loadPolicy(null) chỉ trả policy MẶC ĐỊNH, tức
      // codex-guardrail.json của dự án không bao giờ được đọc, và cơ chế nới
      // policy qua PR có CODEOWNERS là vô hiệu.
      cwd: ctx.cwd ?? undefined,
    };

    if (ctx.escapes.has(res.ruleId)) {
      record({ decision: 'escaped', ...common });
      stderr += `⚠ guardrail: ${res.ruleId} bị bỏ qua bằng CODEX_GUARDRAIL_ALLOW.\n`;
      continue;
    }

    record({ decision: 'denied', ...common });
    return deny(denyMessage(res, ctx), stderr);
  }

  return allow(stderr);
}
