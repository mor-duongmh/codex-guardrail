import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../../lib/rules/git-workflow.mjs';
import { loadDefaultPolicy, mergePolicy } from '../../lib/policy.mjs';

const P = loadDefaultPolicy();
const shell = (command) => ({ tool: 'Bash', command, patchFiles: [], cwd: '/tmp/demo' });
const onBranch = (b) => ({ currentBranch: () => b });

// ---------------------------------------------------------------------------
// 12 test của brief
// ---------------------------------------------------------------------------

test('cho qua mọi lệnh git chỉ đọc', () => {
  for (const cmd of ['git status', 'git log --oneline -5', 'git diff', 'git branch -a']) {
    assert.equal(evaluate(shell(cmd), P, onBranch('main')).decision, 'allow', cmd);
  }
});

test('chặn commit và push khi đứng trên branch được bảo vệ', () => {
  assert.equal(evaluate(shell('git commit -m "feat: x"'), P, onBranch('main')).ruleId,
    'git.protected-branch');
  assert.equal(evaluate(shell('git push'), P, onBranch('develop')).ruleId,
    'git.protected-branch');
});

test('khớp protectedBranches dạng glob', () => {
  assert.equal(evaluate(shell('git push'), P, onBranch('release/1.2')).ruleId,
    'git.protected-branch');
});

test('cho qua commit và push trên feature branch', () => {
  assert.equal(evaluate(shell('git commit -m "feat: x"'), P, onBranch('feat/x')).decision,
    'allow');
  assert.equal(evaluate(shell('git push'), P, onBranch('feat/x')).decision, 'allow');
});

test('chặn cờ nguy hiểm bất kể branch nào', () => {
  const cases = [
    'git push --force', 'git push -f origin feat/x', 'git push --force-with-lease',
    'git push --delete origin feat/x', 'git reset --hard HEAD~3',
    'git clean -fdx', 'git filter-branch --all', 'git tag -d v1.0.0',
  ];
  for (const cmd of cases) {
    assert.equal(evaluate(shell(cmd), P, onBranch('feat/x')).ruleId,
      'git.dangerous-flag', cmd);
  }
});

test('chặn --no-verify ở mọi lệnh git', () => {
  assert.equal(evaluate(shell('git commit --no-verify -m "feat: x"'), P,
    onBranch('feat/x')).ruleId, 'git.no-verify');
  assert.equal(evaluate(shell('git push --no-verify'), P, onBranch('feat/x')).ruleId,
    'git.no-verify');
});

test('chặn gh pr merge', () => {
  assert.equal(evaluate(shell('gh pr merge 12 --squash'), P, onBranch('feat/x')).ruleId,
    'git.pr-merge');
});

test('chặn commit message không đúng conventional commits', () => {
  const r = evaluate(shell('git commit -m "sua loi"'), P, onBranch('feat/x'));
  assert.equal(r.ruleId, 'git.commit-message');
  assert.ok(r.hint.includes('feat'));
});

test('cho qua các tiền tố conventional commits hợp lệ', () => {
  for (const m of ['feat: x', 'fix(api): y', 'chore!: z', 'refactor(core): w']) {
    assert.equal(evaluate(shell(`git commit -m "${m}"`), P, onBranch('feat/x')).decision,
      'allow', m);
  }
});

test('commitMessagePattern rỗng thì tắt kiểm message', () => {
  const p = mergePolicy(P, { git: { commitMessagePattern: '' } });
  assert.equal(evaluate(shell('git commit -m "sua loi"'), p, onBranch('feat/x')).decision,
    'allow');
});

test('không lấy được branch thì bỏ kiểm protected-branch, không chặn oan', () => {
  assert.equal(evaluate(shell('git commit -m "feat: x"'), P, onBranch(null)).decision,
    'allow');
});

test('lệnh không phải git thì cho qua và KHÔNG gọi git', () => {
  let called = false;
  const deps = { currentBranch: () => { called = true; return 'main'; } };
  assert.equal(evaluate(shell('npm test'), P, deps).decision, 'allow');
  assert.equal(called, false, 'không được spawn git cho lệnh không liên quan');
});

// ---------------------------------------------------------------------------
// G1: `git -C <dir>` phá công thức tìm subcommand.
// Đo được trước fix: `git -C /repo push --force` cho args=["-C","/repo","push",
// "--force"] và `args.find(a => !a.startsWith('-'))` trả "/repo" — tức verb là
// GIÁ TRỊ của -C. Hệ quả: mọi kiểm gate theo verb bị bỏ (force-push lọt) và
// needsBranchCheck không bật (protected-branch cũng không chạy).
// ---------------------------------------------------------------------------

test('G1: global option của git không được cướp vị trí subcommand', () => {
  const blocked = [
    ['git -C /repo push --force', 'git.dangerous-flag'],
    ['git -c user.name=x push --force', 'git.dangerous-flag'],
    ['git --git-dir=/r/.git push --force', 'git.dangerous-flag'],
    ['git --work-tree /r push --force', 'git.dangerous-flag'],
    ['git --namespace ns push --force', 'git.dangerous-flag'],
    ['git --no-pager push --force', 'git.dangerous-flag'],
    ['git -C /repo clean --force -d', 'git.dangerous-flag'],
    ['git -C /repo tag --delete v1.0.0', 'git.dangerous-flag'],
    ['git -C /repo commit --no-verify -m "feat: x"', 'git.no-verify'],
  ];
  for (const [cmd, ruleId] of blocked) {
    assert.equal(evaluate(shell(cmd), P, onBranch('feat/x')).ruleId, ruleId, cmd);
  }
});

// Ca chốt của G1: nếu verb vẫn là "/repo" thì needsBranchCheck không bật và
// test này xanh giả bằng cách allow. Nó phải chặn ĐÚNG vì lý do branch.
test('G1: protected-branch vẫn cưỡng chế được sau `git -C`', () => {
  assert.equal(evaluate(shell('git -C /repo push'), P, onBranch('main')).ruleId,
    'git.protected-branch');
  assert.equal(evaluate(shell('git -C /repo commit -m "feat: x"'), P, onBranch('main')).ruleId,
    'git.protected-branch');
  // Message sai vẫn bị chặn (rule nào chặn trước không quan trọng, miễn là deny).
  assert.equal(evaluate(shell('git -C /repo commit -m "sua loi"'), P, onBranch('main')).decision,
    'deny');
});

test('G1: `git -C` không chặn oan lệnh chỉ đọc hay commit hợp lệ', () => {
  const allowed = [
    'git -C /repo status', 'git -C /repo log --oneline', 'git -C /repo diff',
    'git -C /repo commit -m "feat: x"', 'git -C /repo push',
    'git -c user.name=x commit -m "feat: x"', 'git --no-pager log',
  ];
  for (const cmd of allowed) {
    const r = evaluate(shell(cmd), P, onBranch('feat/x'));
    assert.equal(r.decision, 'allow', `chặn oan: ${cmd} => ${r.ruleId} ${r.reason ?? ''}`);
  }
});

// `git -C /other` làm việc trên repo KHÁC cwd, nên kiểm branch của cwd là kiểm
// sai repo — vừa chặn oan (cwd trên main, /other trên feature) vừa lọt (ngược
// lại). Phải hỏi branch của đúng thư mục repo.
test('G1: protected-branch hỏi branch của thư mục -C, không phải cwd', () => {
  const seen = [];
  const deps = { currentBranch: (cwd) => { seen.push(cwd); return 'feat/x'; } };
  evaluate(shell('git -C /other/repo push'), P, deps);
  assert.deepEqual(seen, ['/other/repo']);

  const seen2 = [];
  const deps2 = { currentBranch: (cwd) => { seen2.push(cwd); return 'feat/x'; } };
  evaluate(shell('git -C sub push'), P, deps2);
  assert.deepEqual(seen2, ['/tmp/demo/sub'], '-C tương đối phải resolve theo cwd');

  const seen3 = [];
  const deps3 = { currentBranch: (cwd) => { seen3.push(cwd); return 'feat/x'; } };
  evaluate(shell('git push'), P, deps3);
  assert.deepEqual(seen3, ['/tmp/demo'], 'không có -C thì giữ nguyên cwd');
});

// ---------------------------------------------------------------------------
// G2: wrapper và từ khoá shell — TÁI DIỄN từ Task 7.
// Đo được trước fix: `sudo git push --force` cho basename(argv[0]) = "sudo" và
// segment giữa của vòng for cho "do"; filter(b => b === 'git' || b === 'gh')
// loại sạch chúng TRƯỚC khi kiểm bất cứ thứ gì.
// ---------------------------------------------------------------------------

test('G2: wrapper / vòng lặp / subshell không vô hiệu hoá rule', () => {
  const cases = [
    'sudo git push --force',
    'for b in a b; do git push --force origin $b; done',
    '(cd /repo && git push --force)',
    '{ git push --force; }',
    '( git push --force )',
    'if true; then git push --force; fi',
    'while read b; do git push --force origin $b; done < list.txt',
    'npx git push --force',
    'sudo git -C /repo push --force',
    'cd /repo && git push --force',
    'bash -c "git push --force"',
    '(cd /repo && git clean -fd)',
  ];
  for (const cmd of cases) {
    assert.equal(evaluate(shell(cmd), P, onBranch('feat/x')).ruleId,
      'git.dangerous-flag', cmd);
  }
});

test('G2: wrapper / vòng lặp cũng không vô hiệu hoá các rule khác', () => {
  assert.equal(evaluate(shell('sudo gh pr merge 12 --squash'), P, onBranch('feat/x')).ruleId,
    'git.pr-merge');
  assert.equal(evaluate(shell('for f in a; do git commit -m "sua loi"; done'), P,
    onBranch('feat/x')).ruleId, 'git.commit-message');
  assert.equal(evaluate(shell('(cd /repo && git push)'), P, onBranch('main')).ruleId,
    'git.protected-branch');
});

// Khớp từ khoá phải TUYỆT ĐỐI theo token — cùng lý do như Task 7 (`docker` bắt
// đầu bằng `do`). Ở đây `doat`/`gitk`/`ghq` là lệnh thật.
test('G2: token giống từ khoá / giống tên git không bị chặn oan', () => {
  const allowed = [
    'gitk --all', 'git-secrets --scan', 'ghq get x', 'gh-dash',
    'do_something --force', 'dotool --force',
    'for d in */; do npm ci; done',
    'if [ -f package.json ]; then npm test; fi',
    'echo git push --force',
    'grep -rn "git push --force" docs/',
    'cat notes.md | grep "git clean -fd"',
  ];
  for (const cmd of allowed) {
    const r = evaluate(shell(cmd), P, onBranch('main'));
    assert.equal(r.decision, 'allow', `chặn oan: ${cmd} => ${r.ruleId} ${r.reason ?? ''}`);
  }
});

// ---------------------------------------------------------------------------
// G3: `git commit -am` bỏ qua kiểm message.
// Đo được: args=["commit","-am","sua loi"] nên has('-m') là FALSE, mà `-am` là
// dạng cực phổ biến. Cũng lọt `--message=<v>` và `--message <v>`.
// ---------------------------------------------------------------------------

test('G3: lấy được message ở mọi dạng cờ mang message', () => {
  const bad = [
    'git commit -am "sua loi"',
    'git commit --message="sua loi"',
    'git commit --message "sua loi"',
    'git commit -m "sua loi"',
    'git commit -a -m "sua loi"',
    'git commit -S -am "sua loi"',
    'git commit --amend -m "sua loi"',
    'git -C /repo commit -am "sua loi"',
  ];
  for (const cmd of bad) {
    assert.equal(evaluate(shell(cmd), P, onBranch('feat/x')).ruleId,
      'git.commit-message', cmd);
  }
});

test('G3: message hợp lệ cho qua ở MỌI dạng cờ', () => {
  const good = [
    'git commit -am "feat: x"',
    'git commit --message="feat: x"',
    'git commit --message "feat: x"',
    'git commit -m "feat: x"',
    'git commit -a -m "fix(api): y"',
    'git commit -S -am "chore!: z"',
    'git commit --amend -m "refactor(core): w"',
    'git -C /repo commit -am "feat: x"',
  ];
  for (const cmd of good) {
    const r = evaluate(shell(cmd), P, onBranch('feat/x'));
    assert.equal(r.decision, 'allow', `chặn oan: ${cmd} => ${r.ruleId} ${r.reason ?? ''}`);
  }
});

// Không tìm được message thì KHÔNG được suy ra "message rỗng, chặn": commit
// không mang message là dạng hợp lệ (mở editor, --amend --no-edit, -F file).
test('G3: commit không mang message thì bỏ kiểm message', () => {
  const allowed = [
    'git commit', 'git commit -a', 'git commit --amend --no-edit',
    'git commit -F msg.txt', 'git commit -v', 'git commit -am',
  ];
  for (const cmd of allowed) {
    const r = evaluate(shell(cmd), P, onBranch('feat/x'));
    assert.equal(r.decision, 'allow', `chặn oan: ${cmd} => ${r.ruleId} ${r.reason ?? ''}`);
  }
});

// ---------------------------------------------------------------------------
// G4: dạng long-flag lọt. Đo được: `git clean --force -d` lọt vì regex
// /^-[a-z]*f/ không khớp "--force"; `git tag --delete` lọt vì chỉ kiểm '-d';
// `git push --force-with-lease=refs/heads/x` lọt vì has() so khớp CHÍNH XÁC.
// ---------------------------------------------------------------------------

test('G4: short / long / gộp / =value đều được nhận cho cùng một ý nghĩa', () => {
  const cases = [
    'git clean --force -d',
    'git clean -d --force',
    'git clean -f -d',
    'git clean -fd',
    'git clean -df',
    'git tag --delete v1.0.0',
    'git tag -d v1.0.0',
    'git push --force-with-lease=refs/heads/x',
    'git push --force-with-lease',
    'git push --force',
    'git push -f',
    'git push --delete origin feat/x',
    'git push -d origin feat/x',
    'git reset --hard HEAD~3',
  ];
  for (const cmd of cases) {
    assert.equal(evaluate(shell(cmd), P, onBranch('feat/x')).ruleId,
      'git.dangerous-flag', cmd);
  }
});

// `-n` là --no-verify của git commit NHƯNG là --dry-run của git push. Gộp hai
// nghĩa lại là chặn oan `git push -n`, một lệnh xem trước hoàn toàn vô hại.
test('G4: `-n` chỉ là --no-verify trong ngữ cảnh commit', () => {
  assert.equal(evaluate(shell('git commit -n -m "feat: x"'), P, onBranch('feat/x')).ruleId,
    'git.no-verify');
  assert.equal(evaluate(shell('git commit -nm "feat: x"'), P, onBranch('feat/x')).ruleId,
    'git.no-verify');
  assert.equal(evaluate(shell('git push -n'), P, onBranch('feat/x')).decision, 'allow');
  assert.equal(evaluate(shell('git push --dry-run'), P, onBranch('feat/x')).decision, 'allow');
});

test('G4: cờ gần giống nhưng khác nghĩa không bị chặn oan', () => {
  const allowed = [
    'git clean -nd', 'git clean -n', 'git clean --dry-run -d', 'git clean -i',
    'git clean -ndx', 'git clean -nfd',
    'git tag v1.0.0', 'git tag -a v1.0.0 -m "release"', 'git tag -l "v*"',
    'git tag --list', 'git tag --contains HEAD',
    'git push --tags', 'git push -u origin feat/x', 'git push --follow-tags',
    'git push --set-upstream origin feat/x', 'git push --no-force-with-lease',
    'git reset --soft HEAD~1', 'git reset HEAD~1', 'git reset --mixed HEAD',
    'git branch -d merged-branch', 'git branch -D merged-branch',
    'git commit --verify -m "feat: x"',
    'git log -5', 'git log -p -2', 'git log --format=%H',
  ];
  for (const cmd of allowed) {
    const r = evaluate(shell(cmd), P, onBranch('feat/x'));
    assert.equal(r.decision, 'allow', `chặn oan: ${cmd} => ${r.ruleId} ${r.reason ?? ''}`);
  }
});

// ---------------------------------------------------------------------------
// G5: ngoặc đóng của nhóm lệnh dính vào token CUỐI.
// Đo được: `(cd /repo && git push --force)` cho argv=["git","push","--force)"]
// — dấu `)` nằm trên chính CỜ, nên so khớp token chính xác trượt.
// ---------------------------------------------------------------------------

test('G5: dấu nhóm dính vào cờ ở token cuối vẫn phải nhận ra cờ', () => {
  const cases = [
    '(cd /repo && git push --force)',
    '(cd /repo && git reset --hard)',
    '{ cd /repo && git push --force; }',
    'if true; then git clean -fd; fi',
  ];
  for (const cmd of cases) {
    assert.equal(evaluate(shell(cmd), P, onBranch('feat/x')).ruleId,
      'git.dangerous-flag', cmd);
  }
});

// ---------------------------------------------------------------------------
// G6: `gh pr merge` phải khớp theo VỊ TRÍ subcommand, không phải "có chứa token
// merge". Brief dùng args.includes('merge') nên `gh pr list --search merge`
// (lệnh đọc thuần) bị chặn oan.
// ---------------------------------------------------------------------------

test('G6: gh pr merge khớp theo vị trí subcommand', () => {
  for (const cmd of ['gh pr merge 12 --squash', 'gh pr merge --merge',
                     'gh pr merge 12 --rebase --delete-branch']) {
    assert.equal(evaluate(shell(cmd), P, onBranch('feat/x')).ruleId, 'git.pr-merge', cmd);
  }
  const allowed = [
    'gh pr list --search merge', 'gh pr view 12', 'gh pr list',
    'gh pr create --fill', 'gh pr checkout 12', 'gh pr diff 12',
    'gh pr status', 'gh run list', 'gh issue list --search "merge conflict"',
    'gh repo view',
  ];
  for (const cmd of allowed) {
    const r = evaluate(shell(cmd), P, onBranch('main'));
    assert.equal(r.decision, 'allow', `chặn oan: ${cmd} => ${r.ruleId} ${r.reason ?? ''}`);
  }
});

// ---------------------------------------------------------------------------
// Văn bản NẰM TRONG message không được coi là cờ thật. Đây là lớp lỗ đã tốn
// nhiều round ở Task 6/7: quote đã bị tokenize bóc nên cả message là MỘT token,
// và mọi so khớp cờ phải thao tác trên token, không trên chuỗi thô.
// ---------------------------------------------------------------------------

test('văn bản trong commit message không kích hoạt rule nào', () => {
  const allowed = [
    'git commit -m "feat: thêm cờ --no-verify vào docs"',
    'git commit -m "fix: bỏ git push --force khỏi script"',
    'git commit -m "docs: giải thích git reset --hard"',
    'git commit -m "chore: xoá git clean -fd khỏi Makefile"',
    'git commit -am "refactor: gom gh pr merge vào CI"',
    'git commit --message="fix: chặn git tag -d trong hook"',
    'git commit -m "feat: hỗ trợ --force-with-lease"',
    'git commit -m "test: ca git filter-branch --all"',
  ];
  for (const cmd of allowed) {
    const r = evaluate(shell(cmd), P, onBranch('feat/x'));
    assert.equal(r.decision, 'allow', `chặn oan: ${cmd} => ${r.ruleId} ${r.reason ?? ''}`);
  }
});

// Trường hợp gắt hơn: message BẮT ĐẦU bằng đúng chuỗi cờ. Token khi đó thực sự
// mở đầu bằng `--`, nên chỉ có so khớp cả token (chứ không phải tiền tố) mới
// không chặn oan.
test('message bắt đầu bằng chuỗi cờ vẫn không bị coi là cờ', () => {
  const r = evaluate(shell('git commit -m "--force is banned, use feat: x"'), P,
    onBranch('feat/x'));
  assert.notEqual(r.ruleId, 'git.dangerous-flag');
});

// ---------------------------------------------------------------------------
// Thứ tự kiểm: mọi kiểm dựa trên argv (rẻ) phải chạy TRƯỚC protected-branch,
// vì nó spawn `git`. Hook chạy trên MỌI tool call với ngân sách p95 < 150ms.
// ---------------------------------------------------------------------------

test('không spawn git khi verdict đã quyết được từ argv', () => {
  const cases = [
    'git push --force', 'git commit --no-verify -m "feat: x"',
    'git commit -m "sua loi"', 'gh pr merge 12', 'git clean -fd',
    'git status', 'git log --oneline', 'git diff', 'git fetch --all',
    'npm test', 'ls -la',
  ];
  for (const cmd of cases) {
    let called = false;
    const deps = { currentBranch: () => { called = true; return 'main'; } };
    evaluate(shell(cmd), P, deps);
    assert.equal(called, false, `không được spawn git cho: ${cmd}`);
  }
});

test('chỉ spawn git khi thật sự cần biết branch', () => {
  for (const cmd of ['git commit -m "feat: x"', 'git push', 'git push origin feat/x']) {
    let called = 0;
    const deps = { currentBranch: () => { called += 1; return 'feat/x'; } };
    evaluate(shell(cmd), P, deps);
    assert.equal(called, 1, `phải hỏi branch đúng một lần cho: ${cmd}`);
  }
});

// ---------------------------------------------------------------------------
// Corpus chống chặn oan: lệnh git/gh thật mà dev chạy hàng ngày. Rule này chặn
// `git commit`/`git push`, nên chặn oan ở đây làm dev KHÔNG LÀM VIỆC ĐƯỢC —
// ngưỡng phải khắt khe hơn mọi rule khác.
// ---------------------------------------------------------------------------

const CORPUS_ALLOW = [
  // đọc trạng thái
  'git status', 'git status --short', 'git status -sb', 'git diff', 'git diff --cached',
  'git diff --stat', 'git diff HEAD~1', 'git show HEAD', 'git show --stat HEAD',
  'git log', 'git log --oneline -10', 'git log --graph --decorate --all',
  'git log -p -- lib/', 'git blame lib/argv.mjs', 'git shortlog -sn',
  'git branch', 'git branch -a', 'git branch -vv', 'git remote -v',
  'git remote show origin', 'git config --get user.email', 'git rev-parse HEAD',
  'git rev-parse --abbrev-ref HEAD', 'git describe --tags', 'git ls-files',
  'git reflog', 'git stash list', 'git tag', 'git tag --list "v1.*"',
  // sửa cây làm việc
  'git add .', 'git add -A', 'git add -p lib/argv.mjs', 'git restore lib/argv.mjs',
  'git restore --staged lib/argv.mjs', 'git checkout -b feat/x',
  'git switch -c feat/x', 'git switch main', 'git checkout main -- lib/argv.mjs',
  'git stash', 'git stash push -m "wip"', 'git stash pop', 'git stash drop',
  // đồng bộ
  'git fetch', 'git fetch --all --prune', 'git pull', 'git pull --rebase',
  'git pull --ff-only', 'git remote prune origin',
  // lịch sử (không phá remote)
  'git rebase main', 'git rebase --continue', 'git rebase --abort',
  'git cherry-pick abc123', 'git revert HEAD', 'git merge --no-ff feat/x',
  'git merge --abort', 'git bisect start', 'git worktree add ../wt feat/x',
  'git submodule update --init --recursive',
  // commit hợp quy ước
  'git commit -m "feat(api): thêm endpoint tạo đơn"',
  'git commit -am "fix: sửa lỗi tràn số"',
  'git commit -m "chore(deps): nâng node lên 22"',
  'git commit -m "revert: quay lại bản trước"',
  'git commit -m "perf!: bỏ vòng lặp lồng"',
  'git commit --amend --no-edit',
  // push an toàn
  'git push', 'git push origin feat/x', 'git push -u origin feat/x',
  'git push --tags', 'git push --dry-run', 'git push origin HEAD',
  // gh đọc
  'gh pr list', 'gh pr view --web', 'gh pr create --fill', 'gh pr checks',
  'gh run watch', 'gh issue create --title "bug"', 'gh auth status',
  // lệnh không phải git
  'npm test', 'npm run build', 'npm ci', 'ls -la', 'cat README.md',
  'rg "git push" lib/', 'make test', 'node --test tests/',
  // git lồng trong lệnh khác
  'for f in *.ts; do git add $f; done',
  'if git diff --quiet; then npm test; fi',
  '(cd web && git status)',
  'git status && npm test',
  'npm test && git commit -m "test: thêm ca biên"',
];

test('corpus: lệnh git/gh thật hàng ngày không bị chặn oan', () => {
  for (const cmd of CORPUS_ALLOW) {
    const r = evaluate(shell(cmd), P, onBranch('feat/x'));
    assert.equal(r.decision, 'allow', `chặn oan: ${cmd} => ${r.ruleId} ${r.reason ?? ''}`);
  }
});

// Chạy lại corpus trên branch được bảo vệ: chỉ commit/push được phép chặn, mọi
// lệnh khác vẫn phải cho qua (đứng trên main không có nghĩa là không làm gì).
test('corpus: đứng trên main chỉ chặn commit/push, không chặn phần còn lại', () => {
  for (const cmd of CORPUS_ALLOW) {
    const r = evaluate(shell(cmd), P, onBranch('main'));
    if (r.decision === 'allow') continue;
    assert.equal(r.ruleId, 'git.protected-branch', `chặn sai lý do: ${cmd} => ${r.ruleId}`);
    assert.ok(/\b(commit|push)\b/.test(cmd), `chặn oan trên main: ${cmd}`);
  }
});

// ---------------------------------------------------------------------------
// apply_patch không có command — rule phải cho qua ngay, không spawn git.
// ---------------------------------------------------------------------------

test('apply_patch không có command thì cho qua và không spawn git', () => {
  let called = false;
  const deps = { currentBranch: () => { called = true; return 'main'; } };
  const ctx = { tool: 'apply_patch', command: null, patchFiles: ['a.js'], cwd: '/tmp/demo' };
  assert.equal(evaluate(ctx, P, deps).decision, 'allow');
  assert.equal(called, false);
});
