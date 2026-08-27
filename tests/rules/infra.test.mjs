import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../../lib/rules/infra.mjs';
import { loadDefaultPolicy, mergePolicy } from '../../lib/policy.mjs';

const P = loadDefaultPolicy();
const shell = (command) => ({ tool: 'Bash', command, patchFiles: [] });

test('chặn client database', () => {
  for (const cmd of ['psql -l', 'mysql -u root', 'mongosh', 'redis-cli ping']) {
    assert.equal(evaluate(shell(cmd), P).ruleId, 'infra.deny-binary', cmd);
  }
});

test('chặn CLI cloud', () => {
  for (const cmd of ['aws s3 ls', 'gcloud compute instances list', 'oci os ns get',
                     'kubectl get pods', 'terraform apply']) {
    assert.equal(evaluate(shell(cmd), P).ruleId, 'infra.deny-binary', cmd);
  }
});

test('chặn được cả khi lách bằng đường dẫn, env, bash -c', () => {
  for (const cmd of ['/usr/bin/psql -l', 'env FOO=1 psql', 'bash -c "psql -l"']) {
    assert.equal(evaluate(shell(cmd), P).decision, 'deny', cmd);
  }
});

test('sqlite3 và docker thường thì cho qua', () => {
  assert.equal(evaluate(shell('sqlite3 app.db ".tables"'), P).decision, 'allow');
  assert.equal(evaluate(shell('docker compose up -d'), P).decision, 'allow');
});

test('chặn lệnh docker xoá không hoàn tác', () => {
  assert.equal(evaluate(shell('docker system prune -af'), P).ruleId, 'infra.deny-pattern');
  assert.equal(evaluate(shell('docker volume rm data'), P).ruleId, 'infra.deny-pattern');
});

test('allowBinaries thắng denyBinaries', () => {
  const p = mergePolicy(P, { infra: { allowBinaries: ['psql'] } });
  assert.equal(evaluate(shell('psql -l'), p).decision, 'allow');
});

test('ssh tới host thường thì cho qua', () => {
  assert.equal(evaluate(shell('ssh admin-desktop uptime'), P).decision, 'allow');
});

test('chặn ssh tới host trong denyHosts, kể cả có user@', () => {
  const p = mergePolicy(P, { infra: { ssh: { denyHosts: ['*.italent.asia'] } } });
  assert.equal(evaluate(shell('ssh api.italent.asia uptime'), p).ruleId, 'infra.ssh-deny-host');
  assert.equal(evaluate(shell('ssh ubuntu@api.italent.asia uptime'), p).ruleId,
    'infra.ssh-deny-host');
});

test('bỏ qua flag có giá trị khi tìm host', () => {
  const p = mergePolicy(P, { infra: { ssh: { denyHosts: ['prod'] } } });
  assert.equal(evaluate(shell('ssh -p 2222 -i ~/k prod uptime'), p).ruleId,
    'infra.ssh-deny-host');
});

test('soi lệnh remote: ssh host "psql" bị chặn', () => {
  const r = evaluate(shell('ssh admin-desktop "psql -h db"'), P);
  assert.equal(r.ruleId, 'infra.ssh-remote-command');
  assert.ok(r.reason.includes('psql'));
});

test('tắt inspectRemoteCommand thì lệnh remote không bị soi', () => {
  const p = mergePolicy(P, { infra: { ssh: { inspectRemoteCommand: false } } });
  assert.equal(evaluate(shell('ssh admin-desktop "psql -l"'), p).decision, 'allow');
});

test('scp tới host bị chặn', () => {
  const p = mergePolicy(P, { infra: { ssh: { denyHosts: ['prod'] } } });
  assert.equal(evaluate(shell('scp a.txt ubuntu@prod:/tmp/'), p).ruleId, 'infra.ssh-deny-host');
});

test('lệnh không liên quan và command null thì cho qua', () => {
  assert.equal(evaluate(shell('npm test'), P).decision, 'allow');
  assert.equal(evaluate({ tool: 'Bash', command: null, patchFiles: [] }, P).decision, 'allow');
});

test('message deny nêu tên binary và cách nới', () => {
  const r = evaluate(shell('psql -l'), P);
  assert.ok(r.reason.includes('psql'));
  assert.ok(r.hint.includes('allowBinaries'));
});

// --- Ma trận hồi quy: rule này CHẶN, nên chặn oan là chế độ hỏng tệ nhất.
// Mọi ca dưới đây từng sai trong bản đầu và phải được khoá lại bằng test.

const MUST_DENY = [
  'psql -l',
  'docker system prune -af',
  'npm publish',
  'rm -rf /',
  'rm -rf ~',
  'rm -rf /*',
  'npx wrangler deploy',
  'npx supabase db reset',
  'npx vercel --prod',
  'bunx wrangler publish',
  'sudo psql -l',
  'sudo docker system prune -af',
];

const MUST_ALLOW = [
  'rm -rf /tmp/build',
  'rm -rf /Users/me/p/node_modules',
  'rm -rf ~/Library/Caches/foo',
  'rm -rf ./dist',
  'git commit -m "docker system prune is dangerous"',
  'git commit -m "chore: prep npm publish"',
  'echo "never run docker volume rm"',
  'grep -rn terraform docs/',
  'npm test',
  'docker compose up -d',
  'sqlite3 app.db ".tables"',
];

test('ma trận PHẢI CHẶN', () => {
  for (const cmd of MUST_DENY) {
    assert.equal(evaluate(shell(cmd), P).decision, 'deny', `phải chặn: ${cmd}`);
  }
});

test('ma trận PHẢI CHO QUA', () => {
  for (const cmd of MUST_ALLOW) {
    const r = evaluate(shell(cmd), P);
    assert.equal(r.decision, 'allow',
      `chặn oan: ${cmd} => ${r.ruleId} ${r.reason ?? ''}`);
  }
});

// Wrapper không được vô hiệu hoá deny-binary: `npx <tool>` là cách gọi CHUẨN
// của vercel/wrangler/supabase/flyctl, nên nếu bỏ lọt thì 4/21 entry trong
// denyBinaries gần như không được cưỡng chế.
test('wrapper npx/bunx/sudo vẫn lộ ra binary bị chặn, và chặn vì lý do đúng', () => {
  const cases = [
    ['npx wrangler deploy', 'wrangler'],
    ['npx supabase db reset', 'supabase'],
    ['npx vercel --prod', 'vercel'],
    ['bunx wrangler publish', 'wrangler'],
    ['sudo psql -l', 'psql'],
    ['npx -y wrangler deploy', 'wrangler'],
    ['pnpm dlx vercel --prod', 'vercel'],
    ['sudo /usr/bin/psql -l', 'psql'],
    ['time psql -l', 'psql'],
    ['nice psql -l', 'psql'],
  ];
  for (const [cmd, bin] of cases) {
    const r = evaluate(shell(cmd), P);
    assert.equal(r.ruleId, 'infra.deny-binary', cmd);
    assert.ok(r.reason.includes(bin), `${cmd} phải nêu "${bin}", nhận: ${r.reason}`);
  }
});

// `sudo docker system prune` trước đây chặn nhờ may (khớp văn bản thô);
// sau khi khớp theo lệnh hữu hiệu nó phải vẫn chặn, và bằng deny-pattern.
test('deny-pattern khớp theo lệnh hữu hiệu, không theo văn bản thô', () => {
  for (const cmd of ['sudo docker system prune -af', 'sudo npm publish',
                     'cd /app && docker volume rm data', 'bash -c "npm publish"']) {
    assert.equal(evaluate(shell(cmd), P).ruleId, 'infra.deny-pattern', cmd);
  }
});

test('văn bản trong tham số không kích hoạt deny-pattern', () => {
  for (const cmd of ['git commit -m "docker system prune is dangerous"',
                     'git commit -m "chore: prep npm publish"',
                     'echo "never run docker volume rm"',
                     'grep -rn "rm -rf /" docs/']) {
    const r = evaluate(shell(cmd), P);
    assert.equal(r.decision, 'allow', `chặn oan: ${cmd} => ${r.reason ?? ''}`);
  }
});

// rm -rf phải neo "chỉ đúng root": mọi đường dẫn con là lệnh dev chạy hằng ngày.
// Tập wrapper phải hẹp: `command -v <tool>` là lệnh dò công cụ vô hại và phổ
// biến, nếu coi `command` là wrapper thì nó bị chặn oan.
test('không chặn oan lệnh dò công cụ và lệnh chỉ nhắc tên binary', () => {
  for (const cmd of ['command -v psql', 'which terraform', 'type -p aws',
                     'echo aws', 'cat notes.md | grep psql', 'npx tsc --noEmit',
                     'pnpm exec eslint .', 'rm -rf dist build .next']) {
    const r = evaluate(shell(cmd), P);
    assert.equal(r.decision, 'allow', `chặn oan: ${cmd} => ${r.ruleId} ${r.reason ?? ''}`);
  }
});

test('rm -rf chỉ chặn đúng root, cho qua đường dẫn con', () => {
  for (const cmd of ['rm -rf /', 'rm -fr /', 'rm -rf /*', 'rm -rf / --no-preserve-root',
                     'rm -rf ~', 'rm -rf ~/', 'rm -rf ~/*', 'rm -r /', 'rm -rf //']) {
    assert.equal(evaluate(shell(cmd), P).ruleId, 'infra.deny-pattern', `phải chặn: ${cmd}`);
  }
  for (const cmd of ['rm -rf /tmp/build', 'rm -rf /Users/me/p/node_modules',
                     'rm -rf ~/Library/Caches/foo', 'rm -rf ./dist',
                     'rm -rf node_modules', 'rm -rf /var/tmp/x', 'rm -f /etc/hosts']) {
    const r = evaluate(shell(cmd), P);
    assert.equal(r.decision, 'allow', `chặn oan: ${cmd} => ${r.reason ?? ''}`);
  }
});

// ---------------------------------------------------------------------------
// C1: splitSegments tách theo `;`/`&&` nên từ khoá điều khiển rơi vào ĐẦU
// segment (`do psql -f $f`), và ngoặc nhóm lệnh dính vào token (`(psql`, `/)`).
// Trước fix, TOÀN BỘ denylist không được cưỡng chế bên trong bất kỳ vòng lặp
// hay subshell nào — đo được: mọi ca dưới đây đều LỌT.
test('C1: vòng lặp / subshell / negation không vô hiệu hoá rule', () => {
  for (const cmd of [
    'for f in *.sql; do psql -f $f; done',
    'if [ -f a ]; then psql -l; fi',
    'while read l; do psql -c "$l"; done < q.txt',
    'for d in */; do terraform apply; done',
    'for f in *; do npx wrangler deploy; done',
    '(psql -l)',
    '{ psql -l; }',
    '! psql -l',
    '(sudo psql -l)',
  ]) {
    assert.equal(evaluate(shell(cmd), P).ruleId, 'infra.deny-binary', `phải chặn: ${cmd}`);
  }
  // Ngoặc đóng dính vào token cuối phá neo `$` của pattern rm.
  for (const cmd of ['(cd /app && rm -rf /)', 'if true; then rm -rf /; fi',
                     '( rm -rf / )', '{ rm -rf /; }']) {
    assert.equal(evaluate(shell(cmd), P).ruleId, 'infra.deny-pattern', `phải chặn: ${cmd}`);
  }
});

// Khớp từ khoá phải TUYỆT ĐỐI theo token: `do_something` là lệnh thật.
test('C1: token giống từ khoá shell và ngoặc trong tham số không bị chặn oan', () => {
  for (const cmd of [
    'do_something --flag', 'thenable --x', 'elifier build', 'elsewhere run',
    'dotool --list', './do --help', 'make do', 'npm run do', 'npm run then',
    'for d in */; do npm ci; done',
    'for f in *.ts; do npx tsc --noEmit $f; done',
    'for f in *.log; do rm -f $f; done',
    'if [ -f package.json ]; then npm test; fi',
    'if [ -d node_modules ]; then rm -rf node_modules; fi',
    'while read l; do echo $l; done < list.txt',
    '{ npm ci; npm test; }',
    '(cd web && npm run build)',
    '(cd /app && rm -rf ./dist)',
    '(cd /app && rm -rf /tmp/cache)',
    'if true; then rm -rf ./build; fi',
    'for d in */; do (cd $d && git pull); done',
    '! grep -q foo file', '! test -f a.txt',
    '(git status)', '{ git log --oneline -5; }',
    'rm -rf "My Folder (old)"', 'rm -rf "backup (1)"', 'echo "(psql)"',
    'git commit -m "fix(infra): do psql lookup"', 'grep -rn "do psql" docs/',
    "find . -name '*.log' -exec rm -rf {} \\;", 'find . -name "*.tmp" -delete',
  ]) {
    const r = evaluate(shell(cmd), P);
    assert.equal(r.decision, 'allow', `chặn oan: ${cmd} => ${r.ruleId} ${r.reason ?? ''}`);
  }
});

// C2: `rm -rf /` trần là dạng GNU coreutils TỪ CHỐI thi hành, còn mọi dạng
// CHẠY ĐƯỢC (flag đứng trước path, flag tách rời, --no-preserve-root) thì lọt.
// Tức trước fix guardrail chặn dạng vô hại và cho qua dạng gây chết.
test('C2: rm root chặn được cả khi flag đứng trước path hoặc tách rời', () => {
  for (const cmd of [
    'rm -rf --no-preserve-root /', 'rm --no-preserve-root -rf /',
    'rm -r -f /', 'rm -f -r /', 'rm -rf -v /', 'rm --recursive --force /',
    'sudo rm -rf --no-preserve-root /', 'rm -rf --no-preserve-root ~',
    'rm -rf -- /', 'rm --no-preserve-root -rf /*',
  ]) {
    assert.equal(evaluate(shell(cmd), P).ruleId, 'infra.deny-pattern', `phải chặn: ${cmd}`);
  }
});

test('C2: rm có dải flag nhưng đích không phải root thì cho qua', () => {
  for (const cmd of [
    'rm -rf -- ./dist', 'rm -rf -- /tmp/x', 'rm -i -r /tmp/x',
    'rm -rf --preserve-root=all /tmp/x', 'rm --recursive --force ./dist',
    'rm -r -f ./node_modules', 'rm -f -r /tmp/build', 'rm -rf -v ./coverage',
    'rm --recursive --force /var/tmp/x', 'rm -rf ~/.cache/pip',
    'rm -rf -- ~/tmp/x', 'rm -rf --one-file-system ./dist',
  ]) {
    const r = evaluate(shell(cmd), P);
    assert.equal(r.decision, 'allow', `chặn oan: ${cmd} => ${r.ruleId} ${r.reason ?? ''}`);
  }
});

// C3: hostname DNS không phân biệt hoa thường (RFC 4343) → chỉ cần giữ Shift
// là thoát một deny-list có hợp đồng "không được chạm, kể cả chỉ để xem".
test('C3: denyHosts không phân biệt hoa thường, bỏ dấu chấm gốc cuối FQDN', () => {
  const p = mergePolicy(P, { infra: { ssh: { denyHosts: ['*.italent.asia', 'prod'] } } });
  for (const cmd of ['ssh API.ITALENT.ASIA uptime', 'ssh Prod uptime',
                     'scp a.txt PROD:/tmp/', 'ssh api.italent.asia. uptime',
                     'ssh Ubuntu@Api.Italent.Asia uptime']) {
    assert.equal(evaluate(shell(cmd), p).ruleId, 'infra.ssh-deny-host', `phải chặn: ${cmd}`);
  }
  // Chuẩn hoá phải áp cho CẢ HAI phía: pattern viết hoa vẫn khớp host viết thường.
  const pUp = mergePolicy(P, { infra: { ssh: { denyHosts: ['*.ITALENT.ASIA', 'PROD'] } } });
  for (const cmd of ['ssh api.italent.asia uptime', 'ssh prod uptime']) {
    assert.equal(evaluate(shell(cmd), pUp).ruleId, 'infra.ssh-deny-host', `phải chặn: ${cmd}`);
  }
  assert.equal(evaluate(shell('ssh Admin-Desktop uptime'), p).decision, 'allow');
});

// Chốt bộ lọc `a.includes(':')` trong scpHosts: bỏ nó thì mutation testing
// không làm đỏ test nào, nhưng nó chắn một chặn oan THẬT — tên file local
// trùng tiền tố deny-host bị hiểu là host.
test('scp: token không có ":" là tên file local, không phải host', () => {
  const p = mergePolicy(P, { infra: { ssh: { denyHosts: ['prod*'] } } });
  for (const cmd of ['scp prod-dump.sql myhost:/tmp/',
                     'scp ./prod-backup.tar.gz box:/tmp/',
                     'scp prod.sql prod-notes.txt staging:/tmp/']) {
    const r = evaluate(shell(cmd), p);
    assert.equal(r.decision, 'allow', `chặn oan: ${cmd} => ${r.ruleId} ${r.reason ?? ''}`);
  }
  assert.equal(evaluate(shell('scp dump.sql prod-1:/tmp/'), p).ruleId, 'infra.ssh-deny-host');
});

// denyPatterns là data dùng chung cho mọi dự án: thiếu ranh giới từ thì
// `npm publishy` / `docker volume rmi` bị chặn oan.
test('deny-pattern có ranh giới từ ở cuối', () => {
  for (const cmd of ['npm publishy', 'docker volume rmi', 'docker system pruner',
                     'npm publish-please --dry-run', 'docker volume rm-helper']) {
    const r = evaluate(shell(cmd), P);
    assert.equal(r.decision, 'allow', `chặn oan: ${cmd} => ${r.ruleId} ${r.reason ?? ''}`);
  }
  for (const cmd of ['npm publish', 'npm publish --dry-run', 'docker volume rm data',
                     'docker system prune -af', 'docker system prune']) {
    assert.equal(evaluate(shell(cmd), P).ruleId, 'infra.deny-pattern', `phải chặn: ${cmd}`);
  }
});

// ---------------------------------------------------------------------------
// F1: `if`/`while`/`until` mở ĐIỀU KIỆN, và điều kiện là một lệnh chạy thật.
// Đo được trước fix: `if psql -l; then echo ok; fi` LỌT, vì SHELL_KEYWORDS chỉ
// có dải `do`/`then` nên segment điều kiện bị coi là lệnh tên `if`.
// ---------------------------------------------------------------------------

test('F1: denylist được cưỡng chế ở vị trí điều kiện của if/while/until', () => {
  for (const cmd of [
    'if psql -l; then echo ok; fi',
    'while psql -l; do sleep 1; done',
    'until psql -l; do sleep 1; done',
    'if ! psql -l; then echo ok; fi',
    'if aws s3 ls; then echo ok; fi',
    'until kubectl get pods; do sleep 1; done',
    'if docker system prune -af; then echo ok; fi',
    'if npm test; then terraform apply; fi',
  ]) {
    assert.equal(evaluate(shell(cmd), P).decision, 'deny', `phải chặn: ${cmd}`);
  }
});

// Bằng chứng khớp TUYỆT ĐỐI theo token, không phải theo tiền tố: `ifconfig`,
// `iftop`, `docker` là binary THẬT bắt đầu bằng một từ khoá.
// Đã đo bản thí nghiệm prefix-match: nó ĂN LUÔN tên lệnh — `ifconfig` -> [],
// `docker system prune -af` -> `system prune -af` — nên sai theo hướng LỌT, chứ
// không phải chặn oan. Chốt đỏ cho hướng đó nằm ở các test docker của Task 7
// cộng test F1 ngay trên (thử prefix-match: 5 test đỏ). Danh sách dưới ghim
// rằng các token này là LỆNH THẬT, không phải từ khoá để bóc.
test('F1: binary trùng tiền tố if/while/until không bị chặn oan', () => {
  for (const cmd of [
    'ifconfig', 'ifconfig en0', 'ifconfig -a', 'iftop', 'iftop -i en0',
    'ifup en0', 'ifdown en0', 'ifstat', 'untilx --y', 'whileloop.sh',
    'docker ps', 'doctl compute ls', 'dotool click',
    'if [ -f a ]; then npm test; fi',
    'if npm test; then npm run build; fi',
    'while read l; do echo $l; done < f.txt',
    'until nc -z localhost 5432; do sleep 1; done',
    'if ! test -d node_modules; then npm ci; fi',
    'if command -v psql; then echo có; fi',
    'echo "if psql -l; then echo ok; fi"',
    'grep -rn "if psql -l" docs/',
  ]) {
    const r = evaluate(shell(cmd), P);
    assert.equal(r.decision, 'allow', `chặn oan: ${cmd} => ${r.ruleId} ${r.reason ?? ''}`);
  }
});

// `sudo -u postgres psql` là cách gọi CHUẨN của psql, không phải dạng lách khó
// gặp. Cờ mang giá trị làm `effectiveArgv` dừng ở chính giá trị đó (`postgres`),
// nên bin thành "postgres" và TOÀN BỘ denyBinaries không được cưỡng chế. Trước
// khi sửa: `sudo -u postgres psql -c "drop table t"` LỌT hoàn toàn.
// argv.mjs từng ghi đây là giới hạn chấp nhận được với lý do "không đoán bừa cờ
// nào ăn giá trị" — lý do đó không đứng được: với một tập wrapper đã biết thì
// tập cờ mang giá trị cũng đã biết và ổn định, không phải phỏng đoán.
test('cờ mang giá trị của wrapper không làm mất cưỡng chế', () => {
  const cases = [
    'sudo -u postgres psql -c "select 1"',
    'sudo -u root psql -l',
    'sudo --user=postgres psql -l',
    'sudo -g admin psql -l',
    'doas -u root terraform apply',
    'sudo -u deploy aws s3 rm s3://b --recursive',
    'nice -n 10 psql -l',
    'npx -p @foo/bar wrangler deploy',
  ];
  for (const cmd of cases) {
    assert.equal(evaluate(shell(cmd), P).decision, 'deny', `ca: ${cmd}`);
  }
});

// Chiều ngược lại: bóc cờ KHÔNG được ăn mất lệnh thật. `time -p psql` có `-p`
// KHÔNG mang giá trị (POSIX portable output), nên nếu dùng một tập cờ gộp chung
// cho mọi wrapper thì `psql` bị coi là giá trị của `-p` và LỌT. Đây là lý do
// tập cờ phải theo TỪNG wrapper.
test('cờ không mang giá trị không ăn mất lệnh thật', () => {
  for (const cmd of ['time -p psql -l', 'sudo -n psql -l', 'sudo -i psql -l']) {
    assert.equal(evaluate(shell(cmd), P).decision, 'deny', `ca: ${cmd}`);
  }
});
