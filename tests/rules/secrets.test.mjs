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
//
//   LƯU Ý (round sau): điểm neo của `~/.ssh/**` đã đổi từ `known_hosts` sang
//   `my_custom_key`. Lý do: `known_hosts` giờ nằm trong secrets.allowPaths (nó
//   là dữ liệu công khai theo thiết kế, và `ssh-keyscan >> known_hosts` là lệnh
//   thiết lập thường ngày — chặn nó là chặn oan). `my_custom_key` thoả đúng
//   tiêu chí (2) ở trên: không khớp `**/id_rsa`, `**/id_ed25519`,
//   `**/credentials`, `**/*.key`, `**/*.pem` hay bất kỳ pattern basename nào,
//   và không có đuôi `.pub` nên `~/.ssh/*.pub` cũng không nới cho nó. Chứng
//   nhân cho `~/.ssh/**` vẫn còn hiệu lực.
const HOME_ONLY = [
  ['~/.aws/**', '~/.aws/config'],
  ['~/.config/gcloud/**', '~/.config/gcloud/access_tokens.db'],
  ['~/.kube/**', '~/.kube/config'],
  ['~/.ssh/**', '~/.ssh/my_custom_key'],
  ['~/.docker/config.json*', '~/.docker/config.json'],
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

// ---------------------------------------------------------------------------
// Round 2: sửa `.map(globToRegExp)` làm `~/.ssh/**` cưỡng chế THẬT lần đầu, và
// kéo theo chặn oan bốn thứ KHÔNG phải secret: `known_hosts` (fingerprint host,
// dữ liệu công khai theo thiết kế), `config` (alias host, không phải credential
// — lo "đừng chạm host prod" do `infra.ssh.denyHosts` xử lý riêng), và khoá
// CÔNG KHAI `*.pub`. Chặn oan là chế độ hỏng tệ nhất: dev sẽ tắt guardrail, và
// guardrail bị tắt bảo vệ 0 thứ.
//
// `~/.ssh/**` GIỮ NGUYÊN trong denyPaths: nó là catch-all duy nhất cho khoá
// riêng đặt tên tuỳ ý (`id_ecdsa`, `id_dsa`, tên tự chọn) mà không pattern
// basename nào phủ được. Ba entry allowPaths chỉ khoét đúng ba lỗ đó.

test('cho qua thứ KHÔNG phải secret trong ~/.ssh', () => {
  for (const cmd of [
    'cat ~/.ssh/known_hosts',
    'cat ~/.ssh/config',
    'cat ~/.ssh/id_rsa.pub',
    'cat ~/.ssh/id_ed25519.pub',
    // Thiết lập dev/CI thường ngày: đích redirect NẰM trong argv nên vẫn bị soi.
    'ssh-keyscan gh.com >> ~/.ssh/known_hosts',
  ]) {
    const r = evaluate(shell(cmd), P);
    assert.equal(r.decision, 'allow', `chặn oan: ${cmd} => ${r.ruleId ?? ''}`);
  }
});

test('cho qua dạng tuyệt đối $HOME, không chỉ dạng ~', () => {
  // Pattern trong allowPaths cũng đi qua normalizePath nên `~` nở ra homedir
  // thật; nếu chỉ dạng `~` được cho qua thì dev viết đường dẫn tuyệt đối sẽ
  // vẫn bị chặn oan.
  for (const p of ['/.ssh/known_hosts', '/.ssh/config', '/.ssh/id_rsa.pub']) {
    const abs = homedir() + p;
    const r = evaluate(shell(`cat ${abs}`), P);
    assert.equal(r.decision, 'allow', `chặn oan: cat ${abs} => ${r.ruleId ?? ''}`);
  }
});

test('vẫn chặn khoá riêng trong ~/.ssh, kể cả tên tuỳ ý', () => {
  // Phần quan trọng nhất: chứng minh ba entry allowPaths KHÔNG nới quá.
  // `id_ecdsa`, `id_dsa`, `my_custom_key`, `deploy_key` không khớp bất kỳ
  // pattern basename nào trong denyPaths — chỉ `~/.ssh/**` chặn được chúng.
  for (const cmd of [
    'cat ~/.ssh/id_rsa',
    'cat ~/.ssh/id_ed25519',
    'cat ~/.ssh/id_ecdsa',
    'cat ~/.ssh/id_dsa',
    'cat ~/.ssh/my_custom_key',
    'cat ~/.ssh/deploy_key',
  ]) {
    const r = evaluate(shell(cmd), P);
    assert.equal(r.decision, 'deny', `lọt: ${cmd}`);
    assert.equal(r.ruleId, 'secrets.read-path', cmd);
  }
});

test('ba entry allowPaths không nới sang store secret khác', () => {
  for (const cmd of ['cat ~/.aws/credentials', 'cat ~/.kube/config',
                     'cat ~/.docker/config.json']) {
    const r = evaluate(shell(cmd), P);
    assert.equal(r.decision, 'deny', `lọt: ${cmd}`);
    assert.equal(r.ruleId, 'secrets.read-path', cmd);
  }
});

// Khoá lại phán quyết: pattern `.pub` phải là `~/.ssh/*.pub`, KHÔNG phải
// `**/*.pub`. Đã đo trên corpus 336 đường dẫn `.pub`: `**/*.pub` mở 160 ca,
// `~/.ssh/*.pub` mở 48 ca, và 112 ca chênh lệch KHÔNG mang lại lợi ích nào —
// file `.pub` trong repo (`certs/`, `src/`, cwd) vốn ĐÃ được cho qua ở baseline
// vì không denyPath nào khớp đuôi `.pub` ngoài các thư mục secret dưới home.
// 112 ca đó chỉ gồm: mở toàn bộ cây `~/.aws/**` + `~/.config/gcloud/**` qua
// hậu tố `.pub`, cộng lỗ hổng toàn cục cho họ `**/.env.*`. Đây là policy AN
// NINH: carve-out rộng hơn mức cần thiết là nợ kỹ thuật sẽ bị copy sang chỗ
// khác. Test này làm nó đỏ nếu ai đó nới lại thành `**/*.pub`.
//
// KHÔNG dùng `~/.docker/config.json.pub` hay `~/.kube/config.pub` làm chứng
// nhân ở đây: đã đo, hai ca đó `allow` CẢ TRƯỚC lẫn SAU khi thêm entry `.pub`.
// Lý do là `~/.docker/config.json` và `~/.kube/config` là pattern ĐÚNG-Y
// (không có `**`), nên mọi biến thể thêm hậu tố vốn đã không bị chặn — đây là
// khoảng trống có sẵn của denyPaths, không phải hệ quả của `.pub`. Đưa chúng
// vào đây sẽ tạo chứng nhân GIẢ, đỏ ngay lập tức mà không nói lên điều gì.
test('`~/.ssh/*.pub` không được nới thành `**/*.pub`', () => {
  for (const cmd of [
    'cat ~/.aws/credentials.pub',
    'cat ~/.config/gcloud/creds.pub',
    'cat .env.pub',
    'cat .env.production.pub',
  ]) {
    const r = evaluate(shell(cmd), P);
    assert.equal(r.decision, 'deny', `\`**/*.pub\` đã lọt vào allowPaths: ${cmd}`);
  }
});

test('`~/.ssh/*.pub` chỉ phủ một tầng, không đệ quy', () => {
  // `*` không vượt `/`: khoá công khai thật nằm phẳng trong `~/.ssh`, nên
  // không cần phủ thư mục con — và không nên, để bán kính nhỏ nhất.
  const r = evaluate(shell('cat ~/.ssh/backup/id_rsa.pub'), P);
  assert.equal(r.decision, 'deny', 'cat ~/.ssh/backup/id_rsa.pub');
});

// ---------------------------------------------------------------------------
// Round 3: `~/.kube/config` và `~/.docker/config.json` là pattern ĐÚNG-Y (không
// có `**`), nên MỌI biến thể thêm hậu tố lọt: `config.bak`, `config.old`,
// `config.json.bak`. Đã đo trên policy trước khi sửa: cả ba `allow`.
//
// Vì sao đáng sửa: `cp ~/.kube/config ~/.kube/config.bak` là việc người ta làm
// trước khi đổi context, và bản sao chứa ĐÚNG cert + token cluster như bản gốc.
// Chặn bản gốc mà để lọt bản sao là bảo vệ 0 thứ. Cùng LỚP lỗi với bug
// `.map(globToRegExp)`: một denyPath không phủ đúng thứ nó tồn tại để phủ.
//
// Pattern đã chọn, sau khi đo 1460 ca:
//   `~/.kube/**`            — cả thư mục là credential store, đồng dạng với
//                             `~/.aws/**` / `~/.config/gcloud/**` / `~/.ssh/**`.
//   `~/.docker/config.json*` — CHỈ nới hậu tố. `~/.docker/**` bị cấm bởi test
//                             `cat ~/.docker/daemon.json` phải allow, và đo
//                             thực tế `~/.docker` có bin/, buildx/,
//                             cli-plugins/, contexts/, models/, run/ — không
//                             có gì là credential ngoài `config.json`.
//
// Vì sao KHÔNG thu `~/.kube/**` về `~/.kube/config*`: đã đo, `config*` để lọt
// `~/.kube/kubeconfig-staging`, `~/.kube/prod.yaml`, `~/.kube/configs/prod.yaml`
// — kubeconfig tên tuỳ ý là cách dùng đa-cluster bình thường (KUBECONFIG,
// kubectx, kubie), và mỗi file đó là credential đầy đủ.

const KUBE_DOCKER_SUFFIX = [
  'cat ~/.kube/config',
  'cat ~/.kube/config.bak',
  'cat ~/.kube/config.old',
  'cat ~/.kube/kubeconfig-staging',
  'cat ~/.kube/configs/prod.yaml',
  'cat ~/.docker/config.json',
  'cat ~/.docker/config.json.bak',
];

test('chặn biến thể hậu tố của kubeconfig và docker config, dạng ~', () => {
  // Tên file cố ý không khớp bất kỳ pattern basename nào trong denyPaths
  // (`**/credentials`, `**/id_rsa`, `**/*.key`, `**/service-account*.json`...),
  // nên chỉ pattern `~` mới chặn được — nếu không, test sẽ xanh trên code hỏng.
  for (const cmd of KUBE_DOCKER_SUFFIX) {
    const r = evaluate(shell(cmd), P);
    assert.equal(r.decision, 'deny', `lọt: ${cmd}`);
    assert.equal(r.ruleId, 'secrets.read-path', cmd);
  }
});

test('chặn biến thể hậu tố, dạng tuyệt đối $HOME', () => {
  // Đường đi vòng hiển nhiên nhất: bị chặn `~/.kube/config.bak` thì viết
  // `/Users/<user>/.kube/config.bak`. Đã đo: trước khi sửa cả hai đều LỌT.
  for (const cmd of KUBE_DOCKER_SUFFIX) {
    const abs = cmd.replace('~', homedir());
    const r = evaluate(shell(abs), P);
    assert.equal(r.decision, 'deny', `lọt: ${abs}`);
    assert.equal(r.ruleId, 'secrets.read-path', abs);
  }
});

test('nới `~/.kube/**` không kéo `~/.docker` vào theo', () => {
  // `~/.docker/config.json*` phải là nới hậu tố, KHÔNG phải nới cây và cũng
  // không phải `config*`. Bảy ca này allow ở cả trước lẫn sau khi sửa.
  for (const cmd of [
    'cat ~/.docker/daemon.json',
    'cat ~/.docker/daemon.json.bak',
    'cat ~/.docker/buildx/current',
    'ls ~/.docker/cli-plugins',
    'cat ~/.docker/contexts/meta/abc/meta.json',
    'cat ~/.docker/configx.json',
    'cat ~/.docker/config.yaml',
  ]) {
    const r = evaluate(shell(cmd), P);
    assert.equal(r.decision, 'allow', `chặn oan: ${cmd} => ${r.ruleId ?? ''}`);
  }
});

test('nới `~/.kube/**` không chặn oan liệt kê thư mục hay lệnh thường', () => {
  // `ls ~/.kube` (không có `/` cuối) chỉ liệt kê TÊN file, không tiết lộ nội
  // dung credential — cùng phán quyết đã chốt cho `ls ~/.ssh` ở Task 6.
  // `~/.kube` không có `/` nên không khớp `^HOME/\.kube/.*$`.
  for (const cmd of ['ls ~/.kube', 'ls -la ~/.kube', 'mkdir -p ~/.kube',
                     'npm test', 'cat ~/.kubernetes/x', 'cat ~/.kubeconfig',
                     'cat ~/kube/config', 'cat ./kube/config']) {
    const r = evaluate(shell(cmd), P);
    assert.equal(r.decision, 'allow', `chặn oan: ${cmd} => ${r.ruleId ?? ''}`);
  }
});

// Khoá lại một phán quyết dễ bị lật: KHÔNG thêm allowPath cho
// `~/.kube/cache/**` / `~/.kube/http-cache/**`.
//
// Cái giá của `~/.kube/**` là 10 đường dẫn KHÔNG-credential bị chặn theo, tất
// cả đều là cache discovery do kubectl tự sinh (`~/.kube/cache`,
// `~/.kube/http-cache`, `config.lock`, `plugins`, `schema`). Đã đo: chúng vô
// hại vì `kubectl` và `helm` đã nằm trong `infra.denyBinaries` — agent trong
// guardrail này không chạy được kubectl, nên cache của kubectl là đồ chết. Mất
// 0 workflow mà policy chưa chặn từ trước.
//
// Còn khoét lỗ cache thì MẤT THẬT: `matchesAny` so khớp trên chuỗi thô,
// `normalizePath` KHÔNG rút gọn `..`. Nên allowPath dạng `**` bên trong một cây
// deny sẽ tự mở đường đi vòng — đã đo: thêm `~/.kube/cache/**` làm
// `cat ~/.kube/cache/../config` chuyển từ deny sang ALLOW, tức mở lại đúng cái
// file mà cả round này tồn tại để chặn. Đây cũng là lý do ba entry allowPaths
// của `~/.ssh` đều là một-tầng (`~/.ssh/*.pub`) hoặc đúng-y, không có `**`.
test('không được khoét allowPath dạng `**` bên trong cây ~/.kube', () => {
  for (const cmd of ['cat ~/.kube/cache/../config',
                     'cat ~/.kube/http-cache/../config',
                     'cat ~/.kube/x/../config']) {
    const r = evaluate(shell(cmd), P);
    assert.equal(r.decision, 'deny', `allowPath \`**\` đã mở đường đi vòng: ${cmd}`);
  }
});

// Lỗ này ĐÃ TỪNG được đo là đúng ở Task 6 nhưng KHÔNG có gì khoá lại, rồi hồi
// quy im lặng: `checkEnvDump` soi `sub.argv[0]`/`sub.argv[1]` theo VỊ TRÍ, nên
// mọi tiền tố wrapper đẩy vị trí đi một bước và rule không được cưỡng chế.
// Ba rule kia đã đi qua `effectiveArgv`; chỉ `secrets` còn sót lại vì nó được
// viết TRƯỚC khi `lib/argv.mjs` được tách ra. Danh sách wrapper ở đây dán CỨNG,
// không import từ argv.mjs: import thì một bản `WRAPPERS` bị thu hẹp vẫn xanh.
test('env-dump được cưỡng chế qua mọi lớp wrapper', () => {
  const wrapped = [
    'sudo printenv PASSWORD', 'doas printenv PASSWORD', 'npx printenv PASSWORD',
    'bunx printenv PASSWORD', 'npm exec printenv PASSWORD', 'pnpm dlx printenv PASSWORD',
    'yarn dlx printenv PASSWORD', 'bun x printenv PASSWORD', 'time printenv PASSWORD',
    'nice printenv PASSWORD', 'sudo printenv AWS_SECRET_ACCESS_KEY',
    'sudo env', 'npx env', 'time env', 'sudo set',
  ];
  for (const cmd of wrapped) {
    assert.equal(evaluate(shell(cmd), P).ruleId, 'secrets.env-dump', `ca: ${cmd}`);
  }
});

test('env-dump được cưỡng chế trong điều kiện và vòng lặp', () => {
  for (const cmd of ['if printenv PASSWORD; then echo x; fi', 'while printenv TOKEN; do sleep 1; done']) {
    assert.equal(evaluate(shell(cmd), P).ruleId, 'secrets.env-dump', `ca: ${cmd}`);
  }
});

// Bóc wrapper KHÔNG được biến lệnh vô hại thành bị chặn. `docker` mở đầu bằng
// `do`, `ifconfig` bằng `if` — khớp theo tiền tố thay vì theo token sẽ làm
// những lệnh này rơi vào nhánh env-dump.
test('bóc wrapper không chặn oan lệnh thật', () => {
  for (const cmd of ['docker ps', 'ifconfig en0', 'iftop -i en0', 'env PATH=/opt/bin ls', 'command -v printenv', 'printenv PATH']) {
    assert.equal(evaluate(shell(cmd), P).decision, 'allow', `ca: ${cmd}`);
  }
});

// Cùng lớp lỗi vị trí với env-dump, ở vòng lặp `manager-read`. Nguy hiểm hơn ở
// hai điểm: `vault` và `op` KHÔNG nằm trong infra.denyBinaries nên không có rule
// nào đỡ, và với aws/gcloud/kubectl thì infra đỡ được nhưng báo sai ruleId —
// một dev nới `infra.deny-binary` để dùng `aws s3 ls` sẽ mở lại
// `sudo aws secretsmanager get-secret-value` mà không hay biết.
test('manager-read được cưỡng chế qua mọi lớp wrapper', () => {
  const cases = [
    'sudo vault read secret/prod', 'npx vault read secret/prod',
    'sudo op read op://vault/item/field', 'time op read op://vault/item/field',
    'sudo aws secretsmanager get-secret-value --secret-id x',
    'sudo gcloud secrets versions access latest --secret=x',
    'sudo kubectl get secret my-secret -o yaml',
  ];
  for (const cmd of cases) {
    assert.equal(evaluate(shell(cmd), P).ruleId, 'secrets.manager-read', `ca: ${cmd}`);
  }
});

// Vòng quét token của read-path đọc `sub.argv` THÔ, nên dấu `)` của nhóm lệnh
// dính vào token cuối và phá so khớp. Hệ quả KHÔNG đều: pattern kết bằng tên
// file chính xác (`**/.env`, `**/id_rsa`) bị lách, còn pattern cây `**`
// (`~/.aws/**`) vẫn chặn được vì `**` hút luôn dấu `)`. Nghĩa là lỗ này chỉ hở
// đúng những pattern chính xác nhất — dễ tin là đã an toàn.
// `(cd app && cat .env)` là dạng lệnh agent viết rất tự nhiên, không phải lách.
// infra và self-protect miễn nhiễm vì đã dùng stripTrailingGroup; đây là rule
// thứ tư của cùng một lớp lỗi.
test('read-path được cưỡng chế trong nhóm lệnh và subshell', () => {
  const cases = [
    '(cat .env)',
    '(cat .env);',
    '(cd app && cat .env)',
    'echo x; (cat .env)',
    '(sudo cat .env)',
    '(cat src/.env)',
    '(cat ~/.ssh/id_rsa)',
    '{ cat .env; }',
  ];
  for (const cmd of cases) {
    assert.equal(evaluate(shell(cmd), P).ruleId, 'secrets.read-path', `ca: ${cmd}`);
  }
});

// Bóc `)` không được biến file được miễn thành bị chặn.
test('bóc dấu nhóm không chặn oan file được miễn', () => {
  for (const cmd of ['(cat .env.example)', '(cat ~/.ssh/known_hosts)', '(cat ~/.ssh/id_rsa.pub)']) {
    assert.equal(evaluate(shell(cmd), P).decision, 'allow', `ca: ${cmd}`);
  }
});

// Đo 2026-09-04: đường dẫn nằm CHUNG token với cờ thì vòng quét token không
// thấy, nên `dd if=.env of=/tmp/leak`, `grep --file=.env x`, `tar --file=.env -c`
// đều LỌT. Cùng cái bẫy như dấu nhóm đã ghi ở lib/rules/secrets.mjs: pattern
// CÂY (`~/.aws/**`) vẫn chặn được vì `**` hút cả tiền tố `if=`, nên chỉ pattern
// tên file CHÍNH XÁC hở — dễ tin là đã an toàn.
test('chặn đường dẫn nhạy cảm nằm chung token với cờ', () => {
  for (const cmd of [
    'dd if=.env',
    'dd if=.env of=/tmp/leak',
    'grep --file=.env x',
    'tar --file=.env -c',
    'dd if=certs/server.pem',
  ]) {
    assert.equal(evaluate(shell(cmd), P).ruleId, 'secrets.read-path', cmd);
  }
});

// Chiều ngược, để bản vá không mua an toàn bằng chặn oan:
// - `--exclude=.env` là lệnh BẢO VỆ, chặn nó là dạy dev tắt guardrail.
// - gán biến môi trường không tự đọc file, và `ENV_FILE=.env npm start` là
//   workflow dotenv thật. Nó là lỗ có chủ ý, ghi vào README.
// - allowPaths vẫn phải cứu được khi đường dẫn nằm trong token cờ.
test('không chặn oan cờ bảo vệ, gán biến môi trường, hay allowPaths', () => {
  for (const cmd of [
    'tar --exclude=.env -c .',
    'rsync --exclude=.env src dst',
    'ENV_FILE=.env npm start',
    'dd if=.env.example',
    'grep --file=.env.example x',
  ]) {
    assert.equal(evaluate(shell(cmd), P).decision, 'allow', cmd);
  }
});
