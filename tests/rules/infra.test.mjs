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
