# codex-guardrail — Plan 1: Engine, rule an toàn, cài đặt

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Guardrail chặn thật được bốn nhóm rule an toàn (secrets, infra, git workflow, self-protection) trên máy dev, cài và gỡ được mà không phá hook đang có.

**Architecture:** Một entry `bin/guardrail.mjs` là chỗ duy nhất chạm I/O. Mỗi rule là hàm thuần `evaluate(ctx, policy)` trong `lib/rules/`, không đọc stdin và không `exit` — nhờ vậy test bằng object thường và tái dùng được ở tầng CI (Plan 3). Dữ liệu rule nằm trong `policy/default.json`, tách khỏi logic, để điều chỉnh sau này là sửa JSON không sửa code.

**Tech Stack:** Node ESM >= 20, không dependency runtime. Test bằng `node:test` + `node:assert/strict` (built-in).

**Spec:** `docs/superpowers/specs/2026-08-25-codex-guardrail-design.md`

**Phạm vi Plan 1 / để lại cho plan sau:**

- Plan 1 (tài liệu này): tokenize, glob, result, policy, context, redact, audit, rule `secrets` / `infra` / `git` / `selfprotect`, dispatcher, `install` / `uninstall` / `doctor` / `stats`, test độ trễ, CI matrix, README.
- Plan 2: `convention.lint`, `quality.*`, `net.*`, `deps.*`, rule `redact.stdout`, bơm ngữ cảnh `SessionStart`.
- Plan 3: `guardrail ci`, reusable workflow, `guardrail init`, mẫu CODEOWNERS.

## Global Constraints

Mọi task đều phải giữ các ràng buộc sau (trích nguyên từ spec):

- **Node >= 20.** `install` verify và dừng với lỗi rõ nếu thiếu.
- **Không dependency runtime.** `package.json` không có `dependencies`.
- **Đa nền tảng:** macOS, Linux, Windows. Không dùng lệnh shell chỉ có trên Unix trong engine. Không dùng symlink trong `install`.
- **Độ trễ:** hook `PreToolUse` chạy trên mọi tool call. Ngân sách p95 < 150ms. Rule xếp rẻ trước đắt sau; `git rev-parse` chỉ gọi khi cần; short-circuit ở deny đầu tiên.
- **Exit code:** `0` allow, `2` deny (message ở stderr), `3` lỗi nội bộ fail-closed.
- **Chế độ lỗi:** rule an toàn (`secrets`, `infra`, `git`, `selfprotect`) ném exception → **fail-closed**. Rule chất lượng (`convention`, `quality`, `redact`) ném exception → **fail-open** + cảnh báo.
- **Contract rule:** `evaluate(ctx, policy) => { decision, ruleId, reason, hint }`, `decision ∈ {"allow","deny"}`. Rule không áp dụng thì trả `allow`. Không đọc stdin, không `exit`, không ghi log. Rule cần side effect (gọi `git`) nhận tham số thứ ba `deps` để test tiêm được — dispatcher không truyền, dùng mặc định.
- **Message chặn** phải nói ba điều: vi phạm rule nào, vì sao, làm gì tiếp.
- **Tiếng Việt có dấu đầy đủ** trong mọi message hướng tới người dùng.

---

### Task 0: Spike — xác thực hợp đồng hook của Codex

Task này **gating**: nếu kết quả là Codex không tôn trọng exit code non-zero thì dừng plan, quay lại brainstorming. Nó cũng sinh fixture JSON thật mà Task 4 phụ thuộc.

**Files:**
- Create: `spike/dump-hook.mjs`
- Create: `spike/deny-always.mjs`
- Create: `tests/fixtures/codex-events/README.md`
- Create: `docs/superpowers/spikes/2026-08-25-codex-hook-contract.md`

**Interfaces:**
- Consumes: không
- Produces: `tests/fixtures/codex-events/{pretooluse-shell,pretooluse-apply-patch,posttooluse-shell,sessionstart}.json` — payload thật Codex đẩy vào stdin, dùng làm fixture cho `lib/context.mjs` (Task 4). Tài liệu spike ghi kết luận ba câu hỏi.

- [ ] **Step 1: Viết script dump stdin**

```js
// spike/dump-hook.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.env.GUARDRAIL_SPIKE_OUT
  ?? join(process.env.HOME ?? process.env.USERPROFILE ?? '.', 'guardrail-spike');

let raw = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) raw += chunk;

mkdirSync(OUT, { recursive: true });
let name = 'unparseable';
try {
  const j = JSON.parse(raw);
  name = `${j.hook_event_name ?? 'noevent'}-${j.tool_name ?? 'notool'}`;
} catch { /* giữ 'unparseable' */ }

writeFileSync(join(OUT, `${name}-${Date.now()}.json`), raw || '(stdin rỗng)');
process.exit(0);
```

- [ ] **Step 2: Viết script luôn deny**

```js
// spike/deny-always.mjs
process.stderr.write('SPIKE: guardrail chặn lệnh này (deny-always).\n');
process.exit(2);
```

- [ ] **Step 3: Wire tạm vào `~/.codex/hooks.json`**

Backup trước, rồi thêm entry. **Không xoá entry sẵn có** — máy này đã có morkit `session-start.sh` và tldraw `SubagentStart`.

```bash
cp ~/.codex/hooks.json ~/.codex/hooks.json.spike-bak
```

```bash
node -e '
const fs=require("fs"),p=process.env.HOME+"/.codex/hooks.json";
const j=JSON.parse(fs.readFileSync(p,"utf8"));
const repo=process.argv[1];
const add=(ev,matcher,cmd)=>{
  j.hooks[ev]??=[];
  j.hooks[ev].push({...(matcher?{matcher}:{}),hooks:[{type:"command",command:cmd,_spike:true}]});
};
add("PreToolUse","shell",`node ${repo}/spike/dump-hook.mjs`);
add("PreToolUse","apply_patch",`node ${repo}/spike/dump-hook.mjs`);
add("PostToolUse","shell",`node ${repo}/spike/dump-hook.mjs`);
add("SessionStart",null,`node ${repo}/spike/dump-hook.mjs`);
fs.writeFileSync(p,JSON.stringify(j,null,2));
' "$PWD"
```

- [ ] **Step 4: Chạy Codex thật và thu payload (thủ công — cần con người)**

Bước này không tự động hoá được: `codex` không có trong PATH trên máy dev này (symlink `/opt/homebrew/bin/codex` chết), Codex chạy qua app.

Mở Codex trong một repo git bất kỳ rồi làm đúng ba việc:
1. Yêu cầu nó chạy `ls -la` — sinh `PreToolUse-shell` và `PostToolUse-shell`
2. Yêu cầu nó sửa một file — sinh `PreToolUse-apply_patch`
3. Đóng và mở lại phiên — sinh `SessionStart`

Xác nhận có file trong `~/guardrail-spike/`.

- [ ] **Step 5: Trả lời câu hỏi 1 — exit code non-zero có chặn thật không**

Đổi `dump-hook.mjs` thành `deny-always.mjs` cho riêng `PreToolUse`/`shell`, mở lại Codex, yêu cầu nó chạy `ls`.

Ghi lại chính xác một trong ba kết quả vào tài liệu spike:

- **A —** Codex không chạy lệnh và nhận được text ở stderr → hợp đồng đúng, plan tiếp tục như viết.
- **B —** Codex không chạy lệnh nhưng không thấy stderr → plan tiếp tục, nhưng message chặn vô dụng. Task 10 phải đổi cách truyền lý do: thử ghi ra stdout, thử trả JSON `{"decision":"deny","reason":"..."}`, ghi lại cách nào tới được Codex.
- **C —** Codex vẫn chạy lệnh → **DỪNG PLAN.** Báo lại người ra đề và quay về brainstorming: kiến trúc hook không cưỡng chế được, phải dựa hẳn vào tầng CI.

- [ ] **Step 6: Trả lời câu hỏi 2 và 3 từ payload đã thu**

Mở các file JSON trong `~/guardrail-spike/` và ghi vào tài liệu spike:

- Tên khoá chứa command của tool `shell` — spec đoán `tool_input.command`
- Tên khoá chứa nội dung patch và đường dẫn file của `apply_patch`
- `PostToolUse` có mang stdout của tool hay không → nếu **không**, rule `redact.stdout` phải bỏ khỏi Plan 2 và ghi vào spec mục 15 thành giới hạn
- `SessionStart` có kênh trả `additionalContext` hay không → nếu **không**, phần "phòng" của rule convention chuyển sang `UserPromptSubmit` ở Plan 2
- Tên tool đọc file, nếu Codex có tool đọc riêng ngoài `shell` → nếu có, Task 10 phải thêm tool đó vào registry, không thì rule secret hở đúng chỗ quan trọng nhất

- [ ] **Step 7: Chuẩn hoá fixture**

Copy mỗi loại một file vào `tests/fixtures/codex-events/`, đổi tên thành `pretooluse-shell.json`, `pretooluse-apply-patch.json`, `posttooluse-shell.json`, `sessionstart.json`.

**Thay mọi đường dẫn và nội dung thật bằng giá trị vô hại** — `cwd` thành `/tmp/demo-repo`, command thành `ls -la`, patch thành một thay đổi giả trong `src/a.ts`. Fixture đi vào git.

Viết `tests/fixtures/codex-events/README.md`: thu từ Codex thật ngày nào, phiên bản nào, và phải thu lại nếu Codex đổi định dạng.

- [ ] **Step 8: Tháo wiring tạm**

```bash
cp ~/.codex/hooks.json.spike-bak ~/.codex/hooks.json && rm -rf ~/guardrail-spike
```

- [ ] **Step 9: Commit**

```bash
git add spike tests/fixtures/codex-events docs/superpowers/spikes
git commit -m "spike: xác thực hợp đồng hook Codex + thu fixture payload thật"
```

---

### Task 1: Khung repo và `tokenize.mjs`

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `lib/tokenize.mjs`
- Test: `tests/tokenize.test.mjs`

**Interfaces:**
- Consumes: không
- Produces:
  - `parseCommand(command: string, depth?: number) => SubCommand[]`, `SubCommand = { argv: string[], raw: string }`
  - `basename(token: string) => string`
  - `tokenize(segment: string) => string[]`
  - `splitSegments(command: string) => string[]`

- [ ] **Step 1: Tạo `package.json` và `.gitignore`**

```json
{
  "name": "codex-guardrail",
  "version": "0.1.0",
  "type": "module",
  "bin": { "guardrail": "./bin/guardrail.mjs" },
  "engines": { "node": ">=20" },
  "scripts": {
    "test": "node --test tests/",
    "test:latency": "node --test tests/latency.test.mjs"
  },
  "files": ["bin", "lib", "policy"]
}
```

`.gitignore`:

```
node_modules/
*.log
```

- [ ] **Step 2: Viết test thất bại cho `parseCommand`**

Các ca lách là phần giá trị nhất của test này, không phải ca thường.

```js
// tests/tokenize.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand, basename } from '../lib/tokenize.mjs';

const bins = (cmd) => parseCommand(cmd).map(s => basename(s.argv[0]));

test('lệnh thường', () => {
  assert.deepEqual(bins('psql -h localhost'), ['psql']);
});

test('đường dẫn tuyệt đối vẫn ra basename', () => {
  assert.deepEqual(bins('/usr/bin/psql -l'), ['psql']);
});

test('bỏ tiền tố env và biến gán', () => {
  assert.deepEqual(bins('env FOO=1 psql'), ['psql']);
  assert.deepEqual(bins('FOO=1 BAR=2 psql'), ['psql']);
});

test('giải bash -c', () => {
  assert.ok(bins('bash -c "psql -l"').includes('psql'));
});

test('giải eval', () => {
  assert.ok(bins('eval "psql -l"').includes('psql'));
});

test('quote rời vẫn ra psql', () => {
  assert.deepEqual(bins("p''sql"), ['psql']);
  assert.deepEqual(bins('p"s"ql'), ['psql']);
});

test('backslash escape', () => {
  assert.deepEqual(bins('ps\\ql'), ['psql']);
});

test('tách theo ; && || | và newline', () => {
  assert.deepEqual(bins('ls && psql'), ['ls', 'psql']);
  assert.deepEqual(bins('ls | grep x'), ['ls', 'grep']);
  assert.deepEqual(bins('ls\npsql'), ['ls', 'psql']);
});

test('command substitution cũng được phân tích', () => {
  assert.ok(bins('$(which psql) -l').includes('which'));
});

test('không lặp vô hạn khi lồng sâu', () => {
  assert.ok(parseCommand('bash -c "bash -c \\"bash -c ls\\""').length <= 8);
});

test('chuỗi rỗng hoặc null trả mảng rỗng', () => {
  assert.deepEqual(parseCommand(''), []);
  assert.deepEqual(parseCommand('   '), []);
  assert.deepEqual(parseCommand(null), []);
});

test('giữ raw để rule khác soi redirection', () => {
  const subs = parseCommand('echo x > .env');
  assert.ok(subs[0].raw.includes('>'));
});
```

- [ ] **Step 3: Chạy test để xác nhận thất bại**

Run: `node --test tests/tokenize.test.mjs`
Expected: FAIL — `Cannot find module '../lib/tokenize.mjs'`

- [ ] **Step 4: Viết `lib/tokenize.mjs`**

```js
// lib/tokenize.mjs
// Tách command string của shell thành các lệnh con để rule soi được.
// Cố ý KHÔNG phải shell parser đầy đủ: đủ để bắt tai nạn và agent hớ hênh,
// không đủ để chống người cố tình lách (spec mục 15, giới hạn 1).

const SHELL_WRAPPERS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh']);
const MAX_DEPTH = 3;

export function basename(token) {
  const t = String(token ?? '').replace(/^["']+|["']+$/g, '');
  const parts = t.split(/[/\\]/);
  return parts[parts.length - 1];
}

export function tokenize(segment) {
  const out = [];
  let cur = '';
  let has = false;
  let quote = null;
  for (let i = 0; i < segment.length; i++) {
    const c = segment[i];
    if (quote) {
      if (c === quote) { quote = null; continue; }
      cur += c; has = true; continue;
    }
    if (c === '"' || c === "'") { quote = c; has = true; continue; }
    if (c === '\\' && i + 1 < segment.length) { cur += segment[++i]; has = true; continue; }
    if (/\s/.test(c)) { if (has) { out.push(cur); cur = ''; has = false; } continue; }
    cur += c; has = true;
  }
  if (has) out.push(cur);
  return out;
}

export function splitSegments(command) {
  const segs = [];
  let cur = '';
  let quote = null;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote) { cur += c; if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") { quote = c; cur += c; continue; }
    if (c === '\\' && i + 1 < command.length) { cur += c + command[++i]; continue; }
    const two = command.slice(i, i + 2);
    if (two === '&&' || two === '||') { segs.push(cur); cur = ''; i++; continue; }
    if (c === ';' || c === '|' || c === '\n' || c === '&') { segs.push(cur); cur = ''; continue; }
    cur += c;
  }
  segs.push(cur);
  return segs.map(s => s.trim()).filter(Boolean);
}

function stripAssignments(argv) {
  let i = 0;
  if (argv[i] === 'env') i++;
  while (i < argv.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(argv[i])) i++;
  return argv.slice(i);
}

function substitutions(segment) {
  const found = [];
  const re = /\$\(([^()]*)\)|`([^`]*)`/g;
  let m;
  while ((m = re.exec(segment)) !== null) found.push(m[1] ?? m[2]);
  return found.filter(s => s && s.trim());
}

export function parseCommand(command, depth = 0) {
  if (typeof command !== 'string' || depth > MAX_DEPTH) return [];
  const subs = [];
  for (const seg of splitSegments(command)) {
    const argv = stripAssignments(tokenize(seg));
    if (argv.length > 0) subs.push({ argv, raw: seg });

    for (const inner of substitutions(seg)) {
      subs.push(...parseCommand(inner, depth + 1));
    }

    if (argv.length === 0) continue;
    const bin = basename(argv[0]);
    let inner = null;
    if (SHELL_WRAPPERS.has(bin)) {
      const idx = argv.indexOf('-c');
      if (idx >= 0 && argv[idx + 1]) inner = argv[idx + 1];
    } else if (bin === 'eval') {
      inner = argv.slice(1).join(' ');
    }
    if (inner) subs.push(...parseCommand(inner, depth + 1));
  }
  return subs;
}
```

- [ ] **Step 5: Chạy test để xác nhận pass**

Run: `node --test tests/tokenize.test.mjs`
Expected: PASS, 12 test

- [ ] **Step 6: Commit**

```bash
git add package.json .gitignore lib/tokenize.mjs tests/tokenize.test.mjs
git commit -m "feat(tokenize): tách command shell thành lệnh con, phủ các ca lách deny-list"
```

---

### Task 2: `glob.mjs` và `result.mjs`

Hai module nhỏ mà mọi rule đều dùng. Tách riêng vì cả Plan 2 (`quality.protectedPaths`, `net.allowHosts`) cũng dùng — nếu để trong `secrets.mjs` thì Plan 2 phải import ngang qua một rule, sai hướng phụ thuộc.

**Files:**
- Create: `lib/glob.mjs`
- Create: `lib/result.mjs`
- Test: `tests/glob.test.mjs`

**Interfaces:**
- Consumes: không
- Produces:
  - `globToRegExp(pattern: string) => RegExp`
  - `normalizePath(token: string) => string`
  - `matchesAny(normalized: string, regexes: RegExp[]) => boolean`
  - `ALLOW` — object đóng băng `{ decision: 'allow' }`
  - `deny(ruleId: string, reason: string, hint: string) => { decision:'deny', ruleId, reason, hint }`

- [ ] **Step 1: Viết test thất bại**

```js
// tests/glob.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { globToRegExp, normalizePath, matchesAny } from '../lib/glob.mjs';
import { ALLOW, deny } from '../lib/result.mjs';

const hit = (pattern, token) => globToRegExp(pattern).test(normalizePath(token));

test('**/ khớp cả ở gốc và trong thư mục con', () => {
  assert.ok(hit('**/.env', '.env'));
  assert.ok(hit('**/.env', 'src/.env'));
  assert.ok(hit('**/.env', '/Users/x/app/.env'));
});

test('**/.env.* khớp biến thể nhưng không khớp .env trơn', () => {
  assert.ok(hit('**/.env.*', '.env.production'));
  assert.equal(hit('**/.env.*', '.env'), false);
});

test('* không vượt dấu gạch chéo', () => {
  assert.ok(hit('src/*.ts', 'src/a.ts'));
  assert.equal(hit('src/*.ts', 'src/deep/a.ts'), false);
});

test('~ được mở thành home', () => {
  assert.ok(hit('~/.ssh/**', `${homedir()}/.ssh/id_rsa`));
  assert.ok(hit('~/.ssh/**', '~/.ssh/id_rsa'));
});

test('dấu chấm được escape, không thành ký tự đại diện', () => {
  assert.equal(hit('**/.env', 'xenv'), false);
});

test('normalizePath bỏ quote và đổi backslash thành slash', () => {
  assert.equal(normalizePath('"src\\a.ts"'), 'src/a.ts');
});

test('matchesAny', () => {
  const res = [globToRegExp('**/*.pem'), globToRegExp('**/.env')];
  assert.ok(matchesAny(normalizePath('certs/server.pem'), res));
  assert.equal(matchesAny(normalizePath('src/a.ts'), res), false);
});

test('ALLOW là hằng đóng băng, deny sinh đủ bốn khoá', () => {
  assert.equal(ALLOW.decision, 'allow');
  assert.ok(Object.isFrozen(ALLOW));
  const d = deny('infra.deny-binary', 'vì sao', 'làm gì');
  assert.deepEqual(Object.keys(d).sort(), ['decision', 'hint', 'reason', 'ruleId']);
});
```

- [ ] **Step 2: Chạy test để xác nhận thất bại**

Run: `node --test tests/glob.test.mjs`
Expected: FAIL — `Cannot find module '../lib/glob.mjs'`

- [ ] **Step 3: Viết `lib/result.mjs`**

```js
// lib/result.mjs
export const ALLOW = Object.freeze({ decision: 'allow' });

export function deny(ruleId, reason, hint) {
  return { decision: 'deny', ruleId, reason, hint };
}
```

- [ ] **Step 4: Viết `lib/glob.mjs`**

```js
// lib/glob.mjs
import { homedir } from 'node:os';

function expandHome(p) {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return homedir() + '/' + p.slice(2);
  return p;
}

export function normalizePath(token) {
  const t = String(token ?? '').replace(/^["']+|["']+$/g, '').replace(/\\/g, '/');
  return expandHome(t);
}

const SPECIAL = '.+^${}()|[]';

export function globToRegExp(pattern) {
  const p = normalizePath(pattern);
  let re = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*') {
      if (p[i + 1] === '*') {
        if (p[i + 2] === '/') { re += '(?:.*/)?'; i += 2; }
        else { re += '.*'; i += 1; }
      } else {
        re += '[^/]*';
      }
      continue;
    }
    if (c === '?') { re += '[^/]'; continue; }
    if (SPECIAL.includes(c)) { re += '\\' + c; continue; }
    re += c;
  }
  return new RegExp('^' + re + '$');
}

export function matchesAny(normalized, regexes) {
  return regexes.some(r => r.test(normalized));
}
```

- [ ] **Step 5: Chạy test để xác nhận pass**

Run: `node --test tests/glob.test.mjs`
Expected: PASS, 8 test

- [ ] **Step 6: Commit**

```bash
git add lib/glob.mjs lib/result.mjs tests/glob.test.mjs
git commit -m "feat(glob): khớp glob không dependency + hằng kết quả rule dùng chung"
```

---

### Task 3: `policy.mjs` và `policy/default.json`

**Files:**
- Create: `lib/policy.mjs`
- Create: `policy/default.json`
- Test: `tests/policy.test.mjs`

**Interfaces:**
- Consumes: không
- Produces:
  - `findProjectRoot(startDir: string) => string | null`
  - `loadDefaultPolicy() => Policy`
  - `mergePolicy(base: Policy, override: object) => Policy`
  - `loadPolicy(projectRoot: string | null) => { policy: Policy, source: string | null, warnings: string[] }`
  - `class PolicyError extends Error`

Ngữ nghĩa merge (spec §8.2): mảng **hợp** (union, thứ tự base trước), object **đệ quy**, giá trị vô hướng **ghi đè**. Chuỗi rỗng nghĩa là tắt rule đó.

- [ ] **Step 1: Viết `policy/default.json`**

```json
{
  "secrets": {
    "denyPaths": [
      "**/.env", "**/.env.*", "**/*.pem", "**/*.key", "**/*.p12", "**/*.pfx",
      "**/*.jks", "**/id_rsa", "**/id_ed25519", "**/credentials",
      "**/service-account*.json", "**/.npmrc", "**/.netrc", "**/.git-credentials",
      "~/.aws/**", "~/.config/gcloud/**", "~/.kube/config", "~/.ssh/**",
      "~/.docker/config.json"
    ],
    "allowPaths": ["**/.env.example", "**/.env.sample", "**/.env.template"]
  },
  "infra": {
    "denyBinaries": [
      "psql", "mysql", "mysqldump", "mongosh", "mongo", "redis-cli",
      "aws", "gcloud", "gsutil", "az", "oci", "kubectl", "helm",
      "terraform", "pulumi", "ansible", "flyctl", "heroku", "vercel",
      "wrangler", "supabase"
    ],
    "allowBinaries": [],
    "denyPatterns": [
      "docker\\s+system\\s+prune",
      "docker\\s+volume\\s+rm",
      "npm\\s+publish",
      "rm\\s+-rf\\s+/",
      "rm\\s+-rf\\s+~"
    ],
    "ssh": { "denyHosts": [], "inspectRemoteCommand": true }
  },
  "git": {
    "protectedBranches": ["main", "master", "develop", "release/*"],
    "commitMessagePattern": "^(feat|fix|chore|docs|test|refactor|perf|ci|build|style|revert)(\\(.+\\))?!?: .+"
  },
  "convention": {
    "lintCommand": "",
    "lintExtensions": [],
    "lintTimeoutMs": 15000,
    "conventionDocs": []
  },
  "quality": {
    "protectedPaths": [
      ".github/workflows/**", "dist/**", "build/**", "**/*.generated.*",
      "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "poetry.lock", "Cargo.lock"
    ]
  },
  "net": {
    "allowHosts": [
      "registry.npmjs.org", "pypi.org", "files.pythonhosted.org",
      "github.com", "raw.githubusercontent.com", "api.github.com", "crates.io"
    ]
  },
  "deps": { "enabled": true },
  "selfProtect": {
    "protectedPaths": [
      "**/codex-guardrail.json", "~/.codex/hooks.json",
      "~/.codex/config.toml", "~/.codex/guardrail/**"
    ]
  }
}
```

- [ ] **Step 2: Viết test thất bại**

```js
// tests/policy.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergePolicy, loadPolicy, loadDefaultPolicy, findProjectRoot, PolicyError }
  from '../lib/policy.mjs';

function repo(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'guardrail-'));
  mkdirSync(join(dir, '.git'));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return dir;
}

test('default policy có mọi nhóm rule', () => {
  const p = loadDefaultPolicy();
  for (const k of ['secrets','infra','git','convention','quality','net','deps','selfProtect']) {
    assert.ok(k in p, `thiếu nhóm ${k}`);
  }
});

test('mảng được hợp, không bị thay thế', () => {
  const out = mergePolicy(
    { infra: { denyBinaries: ['psql', 'aws'] } },
    { infra: { denyBinaries: ['mongosh', 'psql'] } }
  );
  assert.deepEqual(out.infra.denyBinaries, ['psql', 'aws', 'mongosh']);
});

test('object lồng merge đệ quy, mảng bên trong vẫn hợp', () => {
  const out = mergePolicy(
    { infra: { ssh: { denyHosts: ['a'], inspectRemoteCommand: true } } },
    { infra: { ssh: { denyHosts: ['b'] } } }
  );
  assert.deepEqual(out.infra.ssh.denyHosts, ['a', 'b']);
  assert.equal(out.infra.ssh.inspectRemoteCommand, true);
});

test('vô hướng bị ghi đè, chuỗi rỗng tắt rule', () => {
  const out = mergePolicy(
    { git: { commitMessagePattern: '^x' } },
    { git: { commitMessagePattern: '' } }
  );
  assert.equal(out.git.commitMessagePattern, '');
});

test('khoá mới của dự án được thêm vào', () => {
  const out = mergePolicy({ infra: {} }, { infra: { allowBinaries: ['psql'] } });
  assert.deepEqual(out.infra.allowBinaries, ['psql']);
});

test('findProjectRoot đi lên tới .git', () => {
  const dir = repo();
  mkdirSync(join(dir, 'src', 'deep'), { recursive: true });
  assert.equal(findProjectRoot(join(dir, 'src', 'deep')), dir);
});

test('không có codex-guardrail.json thì dùng default kèm cảnh báo', () => {
  const { policy, source, warnings } = loadPolicy(repo());
  assert.equal(source, null);
  assert.ok(warnings.length > 0);
  assert.ok(policy.infra.denyBinaries.includes('psql'));
});

test('projectRoot null thì dùng default kèm cảnh báo', () => {
  const { source, warnings } = loadPolicy(null);
  assert.equal(source, null);
  assert.ok(warnings.some(w => w.includes('.git')));
});

test('JSON sai cú pháp thì ném PolicyError, KHÔNG âm thầm dùng default', () => {
  const dir = repo({ 'codex-guardrail.json': '{ "infra": ' });
  assert.throws(() => loadPolicy(dir), PolicyError);
});

test('policy dự án merge vào, deny mặc định vẫn còn', () => {
  const dir = repo({
    'codex-guardrail.json': JSON.stringify({ infra: { allowBinaries: ['psql'] } })
  });
  const { policy, source } = loadPolicy(dir);
  assert.ok(source.endsWith('codex-guardrail.json'));
  assert.ok(policy.infra.allowBinaries.includes('psql'));
  assert.ok(policy.infra.denyBinaries.includes('psql'));
});
```

- [ ] **Step 3: Chạy test để xác nhận thất bại**

Run: `node --test tests/policy.test.mjs`
Expected: FAIL — `Cannot find module '../lib/policy.mjs'`

- [ ] **Step 4: Viết `lib/policy.mjs`**

```js
// lib/policy.mjs
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export class PolicyError extends Error {}

const DEFAULT_URL = new URL('../policy/default.json', import.meta.url);

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function mergeValue(cur, val) {
  if (Array.isArray(cur) && Array.isArray(val)) return [...new Set([...cur, ...val])];
  if (isPlainObject(cur) && isPlainObject(val)) {
    const out = { ...cur };
    for (const [k, v] of Object.entries(val)) out[k] = k in cur ? mergeValue(cur[k], v) : v;
    return out;
  }
  return val;
}

export function mergePolicy(base, override) {
  return mergeValue(base, override ?? {});
}

export function loadDefaultPolicy() {
  return JSON.parse(readFileSync(DEFAULT_URL, 'utf8'));
}

export function findProjectRoot(startDir) {
  let dir = resolve(startDir ?? '.');
  for (;;) {
    if (existsSync(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function loadPolicy(projectRoot) {
  const base = loadDefaultPolicy();
  if (!projectRoot) {
    return {
      policy: base,
      source: null,
      warnings: ['Không tìm được thư mục .git từ cwd — đang dùng policy mặc định.'],
    };
  }
  const file = join(projectRoot, 'codex-guardrail.json');
  if (!existsSync(file)) {
    return {
      policy: base,
      source: null,
      warnings: [`Không có ${file} — đang dùng policy mặc định. Chạy "guardrail init" để sinh.`],
    };
  }
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new PolicyError(`${file} sai cú pháp JSON: ${err.message}`);
  }
  return { policy: mergePolicy(base, raw), source: file, warnings: [] };
}
```

- [ ] **Step 5: Chạy test để xác nhận pass**

Run: `node --test tests/policy.test.mjs`
Expected: PASS, 10 test

- [ ] **Step 6: Commit**

```bash
git add lib/policy.mjs policy/default.json tests/policy.test.mjs
git commit -m "feat(policy): policy hai tầng, mảng hợp, JSON hỏng thì fail-closed"
```

---

### Task 4: `context.mjs` — dựng ctx từ payload Codex

**Files:**
- Create: `lib/context.mjs`
- Test: `tests/context.test.mjs`
- Read: `tests/fixtures/codex-events/*.json` (từ Task 0)

**Interfaces:**
- Consumes: `findProjectRoot` từ `lib/policy.mjs`; fixture từ Task 0
- Produces:
  - `class ContextError extends Error`
  - `buildContext(rawStdin: string, env: object) => Ctx`
  - `Ctx = { event, tool, command: string|null, patchFiles: string[], patchBody: string|null, stdout: string|null, cwd: string, projectRoot: string|null, escapes: Set<string> }`

`escapes` là tập `ruleId` lấy từ `env.CODEX_GUARDRAIL_ALLOW`, phân tách bằng dấu phẩy. Rule không tự đọc env — dispatcher (Task 10) dùng `escapes` để quyết định.

- [ ] **Step 1: Đối chiếu fixture thật với giả định**

Mở `tests/fixtures/codex-events/pretooluse-shell.json` và `pretooluse-apply-patch.json`, ghi lại tên khoá thật. Code dưới đọc nhiều tên thay thế nên thường không phải sửa; nếu fixture dùng tên khác hẳn thì **thêm** vào các mảng `*_KEYS`, không thay thế.

- [ ] **Step 2: Viết test thất bại**

```js
// tests/context.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildContext, ContextError } from '../lib/context.mjs';

const fixture = (n) =>
  readFileSync(new URL(`./fixtures/codex-events/${n}.json`, import.meta.url), 'utf8');

test('stdin rỗng thì ném ContextError (fail-closed)', () => {
  assert.throws(() => buildContext('', {}), ContextError);
  assert.throws(() => buildContext('   ', {}), ContextError);
});

test('JSON hỏng thì ném ContextError', () => {
  assert.throws(() => buildContext('{ "tool_name": ', {}), ContextError);
});

test('payload shell thật cho ra event, tool và command', () => {
  const ctx = buildContext(fixture('pretooluse-shell'), {});
  assert.equal(ctx.event, 'PreToolUse');
  assert.equal(ctx.tool, 'shell');
  assert.ok(typeof ctx.command === 'string' && ctx.command.length > 0);
});

test('payload apply_patch thật cho ra danh sách file', () => {
  const ctx = buildContext(fixture('pretooluse-apply-patch'), {});
  assert.equal(ctx.tool, 'apply_patch');
  assert.ok(ctx.patchFiles.length > 0, 'phải trích được ít nhất một file đích');
});

test('escape đọc từ env, phân tách bằng dấu phẩy', () => {
  const ctx = buildContext(fixture('pretooluse-shell'),
    { CODEX_GUARDRAIL_ALLOW: 'infra.deny-binary, git.no-verify' });
  assert.ok(ctx.escapes.has('infra.deny-binary'));
  assert.ok(ctx.escapes.has('git.no-verify'));
  assert.equal(ctx.escapes.size, 2);
});

test('không có env thì escapes rỗng', () => {
  assert.equal(buildContext(fixture('pretooluse-shell'), {}).escapes.size, 0);
});

test('trích file đích từ header apply_patch', () => {
  const payload = JSON.stringify({
    hook_event_name: 'PreToolUse',
    tool_name: 'apply_patch',
    cwd: '/tmp/demo-repo',
    tool_input: { patch: '*** Update File: src/a.ts\n@@\n-x\n+y\n*** Add File: src/b.ts\n' },
  });
  assert.deepEqual(buildContext(payload, {}).patchFiles.sort(), ['src/a.ts', 'src/b.ts']);
});

test('trích file đích từ unified diff, bỏ /dev/null', () => {
  const payload = JSON.stringify({
    hook_event_name: 'PreToolUse',
    tool_name: 'apply_patch',
    cwd: '/tmp/demo-repo',
    tool_input: { diff: '--- a/src/a.ts\n+++ b/src/a.ts\n--- x\n+++ /dev/null\n' },
  });
  assert.deepEqual(buildContext(payload, {}).patchFiles, ['src/a.ts']);
});
```

- [ ] **Step 3: Chạy test để xác nhận thất bại**

Run: `node --test tests/context.test.mjs`
Expected: FAIL — `Cannot find module '../lib/context.mjs'`

- [ ] **Step 4: Viết `lib/context.mjs`**

```js
// lib/context.mjs
import { findProjectRoot } from './policy.mjs';

export class ContextError extends Error {}

const COMMAND_KEYS = ['command', 'cmd', 'shell_command', 'script'];
const FILE_KEYS = ['file_path', 'path', 'filename', 'file'];
const PATCH_KEYS = ['patch', 'diff', 'content', 'input'];
const STDOUT_KEYS = ['stdout', 'output', 'result'];

function pick(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

// apply_patch dùng header "*** Update File: path" (cũng có Add/Delete/Move).
// Phủ thêm unified diff "+++ b/path" cho trường hợp Codex đẩy diff thuần.
function filesFromPatch(patch) {
  if (!patch) return [];
  const out = new Set();
  for (const line of patch.split('\n')) {
    let m = line.match(/^\*\*\*\s+(?:Update|Add|Delete|Move)\s+File:\s+(.+)$/);
    if (m) { out.add(m[1].trim()); continue; }
    m = line.match(/^\+\+\+\s+(?:b\/)?(.+)$/);
    if (m && m[1].trim() !== '/dev/null') out.add(m[1].trim());
  }
  return [...out];
}

export function buildContext(rawStdin, env = {}) {
  if (typeof rawStdin !== 'string' || rawStdin.trim() === '') {
    throw new ContextError('stdin rỗng — không xác định được tool call, fail-closed.');
  }
  let payload;
  try {
    payload = JSON.parse(rawStdin);
  } catch (err) {
    throw new ContextError(`stdin không phải JSON hợp lệ: ${err.message}`);
  }

  const input = payload.tool_input ?? payload.input ?? {};
  const cwd = payload.cwd ?? process.cwd();

  const patchBody = pick(input, PATCH_KEYS);
  const patchFiles = new Set(filesFromPatch(patchBody));
  const single = pick(input, FILE_KEYS);
  if (single) patchFiles.add(single);

  const escapes = new Set(
    String(env.CODEX_GUARDRAIL_ALLOW ?? '').split(',').map(s => s.trim()).filter(Boolean)
  );

  return {
    event: payload.hook_event_name ?? payload.event ?? 'unknown',
    tool: payload.tool_name ?? payload.tool ?? 'unknown',
    command: pick(input, COMMAND_KEYS),
    patchFiles: [...patchFiles],
    patchBody,
    stdout: pick(payload, STDOUT_KEYS) ?? pick(payload.tool_response ?? {}, STDOUT_KEYS),
    cwd,
    projectRoot: findProjectRoot(cwd),
    escapes,
  };
}
```

- [ ] **Step 5: Chạy test để xác nhận pass**

Run: `node --test tests/context.test.mjs`
Expected: PASS, 8 test. Nếu hai test đọc fixture thất bại vì tên khoá lệch, thêm tên khoá thật vào `COMMAND_KEYS` / `PATCH_KEYS` / `FILE_KEYS` rồi chạy lại.

- [ ] **Step 6: Commit**

```bash
git add lib/context.mjs tests/context.test.mjs
git commit -m "feat(context): dựng ctx từ payload Codex, stdin rỗng hoặc hỏng thì fail-closed"
```

---

### Task 5: `redact.mjs` và `audit.mjs`

**Files:**
- Create: `lib/redact.mjs`
- Create: `lib/audit.mjs`
- Test: `tests/redact.test.mjs`
- Test: `tests/audit.test.mjs`

**Interfaces:**
- Consumes: không
- Produces:
  - `redact(text: string) => string`
  - `findSecretKinds(text: string) => string[]` — tên loại secret phát hiện được, dùng cho `redact.stdout` ở Plan 2
  - `auditPath() => string`
  - `record(entry: { decision, ruleId, event, tool, repo, branch, command }) => void`
  - `readEntries() => object[]`

`record` **không bao giờ ném** — ghi log thất bại không được chặn công việc của dev. Nó tự `redact` trường `command`.

- [ ] **Step 1: Viết test thất bại cho redact**

```js
// tests/redact.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { redact, findSecretKinds } from '../lib/redact.mjs';

test('che AWS access key id', () => {
  const out = redact('aws key AKIAIOSFODNN7EXAMPLE done');
  assert.ok(!out.includes('AKIAIOSFODNN7EXAMPLE'));
  assert.ok(out.includes('AKIA***'));
});

test('che OpenAI-style key', () => {
  assert.ok(!redact('sk-abcdefghijklmnopqrstuvwxyz0123').includes('abcdefghij'));
});

test('che GitHub token', () => {
  assert.ok(!redact('ghp_abcdefghijklmnopqrstuvwxyz0123').includes('abcdefghij'));
});

test('che JWT', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcDEF123';
  assert.ok(!redact(`token ${jwt}`).includes('eyJzdWIi'));
});

test('che private key block', () => {
  const pem = '-----BEGIN RSA PRIVATE KEY-----\nAAAA\n-----END RSA PRIVATE KEY-----';
  assert.equal(redact(pem), '***private-key***');
});

test('không đụng text vô hại', () => {
  assert.equal(redact('psql -h localhost -U app'), 'psql -h localhost -U app');
});

test('findSecretKinds trả tên loại', () => {
  assert.deepEqual(findSecretKinds('AKIAIOSFODNN7EXAMPLE'), ['aws-access-key-id']);
  assert.deepEqual(findSecretKinds('không có gì'), []);
});

test('chuỗi rỗng hoặc null an toàn', () => {
  assert.equal(redact(''), '');
  assert.equal(redact(null), '');
});
```

- [ ] **Step 2: Chạy test để xác nhận thất bại**

Run: `node --test tests/redact.test.mjs`
Expected: FAIL — `Cannot find module '../lib/redact.mjs'`

- [ ] **Step 3: Viết `lib/redact.mjs`**

```js
// lib/redact.mjs
const PATTERNS = [
  { kind: 'aws-access-key-id', re: /AKIA[0-9A-Z]{16}/g, mask: 'AKIA***' },
  { kind: 'openai-key', re: /\bsk-[A-Za-z0-9_-]{20,}/g, mask: 'sk-***' },
  { kind: 'github-token', re: /\b(?:ghp|gho|ghu|ghs)_[A-Za-z0-9]{20,}/g, mask: 'gh_***' },
  { kind: 'github-pat', re: /\bgithub_pat_[A-Za-z0-9_]{20,}/g, mask: 'github_pat_***' },
  { kind: 'slack-token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g, mask: 'xox_***' },
  {
    kind: 'jwt',
    re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/g,
    mask: 'jwt.***',
  },
  {
    kind: 'private-key',
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    mask: '***private-key***',
  },
];

export function redact(text) {
  let out = String(text ?? '');
  for (const { re, mask } of PATTERNS) out = out.replace(re, mask);
  return out;
}

export function findSecretKinds(text) {
  const s = String(text ?? '');
  return PATTERNS.filter(({ re }) => new RegExp(re.source).test(s)).map(p => p.kind);
}
```

- [ ] **Step 4: Chạy test redact để xác nhận pass**

Run: `node --test tests/redact.test.mjs`
Expected: PASS, 8 test

- [ ] **Step 5: Viết test thất bại cho audit**

```js
// tests/audit.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function freshAudit() {
  const dir = mkdtempSync(join(tmpdir(), 'guardrail-audit-'));
  process.env.GUARDRAIL_AUDIT_PATH = join(dir, 'audit.jsonl');
  return process.env.GUARDRAIL_AUDIT_PATH;
}

test('ghi một dòng JSONL có ts và ruleId', async () => {
  const p = freshAudit();
  const { record } = await import('../lib/audit.mjs');
  record({ decision: 'denied', ruleId: 'infra.deny-binary', event: 'PreToolUse',
           tool: 'shell', repo: 'demo', branch: 'feat/x', command: 'psql -l' });
  const lines = readFileSync(p, 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  const e = JSON.parse(lines[0]);
  assert.equal(e.ruleId, 'infra.deny-binary');
  assert.equal(e.decision, 'denied');
  assert.ok(typeof e.ts === 'string' && e.ts.includes('T'));
});

test('command được redact trước khi ghi', async () => {
  const p = freshAudit();
  const { record } = await import('../lib/audit.mjs');
  record({ decision: 'denied', ruleId: 'x',
           command: 'curl -H "Bearer sk-abcdefghijklmnopqrstuvwxyz01"' });
  assert.ok(!readFileSync(p, 'utf8').includes('abcdefghij'));
});

test('nối thêm dòng, không ghi đè', async () => {
  const p = freshAudit();
  const { record } = await import('../lib/audit.mjs');
  record({ decision: 'denied', ruleId: 'a' });
  record({ decision: 'escaped', ruleId: 'b' });
  assert.equal(readFileSync(p, 'utf8').trim().split('\n').length, 2);
});

test('đường dẫn không ghi được thì KHÔNG ném', async () => {
  process.env.GUARDRAIL_AUDIT_PATH = '/khong-ton-tai-chac-chan/audit.jsonl';
  const { record } = await import('../lib/audit.mjs');
  assert.doesNotThrow(() => record({ decision: 'denied', ruleId: 'x' }));
});

test('readEntries bỏ qua dòng hỏng', async () => {
  const p = freshAudit();
  const { record, readEntries } = await import('../lib/audit.mjs');
  record({ decision: 'denied', ruleId: 'a' });
  appendFileSync(p, 'không phải json\n');
  record({ decision: 'denied', ruleId: 'b' });
  assert.equal(readEntries().length, 2);
});
```

- [ ] **Step 6: Viết `lib/audit.mjs`**

```js
// lib/audit.mjs
import { appendFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { redact } from './redact.mjs';

export function auditPath() {
  return process.env.GUARDRAIL_AUDIT_PATH
    ?? join(homedir(), '.codex', 'guardrail-audit.jsonl');
}

export function record(entry) {
  try {
    const payload = { ts: new Date().toISOString(), ...entry };
    if (payload.command) payload.command = redact(payload.command);
    const p = auditPath();
    mkdirSync(dirname(p), { recursive: true });
    appendFileSync(p, JSON.stringify(payload) + '\n');
  } catch {
    // Ghi log thất bại không được chặn công việc của dev.
  }
}

export function readEntries() {
  const p = auditPath();
  if (!existsSync(p)) return [];
  const out = [];
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* bỏ dòng hỏng */ }
  }
  return out;
}
```

- [ ] **Step 7: Chạy test audit để xác nhận pass**

Run: `node --test tests/audit.test.mjs`
Expected: PASS, 5 test

- [ ] **Step 8: Commit**

```bash
git add lib/redact.mjs lib/audit.mjs tests/redact.test.mjs tests/audit.test.mjs
git commit -m "feat(audit): log JSONL đã redact, ghi lỗi không chặn công việc"
```

---

### Task 6: Rule `secrets`

**Files:**
- Create: `lib/rules/secrets.mjs`
- Test: `tests/rules/secrets.test.mjs`

**Interfaces:**
- Consumes: `parseCommand`, `basename` (Task 1); `globToRegExp`, `normalizePath`, `matchesAny`, `ALLOW`, `deny` (Task 2)
- Produces: `evaluate(ctx, policy) => Result` với `ruleId ∈ { 'secrets.read-path', 'secrets.write-path', 'secrets.env-dump', 'secrets.manager-read' }`

- [ ] **Step 1: Viết test thất bại**

```js
// tests/rules/secrets.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../../lib/rules/secrets.mjs';
import { loadDefaultPolicy } from '../../lib/policy.mjs';

const P = loadDefaultPolicy();
const shell = (command) => ({ tool: 'shell', command, patchFiles: [] });
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
  assert.equal(evaluate({ tool: 'shell', command: null, patchFiles: [] }, P).decision, 'allow');
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
```

- [ ] **Step 2: Chạy test để xác nhận thất bại**

Run: `node --test tests/rules/secrets.test.mjs`
Expected: FAIL — `Cannot find module '../../lib/rules/secrets.mjs'`

- [ ] **Step 3: Viết `lib/rules/secrets.mjs`**

```js
// lib/rules/secrets.mjs
import { parseCommand, basename } from '../tokenize.mjs';
import { globToRegExp, normalizePath, matchesAny } from '../glob.mjs';
import { ALLOW, deny } from '../result.mjs';

const ENV_DUMP = new Set(['env', 'printenv', 'set']);

const MANAGER_READ = [
  /\baws\s+secretsmanager\s+get-secret-value\b/,
  /\bgcloud\s+secrets\s+versions\s+access\b/,
  /\bvault\s+read\b/,
  /\bop\s+read\b/,
  /\bkubectl\s+get\s+secret\b/,
];

const HINT = 'Nếu thật sự cần, dùng .env.example, hoặc thêm đường dẫn vào '
  + 'secrets.allowPaths trong codex-guardrail.json (file có CODEOWNERS).';

export function evaluate(ctx, policy) {
  const cfg = policy.secrets ?? {};
  const denyRes = (cfg.denyPaths ?? []).map(globToRegExp);
  const allowRes = (cfg.allowPaths ?? []).map(globToRegExp);
  if (denyRes.length === 0) return ALLOW;

  const isSensitive = (token) => {
    const p = normalizePath(token);
    if (matchesAny(p, allowRes)) return false;
    return matchesAny(p, denyRes);
  };

  if (ctx.tool === 'apply_patch') {
    for (const f of ctx.patchFiles ?? []) {
      if (isSensitive(f)) {
        return deny('secrets.write-path',
          `apply_patch định ghi vào file nhạy cảm "${f}".`, HINT);
      }
    }
    return ALLOW;
  }

  if (!ctx.command) return ALLOW;

  for (const sub of parseCommand(ctx.command)) {
    const bin = basename(sub.argv[0]);
    if (ENV_DUMP.has(bin) && sub.argv.length === 1) {
      return deny('secrets.env-dump',
        `"${bin}" không tham số sẽ xả toàn bộ biến môi trường, trong đó có thể có secret.`,
        'Đọc đúng biến cần dùng, ví dụ: printenv PATH');
    }
    for (const token of sub.argv.slice(1)) {
      if (isSensitive(token)) {
        return deny('secrets.read-path',
          `Lệnh chạm đường dẫn nhạy cảm "${token}".`, HINT);
      }
    }
  }

  for (const re of MANAGER_READ) {
    if (re.test(ctx.command)) {
      return deny('secrets.manager-read',
        'Lệnh đọc secret từ secret manager.',
        'Lấy giá trị đó bằng tay ngoài phiên Codex, hoặc dùng biến môi trường đã inject sẵn.');
    }
  }

  return ALLOW;
}
```

- [ ] **Step 4: Chạy test để xác nhận pass**

Run: `node --test tests/rules/secrets.test.mjs`
Expected: PASS, 10 test

- [ ] **Step 5: Commit**

```bash
git add lib/rules/secrets.mjs tests/rules/secrets.test.mjs
git commit -m "feat(rule/secrets): chặn theo đường dẫn thay vì theo động từ đọc file"
```

---

### Task 7: Rule `infra`

**Files:**
- Create: `lib/rules/infra.mjs`
- Test: `tests/rules/infra.test.mjs`

**Interfaces:**
- Consumes: `parseCommand`, `basename` (Task 1); `globToRegExp`, `normalizePath`, `matchesAny`, `ALLOW`, `deny` (Task 2)
- Produces: `evaluate(ctx, policy) => Result` với `ruleId ∈ { 'infra.deny-binary', 'infra.deny-pattern', 'infra.ssh-deny-host', 'infra.ssh-remote-command' }`

`ssh` và `scp` **không** nằm trong `denyBinaries`; chúng đi qua nhánh riêng: chặn theo `denyHosts`, rồi soi phần lệnh chạy trên host bằng chính deny-list infra. Chống đệ quy vô hạn bằng cách tắt `inspectRemoteCommand` ở lần gọi lồng.

- [ ] **Step 1: Viết test thất bại**

```js
// tests/rules/infra.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../../lib/rules/infra.mjs';
import { loadDefaultPolicy, mergePolicy } from '../../lib/policy.mjs';

const P = loadDefaultPolicy();
const shell = (command) => ({ tool: 'shell', command, patchFiles: [] });

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
  assert.equal(evaluate({ tool: 'shell', command: null, patchFiles: [] }, P).decision, 'allow');
});

test('message deny nêu tên binary và cách nới', () => {
  const r = evaluate(shell('psql -l'), P);
  assert.ok(r.reason.includes('psql'));
  assert.ok(r.hint.includes('allowBinaries'));
});
```

- [ ] **Step 2: Chạy test để xác nhận thất bại**

Run: `node --test tests/rules/infra.test.mjs`
Expected: FAIL — `Cannot find module '../../lib/rules/infra.mjs'`

- [ ] **Step 3: Viết `lib/rules/infra.mjs`**

```js
// lib/rules/infra.mjs
import { parseCommand, basename } from '../tokenize.mjs';
import { globToRegExp, normalizePath, matchesAny } from '../glob.mjs';
import { ALLOW, deny } from '../result.mjs';

const SSH_BINS = new Set(['ssh', 'scp']);

// Flag của ssh nhận một giá trị đứng sau — phải bỏ qua khi đi tìm token host.
const SSH_FLAGS_WITH_VALUE = new Set([
  '-p', '-i', '-o', '-F', '-l', '-J', '-b', '-c', '-D', '-E', '-e',
  '-I', '-L', '-m', '-O', '-Q', '-R', '-S', '-W', '-w',
]);

function stripUser(host) {
  return host.replace(/^[^@]*@/, '');
}

function sshParts(argv) {
  let i = 1;
  while (i < argv.length) {
    const a = argv[i];
    if (SSH_FLAGS_WITH_VALUE.has(a)) { i += 2; continue; }
    if (a.startsWith('-')) { i += 1; continue; }
    break;
  }
  const target = argv[i] ? stripUser(argv[i]) : null;
  const remote = argv.slice(i + 1).join(' ').trim();
  return { target, remote: remote.length > 0 ? remote : null };
}

function scpHosts(argv) {
  return argv
    .slice(1)
    .filter(a => !a.startsWith('-') && a.includes(':'))
    .map(a => stripUser(a.split(':')[0]))
    .filter(Boolean);
}

const HINT_BINARY = 'Nếu dự án thật sự cần công cụ này, thêm nó vào '
  + 'infra.allowBinaries trong codex-guardrail.json rồi mở PR (file có CODEOWNERS).';

export function evaluate(ctx, policy) {
  if (!ctx.command) return ALLOW;

  const cfg = policy.infra ?? {};
  const denyBin = new Set(cfg.denyBinaries ?? []);
  const allowBin = new Set(cfg.allowBinaries ?? []);
  const sshCfg = cfg.ssh ?? {};
  const denyHostRes = (sshCfg.denyHosts ?? []).map(globToRegExp);

  for (const src of cfg.denyPatterns ?? []) {
    if (new RegExp(src).test(ctx.command)) {
      return deny('infra.deny-pattern',
        `Lệnh khớp mẫu bị chặn "${src}" — đây là thao tác không hoàn tác được.`,
        'Làm thủ công ngoài phiên Codex nếu thật sự cần.');
    }
  }

  for (const sub of parseCommand(ctx.command)) {
    const bin = basename(sub.argv[0]);

    if (SSH_BINS.has(bin)) {
      const hosts = bin === 'scp' ? scpHosts(sub.argv) : [sshParts(sub.argv).target];
      for (const host of hosts) {
        if (host && matchesAny(normalizePath(host), denyHostRes)) {
          return deny('infra.ssh-deny-host',
            `Host "${host}" nằm trong infra.ssh.denyHosts — không được chạm, kể cả chỉ để xem.`,
            'Nếu đây là host an toàn, sửa infra.ssh.denyHosts trong codex-guardrail.json.');
        }
      }

      if (bin === 'ssh' && sshCfg.inspectRemoteCommand !== false) {
        const { remote } = sshParts(sub.argv);
        if (remote) {
          const inner = evaluate(
            { ...ctx, tool: 'shell', command: remote },
            { ...policy, infra: { ...cfg, ssh: { ...sshCfg, inspectRemoteCommand: false } } }
          );
          if (inner.decision === 'deny') {
            return deny('infra.ssh-remote-command',
              `Lệnh chạy trên host qua ssh vi phạm ${inner.ruleId}: ${inner.reason}`,
              inner.hint);
          }
        }
      }
      continue;
    }

    if (denyBin.has(bin) && !allowBin.has(bin)) {
      return deny('infra.deny-binary',
        `"${bin}" là công cụ thao tác database/cloud — Codex không được tự chạy.`,
        HINT_BINARY);
    }
  }

  return ALLOW;
}
```

- [ ] **Step 4: Chạy test để xác nhận pass**

Run: `node --test tests/rules/infra.test.mjs`
Expected: PASS, 14 test

- [ ] **Step 5: Commit**

```bash
git add lib/rules/infra.mjs tests/rules/infra.test.mjs
git commit -m "feat(rule/infra): deny-list db/cloud + ssh chặn theo host và soi lệnh remote"
```

---

### Task 8: Rule `git-workflow`

**Files:**
- Create: `lib/rules/git-workflow.mjs`
- Test: `tests/rules/git-workflow.test.mjs`

**Interfaces:**
- Consumes: `parseCommand`, `basename` (Task 1); `globToRegExp`, `matchesAny`, `ALLOW`, `deny` (Task 2)
- Produces:
  - `evaluate(ctx, policy, deps?) => Result` với `deps = { currentBranch?: (cwd) => string|null }`
  - `currentBranch(cwd: string) => string | null` — export riêng để dispatcher tái dùng khi ghi audit log

`ruleId ∈ { 'git.pr-merge', 'git.no-verify', 'git.dangerous-flag', 'git.commit-message', 'git.protected-branch' }`.

Thứ tự kiểm: các kiểm dựa trên argv (rẻ) trước, `git.protected-branch` sau cùng vì nó phải spawn `git`.

- [ ] **Step 1: Viết test thất bại**

```js
// tests/rules/git-workflow.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../../lib/rules/git-workflow.mjs';
import { loadDefaultPolicy, mergePolicy } from '../../lib/policy.mjs';

const P = loadDefaultPolicy();
const shell = (command) => ({ tool: 'shell', command, patchFiles: [], cwd: '/tmp/demo' });
const onBranch = (b) => ({ currentBranch: () => b });

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
```

- [ ] **Step 2: Chạy test để xác nhận thất bại**

Run: `node --test tests/rules/git-workflow.test.mjs`
Expected: FAIL — `Cannot find module '../../lib/rules/git-workflow.mjs'`

- [ ] **Step 3: Viết `lib/rules/git-workflow.mjs`**

```js
// lib/rules/git-workflow.mjs
import { execFileSync } from 'node:child_process';
import { parseCommand, basename } from '../tokenize.mjs';
import { globToRegExp, matchesAny } from '../glob.mjs';
import { ALLOW, deny } from '../result.mjs';

export function currentBranch(cwd) {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || null;
  } catch {
    return null;
  }
}

const FORCE_FLAGS = ['--force', '-f', '--force-with-lease', '--delete'];

export function evaluate(ctx, policy, deps = {}) {
  if (!ctx.command) return ALLOW;
  const cfg = policy.git ?? {};
  const branchOf = deps.currentBranch ?? currentBranch;

  const gitSubs = parseCommand(ctx.command).filter(s => {
    const b = basename(s.argv[0]);
    return b === 'git' || b === 'gh';
  });
  if (gitSubs.length === 0) return ALLOW;

  let needsBranchCheck = false;

  for (const sub of gitSubs) {
    const bin = basename(sub.argv[0]);
    const args = sub.argv.slice(1);
    const verb = args.find(a => !a.startsWith('-')) ?? '';
    const has = (f) => args.includes(f);

    if (bin === 'gh') {
      if (verb === 'pr' && args.includes('merge')) {
        return deny('git.pr-merge',
          'gh pr merge sẽ merge PR mà không đi qua review của người.',
          'Để người merge trên giao diện GitHub sau khi review.');
      }
      continue;
    }

    if (has('--no-verify')) {
      return deny('git.no-verify',
        '--no-verify bỏ qua git hook của dự án, tức bỏ qua chính lớp kiểm tra trước commit.',
        'Sửa cho hook chạy xanh thay vì bỏ qua nó.');
    }

    if (verb === 'push' && FORCE_FLAGS.some(has)) {
      return deny('git.dangerous-flag',
        'push kèm --force / --force-with-lease / --delete ghi đè lịch sử trên remote.',
        'Nếu cần sửa lịch sử, làm thủ công và tự chịu trách nhiệm ngoài phiên Codex.');
    }
    if (verb === 'reset' && has('--hard')) {
      return deny('git.dangerous-flag',
        'reset --hard xoá thay đổi chưa commit, không lấy lại được.',
        'Dùng git stash nếu chỉ muốn dọn tạm.');
    }
    if (verb === 'clean' && args.some(a => /^-[a-z]*f/.test(a) && /d/.test(a))) {
      return deny('git.dangerous-flag',
        'clean -fd xoá vĩnh viễn file chưa được track.',
        'Xem trước bằng git clean -nd rồi tự xoá thủ công.');
    }
    if (verb === 'filter-branch') {
      return deny('git.dangerous-flag',
        'filter-branch viết lại toàn bộ lịch sử.',
        'Việc này phải do người làm, có thông báo cho cả team.');
    }
    if (verb === 'tag' && has('-d')) {
      return deny('git.dangerous-flag',
        'tag -d xoá tag, có thể phá bản release đã pin.',
        'Xoá tag là việc của người phụ trách release.');
    }

    if (verb === 'commit' && has('-m') && (cfg.commitMessagePattern ?? '') !== '') {
      const msg = args[args.indexOf('-m') + 1] ?? '';
      if (!new RegExp(cfg.commitMessagePattern).test(msg)) {
        return deny('git.commit-message',
          `Message "${msg}" không khớp quy ước commit của dự án.`,
          'Dùng conventional commits, ví dụ: feat(api): thêm endpoint tạo đơn');
      }
    }

    if (verb === 'commit' || verb === 'push') needsBranchCheck = true;
  }

  if (needsBranchCheck) {
    const protectedRes = (cfg.protectedBranches ?? []).map(globToRegExp);
    const branch = branchOf(ctx.cwd);
    if (branch && matchesAny(branch, protectedRes)) {
      return deny('git.protected-branch',
        `Đang đứng trên branch được bảo vệ "${branch}" — không commit/push trực tiếp.`,
        'Tạo feature branch: git switch -c feat/<tên-việc> rồi commit lại.');
    }
  }

  return ALLOW;
}
```

- [ ] **Step 4: Chạy test để xác nhận pass**

Run: `node --test tests/rules/git-workflow.test.mjs`
Expected: PASS, 12 test

- [ ] **Step 5: Commit**

```bash
git add lib/rules/git-workflow.mjs tests/rules/git-workflow.test.mjs
git commit -m "feat(rule/git): chặn branch bảo vệ, cờ nguy hiểm, no-verify, message sai quy ước"
```

---

### Task 9: Rule `self-protect`

Không có rule này thì mọi rule khác chỉ là gợi ý — Codex bị chặn có thể tự nới policy hoặc tháo hook.

**Files:**
- Create: `lib/rules/self-protect.mjs`
- Test: `tests/rules/self-protect.test.mjs`

**Interfaces:**
- Consumes: `parseCommand`, `basename` (Task 1); `globToRegExp`, `normalizePath`, `matchesAny`, `ALLOW`, `deny` (Task 2)
- Produces: `evaluate(ctx, policy) => Result` với `ruleId ∈ { 'selfprotect.escape-inline', 'selfprotect.policy-file' }`

Phân biệt đọc và ghi: **đọc** policy của chính mình là việc bình thường và hữu ích, **ghi** thì không. Rule chỉ chặn khi đường dẫn được bảo vệ đi kèm dấu hiệu ghi — redirection `>` / `>>`, hoặc binary có tác dụng ghi.

- [ ] **Step 1: Viết test thất bại**

```js
// tests/rules/self-protect.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../../lib/rules/self-protect.mjs';
import { loadDefaultPolicy } from '../../lib/policy.mjs';

const P = loadDefaultPolicy();
const shell = (command) => ({ tool: 'shell', command, patchFiles: [] });
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
  assert.equal(evaluate(patch(['~/.codex/hooks.json']), P).ruleId, 'selfprotect.policy-file');
  assert.equal(evaluate(patch(['~/.codex/config.toml']), P).ruleId, 'selfprotect.policy-file');
});

test('chặn ghi qua redirection', () => {
  assert.equal(evaluate(shell('echo "{}" > codex-guardrail.json'), P).ruleId,
    'selfprotect.policy-file');
  assert.equal(evaluate(shell('echo x >> ~/.codex/hooks.json'), P).ruleId,
    'selfprotect.policy-file');
});

test('chặn ghi qua binary có tác dụng ghi', () => {
  for (const cmd of ['sed -i s/a/b/ codex-guardrail.json',
                     'rm codex-guardrail.json',
                     'mv other.json codex-guardrail.json',
                     'tee codex-guardrail.json']) {
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
  assert.equal(evaluate({ tool: 'shell', command: null, patchFiles: [] }, P).decision, 'allow');
});
```

- [ ] **Step 2: Chạy test để xác nhận thất bại**

Run: `node --test tests/rules/self-protect.test.mjs`
Expected: FAIL — `Cannot find module '../../lib/rules/self-protect.mjs'`

- [ ] **Step 3: Viết `lib/rules/self-protect.mjs`**

```js
// lib/rules/self-protect.mjs
import { parseCommand, basename } from '../tokenize.mjs';
import { globToRegExp, normalizePath, matchesAny } from '../glob.mjs';
import { ALLOW, deny } from '../result.mjs';

const WRITE_BINS = new Set([
  'tee', 'sed', 'mv', 'cp', 'rm', 'truncate', 'install', 'ln', 'dd', 'patch',
]);

const HINT = 'Nới policy là việc của người: sửa codex-guardrail.json rồi mở PR — '
  + 'file này có CODEOWNERS nên lead phải duyệt.';

export function evaluate(ctx, policy) {
  const patterns = (policy.selfProtect?.protectedPaths ?? []).map(globToRegExp);
  if (patterns.length === 0) return ALLOW;
  const isProtected = (t) => matchesAny(normalizePath(t), patterns);

  if (ctx.tool === 'apply_patch') {
    for (const f of ctx.patchFiles ?? []) {
      if (isProtected(f)) {
        return deny('selfprotect.policy-file',
          `apply_patch định sửa "${f}" — đây là file cấu hình chính guardrail.`, HINT);
      }
    }
    return ALLOW;
  }

  if (!ctx.command) return ALLOW;

  if (ctx.command.includes('CODEX_GUARDRAIL_ALLOW')) {
    return deny('selfprotect.escape-inline',
      'Lệnh tự đặt CODEX_GUARDRAIL_ALLOW — agent không được tự phát escape cho chính nó.',
      'Escape chỉ hợp lệ khi người export biến này trong shell trước khi mở Codex.');
  }

  for (const sub of parseCommand(ctx.command)) {
    const bin = basename(sub.argv[0]);
    const redirect = sub.raw.match(/>>?\s*(\S+)/);
    if (redirect && isProtected(redirect[1])) {
      return deny('selfprotect.policy-file',
        `Lệnh định ghi vào "${redirect[1]}" — đây là file cấu hình chính guardrail.`, HINT);
    }
    if (!WRITE_BINS.has(bin)) continue;
    for (const token of sub.argv.slice(1)) {
      if (isProtected(token)) {
        return deny('selfprotect.policy-file',
          `Lệnh định ghi vào "${token}" — đây là file cấu hình chính guardrail.`, HINT);
      }
    }
  }

  return ALLOW;
}
```

- [ ] **Step 4: Chạy test để xác nhận pass**

Run: `node --test tests/rules/self-protect.test.mjs`
Expected: PASS, 8 test

- [ ] **Step 5: Commit**

```bash
git add lib/rules/self-protect.mjs tests/rules/self-protect.test.mjs
git commit -m "feat(rule/selfprotect): chặn sửa policy, tháo hook, và agent tự phát escape"
```

---

### Task 10: Dispatcher `bin/guardrail.mjs`

**Files:**
- Create: `lib/dispatch.mjs`
- Create: `bin/guardrail.mjs`
- Test: `tests/dispatch.test.mjs`
- Test: `tests/cli-hook.test.mjs`

**Interfaces:**
- Consumes: mọi module ở Task 1–9
- Produces:
  - `runHook(rawStdin: string, env: object) => { code: number, stderr: string }` — hàm thuần để test, không `exit`
  - `denyMessage(result, ctx) => string`
  - `bin/guardrail.mjs` — subcommand `hook`; các subcommand khác thêm ở Task 11–12

Thứ tự rule: `selfprotect` → `secrets` → `infra` → `git`. Rẻ và quan trọng nhất trước; `git` sau cùng vì có thể spawn `git`.

**Một lệch có ý thức so với spec §10:** spec nói "không có `codex-guardrail.json` → cảnh báo một lần mỗi session". Hook là tiến trình sống ngắn, không giữ được trạng thái "đã cảnh báo trong session này", nên in ra sẽ thành cảnh báo ở **mọi** tool call — nhiễu tới mức dev sẽ học cách bỏ qua stderr của guardrail, làm hỏng luôn message chặn thật. Vì vậy `runHook` **bỏ** `warnings` của `loadPolicy`, và `guardrail doctor` (Task 12) là chỗ báo việc đang chạy policy mặc định. Nếu sau này Codex cho hook giữ state theo session thì đưa cảnh báo trở lại đúng như spec.

- [ ] **Step 1: Viết test thất bại cho `runHook`**

```js
// tests/dispatch.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runHook, denyMessage } from '../lib/dispatch.mjs';

function repo(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'guardrail-dispatch-'));
  mkdirSync(join(dir, '.git'));
  for (const [n, b] of Object.entries(files)) writeFileSync(join(dir, n), b);
  process.env.GUARDRAIL_AUDIT_PATH = join(dir, 'audit.jsonl');
  return dir;
}

const payload = (cwd, command) => JSON.stringify({
  hook_event_name: 'PreToolUse', tool_name: 'shell', cwd,
  tool_input: { command },
});

test('lệnh vô hại thì exit 0 và không in gì', () => {
  const r = runHook(payload(repo(), 'npm test'), {});
  assert.equal(r.code, 0);
  assert.equal(r.stderr, '');
});

test('lệnh vi phạm thì exit 2 và stderr nói đủ ba điều', () => {
  const r = runHook(payload(repo(), 'psql -l'), {});
  assert.equal(r.code, 2);
  assert.ok(r.stderr.includes('infra.deny-binary'));
  assert.ok(r.stderr.includes('Vì sao'));
  assert.ok(r.stderr.includes('Làm gì tiếp'));
  assert.ok(r.stderr.includes('CODEX_GUARDRAIL_ALLOW=infra.deny-binary'));
});

test('stdin rỗng thì exit 3 (fail-closed)', () => {
  const r = runHook('', {});
  assert.equal(r.code, 3);
  assert.ok(r.stderr.includes('fail-closed'));
});

test('policy hỏng thì exit 3, KHÔNG âm thầm dùng default', () => {
  const dir = repo({ 'codex-guardrail.json': '{ "infra": ' });
  const r = runHook(payload(dir, 'npm test'), {});
  assert.equal(r.code, 3);
  assert.ok(r.stderr.includes('codex-guardrail.json'));
});

test('escape đúng ruleId thì cho qua và cảnh báo', () => {
  const r = runHook(payload(repo(), 'psql -l'), { CODEX_GUARDRAIL_ALLOW: 'infra.deny-binary' });
  assert.equal(r.code, 0);
  assert.ok(r.stderr.includes('bị bỏ qua'));
});

test('escape sai ruleId thì vẫn chặn', () => {
  const r = runHook(payload(repo(), 'psql -l'), { CODEX_GUARDRAIL_ALLOW: 'git.no-verify' });
  assert.equal(r.code, 2);
});

test('escape không nhận wildcard', () => {
  const r = runHook(payload(repo(), 'psql -l'), { CODEX_GUARDRAIL_ALLOW: '*' });
  assert.equal(r.code, 2);
});

test('event hoặc tool không khai rule thì exit 0 ngay', () => {
  const raw = JSON.stringify({
    hook_event_name: 'PreCompact', tool_name: 'whatever', cwd: '/tmp', tool_input: {},
  });
  assert.equal(runHook(raw, {}).code, 0);
});

test('selfprotect chạy trước infra', () => {
  const r = runHook(payload(repo(), 'CODEX_GUARDRAIL_ALLOW=x psql -l'), {});
  assert.ok(r.stderr.includes('selfprotect.escape-inline'));
});

test('denyMessage giữ đúng khuôn (golden)', () => {
  const msg = denyMessage(
    { ruleId: 'infra.deny-binary', reason: 'LÝ DO', hint: 'GỢI Ý' }, {}
  );
  assert.equal(msg,
`✗ guardrail chặn: infra.deny-binary

  Vì sao: LÝ DO
  Làm gì tiếp: GỢI Ý

  Escape một lần (người gõ, không phải agent):
    export CODEX_GUARDRAIL_ALLOW=infra.deny-binary
  Nới vĩnh viễn: thêm vào codex-guardrail.json rồi mở PR (file có CODEOWNERS).
`);
});
```

- [ ] **Step 2: Chạy test để xác nhận thất bại**

Run: `node --test tests/dispatch.test.mjs`
Expected: FAIL — `Cannot find module '../lib/dispatch.mjs'`

- [ ] **Step 3: Viết `lib/dispatch.mjs`**

```js
// lib/dispatch.mjs
import { basename as pathBasename } from 'node:path';
import { buildContext, ContextError } from './context.mjs';
import { loadPolicy, PolicyError } from './policy.mjs';
import { record } from './audit.mjs';
import * as selfProtect from './rules/self-protect.mjs';
import * as secrets from './rules/secrets.mjs';
import * as infra from './rules/infra.mjs';
import * as gitWorkflow from './rules/git-workflow.mjs';
import { currentBranch } from './rules/git-workflow.mjs';

const SAFETY_GROUPS = new Set(['selfprotect', 'secrets', 'infra', 'git']);

const REGISTRY = {
  PreToolUse: {
    shell: [
      ['selfprotect', selfProtect],
      ['secrets', secrets],
      ['infra', infra],
      ['git', gitWorkflow],
    ],
    apply_patch: [
      ['selfprotect', selfProtect],
      ['secrets', secrets],
    ],
  },
};

export function denyMessage(result, _ctx) {
  return `✗ guardrail chặn: ${result.ruleId}

  Vì sao: ${result.reason}
  Làm gì tiếp: ${result.hint}

  Escape một lần (người gõ, không phải agent):
    export CODEX_GUARDRAIL_ALLOW=${result.ruleId}
  Nới vĩnh viễn: thêm vào codex-guardrail.json rồi mở PR (file có CODEOWNERS).
`;
}

function failClosed(err) {
  return {
    code: 3,
    stderr: `✗ guardrail fail-closed: ${err.message}\n`
      + '  Guardrail chặn vì không xác định được tình huống. Sửa nguyên nhân rồi thử lại.\n',
  };
}

export function runHook(rawStdin, env = {}) {
  let ctx;
  try {
    ctx = buildContext(rawStdin, env);
  } catch (err) {
    if (err instanceof ContextError) return failClosed(err);
    throw err;
  }

  const rules = REGISTRY[ctx.event]?.[ctx.tool] ?? [];
  if (rules.length === 0) return { code: 0, stderr: '' };

  let policy;
  try {
    ({ policy } = loadPolicy(ctx.projectRoot));
  } catch (err) {
    if (err instanceof PolicyError) return failClosed(err);
    throw err;
  }

  let stderr = '';
  const repo = ctx.projectRoot ? pathBasename(ctx.projectRoot) : null;

  for (const [group, mod] of rules) {
    let res;
    try {
      res = mod.evaluate(ctx, policy);
    } catch (err) {
      if (SAFETY_GROUPS.has(group)) return failClosed(err);
      stderr += `⚠ guardrail: rule ${group} lỗi, bỏ qua: ${err.message}\n`;
      continue;
    }
    if (res.decision !== 'deny') continue;

    const common = {
      ruleId: res.ruleId, event: ctx.event, tool: ctx.tool,
      repo, branch: currentBranch(ctx.cwd), command: ctx.command ?? undefined,
    };

    if (ctx.escapes.has(res.ruleId)) {
      record({ decision: 'escaped', ...common });
      stderr += `⚠ guardrail: ${res.ruleId} bị bỏ qua bằng CODEX_GUARDRAIL_ALLOW.\n`;
      continue;
    }

    record({ decision: 'denied', ...common });
    return { code: 2, stderr: stderr + denyMessage(res, ctx) };
  }

  return { code: 0, stderr };
}
```

- [ ] **Step 4: Chạy test dispatch để xác nhận pass**

Run: `node --test tests/dispatch.test.mjs`
Expected: PASS, 10 test

- [ ] **Step 5: Viết `bin/guardrail.mjs`**

```js
#!/usr/bin/env node
// bin/guardrail.mjs
import { runHook } from '../lib/dispatch.mjs';

const USAGE = 'Cách dùng: guardrail <hook|install|uninstall|doctor|stats>\n'
  + '  hook       đọc payload Codex từ stdin và quyết định chặn hay cho qua\n'
  + '  install    wire hook vào ~/.codex/hooks.json (merge, có backup)\n'
  + '  uninstall  gỡ đúng entry của guardrail\n'
  + '  doctor     kiểm tra wiring và in rule đang hiệu lực\n'
  + '  stats      tổng hợp audit log theo rule\n';

async function readStdin() {
  let raw = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) raw += chunk;
  return raw;
}

const sub = process.argv[2];

if (sub === 'hook') {
  const raw = await readStdin();
  const { code, stderr } = runHook(raw, process.env);
  if (stderr) process.stderr.write(stderr);
  process.exit(code);
} else {
  process.stderr.write(USAGE);
  process.exit(1);
}
```

- [ ] **Step 6: Viết test end-to-end cho CLI**

```js
// tests/cli-hook.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../bin/guardrail.mjs', import.meta.url));

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'guardrail-cli-'));
  mkdirSync(join(dir, '.git'));
  return dir;
}

function run(payloadStr, cwd) {
  return spawnSync(process.execPath, [BIN, 'hook'], {
    input: payloadStr, encoding: 'utf8',
    env: { ...process.env, GUARDRAIL_AUDIT_PATH: join(cwd, 'audit.jsonl') },
  });
}

const payload = (cwd, command) => JSON.stringify({
  hook_event_name: 'PreToolUse', tool_name: 'shell', cwd, tool_input: { command },
});

test('exit 0 cho lệnh vô hại', () => {
  const dir = repo();
  assert.equal(run(payload(dir, 'npm test'), dir).status, 0);
});

test('exit 2 và in lý do cho lệnh vi phạm', () => {
  const dir = repo();
  const r = run(payload(dir, 'terraform apply'), dir);
  assert.equal(r.status, 2);
  assert.ok(r.stderr.includes('infra.deny-binary'));
});

test('exit 3 khi stdin rỗng', () => {
  const dir = repo();
  assert.equal(run('', dir).status, 3);
});

test('không có subcommand thì in cách dùng và exit 1', () => {
  const r = spawnSync(process.execPath, [BIN], { encoding: 'utf8', input: '' });
  assert.equal(r.status, 1);
  assert.ok(r.stderr.includes('Cách dùng'));
});
```

- [ ] **Step 7: Chạy test CLI để xác nhận pass**

Run: `node --test tests/cli-hook.test.mjs`
Expected: PASS, 4 test

- [ ] **Step 8: Chạy toàn bộ test**

Run: `npm test`
Expected: PASS toàn bộ

- [ ] **Step 9: Commit**

```bash
git add bin/guardrail.mjs lib/dispatch.mjs tests/dispatch.test.mjs tests/cli-hook.test.mjs
git commit -m "feat(dispatch): entry hook, exit code 0/2/3, escape theo ruleId, message ba phần"
```

---

### Task 11: `install` và `uninstall`

**Files:**
- Create: `lib/install.mjs`
- Modify: `bin/guardrail.mjs` — nối subcommand `install` và `uninstall`
- Test: `tests/install.test.mjs`

**Interfaces:**
- Consumes: không (độc lập với engine rule)
- Produces:
  - `codexHome() => string`
  - `installDir() => string`
  - `sidecarPath() => string`
  - `checkNode(versionString?: string) => { ok: boolean, message: string }`
  - `enableCodexHooks(tomlText: string) => string`
  - `mergeHooks(existing: object, entries: HookEntry[]) => object` với `HookEntry = { event, matcher, command }`
  - `install({ sourceDir: string }) => { ok: boolean, messages: string[] }`
  - `uninstall() => { ok: boolean, messages: string[] }`

Marker dùng **file sidecar** `~/.codex/.guardrail-installed.json` ghi lại chính xác entry đã thêm, không nhúng khoá lạ vào `hooks.json` — cách này đúng bất kể Codex có chấp nhận khoá lạ hay không, nên không phụ thuộc kết quả Task 0 Step 6.

Không dùng symlink: copy thẳng vào `~/.codex/guardrail/` để chạy được trên Windows không cần quyền đặc biệt.

- [ ] **Step 1: Viết test thất bại**

```js
// tests/install.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  install, uninstall, checkNode, enableCodexHooks, mergeHooks, sidecarPath, installDir,
} from '../lib/install.mjs';

const SOURCE = fileURLToPath(new URL('../', import.meta.url));

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'guardrail-install-'));
  process.env.CODEX_HOME = dir;
  return dir;
}

test('checkNode từ chối bản dưới 20', () => {
  assert.equal(checkNode('v18.19.0').ok, false);
  assert.equal(checkNode('v20.11.0').ok, true);
  assert.equal(checkNode('v22.3.0').ok, true);
});

test('enableCodexHooks thêm mục features khi chưa có', () => {
  const out = enableCodexHooks('model = "gpt-5.4"\n');
  assert.ok(out.includes('[features]'));
  assert.ok(out.includes('codex_hooks = true'));
});

test('enableCodexHooks bật lại khi đang false, không đụng khoá khác', () => {
  const out = enableCodexHooks('[features]\ncodex_hooks = false\njs_repl = false\n');
  assert.ok(out.includes('codex_hooks = true'));
  assert.ok(!out.includes('codex_hooks = false'));
  assert.ok(out.includes('js_repl = false'));
});

test('enableCodexHooks không nhân bản khi đã true', () => {
  const src = '[features]\ncodex_hooks = true\n';
  assert.equal(enableCodexHooks(src), src);
});

test('mergeHooks giữ nguyên entry sẵn có', () => {
  const existing = {
    hooks: {
      SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: 'morkit.sh' }] }],
    },
  };
  const out = mergeHooks(existing, [
    { event: 'PreToolUse', matcher: 'shell', command: 'node g.mjs hook' },
  ]);
  assert.equal(out.hooks.SessionStart.length, 1);
  assert.equal(out.hooks.SessionStart[0].hooks[0].command, 'morkit.sh');
  assert.equal(out.hooks.PreToolUse.length, 1);
});

test('install ghi hooks.json, sidecar, và copy runtime', () => {
  const home = sandbox();
  writeFileSync(join(home, 'config.toml'), 'model = "gpt-5.4"\n');
  const res = install({ sourceDir: SOURCE });
  assert.equal(res.ok, true);
  const hooks = JSON.parse(readFileSync(join(home, 'hooks.json'), 'utf8'));
  assert.ok(hooks.hooks.PreToolUse.length >= 2);
  assert.ok(existsSync(sidecarPath()));
  assert.ok(existsSync(join(installDir(), 'bin', 'guardrail.mjs')));
  assert.ok(existsSync(join(installDir(), 'policy', 'default.json')));
});

test('install chạy lại không nhân bản entry', () => {
  const home = sandbox();
  install({ sourceDir: SOURCE });
  const first = readFileSync(join(home, 'hooks.json'), 'utf8');
  install({ sourceDir: SOURCE });
  assert.equal(readFileSync(join(home, 'hooks.json'), 'utf8'), first);
});

test('install không phá hooks.json đang có nội dung và có backup', () => {
  const home = sandbox();
  writeFileSync(join(home, 'hooks.json'), JSON.stringify({
    hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'morkit.sh' }] }] },
  }));
  install({ sourceDir: SOURCE });
  const hooks = JSON.parse(readFileSync(join(home, 'hooks.json'), 'utf8'));
  assert.equal(hooks.hooks.SessionStart[0].hooks[0].command, 'morkit.sh');
  assert.ok(existsSync(join(home, 'hooks.json.bak')));
});

test('uninstall gỡ đúng entry của mình, giữ entry người khác', () => {
  const home = sandbox();
  writeFileSync(join(home, 'hooks.json'), JSON.stringify({
    hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'other.sh' }] }] },
  }));
  install({ sourceDir: SOURCE });
  uninstall();
  const hooks = JSON.parse(readFileSync(join(home, 'hooks.json'), 'utf8'));
  assert.equal(hooks.hooks.PreToolUse.length, 1);
  assert.equal(hooks.hooks.PreToolUse[0].hooks[0].command, 'other.sh');
  assert.equal(existsSync(installDir()), false);
});

test('uninstall khi chưa cài thì báo rõ, không ném', () => {
  sandbox();
  const res = uninstall();
  assert.equal(res.ok, false);
  assert.ok(res.messages.join(' ').includes('chưa được cài'));
});
```

- [ ] **Step 2: Chạy test để xác nhận thất bại**

Run: `node --test tests/install.test.mjs`
Expected: FAIL — `Cannot find module '../lib/install.mjs'`

- [ ] **Step 3: Viết `lib/install.mjs`**

```js
// lib/install.mjs
import {
  cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function codexHome() {
  return process.env.CODEX_HOME ?? join(homedir(), '.codex');
}

export function installDir() {
  return join(codexHome(), 'guardrail');
}

export function sidecarPath() {
  return join(codexHome(), '.guardrail-installed.json');
}

export function checkNode(versionString = process.version) {
  const major = Number(String(versionString).replace(/^v/, '').split('.')[0]);
  return Number.isFinite(major) && major >= 20
    ? { ok: true, message: `Node ${versionString} — đạt yêu cầu.` }
    : { ok: false, message: `Cần Node >= 20, máy đang dùng ${versionString}.` };
}

export function enableCodexHooks(tomlText) {
  const text = tomlText ?? '';
  if (/^\s*codex_hooks\s*=\s*true\s*$/m.test(text)) return text;
  if (/^\s*codex_hooks\s*=\s*false\s*$/m.test(text)) {
    return text.replace(/^\s*codex_hooks\s*=\s*false\s*$/m, 'codex_hooks = true');
  }
  if (/^\s*\[features\]\s*$/m.test(text)) {
    return text.replace(/^\s*\[features\]\s*$/m, '[features]\ncodex_hooks = true');
  }
  const sep = text === '' || text.endsWith('\n') ? '' : '\n';
  return `${text}${sep}\n[features]\ncodex_hooks = true\n`;
}

function hookEntries() {
  const bin = join(installDir(), 'bin', 'guardrail.mjs');
  const cmd = `node "${bin}" hook`;
  return [
    { event: 'PreToolUse', matcher: 'shell', command: cmd },
    { event: 'PreToolUse', matcher: 'apply_patch', command: cmd },
  ];
}

export function mergeHooks(existing, entries) {
  const out = existing && typeof existing === 'object' ? structuredClone(existing) : {};
  out.hooks ??= {};
  for (const e of entries) {
    out.hooks[e.event] ??= [];
    const already = out.hooks[e.event].some(group =>
      group.matcher === e.matcher
      && (group.hooks ?? []).some(h => h.command === e.command));
    if (already) continue;
    out.hooks[e.event].push({
      ...(e.matcher ? { matcher: e.matcher } : {}),
      hooks: [{ type: 'command', command: e.command }],
    });
  }
  return out;
}

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; }
}

export function install({ sourceDir }) {
  const messages = [];
  const node = checkNode();
  if (!node.ok) return { ok: false, messages: [node.message] };
  messages.push(node.message);

  const dest = installDir();
  mkdirSync(dest, { recursive: true });
  for (const part of ['bin', 'lib', 'policy', 'package.json']) {
    cpSync(join(sourceDir, part), join(dest, part), { recursive: true });
  }
  messages.push(`Đã copy runtime vào ${dest}`);

  const configPath = join(codexHome(), 'config.toml');
  const toml = existsSync(configPath) ? readFileSync(configPath, 'utf8') : '';
  const nextToml = enableCodexHooks(toml);
  if (nextToml !== toml) {
    if (existsSync(configPath)) copyFileSync(configPath, `${configPath}.bak`);
    writeFileSync(configPath, nextToml);
    messages.push('Đã bật codex_hooks = true trong config.toml');
  } else {
    messages.push('codex_hooks đã bật, không đụng config.toml');
  }

  const hooksPath = join(codexHome(), 'hooks.json');
  const existing = readJson(hooksPath, { hooks: {} });
  if (existsSync(hooksPath)) copyFileSync(hooksPath, `${hooksPath}.bak`);
  const entries = hookEntries();
  writeFileSync(hooksPath, JSON.stringify(mergeHooks(existing, entries), null, 2) + '\n');
  messages.push(`Đã merge ${entries.length} entry vào ${hooksPath} (backup .bak)`);

  const version = readJson(join(sourceDir, 'package.json'), {}).version ?? 'unknown';
  writeFileSync(sidecarPath(),
    JSON.stringify({ version, installedAt: new Date().toISOString(), entries }, null, 2) + '\n');
  messages.push(`Đã ghi sidecar ${sidecarPath()}`);
  messages.push('Khởi động lại Codex để hook có hiệu lực.');

  return { ok: true, messages };
}

export function uninstall() {
  const messages = [];
  const sidecar = readJson(sidecarPath(), null);
  if (!sidecar) {
    return { ok: false, messages: ['Guardrail chưa được cài trên máy này (không có sidecar).'] };
  }

  const hooksPath = join(codexHome(), 'hooks.json');
  const hooks = readJson(hooksPath, { hooks: {} });
  const mine = new Set(sidecar.entries.map(e => e.command));
  for (const [event, groups] of Object.entries(hooks.hooks ?? {})) {
    hooks.hooks[event] = groups
      .map(g => ({ ...g, hooks: (g.hooks ?? []).filter(h => !mine.has(h.command)) }))
      .filter(g => (g.hooks ?? []).length > 0);
    if (hooks.hooks[event].length === 0) delete hooks.hooks[event];
  }
  writeFileSync(hooksPath, JSON.stringify(hooks, null, 2) + '\n');
  messages.push(`Đã gỡ entry của guardrail khỏi ${hooksPath}`);

  rmSync(installDir(), { recursive: true, force: true });
  rmSync(sidecarPath(), { force: true });
  messages.push('Đã xoá runtime và sidecar. Không đụng codex_hooks trong config.toml — '
    + 'tool khác có thể đang cần.');
  return { ok: true, messages };
}
```

- [ ] **Step 4: Nối subcommand vào `bin/guardrail.mjs`**

Thay nhánh `else` cuối bằng:

```js
} else if (sub === 'install' || sub === 'uninstall') {
  const { install, uninstall } = await import('../lib/install.mjs');
  const sourceDir = fileURLToPath(new URL('../', import.meta.url));
  const res = sub === 'install' ? install({ sourceDir }) : uninstall();
  for (const m of res.messages) process.stdout.write(`${res.ok ? '✓' : '✗'} ${m}\n`);
  process.exit(res.ok ? 0 : 1);
} else {
  process.stderr.write(USAGE);
  process.exit(1);
}
```

Và thêm import ở đầu file:

```js
import { fileURLToPath } from 'node:url';
```

- [ ] **Step 5: Chạy test để xác nhận pass**

Run: `node --test tests/install.test.mjs`
Expected: PASS, 10 test

- [ ] **Step 6: Chạy toàn bộ test**

Run: `npm test`
Expected: PASS toàn bộ

- [ ] **Step 7: Commit**

```bash
git add lib/install.mjs bin/guardrail.mjs tests/install.test.mjs
git commit -m "feat(install): merge hooks.json có backup và sidecar, gỡ đúng entry của mình"
```

---

### Task 12: `doctor` và `stats`

**Files:**
- Create: `lib/doctor.mjs`
- Create: `lib/stats.mjs`
- Modify: `bin/guardrail.mjs` — nối subcommand `doctor` và `stats`
- Test: `tests/doctor.test.mjs`
- Test: `tests/stats.test.mjs`

**Interfaces:**
- Consumes: `codexHome`, `installDir`, `sidecarPath`, `checkNode` (Task 11); `findProjectRoot`, `loadPolicy`, `PolicyError` (Task 3); `readEntries`, `auditPath` (Task 5)
- Produces:
  - `diagnose(cwd: string) => { ok: boolean, lines: string[] }`
  - `summarize(entries: object[]) => { rows: Array<{ruleId, denied, escaped}>, total: number }`
  - `formatStats(summary) => string`

`doctor` phải nói rõ **rule nào đang tắt và vì sao** — một guardrail im lặng không chạy còn tệ hơn không có guardrail.

- [ ] **Step 1: Viết test thất bại cho doctor**

```js
// tests/doctor.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { diagnose } from '../lib/doctor.mjs';
import { install } from '../lib/install.mjs';

const SOURCE = fileURLToPath(new URL('../', import.meta.url));

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'guardrail-doctor-'));
  process.env.CODEX_HOME = dir;
  process.env.GUARDRAIL_AUDIT_PATH = join(dir, 'audit.jsonl');
  return dir;
}
function repo(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'guardrail-doctor-repo-'));
  mkdirSync(join(dir, '.git'));
  for (const [n, b] of Object.entries(files)) writeFileSync(join(dir, n), b);
  return dir;
}

test('chưa cài thì ok=false và nói rõ thiếu gì', () => {
  sandbox();
  const res = diagnose(repo());
  assert.equal(res.ok, false);
  assert.ok(res.lines.join('\n').includes('chưa được cài'));
});

test('đã cài thì ok=true và in đường dẫn runtime', () => {
  const home = sandbox();
  writeFileSync(join(home, 'config.toml'), '');
  install({ sourceDir: SOURCE });
  const res = diagnose(repo());
  assert.equal(res.ok, true);
  assert.ok(res.lines.join('\n').includes('guardrail'));
});

test('báo rule convention đang tắt vì thiếu lintCommand', () => {
  sandbox();
  const out = diagnose(repo()).lines.join('\n');
  assert.ok(out.includes('convention.lint'));
  assert.ok(out.includes('lintCommand'));
});

test('báo đang dùng policy mặc định khi repo chưa có file policy', () => {
  sandbox();
  assert.ok(diagnose(repo()).lines.join('\n').includes('mặc định'));
});

test('báo nguồn policy khi repo đã có file', () => {
  sandbox();
  const dir = repo({ 'codex-guardrail.json': '{}' });
  assert.ok(diagnose(dir).lines.join('\n').includes('codex-guardrail.json'));
});

test('policy hỏng thì doctor báo lỗi chứ không ném', () => {
  sandbox();
  const dir = repo({ 'codex-guardrail.json': '{ "infra": ' });
  const res = diagnose(dir);
  assert.equal(res.ok, false);
  assert.ok(res.lines.join('\n').includes('sai cú pháp'));
});
```

- [ ] **Step 2: Viết `lib/doctor.mjs`**

```js
// lib/doctor.mjs
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { codexHome, installDir, sidecarPath, checkNode } from './install.mjs';
import { findProjectRoot, loadPolicy, PolicyError } from './policy.mjs';
import { auditPath, readEntries } from './audit.mjs';

export function diagnose(cwd) {
  const lines = [];
  let ok = true;

  const node = checkNode();
  lines.push(`${node.ok ? '✓' : '✗'} ${node.message}`);
  if (!node.ok) ok = false;

  if (existsSync(sidecarPath())) {
    const s = JSON.parse(readFileSync(sidecarPath(), 'utf8'));
    lines.push(`✓ Đã cài bản ${s.version} lúc ${s.installedAt}`);
    lines.push(`  Runtime: ${installDir()}`);
    lines.push(`  Entry hook: ${s.entries.length} mục trong ${join(codexHome(), 'hooks.json')}`);
  } else {
    lines.push('✗ Guardrail chưa được cài trên máy này. Chạy: guardrail install');
    ok = false;
  }

  const root = findProjectRoot(cwd);
  lines.push(root ? `✓ Project root: ${root}` : '⚠ Không tìm được .git từ cwd');

  let policy = null;
  try {
    const res = loadPolicy(root);
    policy = res.policy;
    lines.push(res.source
      ? `✓ Policy: ${res.source}`
      : '⚠ Policy: đang dùng bản mặc định của plugin');
    for (const w of res.warnings) lines.push(`  ${w}`);
  } catch (err) {
    lines.push(`✗ Policy lỗi: ${err instanceof PolicyError ? err.message : String(err)}`);
    ok = false;
  }

  if (policy) {
    lines.push('Rule đang hiệu lực:');
    lines.push(`  ✓ secrets      — ${policy.secrets?.denyPaths?.length ?? 0} mẫu đường dẫn`);
    lines.push(`  ✓ infra        — ${policy.infra?.denyBinaries?.length ?? 0} binary bị chặn`);
    lines.push(`  ✓ git          — branch bảo vệ: ${(policy.git?.protectedBranches ?? []).join(', ')}`);
    lines.push(`  ✓ selfprotect  — ${policy.selfProtect?.protectedPaths?.length ?? 0} mẫu đường dẫn`);
    const lint = policy.convention?.lintCommand ?? '';
    lines.push(lint
      ? `  ✓ convention.lint — ${lint}`
      : '  ✗ convention.lint — TẮT vì convention.lintCommand rỗng. '
        + 'Guardrail đang chạy ở chế độ chỉ-bảo-vệ, không nâng được chất lượng.');
  }

  lines.push(`Audit log: ${auditPath()} (${readEntries().length} dòng)`);
  return { ok, lines };
}
```

- [ ] **Step 3: Chạy test doctor để xác nhận pass**

Run: `node --test tests/doctor.test.mjs`
Expected: PASS, 6 test

- [ ] **Step 4: Viết test thất bại cho stats**

```js
// tests/stats.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { summarize, formatStats } from '../lib/stats.mjs';

const entries = [
  { decision: 'denied', ruleId: 'infra.deny-binary' },
  { decision: 'denied', ruleId: 'infra.deny-binary' },
  { decision: 'escaped', ruleId: 'infra.deny-binary' },
  { decision: 'denied', ruleId: 'git.protected-branch' },
];

test('gộp theo ruleId, đếm riêng denied và escaped', () => {
  const { rows, total } = summarize(entries);
  assert.equal(total, 4);
  const infra = rows.find(r => r.ruleId === 'infra.deny-binary');
  assert.equal(infra.denied, 2);
  assert.equal(infra.escaped, 1);
});

test('sắp giảm dần theo tổng số lần bắn', () => {
  assert.equal(summarize(entries).rows[0].ruleId, 'infra.deny-binary');
});

test('log rỗng thì nói rõ chưa có dữ liệu', () => {
  assert.ok(formatStats(summarize([])).includes('chưa có'));
});

test('formatStats in đủ ruleId và số đếm', () => {
  const out = formatStats(summarize(entries));
  assert.ok(out.includes('infra.deny-binary'));
  assert.ok(out.includes('git.protected-branch'));
});
```

- [ ] **Step 5: Viết `lib/stats.mjs`**

```js
// lib/stats.mjs
export function summarize(entries) {
  const byRule = new Map();
  for (const e of entries) {
    const id = e.ruleId ?? '(không rõ)';
    const row = byRule.get(id) ?? { ruleId: id, denied: 0, escaped: 0 };
    if (e.decision === 'escaped') row.escaped++; else row.denied++;
    byRule.set(id, row);
  }
  const rows = [...byRule.values()]
    .sort((a, b) => (b.denied + b.escaped) - (a.denied + a.escaped));
  return { rows, total: entries.length };
}

export function formatStats({ rows, total }) {
  if (total === 0) {
    return 'Audit log chưa có dữ liệu — guardrail chưa chặn lần nào, '
      + 'hoặc chưa được cài đúng (chạy: guardrail doctor).\n';
  }
  const width = Math.max(...rows.map(r => r.ruleId.length), 8);
  const head = `${'rule'.padEnd(width)}  chặn  escape\n`;
  const body = rows
    .map(r => `${r.ruleId.padEnd(width)}  ${String(r.denied).padStart(4)}  ${String(r.escaped).padStart(6)}`)
    .join('\n');
  return `${head}${body}\n\nTổng ${total} lần ghi. Rule chặn oan nhiều thì nới trong `
    + 'codex-guardrail.json; rule chưa bắn lần nào thì cân nhắc bỏ cho gọn.\n';
}
```

- [ ] **Step 6: Nối subcommand vào `bin/guardrail.mjs`**

Thêm hai nhánh trước nhánh `else` cuối:

```js
} else if (sub === 'doctor') {
  const { diagnose } = await import('../lib/doctor.mjs');
  const res = diagnose(process.cwd());
  process.stdout.write(res.lines.join('\n') + '\n');
  process.exit(res.ok ? 0 : 1);
} else if (sub === 'stats') {
  const { readEntries } = await import('../lib/audit.mjs');
  const { summarize, formatStats } = await import('../lib/stats.mjs');
  process.stdout.write(formatStats(summarize(readEntries())));
  process.exit(0);
} else {
```

- [ ] **Step 7: Chạy toàn bộ test**

Run: `npm test`
Expected: PASS toàn bộ

- [ ] **Step 8: Commit**

```bash
git add lib/doctor.mjs lib/stats.mjs bin/guardrail.mjs tests/doctor.test.mjs tests/stats.test.mjs
git commit -m "feat(doctor,stats): báo rule nào đang tắt và vì sao, tổng hợp audit log"
```

---

### Task 13: Test độ trễ, CI matrix, README

**Files:**
- Create: `tests/latency.test.mjs`
- Create: `.github/workflows/test.yml`
- Create: `README.md`
- Create: `codex-guardrail.json` — policy của chính repo này, để nó tự bảo vệ mình

**Interfaces:**
- Consumes: `bin/guardrail.mjs` (Task 10)
- Produces: không có API mới

- [ ] **Step 1: Viết test độ trễ**

Đo bằng cách spawn thật, vì phần lớn ngân sách là Node cold start — đo trong tiến trình sẽ cho số đẹp giả.

```js
// tests/latency.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../bin/guardrail.mjs', import.meta.url));
const BUDGET_MS = Number(process.env.GUARDRAIL_LATENCY_BUDGET_MS ?? 150);
const RUNS = 20;

test(`p95 của một lần gọi hook dưới ${BUDGET_MS}ms`, () => {
  const dir = mkdtempSync(join(tmpdir(), 'guardrail-lat-'));
  mkdirSync(join(dir, '.git'));
  const payload = JSON.stringify({
    hook_event_name: 'PreToolUse', tool_name: 'shell', cwd: dir,
    tool_input: { command: 'npm test' },
  });

  const times = [];
  for (let i = 0; i < RUNS; i++) {
    const t0 = process.hrtime.bigint();
    const r = spawnSync(process.execPath, [BIN, 'hook'], {
      input: payload, encoding: 'utf8',
      env: { ...process.env, GUARDRAIL_AUDIT_PATH: join(dir, 'audit.jsonl') },
    });
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
    assert.equal(r.status, 0);
  }

  times.sort((a, b) => a - b);
  const p95 = times[Math.floor(times.length * 0.95) - 1];
  assert.ok(p95 < BUDGET_MS,
    `p95 = ${p95.toFixed(1)}ms, vượt ngân sách ${BUDGET_MS}ms. `
    + 'Hook chạy trên mọi tool call nên đây là lỗi thật, không phải test khó tính.');
});
```

- [ ] **Step 2: Chạy test độ trễ**

Run: `npm run test:latency`
Expected: PASS. Nếu vượt ngân sách: kiểm xem có module nào bị import ở top-level của `bin/guardrail.mjs` mà chỉ subcommand khác cần — chuyển sang `await import()` động như `install` / `doctor` / `stats` đang làm.

- [ ] **Step 3: Viết `codex-guardrail.json` cho chính repo này**

```json
{
  "git": {
    "protectedBranches": ["main"]
  },
  "convention": {
    "lintCommand": "node --check {file}",
    "lintExtensions": [".mjs"],
    "conventionDocs": ["README.md"]
  }
}
```

- [ ] **Step 4: Viết `.github/workflows/test.yml`**

```yaml
name: test

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
        node: [20, 22]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
      - run: node --test tests/
        env:
          GUARDRAIL_LATENCY_BUDGET_MS: 250
```

Ngân sách trên CI nới lên 250ms vì runner chậm hơn máy dev — nhưng **không xoá** test độ trễ.

- [ ] **Step 5: Viết `README.md`**

Nội dung bắt buộc có, không được lược mục "KHÔNG làm được gì":

```markdown
# codex-guardrail

Lớp cưỡng chế guardrail cho Codex CLI. Chặn agent làm bốn nhóm việc nguy hiểm:
đọc secret, tự thao tác database/cloud, tự chạy git lệch quy trình, và sinh code
không đúng convention của dự án.

## Cài

    npx github:mor-duongmh/codex-guardrail#v1.0.0 install
    guardrail doctor

Khởi động lại Codex sau khi cài.

## Ba tầng

1. **Hook local** — chặn agent ngay khi nó định làm. Đây là phần này.
2. **CI check** — bắt lại các rule thấy được trong diff. Xem Plan 3.
3. **CODEOWNERS** — khoá `codex-guardrail.json` để nới policy phải có lead duyệt.

## Guardrail này KHÔNG làm được gì

1. **Không chống người cố tình lách.** `$(printf 'ps'; printf 'ql')` không bắt được.
   Nó chống tai nạn và chống agent hớ hênh.
2. **`grep -r` và `git diff` vẫn lôi được secret ra** mà không hiện đường dẫn nào.
3. **`ssh` chỉ soi được lệnh remote viết thẳng trong command.** ProxyJump, `-F`
   custom config, hoặc lệnh remote sinh động thì lọt.
4. **Trên máy dev khác, hook có thể bị tháo.** `~/.codex/hooks.json` thuộc quyền
   của dev đó. Bản này không có telemetry nên tháo hook thì không ai biết — đó là
   lý do tầng CI tồn tại.
5. **Guardrail chỉ cưỡng chế thứ dự án đã có.** Repo không có lint thì
   `convention.lint` không có gì để chạy; `guardrail doctor` sẽ nói thẳng điều đó.

## Escape

Đường tốt: thêm entry vào `codex-guardrail.json`, mở PR, lead duyệt qua CODEOWNERS.

Đường nhanh, một rule một phiên, **người gõ chứ không phải agent**:

    export CODEX_GUARDRAIL_ALLOW=infra.deny-binary

Không hỗ trợ `*`. Nếu chuỗi này xuất hiện *trong* command thì bị chặn ngay — đó là
agent tự phát escape cho chính nó.

## Điều chỉnh rule

| Mức | Cách làm |
|---|---|
| Một dự án | Sửa `codex-guardrail.json`, mở PR |
| Mọi dự án | Sửa `policy/default.json` trong repo này, bump tag |
| Rule mới | Thêm module vào `lib/rules/`, đăng ký vào `lib/dispatch.mjs` |

`guardrail stats` cho biết rule nào chặn oan nhiều nhất (nên nới) và rule nào chưa
bắn lần nào (nên bỏ cho gọn). Cố ý **không** có cơ chế rule tự nới.
```

- [ ] **Step 6: Chạy toàn bộ test lần cuối**

Run: `npm test`
Expected: PASS toàn bộ, không test nào bị skip

- [ ] **Step 7: Commit**

```bash
git add tests/latency.test.mjs .github/workflows/test.yml README.md codex-guardrail.json
git commit -m "test(latency): giữ ngân sách p95 150ms; ci matrix 3 OS x 2 node; README giới hạn"
```

---

## Kết thúc Plan 1

Sau Task 13, `guardrail install` + khởi động lại Codex là chặn thật được bốn nhóm rule an toàn. Chạy `guardrail doctor` để xác nhận, rồi để nó chạy một tuần và đọc `guardrail stats` trước khi bắt đầu Plan 2 — dữ liệu thật về rule nào chặn oan sẽ đổi thứ tự ưu tiên của Plan 2.

Nhắc lại rẽ nhánh ở Task 0 Step 5: kết quả **C** (Codex vẫn chạy lệnh dù hook exit non-zero) làm sụp toàn bộ plan này. Gặp C thì dừng, đừng cố làm tiếp.
