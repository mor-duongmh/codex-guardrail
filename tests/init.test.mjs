// tests/init.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { inferPolicy, initProject } from '../lib/init.mjs';

function repo(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'guardrail-init-'));
  mkdirSync(join(dir, '.git'));
  for (const [name, body] of Object.entries(files)) {
    const p = join(dir, name);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  }
  return dir;
}

// `git` được TIÊM chứ không spawn thật: test chạy trong thư mục tạm không có
// remote, nên `git symbolic-ref` thật ở đó sẽ luôn thất bại — tức mọi nhánh
// suy luận từ git sẽ không bao giờ được kiểm.
const git = (map) => (args) => (Object.prototype.hasOwnProperty.call(map, args.join(' '))
  ? map[args.join(' ')]
  : null);

const CONVENTIONAL = [
  'feat(api): thêm endpoint', 'fix: sửa lỗi đăng nhập', 'chore: bump deps',
  'docs: cập nhật README', 'refactor(core): gộp hàm', 'test: thêm ca biên',
  'feat: thêm trang chủ', 'fix(ui): lệch layout', 'ci: thêm matrix',
  'perf: giảm truy vấn',
].join('\n');

const FREEFORM = [
  'update stuff', 'wip', 'fix bug', 'asdf', 'merge branch main',
  'more changes', 'final', 'oops', 'try again', 'cleanup',
].join('\n');

// --- suy luận default branch --------------------------------------------

test('lấy default branch từ origin/HEAD', () => {
  const { policy } = inferPolicy(repo(), {
    runGit: git({ 'symbolic-ref refs/remotes/origin/HEAD': 'refs/remotes/origin/develop' }),
  });
  assert.ok(policy.git.protectedBranches.includes('develop'),
    `không thấy develop trong ${JSON.stringify(policy.git.protectedBranches)}`);
});

// Repo mới clone chưa có origin/HEAD, và repo local thuần thì không bao giờ có.
// Đây là trạng thái MẶC ĐỊNH chứ không phải ca biên, nên không được crash và
// không được sinh policy rỗng.
test('không có origin/HEAD thì vẫn ra policy dùng được', () => {
  const { policy, notes } = inferPolicy(repo(), { runGit: git({}) });
  assert.ok(policy.git.protectedBranches.length > 0, 'protectedBranches rỗng');
  assert.ok(notes.some(n => /origin\/HEAD/i.test(n)),
    `không có note giải thích: ${JSON.stringify(notes)}`);
});

// --- suy luận conventional commits --------------------------------------

test('repo dùng conventional commits thì BẬT commitMessagePattern', () => {
  const { policy } = inferPolicy(repo(), {
    runGit: git({ 'log --format=%s -50': CONVENTIONAL }),
  });
  assert.notEqual(policy.git.commitMessagePattern, '',
    'phải bật pattern khi repo đã theo quy ước');
  assert.match('feat(api): x', new RegExp(policy.git.commitMessagePattern));
});

// Chiều quan trọng hơn: KHÔNG áp quy ước mà dự án chưa theo. Áp bừa thì mọi
// commit tiếp theo của họ bị chặn oan, và đường thoát duy nhất là tắt guardrail.
test('repo KHÔNG dùng conventional commits thì để pattern rỗng', () => {
  const { policy, notes } = inferPolicy(repo(), {
    runGit: git({ 'log --format=%s -50': FREEFORM }),
  });
  assert.equal(policy.git.commitMessagePattern, '',
    'không được áp quy ước mà dự án chưa theo');
  assert.ok(notes.some(n => /conventional/i.test(n)), JSON.stringify(notes));
});

test('repo chưa có commit nào thì không áp quy ước', () => {
  const { policy } = inferPolicy(repo(), { runGit: git({ 'log --format=%s -50': '' }) });
  assert.equal(policy.git.commitMessagePattern, '');
});

// --- suy luận lintCommand -----------------------------------------------

test('lấy lintCommand từ package.json scripts', () => {
  const dir = repo({ 'package.json': JSON.stringify({ scripts: { lint: 'eslint .' } }) });
  const { policy } = inferPolicy(dir, { runGit: git({}) });
  assert.equal(policy.convention.lintCommand, 'npm run lint');
});

test('lấy lintCommand từ Makefile khi không có package.json', () => {
  const dir = repo({ Makefile: 'build:\n\tgo build ./...\n\nlint:\n\tgolangci-lint run\n' });
  const { policy } = inferPolicy(dir, { runGit: git({}) });
  assert.equal(policy.convention.lintCommand, 'make lint');
});

test('package.json không có script lint thì không bịa lệnh', () => {
  const dir = repo({ 'package.json': JSON.stringify({ scripts: { test: 'node --test' } }) });
  const { policy } = inferPolicy(dir, { runGit: git({}) });
  assert.equal(policy.convention.lintCommand, '');
});

// Câu này §8.3 yêu cầu in ra, và nó là thứ duy nhất nói cho người dùng biết
// guardrail đang chạy ở chế độ giảm năng lực. Dán literal cứng.
test('không tìm được lệnh lint thì nói thẳng đang ở chế độ chỉ-bảo-vệ', () => {
  const { notes } = inferPolicy(repo(), { runGit: git({}) });
  assert.ok(
    notes.some(n => n.includes('chưa khai báo lệnh lint')
      && n.includes('chỉ-bảo-vệ')
      && n.includes('không nâng được chất lượng')),
    `thiếu câu bắt buộc của §8.3: ${JSON.stringify(notes)}`,
  );
});

// --- suy luận conventionDocs --------------------------------------------

test('chỉ ghi conventionDocs cho file CÓ THẬT', () => {
  const dir = repo({ 'CLAUDE.md': '# hướng dẫn', 'AGENTS.md': '# agents' });
  const { policy } = inferPolicy(dir, { runGit: git({}) });
  assert.deepEqual([...policy.convention.conventionDocs].sort(), ['AGENTS.md', 'CLAUDE.md']);
});

test('không có file quy ước nào thì conventionDocs rỗng', () => {
  const { policy } = inferPolicy(repo(), { runGit: git({}) });
  assert.deepEqual(policy.convention.conventionDocs, []);
});

// --- ghi file ------------------------------------------------------------

// Cùng nguyên tắc với install: KHÔNG ghi đè cấu hình đang có. File này là nơi
// cả team đã nới rule và đã qua review CODEOWNERS; ghi đè nó là xoá công việc
// của người khác, bằng một lệnh người ta gõ lại vô tình.
test('từ chối ghi đè codex-guardrail.json đang có', () => {
  const dir = repo({ 'codex-guardrail.json': '{"infra":{"allowBinaries":["supabase"]}}' });
  const res = initProject({ cwd: dir, runGit: git({}) });
  assert.equal(res.ok, false);
  assert.ok(res.lines.join('\n').includes('đã có'), res.lines.join('\n'));
  assert.equal(readFileSync(join(dir, 'codex-guardrail.json'), 'utf8'),
    '{"infra":{"allowBinaries":["supabase"]}}', 'file cũ bị đụng');
});

test('ghi file mới, parse được và merge được với policy mặc định', async () => {
  const dir = repo({ 'package.json': JSON.stringify({ scripts: { lint: 'eslint .' } }) });
  const res = initProject({ cwd: dir, runGit: git({}) });
  assert.equal(res.ok, true);
  const raw = readFileSync(join(dir, 'codex-guardrail.json'), 'utf8');
  const parsed = JSON.parse(raw);
  assert.equal(parsed.convention.lintCommand, 'npm run lint');
  assert.ok(raw.endsWith('\n'), 'file phải kết bằng newline');
  const { mergePolicy, loadDefaultPolicy } = await import('../lib/policy.mjs');
  assert.doesNotThrow(() => mergePolicy(loadDefaultPolicy(), parsed),
    'file sinh ra phải merge được với policy mặc định');
});

// CODEOWNERS là tầng 3 — thứ biến việc nới policy thành việc có người duyệt.
// `init` không tự ghi file đó (§11 để nó là bước thủ công), nhưng phải in ra
// đúng dòng cần thêm, nếu không người dùng bỏ qua tầng 3 mà không biết.
test('in ra dòng CODEOWNERS cần thêm', () => {
  const res = initProject({ cwd: repo(), runGit: git({}) });
  const out = res.lines.join('\n');
  assert.ok(out.includes('CODEOWNERS'), out);
  assert.ok(/codex-guardrail\.json\s+@/.test(out),
    `phải in mẫu dòng CODEOWNERS thật: ${out}`);
});

// --- dò phần deploy (Task 8 của plan deploy) --------------------------------
// `targets` LUÔN để trống: init không suy ra được tên môi trường, và đoán ở đây
// là đoán chính thứ cần review.

test('init dò script deploy và sinh sẵn bảo vệ nó', () => {
  const dir = repo({ 'scripts/deploy.sh': '#!/bin/sh\n' });
  const { policy } = inferPolicy(dir, { runGit: git({}) });
  assert.deepEqual(policy.deploy.entrypoints, ['./scripts/deploy.sh']);
  assert.deepEqual(policy.selfProtect.protectedPaths['deploy.script'], ['scripts/deploy.sh']);
});

test('init dò được script deploy trong package.json và Makefile', () => {
  const npm = repo({ 'package.json': JSON.stringify({ scripts: { deploy: 'node ship.js' } }) });
  assert.deepEqual(inferPolicy(npm, { runGit: git({}) }).policy.deploy.entrypoints,
    ['npm run deploy']);

  const mk = repo({ Makefile: '.PHONY: deploy\ndeploy:\n\techo ship\n' });
  assert.deepEqual(inferPolicy(mk, { runGit: git({}) }).policy.deploy.entrypoints,
    ['make deploy']);
});

test('init KHÔNG đoán tên môi trường', () => {
  const dir = repo({ 'scripts/deploy.sh': '#!/bin/sh\ncase "$1" in prod|staging) ;; esac\n' });
  const { policy } = inferPolicy(dir, { runGit: git({}) });
  assert.deepEqual(policy.deploy.targets, []);
});

test('không có script deploy thì để trống VÀ nói ra', () => {
  const dir = repo({ 'src/index.js': '' });
  const { policy, notes } = inferPolicy(dir, { runGit: git({}) });
  assert.deepEqual(policy.deploy?.entrypoints ?? [], []);
  assert.ok(notes.some(n => /deploy/i.test(n)),
    'phải nói ra rằng nhóm deploy không cưỡng chế gì, không im lặng');
});

test('khai entrypoint mà thiếu targets thì notes phải cảnh báo chặn 100%', () => {
  const dir = repo({ 'scripts/deploy.sh': '#!/bin/sh\n' });
  const { notes } = inferPolicy(dir, { runGit: git({}) });
  assert.ok(notes.some(n => /MỌI lệnh deploy/.test(n)),
    'trạng thái khai-nửa-vời phải hiện khác trạng thái chưa-khai');
});

// --- A3: không hướng dẫn gọi subcommand chưa tồn tại -----------------------
// `bin/guardrail.mjs` không có nhánh `ci` (đo: `guardrail ci` in USAGE và thoát
// 1). In nó ra như một BƯỚC CẦN LÀM là dạy mọi dev thêm một bước CI luôn đỏ,
// rồi họ học cách bỏ qua hướng dẫn của init. Tầng 2 chưa có thì phải nói là
// chưa có — và nói luôn hệ quả: tầng 3 đang là tầng duy nhất còn lại.
test('không bảo dev thêm bước gọi `guardrail ci`', () => {
  const out = initProject({ cwd: repo(), runGit: git({}) }).lines.join('\n');
  assert.ok(!/[Tt]hêm bước gọi/.test(out), out);
  assert.ok(/tầng 2/i.test(out) && /(chưa có|CHƯA)/.test(out),
    `phải nói rõ tầng 2 chưa có: ${out}`);
});
