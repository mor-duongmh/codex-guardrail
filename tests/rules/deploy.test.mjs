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
  // Tiêm branch hợp lệ của `staging`: test này về BÓC ĐÍCH, không về branch.
  // Không tiêm thì currentBranch thật chạy với cwd giả và trả null -> branch-mismatch.
  const br = () => 'develop';
  for (const cmd of [
    './scripts/deploy.sh staging',
    './scripts/deploy.sh --env=staging',
    './scripts/deploy.sh --env staging',
    './scripts/deploy.sh --dry-run staging',
    'npm run deploy -- staging',
    'bash scripts/deploy.sh staging',
    'sudo bash ./scripts/deploy.sh staging',
  ]) {
    assert.equal(evaluate(shell(cmd), p, br).decision, 'allow', cmd);
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
  assert.equal(
    evaluate(shell('npm run build && ./scripts/deploy.sh staging'), p, () => 'develop').decision,
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

// --- deploy.no-project-root + detectScripts (Task 4) -------------------------
// Khi projectRoot là null thì loadPolicy(null) CHỈ trả policy mặc định, nên
// deploy.entrypoints luôn rỗng — cò súng cũng mất. Vì thế cò súng của rule này
// phải nằm ở policy MẶC ĐỊNH, không phải policy dự án.

const rootless = (command) => ({ ...shell(command), cwd: '/Users/me', projectRoot: null });

test('không có project root: lệnh trông-như-deploy bị chặn, kèm nguyên nhân thật', () => {
  for (const cmd of ['./scripts/deploy.sh prod', 'bash scripts/deploy.sh', './deploy-prod.sh',
                     'pwsh ./deploy.ps1', './scripts/publish.sh',
                     'sudo bash ./scripts/deploy.sh prod']) {
    const r = evaluate(rootless(cmd), P0);
    assert.equal(r.ruleId, 'deploy.no-project-root', cmd);
    assert.match(r.reason, /Users\/me/, cmd);        // phải nói cwd thật
    assert.match(r.hint, /TỪ thư mục dự án/, cmd);
    assert.ok(!/[.\n]$/.test(r.reason), 'reason không kết thúc bằng dấu chấm');
  }
});

test('detectScripts chỉ khớp khi script ĐANG được thi hành', () => {
  for (const cmd of ['cat scripts/deploy.sh', 'vim deploy.sh', 'git diff scripts/deploy.sh',
                     'grep -rn deploy scripts/', 'chmod +x scripts/deploy.sh',
                     'ls scripts/deploy.sh', 'git add scripts/deploy.sh',
                     'cp scripts/deploy.sh /tmp/', 'head -20 deploy.sh', 'echo ./deploy.sh',
                     'npm test', 'git status', 'node --test tests/']) {
    assert.equal(evaluate(rootless(cmd), P0).decision, 'allow', cmd);
  }
});

test('có project root thì detectScripts KHÔNG chặn — entrypoint mới là cò súng', () => {
  // Dự án có script tên deploy.sh nhưng cố ý không khai nó là entrypoint: đó là
  // quyền của dự án, và detectScripts không được lấn.
  assert.equal(evaluate(shell('./scripts/deploy.sh prod'), P0).decision, 'allow');
});

test('no-project-root chạy TRƯỚC no-target', () => {
  // Ca giả lập: policy CÓ entrypoint nhưng thiếu root. Thực tế không xảy ra (mất
  // root là mất policy), nhưng nếu thứ tự sai thì message sẽ chỉ người dùng sửa
  // một file đang không được đọc.
  assert.equal(evaluate(rootless('./scripts/deploy.sh'), withDeploy()).ruleId,
    'deploy.no-project-root');
});

test('detectScripts rỗng thì không chặn gì', () => {
  const p = mergePolicy(P0, {});
  p.deploy = { ...p.deploy, detectScripts: [] };
  assert.equal(evaluate(rootless('./scripts/deploy.sh prod'), p).decision, 'allow');
});

// --- deploy.branch-mismatch + deploy.target.<name> (Task 5) ------------------
// currentBranch tiêm qua tham số thứ 3 CÓ MẶC ĐỊNH: nó spawn `git`, nên test
// không phải dựng repo thật, và đường allow đo được là không gọi nó.

test('branch đúng thì cho qua, branch sai thì chặn — cả hai chiều', () => {
  const p = withDeploy();
  const br = () => 'develop';
  assert.equal(evaluate(shell('./scripts/deploy.sh staging'), p, br).decision, 'allow');
  const r = evaluate(shell('./scripts/deploy.sh prod'), p, br);
  assert.equal(r.ruleId, 'deploy.branch-mismatch');
  assert.match(r.reason, /develop/);
  assert.match(r.reason, /release\/\*/);
  assert.ok(!/[.\n]$/.test(r.reason), 'reason không kết thúc bằng dấu chấm');
});

test('glob branch hoạt động', () => {
  const p = withDeploy();
  assert.equal(evaluate(shell('./scripts/deploy.sh prod'), p, () => 'release/1.4').decision,
    'allow');
  assert.equal(evaluate(shell('./scripts/deploy.sh prod'), p, () => 'release').ruleId,
    'deploy.branch-mismatch');
});

test('tổ hợp sai không biểu diễn được', () => {
  // cả `develop` lẫn `prod` đều CÓ trong policy, nhưng ghép lại thì không hợp lệ
  const p = withDeploy();
  assert.equal(evaluate(shell('./scripts/deploy.sh prod'), p, () => 'develop').ruleId,
    'deploy.branch-mismatch');
  assert.equal(evaluate(shell('./scripts/deploy.sh staging'), p, () => 'release/1.4').ruleId,
    'deploy.branch-mismatch');
});

test('không biết branch thì chặn, không đoán', () => {
  const p = withDeploy();
  assert.equal(evaluate(shell('./scripts/deploy.sh prod'), p, () => null).ruleId,
    'deploy.branch-mismatch');
});

test('target không khai branches thì bỏ qua phép kiểm branch', () => {
  const p = mergePolicy(P0, {
    deploy: { entrypoints: ['./d.sh'], targets: [{ name: 'sandbox' }] },
  });
  assert.equal(evaluate(shell('./d.sh sandbox'), p, () => 'bất-kỳ-branch').decision, 'allow');
});

test('đường allow KHÔNG gọi currentBranch (nó spawn git)', () => {
  const p = withDeploy();
  let calls = 0;
  const br = () => { calls++; return 'develop'; };
  for (const cmd of ['npm test', 'git status', 'ls -la', './scripts/deploy.sh']) {
    evaluate(shell(cmd), p, br);
  }
  assert.equal(calls, 0, 'no-target chặn trước khi cần branch, và lệnh thường không chạm tới');
  evaluate(shell('./scripts/deploy.sh staging'), p, br);
  assert.equal(calls, 1, 'chỉ gọi khi đã khớp entrypoint VÀ đã có target hợp lệ');
});

test('requireHumanEscape chặn kể cả khi target và branch đều đúng', () => {
  const p = mergePolicy(P0, {
    deploy: {
      entrypoints: ['./scripts/deploy.sh'],
      targets: [{ name: 'prod', branches: ['main'], requireHumanEscape: true }],
    },
  });
  const r = evaluate(shell('./scripts/deploy.sh prod'), p, () => 'main');
  assert.equal(r.ruleId, 'deploy.target.prod');
  assert.match(r.hint, /CODEX_GUARDRAIL_ALLOW=deploy\.target\.prod/);
});

test('requireHumanEscape thắng branch-mismatch: không để người dùng sửa branch rồi tưởng xong', () => {
  const p = mergePolicy(P0, {
    deploy: {
      entrypoints: ['./scripts/deploy.sh'],
      targets: [{ name: 'prod', branches: ['main'], requireHumanEscape: true }],
    },
  });
  assert.equal(evaluate(shell('./scripts/deploy.sh prod'), p, () => 'develop').ruleId,
    'deploy.target.prod');
});

test('ruleId chứa tên target, không dùng chung một khoá escape', () => {
  const p = mergePolicy(P0, {
    deploy: {
      entrypoints: ['./d.sh'],
      targets: [
        { name: 'prod', requireHumanEscape: true },
        { name: 'dr', requireHumanEscape: true },
      ],
    },
  });
  assert.equal(evaluate(shell('./d.sh prod'), p).ruleId, 'deploy.target.prod');
  assert.equal(evaluate(shell('./d.sh dr'), p).ruleId, 'deploy.target.dr');
});

// --- deploy.direct-tool (Task 6) --------------------------------------------

test('denyDirect của dự án chặn công cụ gọi trực tiếp, hint chỉ sang script', () => {
  const p = withDeploy({ denyDirect: ['mydeploy\\b'] });
  const r = evaluate(shell('mydeploy --prod'), p);
  assert.equal(r.ruleId, 'deploy.direct-tool');
  assert.match(r.hint, /scripts\/deploy\.sh/);
  assert.ok(!/[.\n]$/.test(r.reason), 'reason không kết thúc bằng dấu chấm');
});

test('denyDirect đi qua effectiveArgv', () => {
  const p = withDeploy({ denyDirect: ['mydeploy\\b'] });
  for (const cmd of ['sudo mydeploy --prod', 'npx mydeploy', 'cd web && mydeploy',
                     'bash -c "mydeploy"']) {
    assert.equal(evaluate(shell(cmd), p).ruleId, 'deploy.direct-tool', cmd);
  }
});

test('denyDirect KHÔNG khớp văn bản nằm trong tham số', () => {
  const p = withDeploy({ denyDirect: ['mydeploy\\b'] });
  for (const cmd of ['git commit -m "sửa mydeploy"', 'grep -rn mydeploy docs/',
                     'echo mydeploy']) {
    assert.equal(evaluate(shell(cmd), p).decision, 'allow', cmd);
  }
});

// denyDirect khớp lệnh hữu hiệu THÔ, y hệt `infra.denyPatterns` — nó KHÔNG chuẩn
// hoá đường dẫn như matchEntry. Đó là chủ ý: chuẩn hoá ở đây sẽ sinh một kiểu khớp
// thứ hai mà người viết policy phải học riêng. Hệ quả phải biết: pattern viết theo
// đúng chuỗi người gõ, `./` bao gồm.
test('denyDirect khớp chuỗi thô, không chuẩn hoá ./ như entrypoint', () => {
  const p = withDeploy({ denyDirect: ['scripts/deploy\\.sh\\b'] });
  // KHÔNG khớp: lệnh thật là `./scripts/deploy.sh`, pattern thiếu `./`
  assert.notEqual(evaluate(shell('./scripts/deploy.sh staging'), p, () => 'develop').ruleId,
    'deploy.direct-tool');
  // Khớp khi pattern viết đúng chuỗi người gõ
  const p2 = withDeploy({ denyDirect: ['\\./scripts/deploy\\.sh\\b'] });
  assert.equal(evaluate(shell('./scripts/deploy.sh staging'), p2, () => 'develop').ruleId,
    'deploy.direct-tool',
    'denyDirect thắng entrypoint: dự án đã tuyên bố nó không được gọi trực tiếp');
});
