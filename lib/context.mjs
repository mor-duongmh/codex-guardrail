// lib/context.mjs
import { findProjectRoot } from './policy.mjs';

export class ContextError extends Error {}

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
// Phủ thêm unified diff "+++ b/path" cho trường hợp Codex đẩy diff thuần.
function filesFromPatch(patch) {
  if (!patch) return [];
  const out = new Set();
  for (const line of patch.split('\n')) {
    let m = line.match(/^\*\*\*\s+(?:Update|Add|Delete|Move)\s+File:\s+(.+)$/);
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
    event: payload.hook_event_name ?? payload.event ?? 'unknown',
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
