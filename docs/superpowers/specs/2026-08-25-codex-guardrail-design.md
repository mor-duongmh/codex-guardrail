# Thiết kế: codex-guardrail

- **Ngày:** 2026-08-25
- **Trạng thái:** Design — chờ duyệt trước khi lập kế hoạch triển khai
- **Phạm vi:** plugin guardrail độc lập cho Codex CLI, chạy trên máy của nhiều dev

## 1. Vấn đề

Dev MOR chạy Codex CLI trên dự án thật. Codex có quyền chạy shell và sửa file, nên có thể đọc secret của dự án, tự thao tác database/cloud, tự chạy git lệch quy trình, và sinh code không theo convention.

morkit đã hỗ trợ Codex nhưng chạy **Advisory**: review gate và kỷ luật chu trình là quy ước, không cưỡng chế (`plugins/morkit/AGENTS.md`). Gate hiện có (`hooks/pre-tool-checklist-gate.sh`) chỉ bắt đường `executing-plans` và fail-open khi thiếu `MORKIT_CURRENT_CHANGE` hoặc thiếu `jq`.

Cần một lớp cưỡng chế độc lập với morkit, cài được trên máy dev khác, chặn bốn nhóm rủi ro:

1. Không đọc/ghi thông tin nhạy cảm của dự án
2. Không tự thao tác hạ tầng rủi ro cao (database, cloud)
3. Không tự thao tác git lệch git workflow của dự án
4. Code sinh ra phải đúng convention của dự án

## 2. Trần cưỡng chế — đọc trước khi thiết kế

Trên máy dev khác, `~/.codex/hooks.json`, biến môi trường và file policy đều thuộc quyền của dev đó. **Guardrail local không thể cưỡng chế tuyệt đối.** Phân biệt hai mối lo:

- **Agent tự ý làm điều nguy hiểm** — dev không biết, không muốn. Hook local chặn được, và đây là phần lớn giá trị: hook nằm ngoài vòng suy luận của Codex, nó không tháo được hook của chính nó.
- **Con người cố tình lách** — hook local không giải quyết được. Cần tầng không nằm trên máy dev: CI + CODEOWNERS.

Thiết kế này vì vậy có ba tầng, và spec ghi rõ rule nào được tầng nào bảo vệ (§7).

## 3. Quyết định đã chốt

| # | Quyết định | Lý do |
|---|---|---|
| 1 | Plugin **độc lập** với morkit | Dùng được cho dự án không cài morkit |
| 2 | **Chặn cứng** (exit non-zero), escape phải chủ ý và có log | Đẩy sang approval tay dẫn tới bấm duyệt theo phản xạ |
| 3 | **Deny-list có chủ đích**, không allow-list | Allow-list phải bảo trì liên tục, chặn oan sẽ dẫn tới tháo rule |
| 4 | Convention: **bơm ngữ cảnh (phòng) + lint sau khi sửa (bắt)** | Chặn mà không nói luật trước thì agent loay hoay |
| 5 | **Chỉ Codex**, không làm cho Claude Code | Giữ phạm vi; Claude Code đã có lớp guardrail riêng |
| 6 | Kiến trúc **một dispatcher + policy per-project** | Chỉ hướng này chặn được cả `shell` và `apply_patch` bằng cùng logic, và test được không cần Codex chạy thật |
| 7 | **Node ESM, không dependency** | Gate hiện tại của morkit fail-open khi thiếu `jq`; guardrail an toàn không được có lỗ "thiếu công cụ là mở cửa" |
| 8 | Policy là **JSON** | Parse bằng Node thuần, không kéo dependency vào thứ chạy trên mọi tool call |
| 9 | Phân phối bằng **`npx github:mor-duongmh/codex-guardrail`** | Không cần npm registry, chạy trên macOS/Linux/Windows, pin version bằng tag |
| 10 | `ssh`: **deny-list host + soi lệnh remote**, bỏ allow-list host | Allow-list host bắt liệt kê mọi host hợp lệ — nhiều, đổi liên tục, quên là chặn oan |
| 11 | **Không tích hợp SkillHub / telemetry** ở v1 | Lead yêu cầu chưa làm gì liên quan SkillHub |
| 12 | Bổ sung v1: self-protection + 5 rule rẻ + redact output | Chọn theo tỉ lệ giá trị/chi phí; test gate cuối turn để sau |

## 4. Phạm vi

**Trong v1**

- Engine hook cho Codex: `PreToolUse`, `PostToolUse`, `SessionStart`
- 4 nhóm rule gốc + self-protection + 5 rule chất lượng/rủi ro rẻ + redact output (§6)
- Policy hai tầng: default trong package + `codex-guardrail.json` của dự án
- CLI: `install`, `uninstall`, `doctor`, `init`, `ci`, `stats`
- Tầng CI: cùng engine rule, đọc diff thay vì stdin
- CODEOWNERS khoá file policy
- Audit log JSONL local

**Ngoài v1**

- Test gate cuối turn (`Stop` hook chạy test liên quan diff)
- Typecheck gate riêng — trùng phần lớn với lint, lại chậm
- Giới hạn kích thước patch — chặn oan nhiều (lockfile, file sinh tự động), giá trị mơ hồ
- Telemetry / heartbeat về trung tâm, tích hợp SkillHub
- Hỗ trợ Claude Code
- Quét secret trong nội dung patch trước khi commit — morkit `git` skill đã làm

## 5. Kiến trúc

```
codex-guardrail/
  bin/guardrail.mjs          # CLI + hook entry, chỗ duy nhất chạm I/O
  lib/policy.mjs             # nạp default + merge codex-guardrail.json
  lib/context.mjs            # dựng ctx từ stdin JSON (hook) hoặc từ diff (ci)
  lib/tokenize.mjs           # tách token command, giải bash -c / eval, lấy basename
  lib/redact.mjs             # che pattern secret trong chuỗi
  lib/audit.mjs              # ghi JSONL
  lib/rules/secrets.mjs
  lib/rules/infra.mjs
  lib/rules/git-workflow.mjs
  lib/rules/convention.mjs
  lib/rules/self-protect.mjs
  lib/rules/quality.mjs      # test tampering, suppress, CI/generated file
  lib/rules/net.mjs          # curl|sh, fetch ngoài allow-list
  lib/rules/deps.mjs         # cài dependency mới
  policy/default.json        # dữ liệu rule mặc định, tách khỏi logic
  ci/guardrail-check.yml     # reusable workflow
  tests/
  docs/
```

Mỗi rule module export hàm thuần `evaluate(ctx, policy) => { decision, ruleId, reason, hint }`. Không đọc stdin, không `exit`, không ghi log. Nhờ vậy test bằng object thường, và cùng một rule chạy được ở cả hook local lẫn CI.

`decision` ∈ `{ "allow", "deny" }`. Rule không áp dụng thì trả `allow`. Event/tool không có rule nào khai báo thì dispatcher trả `allow` ngay, không nạp policy — giữ ngân sách độ trễ ở §13.

Nếu spike §16.2 cho thấy Codex có tool đọc file riêng ngoài `shell`, `secrets.read-path` phải phủ thêm tool đó; không phủ thì rule 1 hở đúng chỗ quan trọng nhất.

**Tách dữ liệu khỏi logic** là yêu cầu thiết kế, không phải tình cờ: điều chỉnh rule sau này phải làm được bằng cách sửa JSON, không sửa `.mjs` (§12).

## 6. Đặc tả rule

Mọi `ruleId` dưới đây là danh định ổn định — dùng trong escape, audit log, và message chặn.

### 6.1 Secrets — `PreToolUse: Bash`, `PreToolUse: apply_patch`

| ruleId | Chặn khi |
|---|---|
| `secrets.read-path` | Bất kỳ token trong command khớp `secrets.denyPaths` và không khớp `secrets.allowPaths` |
| `secrets.write-path` | `apply_patch` có file đích khớp `secrets.denyPaths` |
| `secrets.env-dump` | Command là `env` hoặc `printenv` không tham số, hoặc `set` không tham số |
| `secrets.manager-read` | `aws secretsmanager get-secret-value`, `gcloud secrets versions access`, `vault read`, `op read`, `kubectl get secret` |

Nguyên tắc `secrets.read-path`: khớp theo **đường dẫn**, không theo động từ. Liệt kê hết cách đọc file (`cat`, `head`, `less`, `grep`, `sed`, `vim`, `code`, `python -c open()`) là cuộc chạy đua không thắng được.

`denyPaths` mặc định: `**/.env`, `**/.env.*`, `**/*.pem`, `**/*.key`, `**/*.p12`, `**/*.pfx`, `**/*.jks`, `**/id_rsa`, `**/id_ed25519`, `**/credentials`, `**/service-account*.json`, `**/.npmrc`, `**/.netrc`, `**/.git-credentials`, `~/.aws/**`, `~/.config/gcloud/**`, `~/.kube/config`, `~/.ssh/**`, `~/.docker/config.json`.

`allowPaths` mặc định (thắng deny): `**/.env.example`, `**/.env.sample`, `**/.env.template`.

### 6.2 Infra — `PreToolUse: Bash`

| ruleId | Chặn khi |
|---|---|
| `infra.deny-binary` | Basename của **lệnh hữu hiệu** nằm trong `infra.denyBinaries` và không nằm trong `infra.allowBinaries`. "Hữu hiệu" = sau khi bóc dải wrapper mở đầu (`sudo`, `npx`, `bunx`, `pnpm dlx`, …) và keyword shell (`do`, `then`, `(`, `{`, …) — nếu chỉ soi token đầu thì `npx wrangler deploy` và `for f in *; do psql; done` lọt |
| `infra.deny-pattern` | Regex trong `infra.denyPatterns` khớp **tiền tố lệnh hữu hiệu của từng segment**, không phải substring của command thô. Chạy trên chuỗi thô thì `git commit -m "docker system prune is dangerous"` bị chặn oan. Hệ quả cần biết khi soạn policy: pattern nhắm vào giữa lệnh (ví dụ `drop\s+table` để bắt `psql -c "drop table users"`) sẽ **không bao giờ khớp** |
| `infra.ssh-deny-host` | Token đích của `ssh`/`scp` khớp `infra.ssh.denyHosts` |
| `infra.ssh-remote-command` | Phần lệnh sau host của `ssh` vi phạm chính `infra.denyBinaries` / `infra.denyPatterns` |

`denyBinaries` mặc định: `psql`, `mysql`, `mysqldump`, `mongosh`, `mongo`, `redis-cli`, `aws`, `gcloud`, `gsutil`, `az`, `oci`, `kubectl`, `helm`, `terraform`, `pulumi`, `ansible`, `flyctl`, `heroku`, `vercel`, `wrangler`, `supabase`.

Không nằm trong deny mặc định: `sqlite3` (thường là DB local nhúng trong app), `docker` (chỉ chặn lệnh xoá qua `denyPatterns`), `ssh`/`scp` (xử lý riêng bằng `infra.ssh`).

`denyPatterns` mặc định: `docker\s+system\s+prune`, `docker\s+volume\s+rm`, `npm\s+publish`, cộng hai pattern chặn xoá root.

Hai pattern root phải cho phép dải flag ở **cả hai phía** đường dẫn. Lý do đo được: `rm -rf /` trần thì GNU coreutils vốn đã từ chối thi hành, còn dạng thật sự chạy được là `rm -rf --no-preserve-root /` (flag đứng **trước** path) — nếu chỉ neo flag đứng sau thì guardrail chặn dạng vô hại và cho qua dạng gây chết. Các dạng phải chặn: `rm -rf /`, `/*`, `-- /`, `-r -f /`, `--recursive --force /`, `--no-preserve-root /` (trước và sau path), và bản `~` tương ứng. Phải cho qua mọi đường dẫn con: `rm -rf /tmp/build`, `rm -rf <path>/node_modules`, `rm -rf ~/Library/Caches/foo`.

**Giới hạn đã biết của cách dùng regex ở đây:** root nằm ở vị trí tham số thứ hai (`rm -rf ./build /`) vẫn lọt, và `~foo` (home của user khác) chưa được coi ngang `~`. Cách sửa đúng là kiểm ở mức **token** — có token đường dẫn nào bằng đúng `/`, `~` hay `~user` — chứ không thêm nhánh regex. Xem §15.

`infra.ssh` mặc định: `denyHosts: []`, `inspectRemoteCommand: true`. Dự án tự khai host prod vào `denyHosts`.

### 6.3 Git workflow — `PreToolUse: Bash`

Chỉ chạy khi token lệnh đầu là `git` hoặc `gh`. Branch hiện tại lấy bằng `git rev-parse --abbrev-ref HEAD` — gọi lazy, chỉ khi cần.

| ruleId | Chặn khi |
|---|---|
| `git.protected-branch` | `commit` hoặc `push` khi branch hiện tại khớp `git.protectedBranches` |
| `git.dangerous-flag` | `push --force`, `push --force-with-lease`, `push --delete`, `reset --hard`, `clean -fdx`, `filter-branch`, `tag -d` |
| `git.no-verify` | Bất kỳ lệnh git có `--no-verify` |
| `git.commit-message` | `commit -m` với message không khớp `git.commitMessagePattern` |
| `git.pr-merge` | `gh pr merge` |

`protectedBranches` mặc định: `main`, `master`, `develop`, `release/*`.
`commitMessagePattern` mặc định: `^(feat|fix|chore|docs|test|refactor|perf|ci|build|style|revert)(\(.+\))?!?: .+` — trùng conventional commits mà morkit `git` skill đang dùng.

### 6.4 Convention — `SessionStart` + `PostToolUse: apply_patch`

- **Phòng** (`SessionStart`): bơm vào context danh sách rule đang hiệu lực + trích nội dung các `convention.conventionDocs`.
- **Bắt** (`PostToolUse: apply_patch`, `ruleId: convention.lint`): chạy `convention.lintCommand` **chỉ trên file vừa sửa**, với `{file}` thay bằng đường dẫn. Chỉ chạy nếu đuôi file nằm trong `convention.lintExtensions`. Timeout `convention.lintTimeoutMs` (mặc định 15000).
- Fail → exit non-zero, stderr mang nguyên lint output để Codex tự sửa.
- **Không auto-fix.** Sửa file sau lưng Codex làm nó mất đồng bộ với thứ nó tưởng đã viết.
- Không khai `lintCommand` → nửa "bắt" tự tắt; `doctor` báo rõ đang tắt.

### 6.5 Self-protection — `PreToolUse: Bash`, `PreToolUse: apply_patch`

Không có rule này thì mọi rule khác chỉ là gợi ý: Codex bị chặn có thể tự nới policy hoặc tháo hook.

| ruleId | Chặn khi |
|---|---|
| `selfprotect.policy-file` | `apply_patch` hoặc lệnh shell ghi vào `codex-guardrail.json` |
| `selfprotect.hooks-file` | Ghi vào `~/.codex/hooks.json` hoặc `~/.codex/config.toml` |
| `selfprotect.install-dir` | Ghi vào thư mục cài guardrail |
| `selfprotect.escape-inline` | Command string **chứa** `CODEX_GUARDRAIL_ALLOW` — agent không được tự phát escape cho chính nó (§9) |

### 6.6 Chất lượng — `PreToolUse: apply_patch`

| ruleId | Chặn khi |
|---|---|
| `quality.test-tampering` | Patch xoá/nới assertion trong file test, hoặc thêm `.skip`, `.only`, `xit`, `xdescribe`, `@pytest.mark.skip`, `t.Skip(`, `@Disabled` |
| `quality.suppress-error` | Patch thêm `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `# type: ignore`, `# noqa`, `@SuppressWarnings`, hoặc `catch` với thân rỗng |
| `quality.ci-generated-file` | File đích khớp `quality.protectedPaths` |

`quality.protectedPaths` mặc định: `.github/workflows/**`, `dist/**`, `build/**`, `**/*.generated.*`, `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `poetry.lock`, `Cargo.lock`.

Ghi chú: lockfile bị chặn ở `apply_patch` để agent không sửa tay, và `deps.install-new` (§6.8) chặn lệnh sinh lockfile mới. Nghĩa là **thêm phụ thuộc mới là việc của người**, không phải của agent — dev tự chạy lệnh cài, hoặc escape một lần có ghi log.

### 6.7 Mạng — `PreToolUse: Bash`

| ruleId | Chặn khi |
|---|---|
| `net.curl-pipe-shell` | `curl`/`wget` có pipe sang `sh`/`bash`/`zsh`/`python` |
| `net.fetch-not-allowed` | `curl`/`wget` tới host không khớp `net.allowHosts` |

`net.allowHosts` mặc định: `registry.npmjs.org`, `pypi.org`, `files.pythonhosted.org`, `github.com`, `raw.githubusercontent.com`, `api.github.com`, `crates.io`.

### 6.8 Dependency — `PreToolUse: Bash`

`ruleId: deps.install-new` — chặn `npm i <pkg>`, `npm install <pkg>`, `yarn add`, `pnpm add`, `pip install <pkg>`, `cargo add`, `go get`, `gem install`.

Không chặn: `npm ci`, `npm install` không tham số, `pip install -r requirements.txt`, `poetry install`, `go mod download` — đây là cài lại từ manifest đã có, không thêm phụ thuộc mới.

`deps.enabled: false` tắt hẳn rule cho dự án đang trong giai đoạn chủ động thêm nhiều phụ thuộc.

### 6.9 Redact — `PostToolUse: Bash`

`ruleId: redact.stdout` — quét stdout tìm `AKIA[0-9A-Z]{16}`, `sk-[A-Za-z0-9]{20,}`, `ghp_`/`gho_`/`github_pat_`, JWT (`eyJ...`), `-----BEGIN * PRIVATE KEY-----`, `xox[baprs]-`. Phát hiện → cảnh báo vào stderr, không chặn (đã chạy rồi).

Cùng hàm `redact()` áp lên command string trước khi ghi audit log.

Rule này bổ khuyết lỗ đã thừa nhận ở §6.1: `grep -r "TOKEN" .` và `git diff` vẫn lôi được secret ra mà không hiện đường dẫn nào.

## 7. Ba tầng và rule nào thuộc tầng nào

| Rule | Hook local | CI/PR |
|---|---|---|
| `secrets.*` | ✓ | ✗ không để lại dấu trong diff |
| `infra.*` | ✓ | ✗ |
| `net.*` | ✓ | ✗ |
| `deps.install-new` | ✓ | ✓ thấy trong diff manifest/lockfile |
| `git.*` | ✓ | ✓ branch protection + lint commit message |
| `convention.lint` | ✓ | ✓ |
| `quality.*` | ✓ | ✓ |
| `selfprotect.policy-file` | ✓ | ✓ CODEOWNERS bắt lead duyệt |

**Rủi ro tồn dư đã chấp nhận:** các rule không hiện trong diff (`secrets`, `infra`, `net`) chỉ được bảo vệ ở tầng local. Một dev tháo hook thì không ai biết, vì v1 không có telemetry (quyết định #11). Ghi lại để lần sau xem xét lại có dữ liệu.

## 8. Policy

### 8.1 Schema `codex-guardrail.json` (gốc repo dự án)

```json
{
  "secrets":    { "denyPaths": [], "allowPaths": [] },
  "infra":      { "denyBinaries": [], "allowBinaries": [], "denyPatterns": [],
                  "ssh": { "denyHosts": [], "inspectRemoteCommand": true } },
  "git":        { "protectedBranches": [], "denyPatterns": [], "commitMessagePattern": "" },
  "convention": { "lintCommand": "", "lintExtensions": [], "lintTimeoutMs": 15000,
                  "conventionDocs": [] },
  "quality":    { "protectedPaths": [] },
  "net":        { "allowHosts": [] },
  "deps":       { "enabled": true }
}
```

Mọi khoá đều tuỳ chọn. Thiếu khoá nào thì lấy default.

### 8.2 Ngữ nghĩa merge

- Mảng `deny*` của dự án **hợp** (union) với default — dự án chỉ siết thêm được, không nới bằng cách xoá phần tử default.
- Mảng `allow*` của dự án **hợp** với default, và `allow*` **thắng** `deny*`.
- Chuỗi (`commitMessagePattern`, `lintCommand`) của dự án **ghi đè** default. Chuỗi rỗng nghĩa là tắt rule đó.
- Đây là đường nới policy chính thức: nới được, nhưng nới trong file có CODEOWNERS nên có người khác nhìn thấy.

### 8.3 `guardrail init`

Sinh `codex-guardrail.json` ban đầu bằng cách suy ra từ repo, để "git workflow trước đó của dự án" được nắm bắt mà không phải khai tay:

- Default branch từ `git symbolic-ref refs/remotes/origin/HEAD`
- Có dùng conventional commits hay không từ `git log --oneline -50`
- `lintCommand` từ `package.json` scripts, `Makefile`, `pyproject.toml`, `composer.json`
- `conventionDocs` từ các file tồn tại: `CLAUDE.md`, `AGENTS.md`, `docs/code-standards.md`

Nếu không tìm được lệnh lint, `init` in ra rõ: *"dự án này chưa khai báo lệnh lint — guardrail đang chạy ở chế độ chỉ-bảo-vệ, không nâng được chất lượng."*

## 9. Escape và audit

**Hai đường, có thứ tự ưu tiên rõ:**

1. **Đường tốt** — thêm entry vào `codex-guardrail.json`, mở PR, CODEOWNERS bắt lead duyệt. Vĩnh viễn, có người thấy, người escape không xoá được dấu.
2. **Đường nhanh** — `CODEX_GUARDRAIL_ALLOW=<ruleId>` cho đúng một rule, một phiên. Không hỗ trợ `*`, cố ý. Nhiều rule thì phân tách bằng dấu phẩy.

**Escape chỉ hợp lệ khi đã có trong môi trường của tiến trình Codex** — nghĩa là do người gõ `export` trước khi mở Codex. Nếu nó xuất hiện *trong* command string thì `selfprotect.escape-inline` chặn ngay: đó là agent tự phát escape cho chính nó.

**Audit log** `~/.codex/guardrail-audit.jsonl` (Windows: `%USERPROFILE%\.codex\`). Một dòng JSON mỗi lần `denied` hoặc `escaped`; lần `allow` không ghi để log khỏi phình.

```json
{"ts":"2026-08-25T14:00:00Z","decision":"denied","ruleId":"infra.deny-binary",
 "event":"PreToolUse","tool":"shell","repo":"italent-be","branch":"feat/x",
 "command":"psql -h *** -U ***"}
```

`command` đã qua `redact()`. `guardrail stats` đọc file này, tổng hợp theo `ruleId` để biết rule nào chặn oan nhiều nhất (nên nới) và rule nào chưa bắn lần nào (nên bỏ cho gọn).

## 10. Chế độ lỗi

Nguyên tắc: **bug trong rule an toàn thì thà chặn oan; bug trong rule chất lượng thì không được khoá cả phiên làm việc.**

| Tình huống | Xử lý |
|---|---|
| stdin rỗng / JSON hỏng | **Fail-closed** — không biết đang làm gì thì không cho làm |
| `codex-guardrail.json` sai cú pháp | **Fail-closed**, stderr chỉ rõ dòng lỗi |
| Không có `codex-guardrail.json` | Chạy default policy, cảnh báo một lần mỗi session |
| Không tìm được `.git` từ `cwd` | Chạy default policy — ngoài repo còn nguy hiểm hơn trong repo |
| `lintCommand` timeout hoặc không tìm thấy | Cho qua + cảnh báo |
| Rule an toàn ném exception (`secrets`, `infra`, `git`, `selfprotect`, `net`, `deps`) | **Fail-closed** |
| Rule chất lượng ném exception (`convention`, `quality`, `redact`) | **Fail-open** + cảnh báo |
| Thiếu Node | Hook không chạy được; không thể tự phát hiện từ bên trong → `install` verify lúc cài, `doctor` kiểm lại |

Exit code: `0` allow, `2` deny (message ở stderr), `3` lỗi nội bộ fail-closed.

## 11. Cài đặt và vận hành

```bash
npx github:mor-duongmh/codex-guardrail#v1.0.0 install
```

`install` phải:

- Verify Node >= 20, dừng với lỗi rõ nếu thiếu
- Bật `codex_hooks = true` trong `~/.codex/config.toml` nếu chưa bật
- **Merge** vào `~/.codex/hooks.json`, không ghi đè: backup `.bak` trước, chèn entry có marker `"_guardrail": true` để `uninstall` gỡ đúng phần của mình
- Idempotent: chạy lại không nhân bản entry

Trên máy đích, `~/.codex/hooks.json` đã có entry của morkit và tool khác — ghi đè sẽ giết hook đang chạy của dev.

Nếu Codex từ chối khoá lạ trong `hooks.json` (phải xác nhận cùng spike §16.2), marker chuyển sang file riêng `~/.codex/.guardrail-installed.json` ghi lại chính xác entry đã thêm, để `uninstall` gỡ đúng phần của mình mà không đoán.

### 11.1 Mỗi dự án phải làm ba việc

1. `npx github:mor-duongmh/codex-guardrail init` — sinh `codex-guardrail.json`, rà lại rồi commit
2. Thêm vào `CODEOWNERS`: `codex-guardrail.json @<lead>` — đây là thứ biến việc nới policy thành việc có người duyệt
3. Thêm CI check gọi `guardrail ci` vào workflow của PR

Thiếu bước 2 thì tầng thứ ba (§7) không tồn tại: dev nới policy trong PR của chính mình và tự merge.

`doctor` in: version, đường dẫn policy đang áp, danh sách rule đang bật/tắt và vì sao, kết quả kiểm Node + wiring.

## 12. Điều chỉnh rule về sau

| Mức | Cách làm | Ai |
|---|---|---|
| Một dự án | Sửa `codex-guardrail.json` | Dev, một PR, lead duyệt qua CODEOWNERS |
| Mọi dự án | Sửa `policy/default.json`, bump tag | Lead, một commit ở repo guardrail |
| Loại rule mới | Thêm module `lib/rules/`, đăng ký vào dispatcher | Cần code; contract `evaluate` giữ nguyên nên rule cũ không bị đụng |

**Cố ý không làm:** rule tự nới khi bị chặn nhiều. Guardrail tự nới sẽ mất tác dụng đúng lúc cần nhất, và bên bị chặn lại chính là bên có động cơ nới.

## 13. Yêu cầu phi chức năng

- **Độ trễ:** hook `PreToolUse` chạy trên **mọi** tool call. Ngân sách p95 < 150ms, trong đó ~40–80ms là Node cold start. Rule xếp rẻ trước đắt sau; `git rev-parse` chỉ gọi khi token lệnh đầu là `git`/`gh`; short-circuit ở deny đầu tiên.
- **Đa nền tảng:** macOS, Linux, Windows. Không dùng lệnh shell chỉ có trên Unix trong engine.
- **Không dependency runtime.**
- **Message chặn** phải nói được ba điều: vi phạm rule nào, vì sao, và làm gì tiếp.

## 14. Kiểm thử

- **Unit** — mỗi rule là hàm thuần, test bằng object. Bắt buộc có ca lách: `/usr/bin/psql`, `env FOO=1 psql`, `bash -c "psql …"`, `sh -c`, `eval`, `$(which psql)`. `tokenize.mjs` phải so **basename** của mọi token trông như đường dẫn và soi phần trong `bash -c`/`sh -c`/`eval`.
- **Golden test cho message chặn** — stderr chính là thứ Codex đọc để tự sửa; message tệ thì nó loay hoay hoặc thử đường khác. Test giữ nguyên format.
- **Integration** — chạy `bin/guardrail.mjs` với JSON thật thu từ Codex, assert exit code + stderr.
- **Test cho `install`** — merge vào `hooks.json` đã có nội dung, assert entry cũ còn nguyên và `uninstall` gỡ đúng phần của mình.
- **CI matrix** — macOS, Linux, Windows.
- **Smoke tay một lần** — bật hook thật trong Codex, thử 5 lệnh, xác nhận bị chặn. Không tự động hoá được vì cần Codex chạy thật.
- **Test độ trễ** — assert p95 < 150ms trên tập lệnh mẫu.

## 15. Giới hạn đã biết — ghi vào README, không che

1. **Không chống người cố tình lách.** `$(printf 'ps'; printf 'ql')` không bắt được. Guardrail chống tai nạn và chống agent hớ hênh.
2. **`grep -r` và `git diff` vẫn lôi được secret** mà không hiện đường dẫn nào. `redact.stdout` giảm thiệt hại, không chặn.
3. **`ssh` chỉ soi được lệnh remote viết thẳng trong command.** ProxyJump, `-F` custom config, hoặc lệnh remote sinh động thì lọt.
4. **Rule không hiện trong diff chỉ có một tầng bảo vệ** (§7). Không có telemetry ở v1 nên dev tháo hook là không ai biết.
5. **Guardrail cưỡng chế thứ dự án đã có.** Repo không có lint thì `convention.lint` không có gì để chạy.
6. **Interpreter đọc được file mà không nêu tên file theo cách rule thấy.** Đo được: `python -c "print(open('.env').read())"` lọt, và `node -e` / `ruby -e` / `perl -e` cũng vậy. Đây là trần cưỡng chế của cách khớp theo đường dẫn, không phải bug vá được: chặn mọi interpreter kèm `-c`/`-e` sinh false positive khổng lồ. Dev cần biết giới hạn này để không tin guardrail quá mức.
7. **Chặn xoá root bằng regex chưa phủ hết vị trí tham số.** `rm -rf ./build /` (root là tham số thứ hai) lọt, và `~foo` — home của **user khác** — chưa được coi ngang `~`. Cách sửa đúng là kiểm ở mức token thay vì thêm nhánh regex; xem §6.2.
8. **Cửa thoát `allowBinaries` thô ở mức binary, không ở mức subcommand.** Hệ quả đo được: `npx wrangler dev`, `npx supabase start`, `npx vercel dev`, `npx supabase gen types --local` đều bị chặn — lệnh local, chỉ đọc, chạy nhiều lần mỗi ngày. Dev cần `supabase gen types` buộc phải mở `allowBinaries: ["supabase"]`, tức mở luôn `supabase db reset --linked`. Đây là đường dẫn thực tế tới "dev tắt guardrail". Cần `allowPatterns` (cửa thoát theo subcommand) ở bản sau; giữ thế trận deny-list ở v1 là quyết định có chủ đích, không phải bỏ sót.
9. **`ssh` lồng hai tầng lọt.** `ssh h1 "ssh h2 psql"` không bị soi, vì lần gọi lồng đã tắt `inspectRemoteCommand` để chống đệ quy vô hạn.

## 16. Ẩn số cần spike trước khi code

1. **`SessionStart` của Codex có bơm được `additionalContext` không.** Nếu không, nửa "phòng" của rule convention (§6.4) phải chuyển sang `UserPromptSubmit`. Ảnh hưởng: chỗ wiring, không ảnh hưởng kiến trúc.
2. **Định dạng JSON thật mà Codex đẩy vào stdin cho từng event** — tên khoá của `tool_input` cho `shell` và `apply_patch`, và `PostToolUse` có mang stdout của tool hay không. `redact.stdout` (§6.9) phụ thuộc điều này; nếu không có stdout thì rule đó phải bỏ khỏi v1.
3. **Codex có tôn trọng exit code non-zero của `PreToolUse` như một deny thật** hay chỉ ghi cảnh báo. Toàn bộ thiết kế dựa trên điều này — spike đầu tiên, trước mọi thứ khác.
