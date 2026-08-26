import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../../lib/rules/self-protect.mjs';
import { loadDefaultPolicy, mergePolicy } from '../../lib/policy.mjs';

const P = loadDefaultPolicy();
const shell = (command) => ({ tool: 'Bash', command, patchFiles: [] });
const patch = (files) => ({ tool: 'apply_patch', command: null, patchFiles: files });

test('chặn agent tự phát escape cho chính nó', () => {
  const r = evaluate(shell('CODEX_GUARDRAIL_ALLOW=infra.deny-binary psql -l'), P);
  assert.equal(r.ruleId, 'selfprotect.escape-inline');
  assert.ok(r.reason.includes('escape'));
});

test('chặn sửa file policy qua apply_patch', () => {
  assert.equal(evaluate(patch(['codex-guardrail.json']), P).ruleId, 'selfprotect.policy-file');
  assert.equal(evaluate(patch(['sub/dir/codex-guardrail.json']), P).ruleId,
    'selfprotect.policy-file');
});

test('chặn sửa hooks.json và config.toml của Codex', () => {
  assert.equal(evaluate(patch(['~/.codex/hooks.json']), P).decision, 'deny');
  assert.equal(evaluate(patch(['~/.codex/config.toml']), P).decision, 'deny');
});

test('chặn ghi qua redirection', () => {
  assert.equal(evaluate(shell('echo "{}" > codex-guardrail.json'), P).ruleId,
    'selfprotect.policy-file');
  assert.equal(evaluate(shell('echo x >> ~/.codex/hooks.json'), P).decision, 'deny');
});

test('chặn ghi qua binary có tác dụng ghi', () => {
  for (const cmd of ['sed -i s/a/b/ codex-guardrail.json',
                     'sed -i.bak s/a/b/ codex-guardrail.json',
                     'sed --in-place s/a/b/ codex-guardrail.json',
                     'rm codex-guardrail.json',
                     'mv other.json codex-guardrail.json',
                     'mv codex-guardrail.json /tmp/',
                     'cp /tmp/loose.json codex-guardrail.json',
                     'tee codex-guardrail.json',
                     'truncate -s 0 codex-guardrail.json',
                     'patch -p1 codex-guardrail.json',
                     'dd of=codex-guardrail.json if=/dev/null',
                     'ln -sf /tmp/evil.json codex-guardrail.json']) {
    assert.equal(evaluate(shell(cmd), P).decision, 'deny', cmd);
  }
});

test('ĐỌC policy của chính mình thì cho qua', () => {
  assert.equal(evaluate(shell('cat codex-guardrail.json'), P).decision, 'allow');
  assert.equal(evaluate(shell('grep denyBinaries codex-guardrail.json'), P).decision, 'allow');
});

test('file khác thì cho qua', () => {
  assert.equal(evaluate(patch(['src/a.ts']), P).decision, 'allow');
  assert.equal(evaluate(shell('echo x > out.txt'), P).decision, 'allow');
});

test('command null thì cho qua', () => {
  assert.equal(evaluate({ tool: 'Bash', command: null, patchFiles: [] }, P).decision, 'allow');
});

// ---------------------------------------------------------------------------
// S1 — escape-inline phải nhận ĐÚNG dạng gán biến, không phải substring.
// Đo trước khi sửa: 3/4 ca dưới bị chặn oan, nghĩa là guardrail chặn chính
// việc viết tài liệu cho guardrail (§9 spec bắt README phải ghi cách escape).
// ---------------------------------------------------------------------------
test('S1: escape-inline bắt mọi dạng gán biến ở đầu lệnh', () => {
  for (const cmd of [
    'CODEX_GUARDRAIL_ALLOW=infra.deny-binary psql -l',
    'CODEX_GUARDRAIL_ALLOW=git.no-force git push --force',
    'FOO=1 CODEX_GUARDRAIL_ALLOW=x psql -l',
    'env CODEX_GUARDRAIL_ALLOW=x psql -l',
    'export CODEX_GUARDRAIL_ALLOW=x',
    'npm test && CODEX_GUARDRAIL_ALLOW=x psql -l',
    'bash -c "CODEX_GUARDRAIL_ALLOW=x psql -l"',
    'echo $(CODEX_GUARDRAIL_ALLOW=x psql -l)',
  ]) {
    assert.equal(evaluate(shell(cmd), P).ruleId, 'selfprotect.escape-inline', cmd);
  }
});

test('S1: nhắc TÊN biến escape trong văn bản thì không phải escape', () => {
  for (const cmd of [
    'grep -rn CODEX_GUARDRAIL_ALLOW README.md',
    'git commit -m "docs: explain CODEX_GUARDRAIL_ALLOW usage"',
    'echo "set CODEX_GUARDRAIL_ALLOW to escape"',
    'rg "CODEX_GUARDRAIL_ALLOW=<ruleId>" docs/',
    'git log --grep CODEX_GUARDRAIL_ALLOW',
  ]) {
    const r = evaluate(shell(cmd), P);
    assert.equal(r.decision, 'allow', `chặn oan: ${cmd} => ${r.ruleId} ${r.reason ?? ''}`);
  }
});

// ---------------------------------------------------------------------------
// S2 — wrapper/keyword. Cùng lỗ này đã xuất hiện ở infra (Task 7) và
// git-workflow (Task 8); đây là rule thứ ba, nên ghim bằng test.
// ---------------------------------------------------------------------------
test('S2: wrapper và keyword shell không che được lệnh ghi', () => {
  for (const cmd of [
    'sudo rm codex-guardrail.json',
    'for f in a; do rm codex-guardrail.json; done',
    'if rm codex-guardrail.json; then echo x; fi',
    'while true; do tee codex-guardrail.json; done',
    '(rm codex-guardrail.json)',
    'time rm codex-guardrail.json',
    'bash -c "rm codex-guardrail.json"',
    'eval "rm codex-guardrail.json"',
  ]) {
    assert.equal(evaluate(shell(cmd), P).decision, 'deny', cmd);
  }
});

// ---------------------------------------------------------------------------
// S3 — đọc/ghi phân biệt theo NGHĨA của tham số, không theo tên binary.
// ---------------------------------------------------------------------------
test('S3: sed không -i là ĐỌC, cp với policy ở NGUỒN là sao lưu', () => {
  for (const cmd of [
    "sed -n '1,5p' codex-guardrail.json",
    'sed -e s/a/b/ codex-guardrail.json',
    'cp codex-guardrail.json /tmp/backup.json',
    'cp codex-guardrail.json codex-guardrail.json.bak',
    'dd if=codex-guardrail.json of=/tmp/x',
  ]) {
    const r = evaluate(shell(cmd), P);
    assert.equal(r.decision, 'allow', `chặn oan: ${cmd} => ${r.ruleId} ${r.reason ?? ''}`);
  }
});

test('S3: mv policy đi chỗ khác vẫn chặn — nó làm mất policy khỏi vị trí cũ', () => {
  assert.equal(evaluate(shell('mv codex-guardrail.json /tmp/'), P).decision, 'deny');
  assert.equal(evaluate(shell('mv ~/.codex/hooks.json ~/.codex/hooks.off'), P).decision, 'deny');
});

// ---------------------------------------------------------------------------
// S4 — redirect đọc từ token đã tách, không từ chuỗi thô.
// ---------------------------------------------------------------------------
test('S4: redirect không khoảng trắng, redirect thứ hai, và stderr', () => {
  for (const cmd of [
    'echo x >codex-guardrail.json',
    'echo x >>codex-guardrail.json',
    'echo x > /tmp/log 2> codex-guardrail.json',
    'printf "%s" x > codex-guardrail.json',
    '> codex-guardrail.json',
    'echo x >| codex-guardrail.json',
  ]) {
    assert.equal(evaluate(shell(cmd), P).decision, 'deny', cmd);
  }
});

test('S4: dấu > trong chuỗi nháy không phải redirect', () => {
  for (const cmd of [
    'echo "a > codex-guardrail.json"',
    "git commit -m 'fix: khong ghi > codex-guardrail.json nua'",
    'echo "codex-guardrail.json" >> .gitignore',
    'grep -rn "> codex-guardrail.json" docs/',
  ]) {
    const r = evaluate(shell(cmd), P);
    assert.equal(r.decision, 'allow', `chặn oan: ${cmd} => ${r.ruleId} ${r.reason ?? ''}`);
  }
});

// ---------------------------------------------------------------------------
// S5 — ruleId là KHOÁ CỦA ESCAPE, nên gộp nhóm làm escape rộng hơn ý định:
// người chỉ muốn sửa codex-guardrail.json (có CODEOWNERS làm tầng hai) không
// được cấp luôn quyền tháo hook (~/.codex/hooks.json, không có tầng nào chắn).
// Tên ruleId lấy đúng theo spec §6.5.
// ---------------------------------------------------------------------------
test('S5: mỗi nhóm đường dẫn có ruleId riêng', () => {
  const project = evaluate(patch(['codex-guardrail.json']), P).ruleId;
  const hooks = evaluate(patch(['~/.codex/hooks.json']), P).ruleId;
  const conf = evaluate(patch(['~/.codex/config.toml']), P).ruleId;
  const dir = evaluate(patch(['~/.codex/guardrail/bin/guardrail.mjs']), P).ruleId;

  assert.equal(project, 'selfprotect.policy-file');
  assert.equal(hooks, 'selfprotect.hooks-file');
  assert.equal(conf, 'selfprotect.hooks-file');
  assert.equal(dir, 'selfprotect.install-dir');

  // Khoá escape của nhóm project KHÔNG mở nhóm tháo hook.
  assert.notEqual(project, hooks);
  assert.notEqual(project, dir);
  assert.notEqual(hooks, dir);
});

test('S5: nhóm giữ nguyên qua đường Bash, không chỉ apply_patch', () => {
  assert.equal(evaluate(shell('rm codex-guardrail.json'), P).ruleId,
    'selfprotect.policy-file');
  assert.equal(evaluate(shell('rm ~/.codex/hooks.json'), P).ruleId,
    'selfprotect.hooks-file');
});

test('§12: map đường dẫn→ruleId nằm trong JSON, thêm nhóm không cần sửa code', () => {
  const p = mergePolicy(P, {
    selfProtect: { protectedPaths: { 'selfprotect.ci-guard': ['**/guard-ci.yml'] } },
  });
  assert.equal(evaluate(shell('rm guard-ci.yml'), p).ruleId, 'selfprotect.ci-guard');
  // Nhóm mặc định không bị đụng khi dự án thêm nhóm riêng.
  assert.equal(evaluate(shell('rm codex-guardrail.json'), p).ruleId,
    'selfprotect.policy-file');
});

test('§12: dự án siết thêm được đường dẫn cho nhóm có sẵn', () => {
  const p = mergePolicy(P, {
    selfProtect: { protectedPaths: { 'selfprotect.policy-file': ['**/guardrail/*.json'] } },
  });
  assert.equal(evaluate(shell('rm config/guardrail/extra.json'), p).ruleId,
    'selfprotect.policy-file');
});

test('không khai protectedPaths thì cho qua', () => {
  assert.equal(evaluate(shell('rm codex-guardrail.json'), {}).decision, 'allow');
  assert.equal(evaluate(shell('rm codex-guardrail.json'),
    { selfProtect: { protectedPaths: {} } }).decision, 'allow');
});

// Shape sai thì THROW để dispatcher fail-closed (spec §10: rule an toàn ném
// exception thì chặn). Trả ALLOW ở đây nghĩa là mất toàn bộ self-protection mà
// không ai biết.
test('protectedPaths shape sai thì ném lỗi, không âm thầm cho qua', () => {
  assert.throws(
    () => evaluate(shell('rm codex-guardrail.json'),
      { selfProtect: { protectedPaths: ['**/codex-guardrail.json'] } }),
    /protectedPaths/,
  );
});

// ---------------------------------------------------------------------------
// Corpus chống chặn oan. Chặn oan là chế độ hỏng tệ nhất: dev sẽ tắt guardrail,
// guardrail bị tắt bảo vệ được 0 thứ.
// ---------------------------------------------------------------------------
test('corpus: lệnh thường ngày không bị chặn oan', () => {
  for (const cmd of [
    'npm test',
    'npm run build',
    'git status',
    'git diff codex-guardrail.json',
    'git diff --stat',
    'jq . codex-guardrail.json',
    'jq -r .infra.denyBinaries codex-guardrail.json',
    'cat codex-guardrail.json | jq .git',
    'head -20 codex-guardrail.json',
    'wc -l codex-guardrail.json',
    'diff codex-guardrail.json policy/default.json',
    'node --test tests/',
    'rm -rf node_modules',
    'rm dist/bundle.js',
    'mv src/a.ts src/b.ts',
    'cp .env.example .env.local',
    'tee -a /tmp/build.log',
    'sed -i s/a/b/ src/a.ts',
    'echo x > out.txt',
    'echo x >> /tmp/log',
    'truncate -s 0 /tmp/log',
    'ln -s ../shared node_modules/shared',
    'install -m 644 policy/default.json /tmp/',
    'cp -r policy /tmp/policy-backup',
    'ls ~/.codex',
    'cat ~/.codex/hooks.json',
    'jq .hooks ~/.codex/hooks.json',
    'grep -n guardrail ~/.codex/config.toml',
    'find . -name codex-guardrail.json',
    'ls -la ~/.codex/guardrail',
    'git add codex-guardrail.json',
    'code codex-guardrail.json',
    'npx prettier --check codex-guardrail.json',
  ]) {
    const r = evaluate(shell(cmd), P);
    assert.equal(r.decision, 'allow', `chặn oan: ${cmd} => ${r.ruleId} ${r.reason ?? ''}`);
  }
});

test('corpus: apply_patch file thường không bị chặn oan', () => {
  for (const files of [
    ['src/a.ts'],
    ['policy/default.json'],
    ['tests/rules/self-protect.test.mjs'],
    ['docs/codex-guardrail.md'],
    ['codex-guardrail.json.example'],
    ['README.md', 'package.json'],
  ]) {
    const r = evaluate(patch(files), P);
    assert.equal(r.decision, 'allow', `chặn oan: ${files.join(',')} => ${r.ruleId ?? ''}`);
  }
});

test('message chặn nói đủ ba điều: rule nào, vì sao, làm gì tiếp', () => {
  const r = evaluate(shell('rm codex-guardrail.json'), P);
  assert.equal(r.decision, 'deny');
  assert.ok(r.reason.includes('codex-guardrail.json'), 'reason phải nêu đường dẫn');
  assert.ok(r.hint.length > 0, 'hint phải nói làm gì tiếp');
  const h = evaluate(patch(['~/.codex/hooks.json']), P);
  assert.ok(h.hint.includes('hook') || h.hint.includes('Codex'), h.hint);
});
