// lib/init.mjs
// Sinh `codex-guardrail.json` ban đầu bằng cách SUY RA từ repo (§8.3), để "git
// workflow trước đó của dự án" được nắm bắt mà không phải khai tay.
//
// Nguyên tắc xuyên suốt file này: THIẾU THÔNG TIN THÌ ĐỂ TRỐNG, không đoán.
// Một policy đoán bừa sẽ chặn oan ngay từ lệnh đầu tiên dev gõ, và đường thoát
// duy nhất của họ là tắt guardrail — tức đoán bừa còn tệ hơn không sinh gì.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { loadDefaultPolicy } from './policy.mjs';

export const POLICY_FILE = 'codex-guardrail.json';

// Ngưỡng coi là "dự án đã theo conventional commits". Chọn 0.6 vì hai đầu phân
// bố rất tách biệt: dự án theo quy ước thì gần như mọi commit khớp, dự án không
// theo thì rất ít khớp. Ngưỡng ở giữa nên vài commit lệch (merge, revert, commit
// tay) không đổi kết luận.
const CONVENTIONAL_MIN_RATIO = 0.6;

// Chỉ những file thật sự mang quy ước code. Cố ý KHÔNG có README.md: gần như
// repo nào cũng có, nên đưa vào là biến conventionDocs thành trường luôn-có-giá-
// trị mà chẳng nói lên điều gì.
const CONVENTION_DOC_CANDIDATES = [
  'CLAUDE.md', 'AGENTS.md', 'CONTRIBUTING.md',
  join('docs', 'code-standards.md'), join('docs', 'conventions.md'),
];

function defaultRunGit(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  if (r.status !== 0 || typeof r.stdout !== 'string') return null;
  return r.stdout.trim();
}

function readJsonIfAny(path) {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

// --- suy luận từng trường -------------------------------------------------

function inferDefaultBranch(runGit, cwd, notes) {
  const ref = runGit(['symbolic-ref', 'refs/remotes/origin/HEAD'], cwd);
  const name = ref && /^refs\/remotes\/origin\/(.+)$/.exec(ref.trim())?.[1];
  if (name) return name;
  notes.push('Không đọc được origin/HEAD (repo chưa có remote, hoặc mới clone) — '
    + 'giữ danh sách branch bảo vệ mặc định. Nếu default branch của bạn khác, sửa '
    + `git.protectedBranches trong ${POLICY_FILE}.`);
  return null;
}

function inferCommitPattern(runGit, cwd, notes, defaultPattern) {
  const out = runGit(['log', '--format=%s', '-50'], cwd);
  const subjects = (out ?? '').split('\n').map(s => s.trim()).filter(Boolean);
  if (subjects.length === 0) {
    notes.push('Chưa đọc được commit nào nên không suy ra được quy ước message — '
      + 'để git.commitMessagePattern rỗng (TẮT). Điền pattern để bật lại.');
    return '';
  }
  const re = new RegExp(defaultPattern);
  const hits = subjects.filter(s => re.test(s)).length;
  if (hits / subjects.length >= CONVENTIONAL_MIN_RATIO) {
    notes.push(`${hits}/${subjects.length} commit gần đây theo conventional commits — `
      + 'bật kiểm message.');
    return defaultPattern;
  }
  // Không áp quy ước dự án chưa theo: nó chặn oan mọi commit tiếp theo, và cách
  // thoát duy nhất của dev là tắt guardrail.
  notes.push(`Chỉ ${hits}/${subjects.length} commit gần đây theo conventional commits, `
    + 'nên KHÔNG áp quy ước đó — để git.commitMessagePattern rỗng (TẮT). Guardrail '
    + 'không áp quy ước mà dự án chưa dùng.');
  return '';
}

function inferLintCommand(cwd, notes) {
  const pkg = readJsonIfAny(join(cwd, 'package.json'));
  if (pkg?.scripts?.lint) return 'npm run lint';

  const makefile = join(cwd, 'Makefile');
  // Target Makefile phải ở ĐẦU DÒNG: `.PHONY: lint` hay chữ `lint` trong một
  // recipe đều không phải target.
  if (existsSync(makefile) && /^lint\s*:/m.test(readFileSync(makefile, 'utf8'))) {
    return 'make lint';
  }

  const pyproject = join(cwd, 'pyproject.toml');
  if (existsSync(pyproject)) {
    const text = readFileSync(pyproject, 'utf8');
    if (/^\[tool\.ruff/m.test(text)) return 'ruff check .';
    if (/^\[tool\.flake8/m.test(text)) return 'flake8';
  }

  const composer = readJsonIfAny(join(cwd, 'composer.json'));
  if (composer?.scripts?.lint) return 'composer run lint';

  // §8.3 yêu cầu in ra câu này. Nó là thứ DUY NHẤT nói cho người dùng biết
  // guardrail đang chạy ở chế độ giảm năng lực.
  notes.push('Dự án này chưa khai báo lệnh lint — guardrail đang chạy ở chế độ '
    + 'chỉ-bảo-vệ, không nâng được chất lượng.');
  return '';
}

function inferConventionDocs(cwd) {
  return CONVENTION_DOC_CANDIDATES.filter(rel => existsSync(join(cwd, rel)));
}

// Ứng viên entrypoint deploy, theo thứ tự ưu tiên. Cùng khuôn với
// `inferLintCommand`. Chỉ trả MỘT: nhiều entrypoint là thứ dự án tự khai thêm,
// còn `init` đoán nhiều thì mỗi cái đoán sai là một lệnh bị chặn oan.
const DEPLOY_SCRIPT_CANDIDATES = [
  join('scripts', 'deploy.sh'), join('scripts', 'deploy'), 'deploy.sh',
  join('bin', 'deploy'), join('scripts', 'publish.sh'),
];

// Trả `{ entrypoint, protectedPath }`. `protectedPath` là đường TƯƠNG ĐỐI trong
// repo (không có `./`) vì `selfProtect.protectedPaths` khớp glob đường dẫn; còn
// `entrypoint` là chuỗi người GÕ nên giữ `./`.
function inferDeploy(cwd, notes) {
  for (const rel of DEPLOY_SCRIPT_CANDIDATES) {
    if (existsSync(join(cwd, rel))) {
      const posix = rel.split(/[/\\]/).join('/');
      return { entrypoint: `./${posix}`, protectedPath: posix };
    }
  }

  const pkg = readJsonIfAny(join(cwd, 'package.json'));
  if (pkg?.scripts?.deploy) return { entrypoint: 'npm run deploy', protectedPath: null };

  const makefile = join(cwd, 'Makefile');
  // Target phải ở ĐẦU DÒNG, cùng lý do như inferLintCommand: `.PHONY: deploy`
  // không phải target.
  if (existsSync(makefile) && /^deploy\s*:/m.test(readFileSync(makefile, 'utf8'))) {
    return { entrypoint: 'make deploy', protectedPath: 'Makefile' };
  }

  notes.push('Không tìm được script deploy nào — deploy.entrypoints để TRỐNG, nghĩa là '
    + `nhóm deploy KHÔNG cưỡng chế gì. Nếu dự án có deploy, khai entrypoint vào ${POLICY_FILE}.`);
  return null;
}

// --- API ------------------------------------------------------------------

export function inferPolicy(cwd, { runGit = defaultRunGit } = {}) {
  const base = loadDefaultPolicy();
  const notes = [];

  const branch = inferDefaultBranch(runGit, cwd, notes);
  // Ghi ra bản ĐÃ HỢP sẵn với mặc định, để người mở file thấy đúng những gì sẽ
  // có hiệu lực. `mergePolicy` hợp mảng nên ghi thêm không làm mất mặc định.
  const branches = branch && !base.git.protectedBranches.includes(branch)
    ? [...base.git.protectedBranches, branch]
    : [...base.git.protectedBranches];

  const deploy = inferDeploy(cwd, notes);

  const policy = {
    git: {
      protectedBranches: branches,
      commitMessagePattern: inferCommitPattern(runGit, cwd, notes, base.git.commitMessagePattern),
    },
    convention: {
      lintCommand: inferLintCommand(cwd, notes),
      conventionDocs: inferConventionDocs(cwd),
    },
    deploy: {
      entrypoints: deploy ? [deploy.entrypoint] : [],
      // LUÔN rỗng. `init` không suy ra được tên môi trường từ repo, và đoán ở đây
      // là đoán chính thứ cần người review. Để trống thì mọi lệnh deploy bị chặn
      // (an toàn, ồn) — đoán sai thì một đích không ai duyệt trở thành hợp lệ.
      targets: [],
    },
  };

  if (deploy) {
    // Trạng thái khai-NỬA-VỜI phải nói ra, và nói khác trạng thái chưa-khai: lúc
    // này guardrail chặn 100% lệnh deploy, đó không phải "đang bảo vệ đúng".
    notes.push(`Tìm được entrypoint deploy (${deploy.entrypoint}) nhưng deploy.targets đang `
      + 'TRỐNG, nên MỌI lệnh deploy sẽ bị chặn. Khai các đích (tên + branch được phép) '
      + 'rồi mở PR.');
    if (deploy.protectedPath) {
      policy.selfProtect = {
        protectedPaths: { 'deploy.script': [deploy.protectedPath] },
      };
    }
  }

  return { policy, notes };
}

export function initProject({ cwd, runGit = defaultRunGit, force = false }) {
  const target = join(cwd, POLICY_FILE);
  const lines = [];

  if (existsSync(target) && !force) {
    lines.push(`✗ ${target} đã có — init KHÔNG ghi đè.`);
    lines.push('  File này là nơi team đã nới rule và đã qua review CODEOWNERS;');
    lines.push('  ghi đè là xoá công việc của người khác. Sửa tay, hoặc xoá file rồi');
    lines.push('  chạy lại nếu bạn thật sự muốn sinh mới.');
    return { ok: false, path: target, lines, policy: null };
  }

  const { policy, notes } = inferPolicy(cwd, { runGit });
  writeFileSync(target, `${JSON.stringify(policy, null, 2)}\n`);

  lines.push(`✓ Đã sinh ${target}`);
  for (const n of notes) lines.push(`  ⚠ ${n}`);
  lines.push('');
  lines.push('Còn HAI bước nữa — đây là hai tầng mà dev KHÔNG tháo được:');
  lines.push('');
  lines.push('  1. Thêm vào CODEOWNERS (tầng 3 — nới policy phải có lead duyệt):');
  lines.push(`       ${POLICY_FILE} @<lead-github-username>`);
  lines.push('');
  lines.push('  2. Thêm bước gọi `guardrail ci` vào workflow PR (tầng 2).');
  lines.push('');
  lines.push('Tầng hook local ai cũng tháo được — hai bước trên tồn tại chính vì thế.');
  return { ok: true, path: target, lines, policy };
}
