// lib/context.mjs
import { findProjectRoot } from './policy.mjs';

export class ContextError extends Error {}

const EVENT_KEYS = ['hook_event_name', 'event'];
const COMMAND_KEYS = ['command', 'cmd', 'shell_command', 'script'];
const FILE_KEYS = ['file_path', 'path', 'filename', 'file'];
const PATCH_KEYS = ['patch', 'diff', 'content', 'input'];
const STDOUT_KEYS = ['stdout', 'output', 'result'];

function pick(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

// apply_patch dùng header "*** Update File: path" (cũng có Add/Delete/Move).
// Đổi tên file thật ra dùng "*** Update File: <đường cũ>" kèm dòng
// "*** Move to: <đường mới>" ngay sau — phải bắt cả hai để không bỏ lọt
// đích đến (agent đổi tên một file thành .env thì đích phải lộ ra).
// Giữ luôn nhánh "Move File:" phòng biến thể cũ/khác, dù chưa thấy trong
// payload thật — union chỉ tốn một nhánh regex không khớp, không mất gì.
// Phủ thêm unified diff "+++ b/path" cho trường hợp Codex đẩy diff thuần.
function filesFromPatch(patch) {
  if (!patch) return [];
  const out = new Set();
  for (const line of patch.split('\n')) {
    let m = line.match(/^\*\*\*\s+(?:Update|Add|Delete|Move)\s+File:\s+(.+)$/);
    if (m) { out.add(m[1].trim()); continue; }
    m = line.match(/^\*\*\*\s+Move to:\s+(.+)$/);
    if (m) { out.add(m[1].trim()); continue; }
    m = line.match(/^\+\+\+\s+(?:b\/)?(.+)$/);
    if (m && m[1].trim() !== '/dev/null') out.add(m[1].trim());
  }
  return [...out];
}

// Codex 0.149 đặt toàn bộ patch envelope (*** Begin Patch ... *** End Patch)
// vào tool_input.command — cùng chỗ với command của Bash — chứ không phải
// vào tool_input.patch/diff/content/input. Với apply_patch, coi COMMAND_KEYS
// là nguồn dự phòng cho patch body, sau khi đã thử PATCH_KEYS trước.
function extractPatchBody(toolName, input) {
  const direct = pick(input, PATCH_KEYS);
  if (direct) return direct;
  if (toolName === 'apply_patch') return pick(input, COMMAND_KEYS);
  return null;
}

// tool_response của PostToolUse là chuỗi thô (raw stdout/stderr đã gộp),
// không phải object bọc { stdout, output, result }. Thử payload cấp cao
// nhất trước, rồi tới tool_response dạng chuỗi, rồi mới tới tool_response
// dạng object (phòng khi Codex đổi shape trong tương lai).
function extractStdout(payload) {
  const direct = pick(payload, STDOUT_KEYS);
  if (direct) return direct;
  const response = payload.tool_response;
  if (typeof response === 'string' && response.length > 0) return response;
  if (response && typeof response === 'object') {
    const nested = pick(response, STDOUT_KEYS);
    if (nested) return nested;
  }
  return null;
}

export function buildContext(rawStdin, env = {}) {
  if (typeof rawStdin !== 'string' || rawStdin.trim() === '') {
    throw new ContextError('stdin rỗng — không xác định được tool call, fail-closed.');
  }
  let payload;
  try {
    payload = JSON.parse(rawStdin);
  } catch (err) {
    throw new ContextError(`stdin không phải JSON hợp lệ: ${err.message}`);
  }

  // JSON.parse chấp nhận cả scalar (null/true/42/"str") và mảng — không chỉ
  // object. Với các dạng đó, đọc thuộc tính trên payload hoặc âm thầm trả
  // undefined (sinh ctx đoán: event/tool='unknown', cwd=process.cwd()) hoặc
  // ném TypeError không kiểm soát (payload === null). Cả hai đều vi phạm
  // "không đoán, không trả ctx rỗng, fail-closed" — chặn ngay ở đây.
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    const got = payload === null ? 'null' : Array.isArray(payload) ? 'mảng' : typeof payload;
    throw new ContextError(`payload JSON phải là object, nhận được ${got} — fail-closed.`);
  }

  // event phải có thật, không được đoán bằng 'unknown': dispatcher (Task 10)
  // tra REGISTRY theo event, event rỗng/giả sẽ khớp 0 rule và im lặng allow
  // — đúng lỗ mà guardrail được tạo ra để chặn. tool_name thì KHÔNG bắt buộc:
  // SessionStart hợp lệ không có tool_name/tool_input.
  const event = pick(payload, EVENT_KEYS);
  if (!event) {
    throw new ContextError('payload thiếu hook_event_name — không xác định được loại sự kiện, fail-closed.');
  }

  const input = payload.tool_input ?? payload.input ?? {};
  const cwd = payload.cwd ?? process.cwd();
  const tool = payload.tool_name ?? payload.tool ?? 'unknown';

  const patchBody = extractPatchBody(tool, input);
  const patchFiles = new Set(filesFromPatch(patchBody));
  const single = pick(input, FILE_KEYS);
  if (single) patchFiles.add(single);

  const escapes = new Set(
    String(env.CODEX_GUARDRAIL_ALLOW ?? '').split(',').map(s => s.trim()).filter(Boolean)
  );

  // apply_patch không phải lệnh shell sẽ chạy — envelope của nó đã có đường
  // riêng qua patchBody (xem extractPatchBody). Nhồi envelope vào ctx.command
  // sinh false positive: rule soi "lệnh sẽ chạy" (vd. secrets.read-path,
  // infra.deny-binary) sẽ tokenize nội dung patch và chặn oan việc sửa file
  // hợp lệ có chứa dòng như "cat .env" hay "psql ...".
  const command = tool === 'apply_patch' ? null : pick(input, COMMAND_KEYS);

  return {
    event,
    tool,
    command,
    patchFiles: [...patchFiles],
    patchBody,
    stdout: extractStdout(payload),
    cwd,
    projectRoot: findProjectRoot(cwd),
    escapes,
  };
}
