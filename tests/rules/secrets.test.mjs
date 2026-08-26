import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../../lib/rules/secrets.mjs';
import { homedir } from 'node:os';
import { loadDefaultPolicy } from '../../lib/policy.mjs';

const P = loadDefaultPolicy();
const shell = (command) => ({ tool: 'Bash', command, patchFiles: [] });
const patch = (files) => ({ tool: 'apply_patch', command: null, patchFiles: files });

test('chặn đọc .env bất kể động từ', () => {
  for (const cmd of ['cat .env', 'head -5 .env', 'less src/.env', 'code .env']) {
    assert.equal(evaluate(shell(cmd), P).ruleId, 'secrets.read-path', cmd);
  }
});

test('cho phép .env.example', () => {
  assert.equal(evaluate(shell('cat .env.example'), P).decision, 'allow');
});

test('chặn .env.production', () => {
  assert.equal(evaluate(shell('cat .env.production'), P).ruleId, 'secrets.read-path');
});

test('chặn khoá riêng và credential', () => {
  for (const cmd of ['cat certs/server.pem', 'cat ~/.ssh/id_rsa', 'cat ~/.aws/credentials']) {
    assert.equal(evaluate(shell(cmd), P).decision, 'deny', cmd);
  }
});

test('chặn xả env nhưng không chặn env có tham số', () => {
  assert.equal(evaluate(shell('env'), P).ruleId, 'secrets.env-dump');
  assert.equal(evaluate(shell('printenv'), P).ruleId, 'secrets.env-dump');
  assert.equal(evaluate(shell('env FOO=1 npm test'), P).decision, 'allow');
});

test('chặn đọc secret manager', () => {
  for (const cmd of [
    'aws secretsmanager get-secret-value --secret-id x',
    'gcloud secrets versions access latest --secret=x',
    'vault read secret/x',
    'kubectl get secret my-secret -o yaml',
  ]) {
    assert.equal(evaluate(shell(cmd), P).ruleId, 'secrets.manager-read', cmd);
  }
});

test('chặn ghi vào file nhạy cảm qua apply_patch', () => {
  assert.equal(evaluate(patch(['.env']), P).ruleId, 'secrets.write-path');
  assert.equal(evaluate(patch(['src/a.ts']), P).decision, 'allow');
});

test('lệnh không liên quan thì cho qua', () => {
  assert.equal(evaluate(shell('npm test'), P).decision, 'allow');
  assert.equal(evaluate(shell(''), P).decision, 'allow');
  assert.equal(evaluate({ tool: 'Bash', command: null, patchFiles: [] }, P).decision, 'allow');
});

test('message deny nói đủ ba điều', () => {
  const r = evaluate(shell('cat .env'), P);
  assert.ok(r.reason.length > 0);
  assert.ok(r.hint.length > 0);
  assert.ok(r.reason.includes('.env'));
});

test('không chặn oan khi tên file chỉ nằm trong câu văn', () => {
  assert.equal(evaluate(shell('git commit -m "thêm .env vào gitignore"'), P).decision, 'allow');
});
test('chặn 15 ca xả env và redirect', () => {
  const mustBlock = [
    // Bare env/printenv/set
    'env',
    'printenv',
    'set',
    // env with pipes and redirects (including no-space variants)
    'env | grep SECRET',
    'env > /tmp/dump.txt',
    'env >/tmp/dump.txt',
    'env>/tmp/dump.txt',
    'env>>file',
    'env && cat /tmp/x',
    'ls && env',
    // printenv with pipes and sensitive vars
    'printenv | grep AWS',
    'printenv>x',
    'printenv AWS_SECRET_ACCESS_KEY',
    'printenv DB_PASSWORD',
  ];

  for (const cmd of mustBlock) {
    const r = evaluate(shell(cmd), P);
    assert.equal(r.decision, 'deny', `ca: ${cmd}`);
    assert.equal(r.ruleId, 'secrets.env-dump', `ca: ${cmd}`);
  }
});

test('cho qua 17 ca: env/set hợp lệ, safe env var, git/npm, manager cmd trong message', () => {
  const mustAllow = [
    // set with arguments
    'set -euo pipefail',
    'set -e',
    'set -x',
    // env with assignments and command
    'env FOO=1 psql --version',
    'env -u FOO npm test',
    // printenv with safe variable names
    'printenv PATH',
    'printenv HOME',
    'printenv NODE_ENV',
    // git and npm scripts
    'git commit -m "set up env"',
    'git commit -m "please run vault read later"',
    'git commit -m "kubectl get secret notes"',
    'npm run set-env',
    './scripts/setup-env.sh',
    'npm run env:check',
    // docker and kubectl with safe flags
    'docker run --env-file .env.example app',
    'kubectl set image dep/app app=img',
    'printf env',
  ];

  for (const cmd of mustAllow) {
    const r = evaluate(shell(cmd), P);
    assert.equal(r.decision, 'allow', `ca: ${cmd}`);
  }
});

test('chặn secret manager commands', () => {
  const mustBlock = [
    'vault read secret/db',
  ];

  for (const cmd of mustBlock) {
    const r = evaluate(shell(cmd), P);
    assert.equal(r.decision, 'deny', `ca: ${cmd}`);
    assert.equal(r.ruleId, 'secrets.manager-read', `ca: ${cmd}`);
  }
});

test('chặn printenv với tên biến nhạy cảm (có hoặc không gạch dưới)', () => {
  const mustBlock = [
    'printenv PASSWORD',
    'printenv TOKEN',
    'printenv SECRET',
    'printenv APIKEY',
    'printenv DB_PASSWORD',
    'printenv AWS_SECRET_ACCESS_KEY',
  ];

  for (const cmd of mustBlock) {
    const r = evaluate(shell(cmd), P);
    assert.equal(r.decision, 'deny', `ca: ${cmd}`);
    assert.equal(r.ruleId, 'secrets.env-dump', `ca: ${cmd}`);
  }
});

test('cho qua printenv với tên biến vô hại', () => {
  const mustAllow = [
    'printenv PATH',
    'printenv HOME',
    'printenv NODE_ENV',
    'printenv LANG',
    'printenv SHELL',
  ];

  for (const cmd of mustAllow) {
    const r = evaluate(shell(cmd), P);
    assert.equal(r.decision, 'allow', `ca: ${cmd}`);
  }
});

test('chặn env bị bọc trong command substitution', () => {
  const mustBlock = [
    '$(env)',
    '`env`',
    '(env)',
  ];

  for (const cmd of mustBlock) {
    const r = evaluate(shell(cmd), P);
    assert.equal(r.decision, 'deny', `ca: ${cmd}`);
    assert.equal(r.ruleId, 'secrets.env-dump', `ca: ${cmd}`);
  }
});

test('cho qua command substitution hợp lệ', () => {
  const mustAllow = [
    'echo "(env vars)"',
    'git commit -m "$(date)"',
    'awk \'{print $1}\'',
  ];

  for (const cmd of mustAllow) {
    const r = evaluate(shell(cmd), P);
    assert.equal(r.decision, 'allow', `ca: ${cmd}`);
  }
});

// ---------------------------------------------------------------------------
// Regression: `.map(globToRegExp)` truyền INDEX của Array.map vào tham số thứ
// hai `home` của globToRegExp, nên MỌI pattern `~/...` trong secrets.denyPaths
// nở ra thành thư mục tên đúng bằng chỉ số (`~/.aws/**` -> `^1\/\.aws\/.*$`) và
// không khớp gì cả. Đã đo trước khi sửa: cả 10 ca dưới đây LỌT.
//
// Hai điều kiện làm test này BẮT được lỗi, cả hai đều cố ý:
//   1. Đi qua `evaluate(ctx, policy)` với POLICY MẶC ĐỊNH. Test cũ gọi
//      `globToRegExp` trực tiếp với `home` tường minh nên không bao giờ đi qua
//      đường `.map` — đó là lý do lỗi sống sót 5 round review của Task 6.
//   2. Chọn tên file KHÔNG khớp bất kỳ pattern basename nào trong denyPaths.
//      `~/.aws/credentials` và `~/.ssh/id_rsa` vẫn chặn kể cả khi lỗi còn sống,
//      nhờ `**/credentials` và `**/id_rsa` trùng khớp tình cờ — chính sự trùng
//      khớp đó đã CHE lỗi. Nên ở đây dùng `config`, `known_hosts`,
//      `access_tokens.db`: chúng chỉ có thể bị chặn nhờ pattern `~`.
const HOME_ONLY = [
  ['~/.aws/**', '~/.aws/config'],
  ['~/.config/gcloud/**', '~/.config/gcloud/access_tokens.db'],
  ['~/.kube/config', '~/.kube/config'],
  ['~/.ssh/**', '~/.ssh/known_hosts'],
  ['~/.docker/config.json', '~/.docker/config.json'],
];

test('chặn đủ 5 đường dẫn ~ trong secrets.denyPaths, dạng ~', () => {
  for (const [pattern, path] of HOME_ONLY) {
    const r = evaluate(shell(`cat ${path}`), P);
    assert.equal(r.decision, 'deny', `pattern ${pattern} không cưỡng chế: cat ${path}`);
    assert.equal(r.ruleId, 'secrets.read-path', `cat ${path}`);
  }
});

test('chặn đủ 5 đường dẫn ~ trong secrets.denyPaths, dạng tuyệt đối $HOME', () => {
  // Dạng tuyệt đối là đường đi vòng hiển nhiên nhất: agent bị chặn `~/.kube/config`
  // chỉ cần viết `/Users/<user>/.kube/config`. Đã đo: trước khi sửa cũng LỌT.
  for (const [pattern, path] of HOME_ONLY) {
    const abs = homedir() + path.slice(1);
    const r = evaluate(shell(`cat ${abs}`), P);
    assert.equal(r.decision, 'deny', `pattern ${pattern} không cưỡng chế: cat ${abs}`);
    assert.equal(r.ruleId, 'secrets.read-path', `cat ${abs}`);
  }
});

test('allowPaths vẫn thắng denyPaths sau khi sửa pattern ~', () => {
  // Sửa chặn-lọt không được kéo theo chặn oan: `**/.env.*` khớp `.env.example`,
  // và chỉ allowPaths giữ nó cho qua.
  for (const cmd of ['cat .env.example', 'cat .env.sample', 'cat .env.template',
                     'cat sub/dir/.env.example']) {
    assert.equal(evaluate(shell(cmd), P).decision, 'allow', cmd);
  }
});

test('chống chặn oan: thư mục cùng tiền tố và file thường dưới home', () => {
  // Ranh giới thư mục phải đúng: `~/.awsome` KHÔNG phải `~/.aws`. Và bản thân
  // thư mục `~/.ssh` (không có `/`) không khớp `~/.ssh/**`, nên `ls ~/.ssh` là
  // liệt kê tên file — cho qua.
  for (const cmd of ['cat ~/.awsome/notes.txt', 'cat ~/.sshfoo/x', 'cat ~/.kubernetes/x',
                     'ls ~/.ssh', 'ls ~/.aws', 'cat ~/.zshrc', 'cat ~/.gitconfig',
                     'cat ~/.docker/daemon.json', 'cat ~/projects/app/README.md']) {
    const r = evaluate(shell(cmd), P);
    assert.equal(r.decision, 'allow', `chặn oan: ${cmd} => ${r.ruleId ?? ''}`);
  }
});
