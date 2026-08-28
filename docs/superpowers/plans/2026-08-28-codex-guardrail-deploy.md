# Nhóm rule `deploy.*` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Làm cho việc deploy mà không chỉ định đích trở thành bất khả, bằng một nhóm rule allow-list mà kiến thức dự án nằm ở `codex-guardrail.json` chứ không ở logic rule.

**Architecture:** Một module rule thuần hàm `lib/rules/deploy.mjs` theo đúng hợp đồng đã có (`evaluate(ctx, policy) => {decision, ruleId, reason, hint}`), đăng ký vào `REGISTRY.PreToolUse.Bash` **trước** `infra`. Nhóm này cần hai thứ hạ tầng chưa có: `effectiveArgv` phải bóc được trình thông dịch shell (Task 1), và `ask` phải là một quyết định hạng nhất trong dispatch (Task 2). Dữ liệu chặn công cụ trực tiếp đi vào `infra.denyBinaries`/`denyPatterns` đang có, không sinh cấu trúc mới.

**Tech Stack:** Node ESM, **không phụ thuộc runtime nào** (`dependencies: {}`), `node:test` + `node:assert/strict`.

**Spec:** [docs/superpowers/specs/2026-08-28-codex-guardrail-deploy-design.md](../specs/2026-08-28-codex-guardrail-deploy-design.md) — đọc cùng [spec chính 2026-08-25](../specs/2026-08-25-codex-guardrail-design.md).

## Global Constraints

- **Zero dependency runtime.** `package.json` giữ `"dependencies": {}`. Không thêm gì.
- **Node >= 20** (`engines`), test bằng `node --test tests/`.
- **Baseline: 409/409 test xanh tại `489dd21`.** Task nào làm giảm con số này là task chưa xong.
- **Ngân sách độ trễ:** hook p95 < **150ms**. Số đo hiện tại **27.8ms**. Đường allow **không được** spawn `git`.
- **Chặn oan là chế độ hỏng tệ nhất.** Khi phải chọn giữa "lọt một ca hiếm" và "chặn oan một lệnh phổ biến", chọn lọt. Mọi rule mới phải có số đo cả hai chiều.
- **Không tài liệu hoá `--dangerously-bypass-hook-trust`** ở bất kỳ file nào dev đọc. `tests/readme.test.mjs` quét chuỗi `bypass|dangerous`.
- **Reason không được kết thúc bằng dấu `.` hay newline** — Codex nối `. Command: <lệnh>` ngay sau.
- **Deny đi qua JSON trên stdout + exit 0**, không bao giờ qua exit code. Dùng `process.exitCode`, không `process.exit()`.
- **Nhánh phụ thuộc nền tảng nhận `platform` làm tham số có mặc định**, không đọc thẳng `process.platform` — team có dev Windows và Ubuntu, nhánh win32 phải test được từ macOS.
- **Mảng trong `policy/default.json` là không thể xoá bởi dự án** (`mergePolicy` HỢP mảng). `deploy.entrypoints`, `deploy.denyDirect`, `deploy.targets` phải **mãi mãi rỗng** ở bản mặc định.
- **Mutation test cho mỗi assert mới:** đổi một hằng số/toán tử trong code vừa viết, xác nhận có test đỏ. Assert không giết được mutant là assert không có giá trị.

---

## File Structure

| File | Trạng thái | Trách nhiệm |
|---|---|---|
| `lib/tokenize.mjs` | sửa | export `SHELL_WRAPPERS` để `argv.mjs` dùng chung một danh sách |
| `lib/argv.mjs` | sửa | `effectiveArgv` bóc thêm trình thông dịch shell |
| `lib/result.mjs` | sửa | thêm `ask(ruleId, reason, hint)` |
| `lib/dispatch.mjs` | sửa | `ask` thành quyết định hạng nhất: deny thắng ask, hạ ask→deny theo `permissionMode`, ghi audit |
| `lib/rules/deploy.mjs` | **tạo** | toàn bộ 9 rule của nhóm |
| `policy/default.json` | sửa | khung `deploy` rỗng + `detectScripts` + dữ liệu `infra` §6.0 |
| `lib/init.mjs` | sửa | dò entrypoint deploy, sinh `selfProtect.protectedPaths` |
| `lib/doctor.mjs` | sửa | báo trạng thái khai nửa vời, resolve alias ssh |
| `README.md` | sửa | 12 giới hạn §9 |
| `tests/rules/deploy.test.mjs` | **tạo** | test của nhóm |
| `tests/argv.test.mjs` | **tạo** | test bóc trình thông dịch (chưa có file test riêng cho argv) |

Rule ở một file duy nhất, không tách 9 file: cả 9 dùng chung một bước đắt nhất (khớp entrypoint + bóc target) và tách ra sẽ phải chạy lại bước đó nhiều lần, hoặc sinh một module "shared" mà không ai sở hữu.

---

## Thứ tự chạy trong REGISTRY

```
selfprotect -> secrets -> deploy -> infra -> git
```

`deploy` **trước** `infra`: `vercel --prod` bị cả hai bắt, và ruleId được báo chính là khoá escape người dùng sẽ gõ. `deploy.direct-tool` nói "hãy dùng script"; `infra.deny-binary` chỉ nói "binary bị chặn". Cái đầu hành động được.

`deploy` **sau** `secrets`: `secrets` rẻ hơn (không spawn gì) và nghiêm trọng hơn.

---

### Task 1: `effectiveArgv` bóc trình thông dịch shell

Vá một lỗ **có sẵn** phát hiện khi lập plan, không phải việc riêng của deploy: `bash ./scripts/deploy.sh prod` không khớp entrypoint nào, tức đi vòng cả nhóm `deploy` trước khi nhóm đó tồn tại. Task này chạm 4 nhóm rule đang có nên nó đứng riêng và review được riêng.

**Files:**
- Modify: `lib/tokenize.mjs:6` (đổi `const SHELL_WRAPPERS` thành `export const`)
- Modify: `lib/argv.mjs:7,64`
- Test: `tests/argv.test.mjs` (tạo)

**Interfaces:**
- Consumes: `basename` từ `lib/tokenize.mjs` (đã có)
- Produces: `SHELL_WRAPPERS: Set<string>` export từ `lib/tokenize.mjs`; `effectiveArgv(rawArgv: string[]) => string[]` giữ nguyên chữ ký

- [x] **Step 1: Viết test đỏ**

Tạo `tests/argv.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand } from '../lib/tokenize.mjs';
import { effectiveArgv } from '../lib/argv.mjs';

const eff = (command) =>
  parseCommand(command).map(s => effectiveArgv(s.argv)).filter(a => a.length > 0);

test('bóc trình thông dịch shell để lộ script thật', () => {
  const cases = [
    ['bash scripts/deploy.sh prod', ['scripts/deploy.sh', 'prod']],
    ['sh ./scripts/deploy.sh prod', ['./scripts/deploy.sh', 'prod']],
    ['zsh scripts/deploy.sh', ['scripts/deploy.sh']],
    ['source ./scripts/deploy.sh prod', ['./scripts/deploy.sh', 'prod']],
    ['. ./scripts/deploy.sh', ['./scripts/deploy.sh']],
    ['sudo bash scripts/deploy.sh prod', ['scripts/deploy.sh', 'prod']],
    ['bash -x scripts/deploy.sh prod', ['scripts/deploy.sh', 'prod']],
    ['npx bash scripts/deploy.sh prod', ['scripts/deploy.sh', 'prod']],
    ['pwsh ./deploy.ps1', ['./deploy.ps1']],
  ];
  for (const [command, expected] of cases) {
    assert.deepEqual(eff(command)[0], expected, command);
  }
});

test('không bóc khi shell không chạy script', () => {
  // `bash` trần: bóc xong argv rỗng, mọi rule đã chặn nhánh argv rỗng
  assert.deepEqual(eff('bash'), []);
  // `./script.sh` có basename là script.sh, không phải `.` — không được coi là sourcer
  assert.deepEqual(eff('./deploy.sh prod')[0], ['./deploy.sh', 'prod']);
});
```

- [x] **Step 2: Chạy để thấy đỏ**

Run: `node --test tests/argv.test.mjs`
Expected: FAIL — `bash scripts/deploy.sh prod` trả `['bash','scripts/deploy.sh','prod']`

- [x] **Step 3: Export `SHELL_WRAPPERS` và mở rộng nó**

Trong `lib/tokenize.mjs`, dòng 6:

```js
// Export vì `argv.mjs` phải bóc ĐÚNG tập trình thông dịch này. Hai bản danh sách
// shell ở hai file là đúng lớp bug "sửa một chỗ quên chỗ kia" mà cả tokenize.mjs
// lẫn argv.mjs đều có comment cảnh báo. `pwsh`/`powershell` có mặt vì team có dev
// Windows, và `pwsh ./deploy.ps1` là dạng gọi chuẩn ở đó.
export const SHELL_WRAPPERS = new Set([
  'bash', 'sh', 'zsh', 'dash', 'ksh', 'pwsh', 'powershell',
]);
```

- [x] **Step 4: Dùng nó trong `argv.mjs`**

Dòng 7:

```js
import { basename, SHELL_WRAPPERS } from './tokenize.mjs';
```

Dòng 64:

```js
// `bash`/`sh`/... vào đây vì `bash ./scripts/deploy.sh prod` để nguyên thì argv[0]
// là `bash`, và MỌI rule khớp theo lệnh thật đều trượt — đo được: nó đi vòng cả
// nhóm deploy. Bóc wrapper chỉ PHƠI RA lệnh thật nên nó chỉ có thể làm rule cưỡng
// chế nhiều hơn, không thể cho qua nhiều hơn; với 4 nhóm deny-list đang có thì đó
// là hướng đúng.
//
// Dạng `-c` KHÔNG bị ảnh hưởng: thân của `bash -c "psql -l"` được parseCommand
// phát thành một segment RIÊNG (tokenize.mjs:98), độc lập với WRAPPERS. Đo được:
// `bash -c "psql -l"` vẫn bị chặn sau thay đổi này.
//
// `source` và `.` là builtin, không phải file thi hành, nên không nằm trong
// SHELL_WRAPPERS (tập đó dùng cho nhánh `-c`) mà thêm trực tiếp ở đây.
const WRAPPERS = new Set([
  'sudo', 'doas', 'npx', 'bunx', 'pnpx', 'time', 'nice',
  ...SHELL_WRAPPERS, 'source', '.',
]);
```

- [x] **Step 5: Chạy test của task**

Run: `node --test tests/argv.test.mjs`
Expected: PASS

- [x] **Step 6: Chạy TOÀN BỘ suite — bắt buộc, task này chạm 4 nhóm rule**

Run: `node --test tests/`
Expected: `# pass 411 # fail 0` (409 cũ + 2 test mới). Đã đo trước khi viết plan: bản vá này giữ 409/409 xanh.

- [x] **Step 7: Kiểm không chặn oan**

Run:

```bash
node --input-type=module -e "import {evaluate} from './lib/rules/infra.mjs'; import {loadDefaultPolicy} from './lib/policy.mjs'; const P=loadDefaultPolicy(); for (const c of ['npm test','git status','find . -name \"*.mjs\"','sh -c \"npm run build\"','source ~/.nvm/nvm.sh','. venv/bin/activate','grep -rn source lib/']) console.log(evaluate({tool:'Bash',command:c,patchFiles:[]},P).decision, c)"
```

Expected: `allow` cho cả 7. Và `bash -c "psql -l"` vẫn `deny`.

- [x] **Step 8: Mutation test**

Bỏ `'source', '.'` khỏi `WRAPPERS`. Expected: test `bóc trình thông dịch shell` đỏ ở 2 ca. Hoàn nguyên.

- [x] **Step 9: Commit**

```bash
git add lib/tokenize.mjs lib/argv.mjs tests/argv.test.mjs && git commit -m "fix(argv): bóc trình thông dịch shell, vá lỗ bash ./script.sh đi vòng mọi rule"
```

---

### Task 2: `ask` là quyết định hạng nhất

`deploy.undeclared-destination` (§5.7) cần `ask`. Hôm nay `dispatch.mjs:140` viết `if (res.decision !== 'deny') continue;` — một rule trả `ask` sẽ bị coi là allow **trong im lặng**. Đó là đúng chế độ hỏng mà cả dự án tồn tại để chống, nên `ask` phải có đường đi riêng trước khi có rule nào dùng nó.

**Files:**
- Modify: `lib/result.mjs`
- Modify: `lib/dispatch.mjs:55-66,140,165-175`
- Test: `tests/dispatch.test.mjs` (thêm)

**Interfaces:**
- Consumes: `ctx.permissionMode` từ `lib/context.mjs:138` (`string | null`)
- Produces: `ask(ruleId, reason, hint) => {decision:'ask', ruleId, reason, hint}`; `runHook` trả `{decision:'ask', stdout, stderr}` với `permissionDecision: 'ask'` trong JSON

- [x] **Step 1: Viết test đỏ**

Thêm vào `tests/dispatch.test.mjs`:

```js
test('ask phát ra permissionDecision ask ở chế độ có người trả lời', () => {
  const out = runHookWith({ decision: 'ask', mode: 'default' });
  assert.equal(out.decision, 'ask');
  assert.equal(JSON.parse(out.stdout).hookSpecificOutput.permissionDecision, 'ask');
});

test('ask hạ về deny ở chế độ không có ai bấm', () => {
  for (const mode of ['dontAsk', 'bypassPermissions']) {
    const out = runHookWith({ decision: 'ask', mode });
    assert.equal(out.decision, 'deny', mode);
    assert.equal(JSON.parse(out.stdout).hookSpecificOutput.permissionDecision, 'deny', mode);
  }
});

test('permissionMode thiếu thì ask hạ về deny', () => {
  // context.mjs cố ý để null chứ không đoán 'default'. Đoán 'default' là đoán
  // rằng có prompt, tức lệch về phía CHO QUA ở đúng chỗ không được lệch.
  const out = runHookWith({ decision: 'ask', mode: null });
  assert.equal(out.decision, 'deny');
});

test('deny THẮNG ask kể cả khi ask đến trước', () => {
  // deploy chạy TRƯỚC infra. Nếu ask trả về ngay thì một ask của deploy sẽ che
  // một deny của infra — biến một lệnh phải chặn thành một lệnh chỉ cần bấm OK.
  const out = runHookTwoRules({ first: 'ask', second: 'deny' });
  assert.equal(out.decision, 'deny');
});
```

Helper `runHookWith` / `runHookTwoRules`: dùng đúng nếp `freshAudit()` đã có trong file, và tiêm rule giả qua `REGISTRY`. Nếu `REGISTRY` chưa export được thì test qua `deploy.undeclared-destination` thật ở Task 7 và **giữ nguyên 4 assert trên**, chỉ đổi cách dựng ctx.

- [x] **Step 2: Chạy để thấy đỏ**

Run: `node --test tests/dispatch.test.mjs`
Expected: FAIL — `ask` bị coi là allow, `out.decision === 'allow'`

- [x] **Step 3: Thêm `ask` vào `lib/result.mjs`**

```js
export const ALLOW = Object.freeze({ decision: 'allow' });

export function deny(ruleId, reason, hint) {
  return { decision: 'deny', ruleId, reason, hint };
}

// `ask` chỉ an toàn khi hành động HIẾM. Hỏi ở một lệnh dev dùng hằng ngày sinh
// prompt fatigue, và prompt fatigue huấn luyện dev bấm qua cả confirm deploy —
// tức nó phá luôn cơ chế mà nó phục vụ. Rule nào dùng `ask` phải chứng minh được
// điều kiện hỏi là hẹp.
export function ask(ruleId, reason, hint) {
  return { decision: 'ask', ruleId, reason, hint };
}
```

- [x] **Step 4: Chế độ nào thì `ask` có nghĩa**

Thêm vào `lib/dispatch.mjs`, cạnh `SAFETY_GROUPS`:

```js
// Enum đầy đủ lấy từ JSON Schema NHÚNG TRONG binary codex 0.150.1:
// "default" | "acceptEdits" | "plan" | "dontAsk" | "bypassPermissions".
// Chỉ ba chế độ đầu là chế độ có người thật trả lời prompt.
//
// ALLOW-LIST cố ý, không phải deny-list `!== 'bypassPermissions'`: chế độ mới mà
// Codex thêm trong tương lai sẽ mặc định KHÔNG được tin là có người trả lời. Với
// một hành động không hoàn tác được, "chưa biết" phải nghĩa là "không hỏi được".
const MODES_WITH_HUMAN = new Set(['default', 'acceptEdits', 'plan']);

function askIsAnswerable(ctx) {
  return MODES_WITH_HUMAN.has(ctx.permissionMode);
}
```

- [x] **Step 5: Đường phát `ask`**

Thêm cạnh `deny()`:

```js
function askOut(reason, stderr = '') {
  return {
    decision: 'ask',
    stdout: JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason: reason,
      },
    }),
    stderr,
  };
}
```

Và message của `ask` — cố ý KHÁC khuôn `denyMessage`, vì nó không phải một lệnh bị chặn:

```js
export function askMessage(result, ctx) {
  return `⚠ guardrail cần xác nhận: ${result.ruleId}

  ${result.reason}
  ${result.hint}${degradedNote(ctx)}`;
}
```

- [x] **Step 6: Sửa vòng lặp — deny phải thắng ask**

Trong `runHook`, đổi `if (res.decision !== 'deny') continue;` thành:

```js
    if (res.decision === 'allow') continue;

    // Gom `ask` lại rồi đi tiếp, KHÔNG trả về ngay. `deploy` chạy trước `infra`,
    // nên trả ngay sẽ để một `ask` của deploy che một `deny` của infra — biến
    // lệnh phải chặn thành lệnh chỉ cần bấm OK. Deny luôn thắng ask.
    if (res.decision === 'ask') {
      if (ctx.escapes.has(res.ruleId)) continue;
      if (!askIsAnswerable(ctx)) {
        pendingDeny ??= res;   // không có ai bấm -> ask thành deny (§3.9)
        continue;
      }
      pendingAsk ??= res;
      continue;
    }
```

Khai `let pendingAsk = null; let pendingDeny = null;` cạnh `let stderr = ''`.

Sau vòng lặp, thay `return allow(stderr)`:

```js
  // Thứ tự ở đây LÀ độ ưu tiên: deny > ask > allow.
  if (pendingDeny) {
    record({ decision: 'denied', ...commonFor(pendingDeny) });
    return deny(denyMessage(pendingDeny, ctx), stderr);
  }
  if (pendingAsk) {
    record({ decision: 'asked', ...commonFor(pendingAsk) });
    return askOut(askMessage(pendingAsk, ctx), stderr);
  }
  return allow(stderr);
```

Bóc khối `common` hiện tại (dispatch.mjs:144-163) thành `commonFor(res)` để dùng được ở cả ba chỗ. Giữ nguyên từng trường và từng comment — chúng ghi lý do `?? undefined` thay vì `?? null`, và lý do `currentBranch` chỉ gọi ngoài đường allow.

- [x] **Step 7: Chạy test**

Run: `node --test tests/dispatch.test.mjs`
Expected: PASS

- [x] **Step 8: Chạy toàn bộ + mutation**

Run: `node --test tests/`
Expected: 411 + 4 = 415 pass, 0 fail.

Mutation 1: đổi `MODES_WITH_HUMAN` thành `new Set(['default','acceptEdits','plan','dontAsk','bypassPermissions'])`. Expected: test `ask hạ về deny ở chế độ không có ai bấm` đỏ. Hoàn nguyên.

Mutation 2: đổi `pendingDeny ??= res` thành `pendingAsk ??= res`. Expected: test `permissionMode thiếu thì ask hạ về deny` đỏ. Hoàn nguyên.

- [x] **Step 9: Commit**

```bash
git add lib/result.mjs lib/dispatch.mjs tests/dispatch.test.mjs && git commit -m "feat(dispatch): ask là quyết định hạng nhất, deny thắng ask, hạ ask khi không có ai bấm"
```

---

### Task 3: `lib/rules/deploy.mjs` — khớp entrypoint và bóc target

Ba rule cốt lõi trả lời trực tiếp §1. Task này cũng nối module vào `REGISTRY` để nhóm chạy thật từ task đầu tiên, không phải chờ tới cuối.

**Files:**
- Create: `lib/rules/deploy.mjs`
- Modify: `policy/default.json` (thêm khối `deploy` rỗng)
- Modify: `lib/dispatch.mjs` (import + REGISTRY + `SAFETY_GROUPS`)
- Test: `tests/rules/deploy.test.mjs` (tạo)

**Interfaces:**
- Consumes: `parseCommand`, `tokenize` từ `lib/tokenize.mjs`; `effectiveArgv` từ `lib/argv.mjs`; `normalizePath` từ `lib/glob.mjs`; `ALLOW`, `deny` từ `lib/result.mjs`
- Produces: `evaluate(ctx, policy)`; nội bộ `matchEntry(argv, entries)`, `targetsIn(rest, names)`, `normToken(t)`

- [x] **Step 1: Viết test đỏ**

Tạo `tests/rules/deploy.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../../lib/rules/deploy.mjs';
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
  ]) {
    assert.equal(evaluate(shell(cmd), p).decision, 'allow', cmd);
  }
});

test('token chỉ CHỨA tên đích thì không tính là đích', () => {
  const p = withDeploy();
  assert.equal(evaluate(shell('./scripts/deploy.sh --config prod.json'), p).ruleId,
    'deploy.no-target');
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

test('đường dẫn Windows khớp cùng entrypoint', () => {
  const p = withDeploy();
  assert.equal(evaluate(shell('scripts\\deploy.sh staging'), p).decision, 'allow');
  assert.equal(evaluate(shell('scripts\\deploy.sh'), p).ruleId, 'deploy.no-target');
});

test('biến môi trường không nở ra: lệch về phía chặn', () => {
  const p = withDeploy();
  assert.equal(evaluate(shell('./scripts/deploy.sh $TARGET'), p).ruleId,
    'deploy.undeclared-target');
});
```

- [x] **Step 2: Chạy để thấy đỏ**

Run: `node --test tests/rules/deploy.test.mjs`
Expected: FAIL — `Cannot find module '../../lib/rules/deploy.mjs'`

- [x] **Step 3: Thêm khung `deploy` rỗng vào `policy/default.json`**

```json
  "deploy": {
    "entrypoints": [],
    "requireExplicitTarget": true,
    "denyDirect": [],
    "targets": []
  },
```

Ba mảng này phải **mãi mãi rỗng**: `mergePolicy` HỢP mảng chứ không thay, nên một mục ở đây là một mục không dự án nào xoá được. `requireExplicitTarget` là boolean nên thay được — đó là lý do nó là boolean.

- [x] **Step 4: Viết `lib/rules/deploy.mjs`**

```js
// lib/rules/deploy.mjs
// Allow-list: deploy chỉ chạy khi đích được NÊU RÕ và đã được khai trước.
// Khác 4 nhóm kia ở chỗ nhóm này liệt kê cái ĐƯỢC PHÉP, nên nó không có gì để
// cưỡng chế khi thiếu dữ liệu dự án — xem `deploy.no-project-root` (Task 4).
//
// Nhóm này KHÔNG chứa tên công cụ nào: mỗi dự án deploy một kiểu, nên kiến thức
// dự án thuộc codex-guardrail.json. Một danh sách vercel|netlify|... trong logic
// rule là chỗ phải bảo trì vô hạn.

import { parseCommand, tokenize } from '../tokenize.mjs';
import { effectiveArgv } from '../argv.mjs';
import { normalizePath } from '../glob.mjs';
import { ALLOW, deny } from '../result.mjs';

// So khớp đường dẫn phải bỏ `./` dẫn đầu và đổi `\` thành `/`: `./scripts/deploy.sh`,
// `scripts/deploy.sh` và `scripts\deploy.sh` là CÙNG một file, mà dev Windows gõ
// dạng thứ ba. normalizePath đã lo dấu `\` và `~`.
function normToken(t) {
  return normalizePath(t).replace(/^\.\//, '').replace(/\/+$/, '');
}

// Entrypoint khớp theo TIỀN TỐ NHIỀU TOKEN, không phải argv[0]: `npm run deploy`
// cho argv ["npm","run","deploy",...] nên khớp argv[0] sẽ trượt hoàn toàn.
function matchEntry(argv, entries) {
  const norm = argv.map(normToken);
  for (const entry of entries) {
    const et = tokenize(entry).map(normToken).filter(Boolean);
    if (et.length === 0 || et.length > norm.length) continue;
    if (et.every((t, i) => t === norm[i])) {
      return { entry, rest: argv.slice(et.length) };
    }
  }
  return null;
}

// Quét TOÀN BỘ tham số, so cả token nguyên và phần sau dấu `=` đầu tiên. Nhờ vậy
// `prod`, `--env=prod`, `--env prod`, `ENV=prod` đều ra cùng kết quả, và schema
// không cần trường `targetArg` nào để mỗi dự án khai sai.
//
// So khớp CHÍNH XÁC cả token, không phải `includes`: `prod.json` không được tính
// là đích `prod`. Ca mơ hồ lệch về phía chặn.
function targetsIn(rest, names) {
  const found = new Set();
  for (const tok of rest) {
    if (names.has(tok)) { found.add(tok); continue; }
    const i = tok.indexOf('=');
    if (i > 0) {
      const v = tok.slice(i + 1);
      if (names.has(v)) found.add(v);
    }
  }
  return [...found];
}

function describeTargets(targets) {
  return targets
    .map(t => (t.branches?.length ? `${t.name} (${t.branches.join(', ')})` : t.name))
    .join(', ');
}

export function evaluate(ctx, policy) {
  if (!ctx.command) return ALLOW;

  const cfg = policy.deploy ?? {};
  const entries = cfg.entrypoints ?? [];
  const targets = cfg.targets ?? [];
  if (entries.length === 0) return ALLOW;   // dự án chưa khai -> no-op hoàn toàn

  const names = new Set(targets.map(t => t.name).filter(Boolean));
  const listed = describeTargets(targets);

  for (const sub of parseCommand(ctx.command)) {
    const argv = effectiveArgv(sub.argv);
    if (argv.length === 0) continue;

    const hit = matchEntry(argv, entries);
    if (!hit) continue;

    const found = targetsIn(hit.rest, names);

    if (found.length > 1) {
      return deny('deploy.ambiguous-target',
        `lệnh nêu ${found.length} đích (${found.join(', ')}) — không xác định được branch rule nào áp`,
        'deploy tuần tự, mỗi lệnh một đích');
    }

    if (found.length === 0) {
      // Phân biệt "không nêu gì" với "nêu một thứ lạ" bằng: có token nào KHÔNG
      // bắt đầu bằng `-`. Đây là HEURISTIC, không phải suy luận chắc chắn — nó
      // KHÔNG đổi quyết định (cả hai đều chặn), chỉ đổi hint và ruleId người dùng
      // gõ để escape. Ghi ra vì một heuristic không ghi ra là một heuristic sẽ bị
      // người sau tưởng là định lý.
      const stray = hit.rest.find(t => !t.startsWith('-'));
      if (stray) {
        return deny('deploy.undeclared-target',
          `đích "${stray}" chưa được khai trong codex-guardrail.json`,
          `Đích đã khai: ${listed || '(chưa khai đích nào)'} — hỏi người dùng chọn một trong số đó`);
      }
      if (cfg.requireExplicitTarget === false) continue;
      return deny('deploy.no-target',
        `${hit.entry} được gọi mà không chỉ định deploy lên đâu`,
        `Đích đã khai: ${listed || '(chưa khai đích nào)'} — hỏi người dùng deploy lên môi trường nào, rồi gọi lại kèm tên đó`);
    }
  }

  return ALLOW;
}
```

- [x] **Step 5: Đăng ký vào dispatch**

`lib/dispatch.mjs` — import, `SAFETY_GROUPS`, và REGISTRY:

```js
import * as deploy from './rules/deploy.mjs';

const SAFETY_GROUPS = new Set(['selfprotect', 'secrets', 'deploy', 'infra', 'git']);
```

Trong `REGISTRY.PreToolUse.Bash`, chèn `['deploy', deploy]` **giữa** `secrets` và `infra`.

`apply_patch` **không** thêm `deploy`: nhóm này soi lệnh sẽ chạy, còn `ctx.command` là null với `apply_patch` (context.mjs:116) nên nó sẽ trả ALLOW ngay. Thêm vào chỉ tốn một lần gọi hàm trên đường nóng.

- [x] **Step 6: Chạy test**

Run: `node --test tests/rules/deploy.test.mjs`
Expected: PASS (9 test)

- [x] **Step 7: Chạy toàn bộ**

Run: `node --test tests/`
Expected: 415 + 9 = 424 pass, 0 fail. Đặc biệt xác nhận `tests/latency.test.mjs` không đỏ.

- [x] **Step 8: Mutation test**

1. Đổi `if (found.length > 1)` thành `>= 1`. Expected: test `bóc đích không phụ thuộc vị trí hay cờ` đỏ.
2. Trong `targetsIn`, đổi `names.has(tok)` thành `[...names].some(n => tok.includes(n))`. Expected: test `token chỉ CHỨA tên đích` đỏ.
3. Trong `matchEntry`, đổi `et.every(...)` thành so `norm[0] === et[0]`. Expected: test `bóc đích...` đỏ ở ca `npm run deploy -- staging`.

Hoàn nguyên cả ba.

- [x] **Step 9: Commit**

```bash
git add lib/rules/deploy.mjs policy/default.json lib/dispatch.mjs tests/rules/deploy.test.mjs && git commit -m "feat(deploy): chặn deploy không nêu đích, đích lạ, và đích mơ hồ"
```

---

### Task 4: `deploy.no-project-root` + `deploy.detectScripts`

Task này sửa một lỗ trong chính spec, phát hiện khi lập plan: `deploy.no-project-root` như đặc tả ban đầu **không thể chạy được**, vì khi `projectRoot` null thì `deploy.entrypoints` rỗng — mất policy là mất luôn cò súng. Xem §3.10 (đã sửa) và §5.1.

**Files:**
- Modify: `lib/rules/deploy.mjs`
- Modify: `policy/default.json` (thêm `deploy.detectScripts`)
- Test: `tests/rules/deploy.test.mjs` (thêm)

**Interfaces:**
- Consumes: `globToRegExp`, `matchesAny` từ `lib/glob.mjs`; `ctx.projectRoot`
- Produces: không thêm export mới

- [x] **Step 1: Viết test đỏ**

```js
const rootless = (command) => ({ ...shell(command), cwd: '/Users/me', projectRoot: null });

test('không có project root thì lệnh trông-như-deploy bị chặn, kèm nguyên nhân thật', () => {
  // policy MẶC ĐỊNH, vì đó chính là tất cả những gì loadPolicy(null) trả về
  for (const cmd of ['./scripts/deploy.sh prod', 'bash scripts/deploy.sh', './deploy-prod.sh',
                     'pwsh ./deploy.ps1', './scripts/publish.sh']) {
    const r = evaluate(rootless(cmd), P0);
    assert.equal(r.ruleId, 'deploy.no-project-root', cmd);
    assert.match(r.reason, /Users\/me/);          // phải nói cwd thật
    assert.match(r.hint, /TỪ thư mục dự án/);
  }
});

test('detectScripts chỉ khớp khi script ĐANG được thi hành', () => {
  for (const cmd of ['cat scripts/deploy.sh', 'vim deploy.sh', 'git diff scripts/deploy.sh',
                     'grep -rn deploy scripts/', 'chmod +x scripts/deploy.sh',
                     'ls scripts/deploy.sh', 'git add scripts/deploy.sh',
                     'cp scripts/deploy.sh /tmp/', 'head -20 deploy.sh', 'echo ./deploy.sh']) {
    assert.equal(evaluate(rootless(cmd), P0).decision, 'allow', cmd);
  }
});

test('có project root thì detectScripts KHÔNG chặn — entrypoint mới là cò súng', () => {
  // Dự án có script tên deploy.sh nhưng cố ý không khai nó là entrypoint:
  // đó là quyền của dự án, và detectScripts không được lấn.
  assert.equal(evaluate(shell('./scripts/deploy.sh prod'), P0).decision, 'allow');
});

test('no-project-root chạy TRƯỚC no-target', () => {
  const p = withDeploy();
  // ngay cả khi policy có entrypoint (ca giả lập), thiếu root vẫn phải ra
  // no-project-root — vì message của no-target sẽ chỉ sửa một file không được đọc
  assert.equal(evaluate(rootless('./scripts/deploy.sh'), p).ruleId, 'deploy.no-project-root');
});
```

- [x] **Step 2: Chạy để thấy đỏ**

Run: `node --test tests/rules/deploy.test.mjs`
Expected: FAIL — `decision` là `allow`, không phải `deny`

- [x] **Step 3: Thêm `detectScripts` vào `policy/default.json`**

Vào khối `deploy`:

```json
    "detectScripts": ["**/deploy*.sh", "**/deploy*.ps1", "**/publish*.sh",
                      "deploy*.sh", "deploy*.ps1", "publish*.sh"],
```

Mảng này **có dữ liệu ở bản mặc định**, khác ba mảng kia, và đó là chủ ý: nó là **cò súng**, và cò súng nằm ở policy dự án thì mất policy là mất cò. Nó không phải danh sách tên công cụ (§3.1 vẫn giữ) mà là phỏng đoán về tên file, và nó chỉ dẫn tới một message "mở Codex từ thư mục dự án" — không bao giờ tới một quyết định về đích.

Hai dạng glob (`**/deploy*.sh` và `deploy*.sh`) vì `**/` của `globToRegExp` sinh `(?:.*/)?` — kiểm bằng test, không suy đoán: nếu một dạng đã phủ cả hai thì bỏ dạng kia.

- [x] **Step 4: Cài rule**

Trong `lib/rules/deploy.mjs`, sửa import:

```js
import { normalizePath, globToRegExp, matchesAny } from '../glob.mjs';
```

Thêm hàm:

```js
// Chỉ soi argv[0] — tức thứ ĐANG ĐƯỢC THI HÀNH — không soi mọi token. Soi mọi
// token thì `cat scripts/deploy.sh`, `git diff scripts/deploy.sh`,
// `chmod +x scripts/deploy.sh` đều bị chặn oan, mà đó là những lệnh dev gõ liên
// tục khi làm việc VỚI script deploy. Đo được: 12/12 lệnh không-thi-hành qua.
function looksLikeDeployScript(argv, res) {
  return argv.length > 0 && matchesAny(normToken(argv[0]), res);
}
```

Trong `evaluate`, **trước** khối `if (entries.length === 0) return ALLOW;`:

```js
  // Chạy TRƯỚC mọi rule khác của nhóm, và trước cả cửa "chưa khai thì no-op":
  // khi projectRoot null thì entries LUÔN rỗng (loadPolicy(null) chỉ trả mặc
  // định), nên đặt sau cửa đó là rule này không bao giờ chạy.
  if (!ctx.projectRoot) {
    const detectRes = (cfg.detectScripts ?? []).map(g => globToRegExp(g));
    if (detectRes.length > 0) {
      for (const sub of parseCommand(ctx.command)) {
        if (looksLikeDeployScript(effectiveArgv(sub.argv), detectRes)) {
          return deny('deploy.no-project-root',
            `không tìm được .git từ cwd (${ctx.cwd}), nên codex-guardrail.json không được đọc — guardrail không biết dự án này được deploy đi đâu`,
            'mở Codex TỪ thư mục dự án rồi thử lại');
        }
      }
    }
    return ALLOW;
  }
```

- [x] **Step 5: Chạy test**

Run: `node --test tests/rules/deploy.test.mjs`
Expected: PASS (13 test)

- [x] **Step 6: Đo lại chặn oan trên tập rộng hơn**

Run:

```bash
node --input-type=module -e "import {runHook} from './lib/dispatch.mjs'; const p=c=>JSON.stringify({hook_event_name:'PreToolUse',tool_name:'Bash',cwd:'/Users/me',permission_mode:'default',tool_input:{command:c}}); for (const c of ['npm test','git status','node --test tests/','ls -la','cat README.md','git log --oneline -5','code .','open .']) { const r=runHook(p(c),{GUARDRAIL_AUDIT_PATH:'/dev/null'}); console.log(r.decision, c); }"
```

Expected: `allow` cho cả 8.

- [x] **Step 7: Mutation test**

Đổi `looksLikeDeployScript` để soi mọi token (`argv.some(...)` thay vì `argv[0]`). Expected: test `detectScripts chỉ khớp khi script ĐANG được thi hành` đỏ ở nhiều ca. Hoàn nguyên.

- [x] **Step 8: Commit**

```bash
git add lib/rules/deploy.mjs policy/default.json tests/rules/deploy.test.mjs && git commit -m "feat(deploy): chặn deploy khi không đọc được policy dự án, cò súng ở bản mặc định"
```

---

### Task 5: `deploy.branch-mismatch` + `deploy.target.<name>`

**Files:**
- Modify: `lib/rules/deploy.mjs`
- Test: `tests/rules/deploy.test.mjs` (thêm)

**Interfaces:**
- Consumes: `currentBranch(cwd)` từ `lib/rules/git-workflow.mjs`; `globToRegExp`, `matchesAny` (đã import ở Task 4)
- Produces: `evaluate(ctx, policy, currentBranch = defaultCurrentBranch)` — tham số thứ ba có mặc định, nên mọi lời gọi hai tham số ở Task 3/4 và ở `dispatch.mjs` vẫn đúng

- [x] **Step 1: Viết test đỏ**

```js
test('branch đúng thì cho qua, branch sai thì chặn — cả hai chiều', () => {
  const p = withDeploy();
  const br = () => 'develop';
  assert.equal(evaluate(shell('./scripts/deploy.sh staging'), p, br).decision, 'allow');
  const r = evaluate(shell('./scripts/deploy.sh prod'), p, br);
  assert.equal(r.ruleId, 'deploy.branch-mismatch');
  assert.match(r.reason, /develop/);
  assert.match(r.reason, /release\/\*/);
});

test('glob branch hoạt động', () => {
  const p = withDeploy();
  assert.equal(evaluate(shell('./scripts/deploy.sh prod'), p, () => 'release/1.4').decision,
    'allow');
});

test('tổ hợp sai không biểu diễn được', () => {
  // cả develop lẫn prod đều CÓ trong policy, nhưng ghép lại thì không hợp lệ
  const p = withDeploy();
  assert.equal(evaluate(shell('./scripts/deploy.sh prod'), p, () => 'develop').ruleId,
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
  assert.equal(evaluate(shell('./d.sh sandbox'), p, () => 'bất-kỳ').decision, 'allow');
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

test('requireHumanEscape thắng branch-mismatch, không để người dùng sửa branch rồi tưởng xong', () => {
  const p = mergePolicy(P0, {
    deploy: {
      entrypoints: ['./scripts/deploy.sh'],
      targets: [{ name: 'prod', branches: ['main'], requireHumanEscape: true }],
    },
  });
  assert.equal(evaluate(shell('./scripts/deploy.sh prod'), p, () => 'develop').ruleId,
    'deploy.target.prod');
});

test('ruleId chứa tên target, không dùng chung một khoá', () => {
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
```

- [x] **Step 2: Chạy để thấy đỏ**

Run: `node --test tests/rules/deploy.test.mjs`
Expected: FAIL — `deploy.sh prod` với branch `develop` đang trả `allow`

- [x] **Step 3: Cài rule**

Sửa chữ ký để `currentBranch` tiêm được:

```js
import { currentBranch as defaultCurrentBranch } from './git-workflow.mjs';

export function evaluate(ctx, policy, currentBranch = defaultCurrentBranch) {
```

Trong nhánh `found.length === 1` (tức sau cả hai khối `found.length > 1` và `found.length === 0`):

```js
    const target = targets.find(t => t.name === found[0]);

    // requireHumanEscape kiểm TRƯỚC branch: nó là cửa lùi khi `ask` không dùng
    // được, và nó không phụ thuộc branch. Kiểm sau branch thì một target
    // hệ-quả-cao trên branch sai sẽ báo branch-mismatch, và người dùng sẽ sửa
    // branch rồi tưởng là đã xong.
    if (target?.requireHumanEscape) {
      return deny(`deploy.target.${target.name}`,
        `${target.name} là đích hệ quả cao, cần người xác nhận chứ không để agent tự quyết`,
        `hỏi người dùng có thật sự muốn deploy ${target.name}. Nếu có, HỌ tự gõ trong shell rồi mở lại Codex:  export CODEX_GUARDRAIL_ALLOW=deploy.target.${target.name}`);
    }

    const wants = target?.branches ?? [];
    if (wants.length === 0) continue;   // target không khai branches -> không kiểm

    // currentBranch spawn `git`, nên CHỈ gọi khi lệnh đã khớp entrypoint VÀ đã có
    // target hợp lệ. Deploy là việc hiếm; hook chạy trên MỌI tool call, nên spawn
    // trên đường allow là trả phí cho việc không xảy ra.
    const branch = currentBranch(ctx.cwd);
    const branchRes = wants.map(b => globToRegExp(b));
    if (!branch || !matchesAny(branch, branchRes)) {
      return deny('deploy.branch-mismatch',
        `branch hiện tại (${branch ?? 'không xác định được'}) không khớp branch cho phép của đích "${target.name}": ${wants.join(', ')}`,
        'chuyển sang branch hợp lệ rồi deploy lại, hoặc sửa deploy.targets trong codex-guardrail.json rồi mở PR (file có CODEOWNERS)');
    }
```

`ruleId` phải chứa tên target: dùng chung một `deploy.high-consequence` thì một lần escape mở cho **mọi** đích hệ quả cao, mà cả điểm của nó là mở đúng một đích.

- [x] **Step 4: Chạy test**

Run: `node --test tests/rules/deploy.test.mjs`
Expected: PASS (21 test)

- [x] **Step 5: Kiểm đường allow không spawn git**

Run: `node --test tests/latency.test.mjs`
Expected: PASS, phần dôi của đường allow không tăng.

Kiểm trực tiếp số lần gọi:

```bash
node --input-type=module -e "import {evaluate} from './lib/rules/deploy.mjs'; import {loadDefaultPolicy,mergePolicy} from './lib/policy.mjs'; let n=0; const p=mergePolicy(loadDefaultPolicy(),{deploy:{entrypoints:['./d.sh'],targets:[{name:'x',branches:['main']}]}}); for (const c of ['npm test','git status','ls','./d.sh x']) evaluate({tool:'Bash',command:c,patchFiles:[],cwd:'/r',projectRoot:'/r',escapes:new Set(),permissionMode:'default'},p,()=>{n++;return 'main';}); console.log('số lần gọi currentBranch:', n, '(phải là 1)')"
```

Expected: `1`.

- [x] **Step 6: Mutation test**

1. Đổi `if (!branch || !matchesAny(...))` thành `if (branch && !matchesAny(...))`. Expected: test `không biết branch thì chặn, không đoán` đỏ.
2. Chuyển khối `requireHumanEscape` xuống **sau** phép kiểm branch. Expected: test `requireHumanEscape thắng branch-mismatch` đỏ.

Hoàn nguyên cả hai.

- [x] **Step 7: Commit**

```bash
git add lib/rules/deploy.mjs tests/rules/deploy.test.mjs && git commit -m "feat(deploy): branch phải khớp đích, và đích hệ quả cao đòi người xác nhận"
```

---

### Task 6: `deploy.direct-tool` + dữ liệu chặn công cụ trực tiếp

**Files:**
- Modify: `lib/rules/deploy.mjs`
- Modify: `policy/default.json` (`infra.denyBinaries`, `infra.denyPatterns`)
- Test: `tests/rules/deploy.test.mjs`, `tests/rules/infra.test.mjs` (thêm)

**Interfaces:**
- Consumes: `cfg.denyDirect` (mảng chuỗi regex, mặc định `[]`)
- Produces: không thêm export mới

- [x] **Step 1: Viết test đỏ**

Vào `tests/rules/infra.test.mjs`:

```js
test('chặn công cụ publish hosting công khai', () => {
  for (const cmd of ['surge ./dist my-app.surge.sh', 'npx gh-pages -d dist']) {
    assert.equal(evaluate(shell(cmd), P).ruleId, 'infra.deny-binary', cmd);
  }
});

test('chặn subcommand publish, giữ chế độ local', () => {
  for (const cmd of ['netlify deploy', 'netlify deploy --prod', 'firebase deploy',
                     'firebase deploy --only hosting', 'railway up', 'sudo railway up',
                     'npx netlify deploy --prod --dir=dist', 'docker push me/app']) {
    assert.equal(evaluate(shell(cmd), P).ruleId, 'infra.deny-pattern', cmd);
  }
  for (const cmd of ['netlify dev', 'netlify link', 'netlify env:list', 'netlify status',
                     'firebase emulators:start', 'firebase login', 'firebase projects:list',
                     'firebase init', 'railway logs', 'railway run npm test',
                     'railway status', 'docker ps']) {
    assert.equal(evaluate(shell(cmd), P).decision, 'allow', cmd);
  }
});

test('ranh giới subcommand: deploying không phải deploy', () => {
  assert.equal(evaluate(shell('netlify deploying-notes.md'), P).decision, 'allow');
  assert.equal(evaluate(shell('grep -rn "netlify deploy" docs/'), P).decision, 'allow');
});
```

Vào `tests/rules/deploy.test.mjs`:

```js
test('denyDirect của dự án chặn công cụ gọi trực tiếp, và hint chỉ sang script', () => {
  const p = withDeploy({ denyDirect: ['mydeploy\\b'] });
  const r = evaluate(shell('mydeploy --prod'), p);
  assert.equal(r.ruleId, 'deploy.direct-tool');
  assert.match(r.hint, /scripts\/deploy\.sh/);
});

test('denyDirect đi qua effectiveArgv', () => {
  const p = withDeploy({ denyDirect: ['mydeploy\\b'] });
  for (const cmd of ['sudo mydeploy --prod', 'npx mydeploy', 'cd web && mydeploy']) {
    assert.equal(evaluate(shell(cmd), p).ruleId, 'deploy.direct-tool', cmd);
  }
});

test('denyDirect không khớp văn bản trong tham số', () => {
  const p = withDeploy({ denyDirect: ['mydeploy\\b'] });
  assert.equal(evaluate(shell('git commit -m "sửa mydeploy"'), p).decision, 'allow');
  assert.equal(evaluate(shell('grep -rn mydeploy docs/'), p).decision, 'allow');
});
```

- [x] **Step 2: Chạy để thấy đỏ**

Run: `node --test tests/rules/`
Expected: FAIL cả hai file

- [x] **Step 3: Thêm dữ liệu vào `policy/default.json`**

`infra.denyBinaries` — thêm `"surge"`, `"gh-pages"`. Chỉ hai công cụ này ở mức binary, vì cả hai **không có chế độ local nào**: gọi trần `surge` là deploy luôn.

`infra.denyPatterns` — thêm:

```json
    "netlify\\s+deploy(?![\\w-])",
    "firebase\\s+deploy(?![\\w-])",
    "railway\\s+up(?![\\w-])",
    "docker\\s+push(?![\\w-])"
```

`netlify`/`firebase`/`railway` ở mức **subcommand**, không mức binary: cả ba có chế độ local dùng hằng ngày (`netlify dev`, `firebase emulators:start`, `railway run`), và mục trong `denyBinaries` mặc định thì **không dự án nào xoá được** — sẽ thành escape từng phiên đến hết đời dự án. Số đo: 8/8 lệnh publish chặn, 12/12 lệnh local qua.

`(?![\w-])` không phải trang trí: nó là thứ giữ `netlify deploying-notes.md` không bị coi là `netlify deploy`.

- [x] **Step 4: Cài `deploy.direct-tool`**

Trong `evaluate`, trong vòng lặp segment, **trước** `matchEntry`:

```js
    // Khớp TIỀN TỐ của lệnh hữu hiệu, cùng ngữ nghĩa với infra.denyPatterns —
    // không sinh thêm một kiểu khớp thứ hai mà người viết policy phải học riêng.
    // Neo vào đầu lệnh nên văn bản nằm trong tham số (`git commit -m "... mydeploy"`)
    // không bao giờ khớp.
    const effective = argv.join(' ').replace(/[)};\s]+$/, '');
    for (const { src, re } of denyDirectRes) {
      if (re.test(effective)) {
        return deny('deploy.direct-tool',
          `lệnh dùng công cụ deploy trực tiếp (khớp mẫu "${src}") thay vì đi qua script đã review`,
          `dùng entrypoint đã khai: ${entries.join(', ')}`);
      }
    }
```

Biên dịch regex **ngoài** vòng lặp segment, cạnh `const names = ...`:

```js
  const denyDirectRes = (cfg.denyDirect ?? []).map(src => ({
    src, re: new RegExp('^(?:' + src + ')'),
  }));
```

`denyDirect` mặc định rỗng nên đường nóng không trả phí gì.

- [x] **Step 5: Chạy test**

Run: `node --test tests/`
Expected: tất cả xanh, 0 fail.

- [x] **Step 6: Đo lại 6 công cụ ở §2.1 mà task này nhận**

```bash
node --input-type=module -e "import {runHook} from './lib/dispatch.mjs'; const p=c=>JSON.stringify({hook_event_name:'PreToolUse',tool_name:'Bash',cwd:process.cwd(),permission_mode:'default',tool_input:{command:c}}); for (const c of ['netlify deploy --prod','firebase deploy','surge ./dist my-app.surge.sh','railway up','docker push docker.io/me/app','npx gh-pages -d dist']) console.log(runHook(p(c),{GUARDRAIL_AUDIT_PATH:'/dev/null'}).decision, c)"
```

Expected: `deny` cho cả 6. Bốn mục còn lại (`scp`/`rsync`/`ssh`/`curl`) là Task 7.

- [x] **Step 7: Mutation test**

Bỏ `(?![\w-])` khỏi `netlify\s+deploy`. Expected: test `ranh giới subcommand` đỏ. Hoàn nguyên.

- [x] **Step 8: Commit**

```bash
git add lib/rules/deploy.mjs policy/default.json tests/rules/ && git commit -m "feat(deploy): chặn công cụ publish trực tiếp, mức subcommand cho công cụ có chế độ local"
```

---

### Task 7: `deploy.undeclared-destination` — nhóm B hỏi, không chặn

**Files:**
- Modify: `lib/rules/deploy.mjs`
- Modify: `lib/rules/infra.mjs` (export `sshParts`, `scpHosts`)
- Modify: `policy/default.json` (thêm `deploy.declaredHosts: []`)
- Test: `tests/rules/deploy.test.mjs` (thêm)

**Interfaces:**
- Consumes: `ask` từ `lib/result.mjs` (Task 2); `basename` từ `lib/tokenize.mjs`
- Produces: `sshParts(argv) => {target, remote}` và `scpHosts(argv) => string[]` export từ `lib/rules/infra.mjs` (chữ ký giữ nguyên, chỉ thêm `export`)

- [x] **Step 1: Viết test đỏ**

```js
const withHosts = () => mergePolicy(P0, {
  deploy: {
    entrypoints: ['./scripts/deploy.sh'],
    targets: [{ name: 'staging' }],
    declaredHosts: ['staging.acme.internal'],
  },
});

test('lệnh ĐẨY tới host chưa khai thì hỏi', () => {
  const p = withHosts();
  for (const cmd of ['scp ./dist deploy@1.2.3.4:/var/www',
                     'rsync -avz ./dist deploy@1.2.3.4:/var/www',
                     'ssh deploy@1.2.3.4 "./deploy.sh"',
                     'curl -X POST https://unknown.example --data-binary @dist.zip',
                     'curl -T dist.zip https://unknown.example',
                     'curl -F file=@dist.zip https://unknown.example']) {
    const r = evaluate(shell(cmd), p);
    assert.equal(r.decision, 'ask', cmd);
    assert.equal(r.ruleId, 'deploy.undeclared-destination', cmd);
  }
});

test('lệnh LẤY VỀ thì không hỏi — đây là phần giữ số prompt thấp', () => {
  const p = withHosts();
  for (const cmd of ['curl https://unknown.example', 'curl -O https://x.example/f.tar.gz',
                     'scp deploy@1.2.3.4:/var/log/app.log .',
                     'rsync -avz deploy@1.2.3.4:/var/log ./logs']) {
    assert.equal(evaluate(shell(cmd), p).decision, 'allow', cmd);
  }
});

test('host ĐÃ khai thì không hỏi', () => {
  const p = withHosts();
  assert.equal(evaluate(shell('scp ./dist deploy@staging.acme.internal:/var/www'), p).decision,
    'allow');
  assert.equal(evaluate(shell('ssh staging.acme.internal "uptime"'), p).decision, 'allow');
});

test('chưa khai declaredHosts thì KHÔNG hỏi gì — không được biến thành hỏi mọi lần', () => {
  // Phép thử chống prompt fatigue: dự án chưa cấu hình mà đã hỏi thì dev sẽ học
  // cách bấm OK, và confirm deploy mất giá trị.
  for (const cmd of ['scp ./dist deploy@1.2.3.4:/var/www', 'ssh x "y"']) {
    assert.equal(evaluate(shell(cmd), P0).decision, 'allow', cmd);
  }
});

test('URL không parse được thì không hỏi', () => {
  // Một prompt về host không đọc được là một prompt không hành động được.
  const p = withHosts();
  assert.equal(evaluate(shell('curl -X POST "$ENDPOINT" -d @dist.zip'), p).decision, 'allow');
});
```

- [x] **Step 2: Chạy để thấy đỏ**

Run: `node --test tests/rules/deploy.test.mjs`
Expected: FAIL — trả `allow` thay vì `ask`

- [x] **Step 3: Export lại bộ bóc host từ `infra.mjs`**

`lib/rules/infra.mjs` — đổi `function sshParts` thành `export function sshParts`, `function scpHosts` thành `export function scpHosts`. Kèm comment:

```js
// Export vì `deploy.undeclared-destination` phải bóc host y HỆT cách này. Hai bản
// là đúng lớp bug mà `lib/argv.mjs` sinh ra để chặn: sửa một chỗ quên chỗ kia.
```

- [x] **Step 4: Cài rule**

Thêm import và hằng số:

```js
import { parseCommand, tokenize, basename } from '../tokenize.mjs';
import { ALLOW, deny, ask } from '../result.mjs';
import { sshParts } from './infra.mjs';

// Cờ của curl nghĩa là ĐẨY dữ liệu ra. Tách khỏi "lấy về" là tín hiệu giảm số
// prompt nhiều nhất: tải-về là việc thường xuyên, đẩy-lên thì hiếm.
const CURL_PUSH_FLAGS = /^(-d|--data(-\S+)?|-F|--form|-T|--upload-file)$/;

function curlPushes(argv) {
  for (let i = 1; i < argv.length; i++) {
    if (CURL_PUSH_FLAGS.test(argv[i])) return true;
    if ((argv[i] === '-X' || argv[i] === '--request')
        && /^(POST|PUT|PATCH)$/i.test(argv[i + 1] ?? '')) return true;
  }
  return false;
}

// scp/rsync: đích là tham số CUỐI. `host:path` ở cuối = đẩy lên;
// `host:path` ở đầu = lấy về. Đây là thứ phân biệt hai chiều.
function remoteDestHost(argv) {
  const positional = argv.slice(1).filter(a => !a.startsWith('-'));
  const last = positional[positional.length - 1];
  if (!last || !last.includes(':')) return null;
  return last.replace(/^[^@]*@/, '').split(':')[0] || null;
}

// URL không parse được -> null, tức KHÔNG hỏi. Một prompt về host không đọc được
// là một prompt không hành động được, và nó chỉ dạy dev bấm qua.
function hostFromUrl(argv) {
  for (const tok of argv.slice(1)) {
    if (!/^https?:\/\//i.test(tok)) continue;
    try { return new URL(tok).hostname || null; } catch { return null; }
  }
  return null;
}
```

Trong `evaluate`, sau khối `denyDirect` và **chỉ khi `declaredHosts` không rỗng**:

```js
    if (declaredRes.length > 0) {
      const bin = basename(argv[0]);
      let host = null;
      if (bin === 'scp' || bin === 'rsync') host = remoteDestHost(argv);
      // ssh = CHẠY LỆNH từ xa, không phải đọc — nên luôn tính là đẩy
      else if (bin === 'ssh') host = sshParts(argv).target;
      else if (bin === 'curl' && curlPushes(argv)) host = hostFromUrl(argv);

      if (host && !matchesAny(host.toLowerCase(), declaredRes)) {
        return ask('deploy.undeclared-destination',
          `lệnh này ĐẨY dữ liệu tới ${host} — host không có trong danh sách đã khai. Đích đã khai: ${declared.join(', ')}`,
          'xác nhận đây là chỗ bạn muốn gửi tới');
      }
    }
```

Khai ngoài vòng lặp, cạnh `denyDirectRes`:

```js
  const declared = cfg.declaredHosts ?? [];
  const declaredRes = declared.map(h => globToRegExp(String(h).toLowerCase()));
```

Và thêm `"declaredHosts": []` vào khối `deploy` của `policy/default.json` — mảng rỗng vĩnh viễn, cùng lý do §6.1.

- [x] **Step 5: Chạy test**

Run: `node --test tests/`
Expected: tất cả xanh.

- [x] **Step 6: Đo số prompt trên tập lệnh hằng ngày**

```bash
node --input-type=module -e "import {evaluate} from './lib/rules/deploy.mjs'; import {loadDefaultPolicy,mergePolicy} from './lib/policy.mjs'; const p=mergePolicy(loadDefaultPolicy(),{deploy:{entrypoints:['./d.sh'],targets:[{name:'x'}],declaredHosts:['staging.acme.internal']}}); const cmds=['curl -fsSL https://deb.nodesource.com/setup_20.x','curl -s https://api.github.com/repos/x/y','curl -o out.tar.gz https://x/y.tar.gz','curl -I https://example.com','curl https://localhost:3000/health','ssh staging.acme.internal uptime','scp staging.acme.internal:/var/log/app.log .','rsync -avz staging.acme.internal:/var/log ./logs','curl -s http://localhost:8080/metrics','curl --version','curl -L https://install.example/script','npm install','git fetch origin','ssh-add -l','curl -sS https://raw.githubusercontent.com/a/b/main/f.sh','scp ./notes.md staging.acme.internal:/tmp/','curl -X GET https://api.example/items','curl -H \"Accept: json\" https://api.example/x','rsync -av ./src ./backup','curl -w \"%{http_code}\" -o /dev/null https://example.com']; let asks=0; for (const c of cmds) { const r=evaluate({tool:'Bash',command:c,patchFiles:[],cwd:'/r',projectRoot:'/r',escapes:new Set(),permissionMode:'default'},p); if (r.decision==='ask') { asks++; console.log('HỎI:', c); } } console.log('số prompt:', asks, '/', cmds.length, '(phải là 0)')"
```

Expected: `0`. Nếu có prompt nào, điều kiện hỏi còn quá rộng — thu hẹp, đừng chấp nhận.

- [x] **Step 7: Mutation test**

1. Bỏ điều kiện `curlPushes(argv)` (hỏi với mọi `curl`). Expected: test `lệnh LẤY VỀ thì không hỏi` đỏ.
2. Trong `remoteDestHost`, đổi `positional[positional.length - 1]` thành `positional[0]`. Expected: test `lệnh ĐẨY...` và `lệnh LẤY VỀ...` đỏ (hai chiều đảo nhau).

Hoàn nguyên cả hai.

- [x] **Step 8: Commit**

```bash
git add lib/rules/deploy.mjs lib/rules/infra.mjs policy/default.json tests/rules/deploy.test.mjs && git commit -m "feat(deploy): hỏi khi đẩy dữ liệu tới host chưa khai, không hỏi khi lấy về"
```

---

### Task 8: `init` dò deploy, `doctor` nói ra trạng thái khai nửa vời

**Files:**
- Modify: `lib/init.mjs:109-133`
- Modify: `lib/doctor.mjs`
- Test: `tests/init.test.mjs`, `tests/doctor.test.mjs` (thêm)

**Interfaces:**
- Consumes: `inferPolicy(cwd, {runGit})`, `POLICY_FILE` từ `lib/init.mjs`
- Produces: `inferPolicy` trả thêm khoá `deploy` và `selfProtect` trong object policy

- [x] **Step 1: Viết test đỏ**

`tests/init.test.mjs` — dùng đúng helper dựng repo tạm đã có trong file:

```js
test('init dò script deploy và sinh sẵn bảo vệ nó', () => {
  const dir = tmpRepo({ 'scripts/deploy.sh': '#!/bin/sh\n' });
  const p = inferPolicy(dir, { runGit: () => '' });
  assert.deepEqual(p.deploy.entrypoints, ['./scripts/deploy.sh']);
  assert.deepEqual(p.selfProtect.protectedPaths['deploy.script'], ['scripts/deploy.sh']);
});

test('init KHÔNG đoán tên môi trường', () => {
  const dir = tmpRepo({ 'scripts/deploy.sh': '#!/bin/sh\ncase "$1" in prod) ;; esac\n' });
  const p = inferPolicy(dir, { runGit: () => '' });
  assert.deepEqual(p.deploy.targets, []);
});

test('không có script deploy thì để trống, không đoán', () => {
  const dir = tmpRepo({ 'src/index.js': '' });
  const p = inferPolicy(dir, { runGit: () => '' });
  assert.deepEqual(p.deploy?.entrypoints ?? [], []);
});
```

`tests/doctor.test.mjs` — dùng đúng helper dựng policy/sidecar đã có trong file:

```js
test('doctor phân biệt chưa khai với khai nửa vời', () => {
  const none = doctorLines({ deploy: { entrypoints: [], targets: [] } });
  assert.ok(none.some(l => /deploy.*KHÔNG cưỡng chế/.test(l)));

  const half = doctorLines({ deploy: { entrypoints: ['./d.sh'], targets: [] } });
  assert.ok(half.some(l => /MỌI lệnh deploy sẽ bị chặn/.test(l)),
    'khai nửa vời phải hiện KHÁC chưa khai — lúc đó guardrail chặn hết, không phải bảo vệ đúng');

  const full = doctorLines({ deploy: { entrypoints: ['./d.sh'], targets: [{ name: 'x' }] } });
  assert.ok(full.some(l => /^✓ deploy/.test(l)));
});
```

- [x] **Step 2: Chạy để thấy đỏ**

Run: `node --test tests/init.test.mjs tests/doctor.test.mjs`
Expected: FAIL

- [x] **Step 3: `init` dò entrypoint**

Trong `lib/init.mjs`, cùng khuôn đã có với `lintCommand`: dò `scripts/deploy*`, script `deploy` trong `package.json`, target `deploy:` trong `Makefile`.

- Tìm được → điền `deploy.entrypoints` và `selfProtect.protectedPaths['deploy.script']`
- Không tìm được → **để trống và nói ra**, không đoán
- `deploy.targets` **luôn để trống**: `init` không suy ra được tên môi trường, và đoán ở đây là đoán chính thứ cần review

- [x] **Step 4: `doctor` báo ba trạng thái khác nhau**

```
⚠ deploy — dự án chưa khai entrypoint hay target nào, nhóm deploy KHÔNG cưỡng chế gì
⚠ deploy — có entrypoint nhưng chưa khai target: MỌI lệnh deploy sẽ bị chặn
✓ deploy — 1 entrypoint, 3 target
```

Ba trạng thái này khác nhau về hành động nên phải hiện khác nhau. Trạng thái giữa là trạng thái guardrail chặn 100%, không phải trạng thái bảo vệ đúng.

- [x] **Step 5: `doctor` resolve alias ssh (phát hiện, không cưỡng chế)**

Resolve từng `declaredHosts` trong `~/.ssh/config`. Gặp `Include`/`Match` thì phải nói **"không resolve được"**, không được đoán — cùng khuôn với bản ghi trust (doctor nói thẳng nó không kiểm được hash).

- [x] **Step 6: Chạy toàn bộ**

Run: `node --test tests/`
Expected: tất cả xanh.

- [x] **Step 7: Chạy doctor thật**

Run: `node bin/guardrail.mjs doctor`
Expected: có dòng `deploy`, và dòng `✗ ... KHÔNG tìm được project root` nếu vẫn mở Codex từ home.

- [x] **Step 8: Commit**

```bash
git add lib/init.mjs lib/doctor.mjs tests/init.test.mjs tests/doctor.test.mjs && git commit -m "feat(init,doctor): dò script deploy, và nói ra trạng thái khai nửa vời"
```

---

### Task 9: README, và một lượt `ask` THẬT trong Codex

Task cuối vì nó kiểm điều duy nhất unit test không kiểm được.

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-08-28-codex-guardrail-deploy-design.md` (§11.4)
- Test: `tests/readme.test.mjs` (thêm)

**Interfaces:** không có API mới.

- [ ] **Step 1: Ghi 12 giới hạn §9 vào README**

Không che một mục nào. Đặc biệt ba mục dễ bị bỏ:

- #9: mở Codex ngoài thư mục dự án thì **đường script không được bảo vệ** — `detectScripts` bịt được, nhưng chỉ ở mức "lệnh trông như deploy", không phải mọi script
- #10: `bash ./deploy.sh` được bịt ở Task 1, nhưng danh sách trình thông dịch **không thể đầy đủ** — `perl -e`, một wrapper tự viết trong repo vẫn gọi được script
- #11: `netlify`/`firebase`/`railway` chặn theo subcommand nên **một subcommand publish mới sẽ lọt** cho tới khi có người thêm pattern, và `doctor` không phát hiện được thiếu sót kiểu này

- [ ] **Step 2: Test README**

```js
test('README ghi đủ giới hạn của nhóm deploy', () => {
  for (const phrase of ['deploy', 'ngoài thư mục dự án', 'subcommand']) {
    assert.match(readme, new RegExp(phrase, 'i'));
  }
});
```

Giữ nguyên test đang có: README **không** được chứa chuỗi khớp `bypass|dangerous`.

- [ ] **Step 3: Cài bản mới**

```bash
node bin/guardrail.mjs install && node bin/guardrail.mjs doctor
```

- [ ] **Step 4: Chạy một lượt `ask` thật**

Trong Codex, **mở TỪ thư mục một dự án có khai `declaredHosts`**, yêu cầu nó chạy:

```bash
scp ./README.md deploy@192.0.2.1:/tmp/
```

`192.0.2.1` là dải TEST-NET-1 (RFC 5737) — không tồn tại, nên dù có bấm OK thì lệnh cũng chỉ timeout, không gửi gì đi đâu. Chọn nhân chứng này thay vì một host thật là có chủ ý: một nhân chứng mà "cho qua" gây hậu quả thật là một nhân chứng không được dùng để thử cơ chế confirm.

Ba kết quả, ba hành động:

| Quan sát | Nghĩa | Hành động |
|---|---|---|
| Codex hiện prompt | `ask` được tôn trọng | đóng §11.4; README nói "sẽ hỏi" |
| Codex tự chạy | `ask` VÔ DỤNG | nhóm B chuyển sang `deny` hoặc `requireHumanEscape`; README nói rõ confirm không khả dụng |
| Codex coi là hook lỗi | **hook lỗi = CHO LỆNH CHẠY** | tuyệt đối không dùng `ask`; đổi toàn bộ Task 7 sang `deny` |

- [ ] **Step 5: Ghi kết quả vào spec §11.4**

Ghi **quan sát**, không ghi suy luận. Nếu chưa chạy được lượt thật thì §11.4 vẫn mở, và README **phải** viết "thiết kế để hỏi", không phải "sẽ hỏi".

- [ ] **Step 6: Đo lại độ trễ**

Run: `node --test tests/latency.test.mjs`
Expected: p95 < 150ms, và phần dôi của đường allow không tăng so với baseline 27.8ms.

- [ ] **Step 7: Commit**

```bash
git add README.md docs/superpowers/specs/ tests/readme.test.mjs && git commit -m "docs: ghi 12 giới hạn của nhóm deploy, và kết quả lượt ask thật"
```

---

## Self-Review

**1. Spec coverage.**

| Spec | Task |
|---|---|
| §5.0 khớp entrypoint + bóc target | 3 |
| §5.0.1 lỗ trình thông dịch | 1 |
| §5.1 `no-project-root` | 4 |
| §5.2 `no-target`, §5.3 `undeclared-target`, §5.4 `ambiguous-target` | 3 |
| §5.5 `branch-mismatch`, §5.8 `target.<name>` | 5 |
| §5.6 `direct-tool` | 6 |
| §5.7 `undeclared-destination` | 7 |
| §5.9 `deploy.script` | 8 (init sinh `selfProtect`, không có code rule) |
| §6 schema, §6.1 mảng mặc định rỗng | 3, 4, 7 |
| §6.0 dữ liệu `infra` | 6 |
| §8 init/doctor | 8 |
| §9 giới hạn | 9 |
| §10 kiểm thử | rải khắp: cả hai chiều, tổ hợp sai, no-op khi chưa khai, đường allow không spawn git, nền tảng Windows, mutation |
| §11.4 `ask` | 2 (cơ chế) + 9 (quan sát thật) |

**§7 không có task** — script phải từ chối target lạ, và guardrail **không cưỡng chế được** điều đó. Nó là yêu cầu của `guardrail ci` ở Plan 3. Ghi ra để không ai tưởng là đã phủ.

**2. Placeholder scan.** Hai chỗ cố ý không dán code:

- Task 2 Step 1 có một nhánh điều kiện ("nếu `REGISTRY` chưa export được thì..."). Cả hai đường đều được chỉ định và 4 assert giữ nguyên trong cả hai — đó là một lựa chọn, không phải TBD.
- Task 8 Step 3/4/5 mô tả `init`/`doctor` theo nếp đã có (`lintCommand`, bản ghi trust) thay vì dán code, vì hai file đó đã có khuôn và dán code mới sẽ lệch khỏi khuôn.

**3. Type consistency.** `evaluate(ctx, policy, currentBranch = defaultCurrentBranch)` — tham số thứ ba thêm ở Task 5 **có mặc định**, nên các lời gọi hai tham số ở Task 3/4 và ở `dispatch.mjs:134` vẫn đúng. `ask(ruleId, reason, hint)` cùng chữ ký với `deny`. `sshParts(argv) => {target, remote}` và `scpHosts(argv) => string[]` giữ đúng chữ ký đang có trong `infra.mjs` — chỉ thêm `export`. `normToken` định nghĩa một lần ở Task 3, dùng lại ở Task 4. `denyDirectRes` và `declaredRes` khai cùng chỗ (ngoài vòng lặp segment), Task 6 và 7.

**4. Ba chỗ plan cố ý lệch khỏi spec, và lý do:**

- **§5.1 không chạy được như đặc tả ban đầu.** Mất policy là mất cò súng, nên plan thêm `deploy.detectScripts` ở **bản mặc định**. Spec đã sửa ở §3.10/§5.1/§9 #9 trước khi plan này được viết.
- **§5.7 nói bóc host "dùng lại đúng đường đã có"** nhưng không nói bằng cách nào. Plan chốt: **export** `sshParts`/`scpHosts` từ `infra.mjs`, không viết bản thứ hai.
- **§5.8 không nói `requireHumanEscape` kiểm trước hay sau branch.** Plan chốt **trước**, vì kiểm sau sẽ khiến người dùng sửa branch rồi tưởng đã xong. Có test riêng cho đúng thứ tự này (Task 5).

**5. Một lỗ ĐÃ ĐO ĐƯỢC mà plan này KHÔNG bịt.** `sudo bash -c "aws s3 ls"` và `npx bash -c "psql -l"` **lọt hôm nay**, trên code sạch tại `489dd21`:

```
LỌT  sudo bash -c "aws s3 ls"
LỌT  npx bash -c "psql -l"
LỌT  sudo sh -c "psql -l"
CHẶN bash -c "aws s3 ls"
```

Nguyên nhân: `parseCommand` (tokenize.mjs:96) soi `basename(argv[0])` **thô**, nên bất kỳ wrapper trước shell đều phá nhánh đệ quy `-c`. Nó ảnh hưởng **cả 4 nhóm rule đang có**, không riêng deploy.

Không bịt trong plan này vì: (a) nó không chặn deploy — Task 1 đã phủ dạng `bash ./script.sh` mà nhóm deploy cần; (b) cách bịt đúng là đảo chiều phụ thuộc giữa `tokenize.mjs` và `argv.mjs` (tách `basename` ra module lá để `tokenize.mjs` gọi được `effectiveArgv`), và đó là một refactor chạm mọi rule — nó phải được review riêng, không đi kèm một plan tính năng.
