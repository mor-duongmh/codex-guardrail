// lib/install.mjs
// Wire hook của guardrail vào ~/.codex, và gỡ ra, mà KHÔNG được làm mất cấu hình
// của người khác: hooks.json là file DÙNG CHUNG — mọi tool khác cũng ghi vào đó.
// Vì vậy mọi thao tác ghi đều theo ba nguyên tắc:
//   1. Merge, không ghi đè. Entry của người khác phải còn nguyên sau install.
//   2. Đọc-hiểu-được hoặc từ chối. hooks.json hỏng JSON thì DỪNG, không ghi gì
//      cả — nuốt lỗi parse rồi ghi đè là xoá trắng cấu hình của người dùng vì
//      một dấu phẩy thừa.
//   3. Kiểm hết mọi thứ có thể từ chối TRƯỚC khi ghi byte đầu tiên, để nhánh
//      lỗi không bao giờ để lại trạng thái nửa vời.
import {
  copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync,
  rmSync, writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const NODE_MIN = 20;

// Khối này là phần QUAN TRỌNG NHẤT của cả subcommand, không phải lời chào cuối.
// Codex bỏ qua IM LẶNG mọi hook chưa được cấp tin cậy: chưa grant trust thì
// guardrail không chặn gì, và Codex cũng không báo gì — người dùng tưởng mình
// được bảo vệ trong khi không. Trên máy mới `~/.codex/config.toml` không có
// section [hooks] nào, nên "chưa có bản ghi trust" là trạng thái MẶC ĐỊNH, tức
// đây là nhánh CHÍNH chứ không phải ca biên.
export const TRUST_NOTICE = `⚠ Còn MỘT bước bạn phải tự làm — guardrail chưa chạy nếu thiếu bước này.

  Codex bỏ qua mọi hook chưa được cấp tin cậy, và không báo gì cả.

  1. Mở Codex CLI
  2. Gõ: /hooks
  3. Tìm HAI mục PreToolUse có lệnh chứa guardrail/bin/guardrail.mjs
     (matcher "Bash" và matcher "apply_patch") rồi cấp tin cậy cho cả hai.
     Danh sách KHÔNG hiện chữ "codex-guardrail" — hooks.json chỉ chứa đường dẫn
     lệnh, nên hãy nhận diện bằng đoạn guardrail.mjs.

  Chỉ phải làm MỘT LẦN. Sửa codex-guardrail.json về sau không làm mất tin cậy,
  vì rule nằm trong file policy chứ không nằm trong lệnh hook.

  Kiểm lại bằng: guardrail doctor`;

export function codexHome() {
  // CODEX_HOME là biến của chính Codex, không phải cửa sau riêng cho test — nên
  // dùng nó vừa đúng với người dùng đã đổi chỗ ở của Codex, vừa là điểm tiêm duy
  // nhất để test không bao giờ chạm ~/.codex thật. Chuỗi rỗng coi như chưa đặt:
  // nếu không, mọi đường dẫn thành tương đối theo cwd.
  const env = process.env.CODEX_HOME;
  return env && env.trim() !== '' ? env : join(homedir(), '.codex');
}

export function installDir() {
  return join(codexHome(), 'guardrail');
}

export function sidecarPath() {
  return join(codexHome(), '.guardrail-installed.json');
}

export function hooksPath() {
  return join(codexHome(), 'hooks.json');
}

export function checkNode(versionString = process.version) {
  const major = Number(String(versionString).replace(/^v/, '').split('.')[0]);
  return Number.isFinite(major) && major >= NODE_MIN
    ? { ok: true, message: `Node ${versionString} — đạt yêu cầu.` }
    : { ok: false, message: `Cần Node >= ${NODE_MIN}, máy đang dùng ${versionString}.` };
}

// Guardrail cưỡng chế QUA hook của Codex CLI, nên không có Codex CLI chạy được
// thì bản cài không bảo vệ gì — dù hooks.json đúng và trust có bản ghi.
//
// Đo được trên máy thật: `/opt/homebrew/bin/codex` là symlink tới cask
// `0.130.0` đã bị xoá. `~/.codex` vẫn còn nguyên với 26 bản ghi trust từ hồi
// CLI còn chạy, nên mọi tín hiệu khác đều "lành" trong khi guardrail chặn 0 thứ.
//
// Phân biệt HỎNG với THIẾU vì hai ca cần hai hành động khác nhau, và
// `existsSync` một mình không phân biệt được: nó ĐI THEO symlink nên symlink
// treo trả về false y như không có file. `lstatSync` mới thấy được symlink.
export function checkCodexCli(env = process.env) {
  for (const dir of String(env.PATH ?? '').split(':').filter(Boolean)) {
    const p = join(dir, 'codex');
    try { lstatSync(p); } catch { continue; }
    if (existsSync(p)) return { ok: true, status: 'ok', message: `Codex CLI: ${p}` };
    let target = p;
    try { target = readlinkSync(p); } catch { /* không phải symlink: giữ nguyên p */ }
    return {
      ok: false,
      status: 'broken',
      message: `Codex CLI hỏng: ${p} trỏ tới ${target} — đích không tồn tại, nên `
        + 'KHÔNG có Codex CLI nào đọc hooks.json và guardrail đang chặn 0 thứ. '
        + 'Cài lại (Homebrew: brew reinstall --cask codex) rồi chạy lại doctor.',
    };
  }
  return {
    ok: false,
    status: 'missing',
    message: 'Không tìm thấy codex trên PATH. Guardrail cưỡng chế qua hook của Codex CLI, '
      + 'nên bản cài này chưa bảo vệ gì. Lưu ý: nếu bạn dùng Codex trong app ChatGPT '
      + 'desktop thì app đó KHÔNG đọc ~/.codex/hooks.json — nó có hệ thống hooks riêng '
      + 'trong Settings, và guardrail chưa hỗ trợ đường đó.',
  };
}

export function enableCodexHooks(tomlText) {
  const text = tomlText ?? '';
  if (/^\s*codex_hooks\s*=\s*true\s*$/m.test(text)) return text;
  if (/^\s*codex_hooks\s*=\s*false\s*$/m.test(text)) {
    return text.replace(/^\s*codex_hooks\s*=\s*false\s*$/m, 'codex_hooks = true');
  }
  if (/^\s*\[features\]\s*$/m.test(text)) {
    return text.replace(/^\s*\[features\]\s*$/m, '[features]\ncodex_hooks = true');
  }
  const sep = text === '' || text.endsWith('\n') ? '' : '\n';
  return `${text}${sep}\n[features]\ncodex_hooks = true\n`;
}

// Tên tool THẬT, đã đo ở Task 0: `Bash` và `apply_patch`. Không phải `shell` —
// matcher sai thì hook không bao giờ khớp, và Codex không báo gì cả.
function hookEntries() {
  const bin = join(installDir(), 'bin', 'guardrail.mjs');
  const cmd = `node "${bin}" hook`;
  return [
    { event: 'PreToolUse', matcher: 'Bash', command: cmd },
    { event: 'PreToolUse', matcher: 'apply_patch', command: cmd },
  ];
}

export function mergeHooks(existing, entries) {
  const usable = existing && typeof existing === 'object' && !Array.isArray(existing);
  const out = usable ? structuredClone(existing) : {};
  out.hooks ??= {};
  for (const e of entries) {
    out.hooks[e.event] ??= [];
    // Idempotent theo (matcher, command): chạy install lần hai không được sinh
    // entry trùng, vì Codex sẽ gọi hook hai lần cho cùng một lệnh.
    const already = out.hooks[e.event].some(group =>
      group.matcher === e.matcher
      && (group.hooks ?? []).some(h => h.command === e.command));
    if (already) continue;
    out.hooks[e.event].push({
      ...(e.matcher ? { matcher: e.matcher } : {}),
      hooks: [{ type: 'command', command: e.command }],
    });
  }
  return out;
}

// Trả { ok:true, value, existed } hoặc { ok:false, error }. Không có nhánh nào
// "im lặng dùng mặc định" cho file có sẵn: file người dùng mà ta không hiểu thì
// ta không có quyền ghi lên.
function readHooksFile() {
  const path = hooksPath();
  if (!existsSync(path)) return { ok: true, value: { hooks: {} }, existed: false };

  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    return { ok: false, error: `Không đọc được ${path}: ${err.message}. Không ghi gì cả.` };
  }

  let value;
  try {
    value = JSON.parse(text);
  } catch (err) {
    return {
      ok: false,
      error: `${path} không phải JSON hợp lệ (${err.message}). Không ghi gì cả — `
        + 'sửa file rồi chạy lại.',
    };
  }

  // Hình dạng cũng phải kiểm, không chỉ cú pháp: nếu `hooks` là array thì
  // JSON.stringify sau khi merge sẽ ÂM THẦM đánh rơi khoá vừa thêm.
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: `${path} phải là object JSON ở gốc. Không ghi gì cả.` };
  }
  const hooks = value.hooks;
  if (hooks !== undefined
    && (hooks === null || typeof hooks !== 'object' || Array.isArray(hooks))) {
    return { ok: false, error: `${path}: khoá "hooks" phải là object. Không ghi gì cả.` };
  }
  for (const [event, groups] of Object.entries(hooks ?? {})) {
    if (!Array.isArray(groups)) {
      return { ok: false, error: `${path}: hooks.${event} phải là array. Không ghi gì cả.` };
    }
  }
  return { ok: true, value, existed: true };
}

// Sidecar là bản ghi "ta đã thêm đúng những entry này". Đọc không hiểu được thì
// KHÔNG đoán bừa entry nào là của mình rồi xoá — xoá nhầm hook của tool khác còn
// tệ hơn là để lại hook của mình.
function readSidecar() {
  const path = sidecarPath();
  if (!existsSync(path)) return { ok: false, missing: true };
  let value;
  try {
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    return {
      ok: false,
      error: `Sidecar ${path} không đọc được (${err.message}), nên không biết chắc entry nào `
        + 'là của guardrail. Không ghi gì cả — gỡ tay entry có command trỏ vào '
        + `${installDir()} rồi xoá sidecar.`,
    };
  }
  if (!value || !Array.isArray(value.entries)) {
    return {
      ok: false,
      error: `Sidecar ${path} thiếu danh sách entries. Không ghi gì cả — gỡ tay entry có `
        + `command trỏ vào ${installDir()} rồi xoá sidecar.`,
    };
  }
  return { ok: true, value };
}

function readPackageVersion(sourceDir) {
  try {
    return JSON.parse(readFileSync(join(sourceDir, 'package.json'), 'utf8')).version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

export function install({ sourceDir }) {
  const messages = [];

  const node = checkNode();
  if (!node.ok) return { ok: false, messages: [node.message] };
  messages.push(node.message);

  const dest = installDir();
  // Chạy install từ chính bản đã cài sẽ xoá nguồn trước khi copy — mất luôn
  // guardrail. Từ chối thẳng.
  if (resolve(sourceDir) === resolve(dest)) {
    return {
      ok: false,
      messages: [`Nguồn trùng đích (${dest}). Chạy install từ repo hoặc bản npm, `
        + 'không chạy từ bản đã copy vào CODEX_HOME.'],
    };
  }

  const hooksFile = readHooksFile();
  if (!hooksFile.ok) return { ok: false, messages: [hooksFile.error] };

  // Từ đây mới bắt đầu ghi.
  mkdirSync(codexHome(), { recursive: true });
  // Xoá rồi copy lại: giữ nguyên thư mục cũ sẽ để sót file của bản trước (rule
  // đã bỏ, policy đã đổi tên), và bản cài thành ra là bản trộn hai phiên bản.
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  for (const part of ['bin', 'lib', 'policy', 'package.json']) {
    cpSync(join(sourceDir, part), join(dest, part), { recursive: true });
  }
  messages.push(`Đã copy runtime vào ${dest}`);

  const configPath = join(codexHome(), 'config.toml');
  const toml = existsSync(configPath) ? readFileSync(configPath, 'utf8') : '';
  const nextToml = enableCodexHooks(toml);
  if (nextToml !== toml) {
    if (existsSync(configPath)) copyFileSync(configPath, `${configPath}.bak`);
    writeFileSync(configPath, nextToml);
    messages.push('Đã bật codex_hooks = true trong config.toml');
  } else {
    messages.push('codex_hooks đã bật, không đụng config.toml');
  }

  const entries = hookEntries();
  const merged = mergeHooks(hooksFile.value, entries);
  if (hooksFile.existed) copyFileSync(hooksPath(), `${hooksPath()}.bak`);
  writeFileSync(hooksPath(), `${JSON.stringify(merged, null, 2)}\n`);
  messages.push(hooksFile.existed
    ? `Đã merge ${entries.length} entry vào ${hooksPath()} (backup ${hooksPath()}.bak)`
    : `Đã tạo ${hooksPath()} với ${entries.length} entry`);

  writeFileSync(sidecarPath(), `${JSON.stringify({
    version: readPackageVersion(sourceDir),
    installedAt: new Date().toISOString(),
    entries,
  }, null, 2)}\n`);
  messages.push(`Đã ghi sidecar ${sidecarPath()}`);
  messages.push('Khởi động lại Codex để hook có hiệu lực.');
  // Cố tình KHÔNG kết bằng "cài xong": phần tự động mới xong, và guardrail chưa
  // chặn gì cho tới khi người dùng cấp tin cậy ở khối bên dưới.
  messages.push('Xong PHẦN TỰ ĐỘNG — mới là MỘT NỬA. Còn MỘT bước thủ công bên dưới.');

  return { ok: true, messages, trustNotice: TRUST_NOTICE };
}

export function uninstall() {
  const messages = [];

  const sidecarFile = readSidecar();
  if (sidecarFile.missing) {
    return {
      ok: false,
      messages: [`Guardrail chưa được cài trên máy này (không có ${sidecarPath()}).`],
    };
  }
  if (!sidecarFile.ok) return { ok: false, messages: [sidecarFile.error] };

  const hooksFile = readHooksFile();
  if (!hooksFile.ok) return { ok: false, messages: [hooksFile.error] };

  if (hooksFile.existed) {
    const hooks = hooksFile.value;
    // Chỉ xoá hook có command KHỚP CHÍNH XÁC entry ta đã ghi trong sidecar. Lọc
    // theo từng hook chứ không theo cả group: một group có thể chứa cả hook của
    // ta lẫn của tool khác.
    const mine = new Set(sidecarFile.value.entries.map(e => e.command));
    let removed = 0;
    for (const [event, groups] of Object.entries(hooks.hooks ?? {})) {
      hooks.hooks[event] = groups
        .map((g) => {
          const kept = (g.hooks ?? []).filter(h => !mine.has(h.command));
          removed += (g.hooks ?? []).length - kept.length;
          return { ...g, hooks: kept };
        })
        .filter(g => g.hooks.length > 0);
      if (hooks.hooks[event].length === 0) delete hooks.hooks[event];
    }
    copyFileSync(hooksPath(), `${hooksPath()}.bak`);
    writeFileSync(hooksPath(), `${JSON.stringify(hooks, null, 2)}\n`);
    messages.push(`Đã gỡ ${removed} entry của guardrail khỏi ${hooksPath()} `
      + `(backup ${hooksPath()}.bak)`);
  } else {
    // Người dùng đã xoá tay hooks.json: không tạo lại file rác chỉ để ghi `{}`.
    messages.push(`Không có ${hooksPath()} — không tạo file mới.`);
  }

  rmSync(installDir(), { recursive: true, force: true });
  rmSync(sidecarPath(), { force: true });
  messages.push('Đã xoá runtime và sidecar. Không đụng codex_hooks trong config.toml — '
    + 'tool khác có thể đang cần.');
  return { ok: true, messages };
}
