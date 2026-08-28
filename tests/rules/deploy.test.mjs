import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, matchEntry } from '../../lib/rules/deploy.mjs';
import { loadDefaultPolicy, mergePolicy } from '../../lib/policy.mjs';

const P0 = loadDefaultPolicy();

const shell = (command) => ({
  tool: 'Bash', command, patchFiles: [],
  cwd: '/repo', projectRoot: '/repo', escapes: new Set(), permissionMode: 'default',
});

const withDeploy = (extra = {}) => mergePolicy(P0, {
  deploy: {
    entrypoints: ['./scripts/deploy.sh', 'npm run deploy'],
    targets: [
      { name: 'staging', branches: ['develop'] },
      { name: 'prod', branches: ['release/*'] },
    ],
    ...extra,
  },
});

test('chưa khai deploy thì nhóm là no-op hoàn toàn', () => {
  for (const cmd of ['./scripts/deploy.sh', './scripts/deploy.sh prod', 'npm run deploy']) {
    assert.equal(evaluate(shell(cmd), P0).decision, 'allow', cmd);
  }
});

test('gọi entrypoint mà không nêu đích thì chặn', () => {
  const p = withDeploy();
  for (const cmd of ['./scripts/deploy.sh', './scripts/deploy.sh --dry-run', 'npm run deploy']) {
    assert.equal(evaluate(shell(cmd), p).ruleId, 'deploy.no-target', cmd);
  }
});

test('đích lạ thì chặn, và message phải liệt kê đích đã khai', () => {
  const p = withDeploy();
  const r = evaluate(shell('./scripts/deploy.sh xyz'), p);
  assert.equal(r.ruleId, 'deploy.undeclared-target');
  assert.match(r.reason + r.hint, /staging/);
  assert.match(r.reason + r.hint, /prod/);
  // Codex nối `. Command: <lệnh>` ngay sau reason.
  assert.ok(!/[.\n]$/.test(r.reason), 'reason không kết thúc bằng dấu chấm hay newline');
});

test('bóc đích không phụ thuộc vị trí hay cờ', () => {
  const p = withDeploy();
  for (const cmd of [
    './scripts/deploy.sh staging',
    './scripts/deploy.sh --env=staging',
    './scripts/deploy.sh --env staging',
    './scripts/deploy.sh --dry-run staging',
    'npm run deploy -- staging',
    'bash scripts/deploy.sh staging',
    'sudo bash ./scripts/deploy.sh staging',
  ]) {
    assert.equal(evaluate(shell(cmd), p).decision, 'allow', cmd);
  }
});

test('token chỉ CHỨA tên đích thì không tính là đích', () => {
  const p = withDeploy();
  assert.equal(evaluate(shell('./scripts/deploy.sh --config prod.json'), p).ruleId,
    'deploy.undeclared-target');
});

test('dạng KEY=value cũng bóc được đích', () => {
  const p = mergePolicy(P0, {
    deploy: { entrypoints: ['make deploy'], targets: [{ name: 'prod' }] },
  });
  assert.equal(evaluate(shell('make deploy ENV=prod'), p).decision, 'allow');
  assert.equal(evaluate(shell('make deploy ENV=xyz'), p).ruleId, 'deploy.undeclared-target');
});

test('nhiều đích trong một lệnh thì chặn', () => {
  const p = withDeploy();
  const r = evaluate(shell('./scripts/deploy.sh staging prod'), p);
  assert.equal(r.ruleId, 'deploy.ambiguous-target');
  assert.match(r.reason, /staging/);
  assert.match(r.reason, /prod/);
});

test('requireExplicitTarget false thì tắt được no-target', () => {
  const p = withDeploy({ requireExplicitTarget: false });
  assert.equal(evaluate(shell('./scripts/deploy.sh'), p).decision, 'allow');
  // nhưng đích LẠ vẫn chặn — tắt "phải nêu đích" không phải tắt "đích phải hợp lệ"
  assert.equal(evaluate(shell('./scripts/deploy.sh xyz'), p).ruleId,
    'deploy.undeclared-target');
});

test('biến môi trường không nở ra: lệch về phía chặn', () => {
  const p = withDeploy();
  assert.equal(evaluate(shell('./scripts/deploy.sh $TARGET'), p).ruleId,
    'deploy.undeclared-target');
});

test('lệnh không khớp entrypoint nào thì không quan tâm', () => {
  const p = withDeploy();
  for (const cmd of ['npm test', 'npm run build', 'git status', './scripts/seed.sh prod',
                     'cat scripts/deploy.sh', 'grep -rn deploy scripts/']) {
    assert.equal(evaluate(shell(cmd), p).decision, 'allow', cmd);
  }
});

test('khớp theo từng segment, không chỉ segment đầu', () => {
  const p = withDeploy();
  assert.equal(evaluate(shell('cd web && ./scripts/deploy.sh'), p).ruleId, 'deploy.no-target');
  assert.equal(evaluate(shell('npm run build && ./scripts/deploy.sh staging'), p).decision,
    'allow');
});

// Chỗ nối nền tảng. tokenize là chỗ quyết định dấu `\` được giữ hay bị nuốt, và
// nhánh đó đã có test riêng ở tests/tokenize.test.mjs. Việc của deploy là CHUẨN
// HOÁ `scripts\deploy.sh` về `scripts/deploy.sh` khi so khớp — nên test ở mức
// matchEntry, cho nó ăn đúng argv mà tokenize win32 sinh ra (đo được 2026-08-28:
// parseCommand('scripts\\deploy.sh staging', 0, 'win32') -> ['scripts\\deploy.sh','staging']).
//
// Không test qua evaluate() được từ macOS: parseCommand ở đó dùng process.platform
// nên dấu `\` bị nuốt thành `scriptsdeploy.sh`. Đưa platform thành tham số của
// evaluate sẽ lệch khỏi 4 rule còn lại, mà cả 4 đều không có.
test('đường dẫn Windows khớp cùng một entrypoint', () => {
  const entries = ['./scripts/deploy.sh'];
  for (const argv of [
    ['scripts\\deploy.sh', 'staging'],
    ['./scripts/deploy.sh', 'staging'],
    ['scripts/deploy.sh', 'staging'],
    ['.\\scripts\\deploy.sh', 'staging'],
  ]) {
    const hit = matchEntry(argv, entries);
    assert.ok(hit, JSON.stringify(argv));
    assert.deepEqual(hit.rest, ['staging'], JSON.stringify(argv));
  }
});

test('matchEntry khớp tiền tố nhiều token, không chỉ argv[0]', () => {
  const hit = matchEntry(['npm', 'run', 'deploy', '--', 'staging'], ['npm run deploy']);
  assert.ok(hit);
  assert.deepEqual(hit.rest, ['--', 'staging']);
  // tiền tố ngắn hơn không được coi là khớp
  assert.equal(matchEntry(['npm', 'run'], ['npm run deploy']), null);
  // và không khớp một script khác cùng thư mục
  assert.equal(matchEntry(['scripts/seed.sh'], ['./scripts/deploy.sh']), null);
});
