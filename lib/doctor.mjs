// lib/doctor.mjs
// Trả lời đúng MỘT câu hỏi: guardrail có đang chặn thật không, và nếu không thì
// vì sao. Mọi dòng khác là phụ.
//
// Hai nguyên tắc chi phối cả file:
//   1. Doctor KHÔNG BAO GIỜ được ném. Đây là thứ người ta chạy khi máy đang
//      hỏng; crash đúng lúc đó là mất luôn chẩn đoán.
//   2. Không kiểm được thì KHÔNG in `✓`. Một dấu tick sai làm dev tin mình được
//      bảo vệ trong khi không — đúng chế độ hỏng mà cả task này sinh ra để bịt.
//      Ở đây im lặng tệ hơn báo động sai.
import { existsSync, readFileSync } from 'node:fs';
import {
  checkCodexCli, checkNode, codexHome, hooksPath, installDir, sidecarPath, TRUST_NOTICE,
} from './install.mjs';
import { findProjectRoot, loadPolicy, PolicyError } from './policy.mjs';
import { auditPath, readEntries } from './audit.mjs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Trust: bản ghi tin cậy của Codex
// ---------------------------------------------------------------------------
// Chế độ hỏng nguy hiểm nhất của cả hệ thống: hook cài đúng, hooks.json đúng,
// nhưng Codex bỏ qua IM LẶNG vì chưa được cấp tin cậy — guardrail trông như đang
// bảo vệ mà thực ra không chặn gì, và Codex cũng không báo gì cả.
//
// Đã ĐO trên `~/.codex/config.toml` thật (không suy diễn): bản ghi trust nằm ở
//
//     [hooks.state."<đường dẫn hooks.json>:<event_snake>:<chỉ số group>:<chỉ số hook>"]
//     trusted_hash = "sha256:<64 hex>"
//
// Hai con số là VỊ TRÍ của entry trong hooks.json, nên phải tra vị trí thật chứ
// không đoán: guardrail nằm sau các group của tool khác, và merge làm vị trí đổi.
//
// Doctor KHÔNG kiểm hash. Cách Codex tính `trusted_hash` chưa xác định — đã thử
// 78 tiền ảnh sha256 (command, JSON của hook/group, nối field theo 7 dấu phân
// cách, cả file hooks.json) đối chiếu 25 hash thật: không khớp cái nào. Nên đây
// là mức rút về mà plan cho phép: báo CÓ / KHÔNG CÓ bản ghi trust, và nói rõ
// trong output rằng hash không kiểm được.

// hooks.json ghi event kiểu CamelCase (`PreToolUse`), còn khoá trust trong
// config.toml ghi snake_case. Đã đối chiếu trên file thật: pre_tool_use,
// post_tool_use, session_start, session_end, subagent_start, subagent_stop,
// user_prompt_submit, pre_compact, stop.
function snakeEvent(event) {
  return String(event).replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

function trustKey(event, groupIndex, hookIndex) {
  return `${hooksPath()}:${snakeEvent(event)}:${groupIndex}:${hookIndex}`;
}

// Cố tình KHÔNG parse TOML đầy đủ, và cố tình không giữ lại giá trị nào:
// config.toml của người dùng có thể chứa token, nên doctor chỉ lấy đúng hai thứ
// nó cần — danh sách KHOÁ có trusted_hash, và công tắc codex_hooks — rồi không
// mang nội dung file ra output.
function readTrustState() {
  const path = join(codexHome(), 'config.toml');
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    return { ok: false, path, reason: err.code === 'ENOENT' ? 'không có file' : err.message };
  }
  const keys = new Set();
  // Thân section = mọi thứ tới `[` kế tiếp. Đủ cho bản ghi trust vì nó chỉ chứa
  // `enabled` và `trusted_hash`, cả hai đều là giá trị vô hướng.
  for (const m of text.matchAll(/^\[hooks\.state\."([^"]*)"\]([^[]*)/gm)) {
    if (/^[ \t]*trusted_hash[ \t]*=[ \t]*"[^"]+"/m.test(m[2])) keys.add(m[1]);
  }
  // Cùng regex với enableCodexHooks trong install.mjs, có ý thức: doctor phải
  // thấy đúng cái install vừa ghi, nên hai bên phải đọc cùng một kiểu.
  const codexHooks = /^\s*codex_hooks\s*=\s*true\s*$/m.test(text) ? 'true'
    : (/^\s*codex_hooks\s*=\s*false\s*$/m.test(text) ? 'false' : 'missing');
  return { ok: true, path, keys, codexHooks };
}

function readHooksDoc() {
  try {
    return { ok: true, doc: JSON.parse(readFileSync(hooksPath(), 'utf8')) };
  } catch (err) {
    return { ok: false, reason: err.code === 'ENOENT' ? 'không có file' : err.message };
  }
}

// Phải khớp CẢ matcher: hai entry của guardrail (`Bash` và `apply_patch`) dùng
// CHUNG một command, nên tra theo command không thôi sẽ gán cả hai vào cùng một
// group index — rồi báo "đã tin cậy" cho một entry chưa được tin cậy.
function locateEntry(doc, entry) {
  const groups = doc?.hooks?.[entry.event];
  if (!Array.isArray(groups)) return null;
  for (let gi = 0; gi < groups.length; gi += 1) {
    const group = groups[gi];
    if ((group?.matcher ?? null) !== (entry.matcher ?? null)) continue;
    const hooks = Array.isArray(group?.hooks) ? group.hooks : [];
    for (let hi = 0; hi < hooks.length; hi += 1) {
      if (hooks[hi]?.command === entry.command) return { gi, hi };
    }
  }
  return null;
}

// Trả về true nếu doctor được phép coi wiring là lành. Mọi nhánh còn lại đều hạ
// ok = false, kể cả nhánh "không biết".
function checkTrust(entries, lines) {
  const hooks = readHooksDoc();
  if (!hooks.ok) {
    lines.push(`✗ Không đọc được ${hooksPath()} (${hooks.reason}) — không kiểm được hook `
      + 'của guardrail còn nằm đó hay không. Chạy: guardrail install');
    return false;
  }

  const located = entries.map(entry => ({ entry, at: locateEntry(hooks.doc, entry) }));
  const gone = located.filter(x => x.at === null);
  if (gone.length > 0) {
    lines.push(`✗ ${gone.length}/${entries.length} entry của guardrail KHÔNG còn trong `
      + `${hooksPath()} — guardrail đang KHÔNG chặn gì. Chạy: guardrail install`);
    for (const x of gone) lines.push(`    thiếu: ${x.entry.event} / ${x.entry.matcher}`);
    return false;
  }

  const trust = readTrustState();
  if (!trust.ok) {
    lines.push(`⚠ Không xác định được trạng thái tin cậy — không đọc được ${trust.path} `
      + `(${trust.reason}).`);
    lines.push('  Đây KHÔNG phải "đã tin cậy": guardrail có thể đang KHÔNG chặn gì.');
    return false;
  }

  // Công tắc này tắt là TẮT HẾT hook của mọi tool, không riêng guardrail — và
  // Codex cũng không báo gì. Nó chắc chắn hơn cả trust (đọc được là biết ngay),
  // nên phải báo trước, và báo cả khi bên dưới thấy có bản ghi trust.
  let healthy = true;
  if (trust.codexHooks !== 'true') {
    lines.push(`✗ codex_hooks ${trust.codexHooks === 'false' ? '= false' : 'chưa được đặt'} `
      + `trong ${trust.path} — Codex đang TẮT toàn bộ hook, guardrail KHÔNG chặn gì. `
      + 'Chạy: guardrail install');
    healthy = false;
  }

  const untrusted = located.filter(x => !trust.keys.has(trustKey(x.entry.event, x.at.gi, x.at.hi)));
  if (untrusted.length > 0) {
    lines.push('✗ Hook đã cài nhưng CHƯA được Codex tin cậy — guardrail đang KHÔNG chặn gì.');
    lines.push(`  Không có bản ghi trust cho ${untrusted.length}/${entries.length} entry của `
      + `guardrail trong ${trust.path}.`);
    // Hướng dẫn lấy NGUYÊN VĂN từ install.mjs, không chép tay: sửa lời văn ở một
    // chỗ thì install và doctor không được nói hai kiểu.
    lines.push('');
    lines.push(TRUST_NOTICE);
    return false;
  }

  lines.push(`⚠ Có bản ghi trust cho đủ ${entries.length} entry của guardrail.`);
  lines.push('  Nhưng doctor KHÔNG kiểm được hash — cách Codex tính trusted_hash chưa xác');
  lines.push('  định — nên đây KHÔNG phải bằng chứng hook đang được tin cậy. Nếu guardrail');
  lines.push('  không chặn, mở Codex CLI và gõ /hooks để cấp lại tin cậy.');
  return healthy;
}

// ---------------------------------------------------------------------------
// Sidecar
// ---------------------------------------------------------------------------
// Sidecar hỏng thì phải BÁO, không được ném. Bản nháp trong plan gọi JSON.parse
// trần, nên sidecar thừa một dấu phẩy là doctor crash đúng lúc cần nó nhất.
function readSidecar() {
  const path = sidecarPath();
  if (!existsSync(path)) return { missing: true };
  let value;
  try {
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    return { error: `Sidecar ${path} không đọc được (${err.message}). Chạy: guardrail install` };
  }
  if (!value || !Array.isArray(value.entries)) {
    return { error: `Sidecar ${path} thiếu danh sách entries. Chạy: guardrail install` };
  }
  return { ok: true, value };
}

// ---------------------------------------------------------------------------
// Rule đang hiệu lực
// ---------------------------------------------------------------------------
const count = v => (Array.isArray(v) ? v.length : 0);

// Nhóm CÓ trong policy nhưng KHÔNG có rule nào trong REGISTRY của bản này. Bảng
// chứ không phải ba nhánh if: khi Plan 2 thêm rule cho một nhóm thì xoá đúng một
// dòng ở đây, và quên xoá thì doctor nói sai theo hướng an toàn (báo chưa cưỡng
// chế trong khi đã có) chứ không hứa hão.
// `deps` dùng boolean nên project ghi đè được thành false; hai nhóm kia là MẢNG,
// và mergePolicy HỢP mảng chứ không thay, nên project không tắt được — cảnh báo
// của chúng luôn hiện, đúng như thực tế.
const UNENFORCED = [
  {
    id: 'quality.protectedPaths', group: 'quality', noun: 'mẫu đường dẫn',
    size: p => count(p.quality?.protectedPaths),
  },
  {
    id: 'net.allowHosts', group: 'net', noun: 'host',
    size: p => count(p.net?.allowHosts),
  },
  {
    id: 'deps.enabled', group: 'deps', noun: 'công tắc bật',
    size: p => (p.deps?.enabled ? 1 : 0),
  },
];

// Nhóm deploy có BA trạng thái khác nhau về hành động, nên phải hiện khác nhau.
// Trạng thái giữa là trạng thái đặc thù của một rule allow-list: khai entrypoint
// mà chưa khai đích thì guardrail chặn 100% lệnh deploy — nói "✓" ở đó là khai
// sai, vì không có gì đang được BẢO VỆ, chỉ có mọi thứ đang bị CHẶN.
function describeDeploy(cfg, lines) {
  const entrypoints = count(cfg.entrypoints);
  const targets = count(cfg.targets);

  if (entrypoints === 0) {
    lines.push('  ⚠ deploy       — dự án chưa khai entrypoint nào, nhóm deploy KHÔNG cưỡng chế '
      + 'gì với script của dự án');
    return;
  }

  if (targets === 0) {
    lines.push(`  ✗ deploy       — có ${entrypoints} entrypoint nhưng CHƯA khai đích nào, nên `
      + 'MỌI lệnh deploy sẽ bị chặn. Đây không phải "đang bảo vệ đúng"');
    return;
  }

  lines.push(`  ✓ deploy       — ${entrypoints} entrypoint, ${targets} đích`);

  // Đích đòi người xác nhận phải nói ra: nó là đích mà agent KHÔNG deploy được
  // dù mọi thứ khác đúng, nên người vận hành cần biết trước khi ngạc nhiên.
  const human = (cfg.targets ?? []).filter(t => t?.requireHumanEscape).map(t => t.name);
  if (human.length > 0) {
    lines.push(`      đích cần người xác nhận: ${human.join(', ')} `
      + '(chặn tới khi người gõ CODEX_GUARDRAIL_ALLOW=deploy.target.<tên>)');
  }

  // Đích không khai branch là đích deploy được từ BẤT KỲ branch nào.
  const anyBranch = (cfg.targets ?? []).filter(t => count(t?.branches) === 0).map(t => t?.name);
  if (anyBranch.length > 0) {
    lines.push(`      đích không giới hạn branch: ${anyBranch.join(', ')} `
      + '— deploy được từ bất kỳ branch nào');
  }

  if (count(cfg.declaredHosts) === 0) {
    lines.push('      ⚠ declaredHosts trống — scp/rsync/ssh/curl đẩy dữ liệu tới host lạ sẽ '
      + 'KHÔNG được hỏi gì');
  }
}

function describeRules(policy, lines) {
  lines.push('Rule đang hiệu lực:');
  lines.push(`  ✓ secrets      — ${count(policy.secrets?.denyPaths)} mẫu đường dẫn bị chặn, `
    + `${count(policy.secrets?.allowPaths)} mẫu miễn`);
  lines.push(`  ✓ infra        — ${count(policy.infra?.denyBinaries)} binary, `
    + `${count(policy.infra?.denyPatterns)} pattern`);
  lines.push(`  ✓ git          — branch bảo vệ: ${(policy.git?.protectedBranches ?? []).join(', ')}`);

  // selfProtect.protectedPaths là OBJECT map ruleId -> mảng glob (self-protect.mjs
  // đọc đúng như vậy), KHÔNG phải mảng. Bản nháp trong plan lấy `.length` của
  // object nên luôn in "0 mẫu đường dẫn": doctor báo rule đang tắt trong khi nó
  // đang chạy — đúng loại lời khai sai mà doctor sinh ra để tránh.
  const raw = policy.selfProtect?.protectedPaths;
  const groups = raw && typeof raw === 'object' && !Array.isArray(raw) ? Object.entries(raw) : [];
  // Mirror đúng filter của self-protect.readGroups: nhóm có globs không phải mảng
  // hoặc mảng rỗng bị BỎ IM LẶNG. mergePolicy không type-check khoá MỚI, nên
  // thêm `{"my.rule": "oops"}` là mất nhóm đó mà không ai biết — doctor phải nói.
  const live = groups.filter(([, g]) => count(g) > 0);
  const dead = groups.filter(([, g]) => count(g) === 0);
  const patterns = live.reduce((n, [, g]) => n + g.length, 0);
  lines.push(`  ✓ selfprotect  — ${live.length} nhóm, ${patterns} mẫu đường dẫn`);
  for (const [ruleId] of dead) {
    lines.push(`  ✗ selfprotect/${ruleId} — TẮT vì globs không phải mảng hoặc mảng rỗng; `
      + 'nhóm này bị bỏ im lặng, không bảo vệ gì');
  }

  describeDeploy(policy.deploy ?? {}, lines);

  // Hai công tắc dưới đây là string trong policy, nên project ghi đè được thành
  // rỗng — tức TẮT được thật. Đó là lý do chúng có nhánh ✗ riêng.
  const commitPattern = policy.git?.commitMessagePattern ?? '';
  lines.push(commitPattern
    ? `  ✓ git.commit-message — ${commitPattern}`
    : '  ✗ git.commit-message — TẮT vì git.commitMessagePattern rỗng. Message commit '
      + 'không còn được kiểm.');

  const lint = policy.convention?.lintCommand ?? '';
  lines.push(lint
    // Cố tình KHÔNG in ✓: bản này chưa có rule convention nào trong registry, nên
    // lintCommand có cấu hình cũng không ai chạy. In ✓ ở đây là hứa một tầng bảo
    // vệ không tồn tại.
    ? `  ⚠ convention.lint — đã cấu hình "${lint}" nhưng bản này chưa có rule convention, `
      + 'nên lệnh KHÔNG được chạy'
    : '  ✗ convention.lint — TẮT vì convention.lintCommand rỗng. Guardrail đang chạy ở chế '
      + 'độ chỉ-bảo-vệ, không nâng được chất lượng.');

  // Cùng lý do như convention.lint, nhưng cho ba nhóm còn lại. Trước bản này
  // doctor IM LẶNG với chúng, nên `quality.protectedPaths` có 9 mẫu thật
  // (`.github/workflows/**`, `package-lock.json`, `dist/**`) mà không ai bảo vệ,
  // `net.allowHosts` là allow-list không được cưỡng chế (tức mạng mở hoàn toàn),
  // và `deps` ghi thẳng `"enabled": true`. Một dev đọc policy sẽ tin mình đang
  // được bảo vệ. Im lặng ở đây còn tệ hơn không khai nhóm đó.
  for (const { id, size, noun, group } of UNENFORCED) {
    const n = size(policy);
    if (n === 0) continue;
    lines.push(`  ⚠ ${id} — có ${n} ${noun} nhưng bản này chưa có rule ${group}, `
      + 'nên KHÔNG cưỡng chế gì');
  }

  return dead.length === 0;
}

// Mọi check khác trong file này soi THẾ GIỚI CỦA CHÍNH DOCTOR: nó chạy với cwd
// của người gõ lệnh, nên nó luôn tìm ra project root và luôn báo
// `✓ Policy: .../codex-guardrail.json`. Hook thì chạy trong ngữ cảnh KHÁC.
//
// Đo được trên máy thật: entry `{"repo":null,"branch":null}` từ phiên Codex, dù
// người dùng chạy Codex TỪ thư mục dự án. Khi projectRoot là null thì
// `loadPolicy(null)` chỉ trả policy MẶC ĐỊNH — nghĩa là `infra.allowBinaries`,
// `selfProtect.protectedPaths`, và mọi thứ team nới qua PR đều VÔ HIỆU, và tầng 3
// (CODEOWNERS gác file policy) không làm gì cả. Mà doctor vẫn xanh.
//
// Audit log là chỗ DUY NHẤT ghi lại ngữ cảnh thật của hook, nên doctor đọc nó để
// nói về thế giới thật thay vì chỉ về thế giới của mình.
//
// Chỉ xét entry TỪ LẦN CÀI HIỆN TẠI trở đi: một lỗ đã vá rồi mà doctor vẫn đỏ mãi
// vì log cũ thì người dùng học cách bỏ qua doctor.
function checkRealHookContext(sidecar, lines) {
  if (!sidecar.ok) return true; // chưa cài thì nhánh khác đã báo
  const since = sidecar.value?.installedAt;
  let entries;
  try {
    entries = readEntries();
  } catch {
    return true; // không đọc được log thì không phán, nhánh audit bên dưới vẫn in
  }
  const recent = since ? entries.filter(e => typeof e.ts === 'string' && e.ts >= since) : entries;
  if (recent.length === 0) {
    lines.push('⚠ Chưa có lần chạy hook nào từ lần cài này — chưa xác nhận được '
      + 'hook đọc đúng policy của dự án. Chạy một lệnh bị chặn trong Codex rồi '
      + 'chạy lại doctor.');
    return true;
  }
  const rootless = recent.filter(e => e.repo === null || e.repo === undefined);
  if (rootless.length === 0) {
    lines.push(`✓ Hook thật đọc được project root (${recent.length} lần chạy từ lần cài này)`);
    return true;
  }
  const cwds = [...new Set(rootless.map(e => e.cwd).filter(Boolean))];
  lines.push(`✗ ${rootless.length}/${recent.length} lần chạy hook KHÔNG tìm được project root, `
    + 'nên policy của dự án KHÔNG được đọc — guardrail đang chạy bằng policy mặc định.');
  lines.push('  Hệ quả: mọi thứ nới trong codex-guardrail.json (allowBinaries, '
    + 'protectedPaths, ...) đang vô hiệu, và tầng CODEOWNERS không có tác dụng.');
  if (cwds.length > 0) lines.push(`  cwd hook nhận được: ${cwds.join(', ')}`);
  return false;
}

// ---------------------------------------------------------------------------
export function diagnose(cwd) {
  const lines = [];
  let ok = true;

  const node = checkNode();
  lines.push(`${node.ok ? '✓' : '✗'} ${node.message}`);
  if (!node.ok) ok = false;

  // Ngay sau Node, TRƯỚC mọi thứ về wiring: nếu không có Codex CLI chạy được
  // thì hooks.json đúng và trust đủ cũng vô nghĩa. Đặt sau wiring sẽ cho người
  // đọc thấy một dãy ✓ rồi mới tới ✗, đúng thứ tự gây hiểu sai nhất.
  const cli = checkCodexCli();
  lines.push(`${cli.ok ? '✓' : '✗'} ${cli.message}`);
  if (!cli.ok) ok = false;

  const sidecar = readSidecar();
  if (sidecar.ok) {
    lines.push(`✓ Đã cài bản ${sidecar.value.version} lúc ${sidecar.value.installedAt}`);
    lines.push(`  Runtime: ${installDir()}`);
    lines.push(`  Entry hook: ${sidecar.value.entries.length} mục trong ${hooksPath()}`);
    if (!checkTrust(sidecar.value.entries, lines)) ok = false;
  } else if (sidecar.missing) {
    lines.push('✗ Guardrail chưa được cài trên máy này. Chạy: guardrail install');
    ok = false;
  } else {
    lines.push(`✗ ${sidecar.error}`);
    ok = false;
  }

  const root = findProjectRoot(cwd);
  lines.push(root ? `✓ Project root: ${root}` : '⚠ Không tìm được .git từ cwd');

  let policy = null;
  try {
    const res = loadPolicy(root);
    policy = res.policy;
    lines.push(res.source
      ? `✓ Policy: ${res.source}`
      : '⚠ Policy: đang dùng bản mặc định của plugin');
    for (const w of res.warnings) lines.push(`  ${w}`);
  } catch (err) {
    // PolicyError là lỗi người dùng sửa được nên in message; lỗi khác in thô còn
    // hơn để doctor ném.
    lines.push(`✗ Policy lỗi: ${err instanceof PolicyError ? err.message : String(err)}`);
    ok = false;
  }

  if (policy && !describeRules(policy, lines)) ok = false;

  if (!checkRealHookContext(sidecar, lines)) ok = false;

  lines.push(`Audit log: ${auditPath()} (${readEntries().length} dòng)`);
  return { ok, lines };
}
