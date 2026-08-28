# codex-guardrail — nhóm rule `deploy.*`

**Ngày:** 2026-08-28
**Trạng thái:** chờ review
**Bổ sung cho:** [2026-08-25-codex-guardrail-design.md](2026-08-25-codex-guardrail-design.md) — §6 (đặc tả rule), §7 (ba tầng), §8 (policy), §15 (giới hạn)

---

## 1. Vấn đề

Nguyên văn từ người dùng:

> Dev nhờ AI deploy nhưng không đưa ra rõ yêu cầu deploy lên đâu nên AI tự đoán và deploy public lên 1 domain free hoặc server không xác định.

Gốc vấn đề **không phải** "AI dùng lệnh xấu". Nó là: **yêu cầu của người mơ hồ, AI lấp khoảng trống bằng phỏng đoán.** Guardrail không đọc được ý định, nên nó không thể biết đích nào là đúng. Điều nó làm được là **làm cho việc không chỉ định trở thành bất khả** — biến một phỏng đoán mở thành một câu hỏi đóng.

Deploy khác các nhóm rule đã có ở một điểm quyết định: **nó không hoàn tác được và hướng ra ngoài.** Một URL public đã tồn tại thì có thể đã bị index kể cả sau khi xoá. Điều này ảnh hưởng tới §9 (giới hạn) và tới mức trung thực bắt buộc của tài liệu.

---

## 2. Trần cưỡng chế — đo trước khi thiết kế

Mọi số dưới đây đo trên engine tại `d0ccc88`, không phải phỏng đoán.

### 2.1 Công cụ deploy: 9 chặn / 10 lọt

Đã chặn qua `infra.deny-binary`: `vercel --prod`, `npx vercel --prod`, `wrangler deploy`, `flyctl deploy`, `terraform apply`, `kubectl apply`, `aws s3 sync --acl public-read`, `gcloud run deploy --allow-unauthenticated`. Cộng `npm publish --access public` qua `infra.deny-pattern`.

**Lọt hoàn toàn:** `netlify deploy --prod`, `firebase deploy`, `surge ./dist my-app.surge.sh`, `railway up`, `docker push docker.io/me/app`, `npx gh-pages -d dist`, `scp -r dist deploy@1.2.3.4:/var/www`, `rsync -avz dist deploy@1.2.3.4:/var/www`, `ssh deploy@1.2.3.4 "./deploy.sh"`, `curl -X POST https://... --data-binary @dist.zip`.

`git push heroku main` **có** bị chặn nhưng **tình cờ**: `git.protected-branch` bắt vì refspec chứa `main`, không vì đích là heroku.

**Kết luận:** thêm binary vào denylist là trận thua. Tập công cụ deploy là mở; cùng một binary vừa an toàn vừa nguy hiểm tuỳ subcommand (đo được: `wrangler dev`, `vercel dev`, `npx wrangler dev` — server dev local vô hại — **đều bị chặn cứng**, đây chính là ma sát khiến dev tháo guardrail); và deploy đi qua được `ssh`/`scp`/`rsync`/`curl`/`git push`, những thứ không bao giờ cấm được.

### 2.2 Cơ chế ssh đã có, nhưng sai cực

`policy.infra.ssh.denyHosts` mặc định là `[]`. Đo được khi khai `denyHosts: ['1.2.3.4']`:

| Lệnh | Mặc định | Có khai |
|---|---|---|
| `ssh deploy@1.2.3.4 "./deploy.sh"` | LỌT | CHẶN `infra.ssh-deny-host` |
| `scp -r dist deploy@1.2.3.4:/var/www` | LỌT | CHẶN `infra.ssh-deny-host` |
| `ssh prod "./deploy.sh"` | LỌT | **LỌT** |
| `ssh deploy@1.2.3.4 "psql -c drop"` | CHẶN `infra.ssh-remote-command` | CHẶN |

Máy móc đã chạy được, kể cả cho `scp`. Hai vấn đề: nó là **deny-list** (vô dụng với "host chưa ai nghĩ tới"), và **alias `ssh_config` lọt bất kể** — guardrail thấy token `prod`, không thấy host thật.

### 2.3 `net.allowHosts` không dùng lại được cho deploy

Mặc định 7 mục: `registry.npmjs.org, pypi.org, files.pythonhosted.org, github.com, raw.githubusercontent.com, api.github.com, crates.io`.

- Dự án khai thêm 3 → 10 mục. **Mảng HỢP, không thay.**
- Dự án khai `allowHosts: []` → **vẫn còn 7 mục.** Không thu hẹp được.
- Glob hoạt động trên hostname, nhưng `*` **đi qua cả dấu chấm**: `*.acme.internal` khớp `a.b.acme.internal`.

`github.com` **phải** với tới được để `npm install` chạy, nhưng **tuyệt đối không** được là đích deploy hợp lệ — đó chính là cách code bị push lên repo public. Một danh sách phẳng không thể vừa nghĩa "được với tới để tải phụ thuộc" vừa nghĩa "được phép làm đích deploy".

**Quyết định:** `deploy` KHÔNG dùng `net.allowHosts`. Hai mục đích, hai danh sách, hai mức duyệt.

### 2.4 Bảo vệ script deploy: đã chạy sẵn, không cần code mới

`selfProtect.protectedPaths` là object `ruleId -> [glob]` và merge đệ quy, nên dự án thêm được nhóm riêng. Đo được với `{"deploy.script": ["scripts/deploy.sh", "Makefile"]}`:

```
CHẶN deploy.script | rm scripts/deploy.sh
CHẶN deploy.script | echo hacked > scripts/deploy.sh
CHẶN deploy.script | mv scripts/deploy.sh /tmp/x
CHẶN deploy.script | apply_patch scripts/deploy.sh
cho qua            | apply_patch src/index.js
```

ruleId là của **dự án**, nên khoá escape cũng theo dự án. Nhóm này không cần gì mới.

### 2.5 Môi trường thực tế

Deploy chạy bằng **script sẵn có trong repo, mỗi dự án một kiểu**. Host **vừa** tên thật **vừa** alias `~/.ssh/config`. Team có dev trên **Windows và Ubuntu**. `~/.ssh/config` của lead: 3 khối `Host`, cả 3 có `HostName`, không `Include`, không `Match`, không `ProxyJump`, không wildcard.

Ngân sách độ trễ hiện tại: hook p95 **27.8ms**, ngân sách §13 spec chính là **150ms**.

---

## 3. Quyết định đã chốt

1. **Nhóm rule `deploy` không chứa tên công cụ nào.** Mỗi dự án một kiểu, nên kiến thức dự án thuộc `codex-guardrail.json`; nhóm `deploy` chỉ cung cấp cơ chế. Một danh sách `vercel|netlify|firebase|...` trong logic rule là chỗ phải bảo trì vô hạn.

   Nói cho chính xác: `infra.denyBinaries` mặc định **có** 21 tên, trong đó có `vercel`, `wrangler`, `flyctl`, `heroku`. Đó là DỮ LIỆU policy có từ trước, dự án nới được, và nó không nằm trong logic của nhóm `deploy`. Ranh giới là: danh sách công cụ sống trong policy (dữ liệu, sửa được, có CODEOWNERS); nhóm `deploy` sống trong code và không biết tên công cụ nào.

2. **Cưỡng chế dựa trên dữ liệu ĐÃ KHAI, không dựa trên "có đủ trường".** Một AI đang đoán sẽ điền đủ cả ba trường bằng giá trị đoán — `--branch=main --host=my-app.surge.sh --user=deploy` là đủ ba và vẫn sai hoàn toàn. **Đầy đủ ≠ đúng.** Phép kiểm là "khớp một entry đã khai"; chưa khai thì chặn.

3. **Host và ssh KHÔNG vào cấu hình guardrail.** Chúng nằm trong script, và script nằm trong repo có CODEOWNERS — tức chúng đã được review. Guardrail không cần thấy thứ nó không cần quyết định. Đây là đơn giản hoá do §2.5 mở ra.

4. **Buộc branch và target vào cùng một entry.** Ba mảng phẳng (`branches: [...]`, `hosts: [...]`) làm tổ hợp `branch=develop` + `host=prod-1` thành hợp lệ — deploy nhánh develop lên production mà mọi giá trị đều "có trong danh sách". Buộc vào một entry làm **tổ hợp sai không biểu diễn được**.

5. **Không đọc `~/.ssh/config` trên đường cưỡng chế.** Hai lý do: (a) đó là file của dev, **không có CODEOWNERS** — agent thêm `Host prod / HostName evil.example.com` là repoint được alias đã allow, biến allow-list thành vô nghĩa mà vẫn *trông như* đang bảo vệ; (b) nó là topology nội bộ, và guardrail đã có nguyên tắc chỉ đọc thứ cần và không in lại (áp cho `config.toml` vì file đó có thể chứa token).

6. **Allow-list theo alias là đủ cho threat model này.** AI không thể bịa ra một tên đã khai: `1.2.3.4`, `my-app.surge.sh`, `vercel --prod` đều không phải `prod` hay `staging`. Nó **không** chống dev cố tình sửa `ssh_config` — nhưng đó là §15 giới hạn #1 của spec chính, ngoài phạm vi từ đầu.

7. **Chưa khai `deploy` thì `doctor` phải nói ra.** Không thì một dự án được zero bảo vệ deploy mà không ai biết — đúng lỗi `deps.enabled: true` đã vá ở `f92156c`.

8. **Càng nhiều đích, allow-list càng yếu — nên đích hệ quả cao phải đòi một hành động chỉ NGƯỜI làm được.** Một dự án deploy nhiều chỗ (đây là ca thực tế, không phải giả định) làm threat model dịch chuyển: từ *"AI chọn chỗ CHƯA khai"* sang *"AI chọn SAI chỗ ĐÃ khai"*. Allow-list không giải được cái sau — `prod` đã khai nên `./deploy.sh prod` qua, và nếu đang ở `release/1.2` thì branch check cũng qua. Với một đích, allow-list là đảm bảo thật; với năm đích, nó gần như chỉ còn là phép kiểm chính tả.

   Cơ chế: mỗi target có ruleId riêng `deploy.target.<name>`, và target khai `requireHumanEscape: true` thì LUÔN bị chặn cho tới khi người gõ `CODEX_GUARDRAIL_ALLOW=deploy.target.prod` trong shell TRƯỚC khi mở Codex. Đo được: escape khớp chuỗi chính xác trên ruleId nên ruleId bất kỳ đều dùng được, và `deploy.*` KHÔNG phải wildcard nên không thể escape gộp cả nhóm.

   Vì sao đây là kênh chỉ người dùng được: đo ở Task 9/10 — `export` bên trong một tool call KHÔNG lan tới tiến trình Codex, và `selfprotect.escape-inline` chặn agent viết biến đó vào command. Giới hạn của nó ở §9.7.

9. **Deploy thì HỎI người, không chặn thẳng — nhưng phải hạ về chặn khi không chắc có người trả lời.** Đây là thay đổi có ý thức đối với quyết định nền của spec chính (chặn cứng, không hỏi-duyệt). Lý do đổi chỉ áp cho nhóm này: **hỏi chỉ an toàn khi hành động HIẾM.** Deploy là việc hiếm và cố ý, nên một prompt là đúng chỗ. `cat .env` trong một vòng lặp thì không — hỏi ở đó sinh prompt fatigue, người bấm qua theo phản xạ, và "hỏi" biến thành "cho qua" về mặt hành vi. Vì vậy nhóm `deploy` dùng `ask`, các nhóm khác giữ nguyên chặn cứng.

   Đo được: `ask` là giá trị hợp lệ của `permissionDecision` trong Codex 0.150.1 (`PreToolUsePermissionDecisionWire` có `ask`; `PreToolUseDecisionWire` có `approve|block|allow|deny`).

   **NHƯNG:** mọi payload thật Task 0 bắt được đều có `"permission_mode": "bypassPermissions"`, và `lib/` hiện KHÔNG đọc trường đó. Nếu ở chế độ đó Codex tự duyệt `ask`, thì confirm âm thầm thành cho-qua — đúng lớp lỗi "trông như được bảo vệ mà không". Nên bắt buộc:

   - `buildContext` phải đọc `permission_mode` vào ctx.
   - Nhóm `deploy` chỉ phát `ask` khi mode KHÔNG phải chế độ bỏ qua quyền. Ở chế độ bỏ qua quyền, `ask` **hạ về `deny`** và dùng `requireHumanEscape` (§5.6) làm cửa duy nhất.
   - Chưa đo được hành vi thật của `ask` dưới `bypassPermissions` thì thiết kế phải GIẢ ĐỊNH nó không hỏi. Xem §11.4.

---

## 4. Phân vai — ai đảm bảo thông tin nào

| Thông tin | Ai đảm bảo | Vì sao |
|---|---|---|
| server/host | **script** (đã review) | nằm trong script, guardrail không thấy |
| ssh user/key | **script** (đã review) | như trên |
| **branch** | **guardrail** | `currentBranch()` đã tồn tại từ Task 8 |
| target đã được khai chưa | **guardrail** | đọc `deploy.targets` |
| **dev có chỉ định rõ chưa** | **guardrail** | entrypoint gọi trơn = chặn |
| script không bị agent sửa | **guardrail** | đã chạy (§2.4) |
| không có cửa nào khác | **guardrail** | `deploy.direct-tool` |
| mapping target → host có đúng | **CODEOWNERS** | review script |
| script từ chối target lạ | **script** — xem §7 | guardrail không cưỡng chế được |

Guardrail không cần *hiểu* deploy. Nó đảm bảo: **có chỉ định rõ, chỉ định đó đã được khai, branch khớp, script nguyên vẹn, và không có cửa nào khác.**

---

## 5. Đặc tả rule

Nhóm `deploy` là **rule an toàn** (§10 spec chính): ném exception thì fail-closed.

### 5.1 `deploy.no-target` — `PreToolUse: Bash`

Lệnh khớp một `deploy.entrypoints` nhưng **không có tham số target nào**. Đây là rule trả lời trực tiếp §1: *chưa chỉ định = chặn.*

```
✗ guardrail chặn: deploy.no-target

  Vì sao: ./scripts/deploy.sh được gọi mà không chỉ định deploy lên đâu
  Target đã khai: staging (develop), prod (release/*)
  Làm gì tiếp: hỏi người dùng deploy lên môi trường nào, rồi gọi lại kèm tên đó
```

Chỉ bật khi `requireExplicitTarget: true` (mặc định `true`).

### 5.2 `deploy.undeclared-target` — `PreToolUse: Bash`

Lệnh khớp entrypoint và **có** tham số, nhưng tham số đó không khớp `name` của bất kỳ target nào.

Message phải **liệt kê các target đã khai**. Đó là thứ biến câu hỏi mở thành câu hỏi đóng, tức là phần giải quyết §1.

### 5.3 `deploy.branch-mismatch` — `PreToolUse: Bash`

Target khai hợp lệ, nhưng branch hiện tại không khớp `branches` của **chính target đó**. So bằng `globToRegExp` (đã có) nên `release/*` hoạt động.

Chỉ có ĐÚNG MỘT target mỗi lệnh (§11.2 đã chốt: deploy tuần tự), nên không cần vòng lặp qua nhiều target.

**Ràng buộc latency:** chỉ gọi `currentBranch()` khi lệnh ĐÃ khớp một entrypoint. Deploy là việc hiếm, còn hook chạy trên mọi tool call — spawn `git` trên đường allow là trả phí cho việc không xảy ra. Cùng nếp với `git.*` (Task 10: `currentBranch` chỉ gọi trên nhánh deny/escaped).

### 5.4 `deploy.ambiguous-target` — `PreToolUse: Bash`

Lệnh khớp entrypoint và nêu **nhiều hơn một** target đã khai (`./deploy.sh staging prod`).

Đây KHÔNG phải mục trang trí. Nếu cho qua rồi lấy target đầu tiên, guardrail sẽ áp `branches` của `staging` trong khi script deploy cả `prod` — tức một đường lách thật. Và vì deploy là tuần tự (§11.2), lệnh nhiều đích nằm ngoài cách dùng đã khai.

```
✗ guardrail chặn: deploy.ambiguous-target

  Vì sao: lệnh nêu 2 đích (staging, prod) — không xác định được branch rule nào áp
  Làm gì tiếp: deploy tuần tự, mỗi lệnh một đích
```

Không có target nào thì là `deploy.no-target` (§5.1); nhiều hơn một thì là mục này. Nghĩa là entrypoint chỉ chạy với **đúng một** target.

### 5.5 `deploy.direct-tool` — `PreToolUse: Bash`

Lệnh dùng công cụ deploy trực tiếp thay vì đi qua entrypoint. Nhận diện **không theo tên binary cứng trong code** (§3.1) mà theo `deploy.denyDirect` — mảng regex do dự án khai, mặc định `[]` — cộng phần `infra.denyBinaries` đã chặn 9 công cụ ở §2.1.

`denyDirect` khớp **tiền tố của lệnh hữu hiệu từng segment**, cùng ngữ nghĩa với `infra.denyPatterns` (§6.2 spec chính) để không sinh thêm một kiểu khớp thứ hai mà người viết policy phải học riêng. Nghĩa là nó đi qua `effectiveArgv` nên `sudo`/`npx`/`nice -n` được bóc trước khi so.

Mười công cụ lọt ở §2.1 được xử bằng **dữ liệu policy** (thêm vào `infra.denyBinaries`), không bằng logic mới — vì danh sách đó vốn đã là dữ liệu dự án nới được.

**Thứ tự trong REGISTRY:** `deploy` chạy **trước** `infra`. Lý do: `vercel --prod` bị cả hai bắt, và ruleId được báo là ruleId người dùng sẽ gõ để escape. `deploy.direct-tool` nói "hãy dùng script", còn `infra.deny-binary` chỉ nói "binary bị chặn" — cái đầu hành động được, cái sau không.

### 5.6 `deploy.target.<name>` — đích hệ quả cao đòi người xác nhận

Đây là **cửa lùi** khi `ask` không dùng được (§3.9): ở chế độ bỏ qua quyền, prompt của Codex không đáng tin nên xác nhận phải đi qua kênh mà agent không với tới được.

Target khai `requireHumanEscape: true` thì bị chặn kể cả khi target đã khai VÀ branch khớp. Chỉ qua khi người đã đặt `CODEX_GUARDRAIL_ALLOW=deploy.target.<name>` trong shell trước khi mở Codex.

```
✗ guardrail chặn: deploy.target.prod

  Vì sao: prod là đích hệ quả cao, cần người xác nhận chứ không để agent tự quyết
  Làm gì tiếp: hỏi người dùng có thật sự muốn deploy prod. Nếu có, HỌ tự gõ
    trong shell rồi mở lại Codex:  export CODEX_GUARDRAIL_ALLOW=deploy.target.prod
```

ruleId phải chứa tên target, không dùng chung một `deploy.high-consequence`: dùng chung thì một lần escape mở cho MỌI đích hệ quả cao, mà cả điểm của nó là mở đúng một đích.

Quyết định escaped vẫn được ghi audit (`decision: 'escaped'`), nên một lần deploy prod do người mở vẫn để lại vết.

### 5.7 `deploy.script` — dự án tự khai, không phải rule của plugin

Bảo vệ script bằng `selfProtect.protectedPaths` (§2.4). Plugin **không** ship nhóm này; `init` sinh nó vào file dự án.

---

## 6. Policy schema

```json
{
  "deploy": {
    "entrypoints": ["./scripts/deploy.sh"],
    "requireExplicitTarget": true,
    "denyDirect": [],
    "targets": [
      { "name": "staging", "branches": ["develop"] },
      { "name": "demo",    "branches": ["develop", "main"] },
      { "name": "prod",    "branches": ["release/*"], "requireHumanEscape": true }
    ]
  },
  "selfProtect": {
    "protectedPaths": { "deploy.script": ["scripts/deploy.sh"] }
  }
}
```

**Không có `hosts` và `ssh`** — theo §3.3 chúng ở trong script.

### 6.1 Ràng buộc bắt buộc về mặc định

`deploy.entrypoints`, `deploy.denyDirect`, `deploy.targets` trong `policy/default.json` phải là `[]` **và mãi mãi rỗng**. Vì `mergePolicy` HỢP mảng chứ không thay (đo ở §2.3), nếu bản mặc định có sẵn dù chỉ một mục thì **mọi dự án sẽ không bao giờ xoá được nó**.

`requireExplicitTarget` là boolean nên thay được — đó là lý do nó là boolean chứ không phải mảng.

### 6.2 Alias và tên thật

Cả hai đều là `name` của target. Dự án dùng alias `prod` thì `name: "prod"`; dùng tên thật thì `name` là tên thật. Guardrail chỉ so tham số của lệnh với `name` — nó không cần biết cái nào là cái gì. Đây là lý do ca "cả hai" không cần thiết kế riêng.

---

## 7. Yêu cầu ngược lại phía script — mắt yếu nhất của chuỗi

**Script PHẢI từ chối target không nằm trong danh sách của nó, và exit khác 0.**

Nếu `./deploy.sh prod` hợp lệ nhưng script cũng chấp nhận `./deploy.sh bất-kỳ-gì` rồi tự chọn mặc định, thì phép kiểm của guardrail bị đi vòng: agent gõ đúng một target đã khai, script lại deploy đi nơi khác.

Guardrail **không cưỡng chế được** điều này — nó nằm trong script. Ghi tường minh thay vì để ngầm.

`guardrail ci` (Plan 3) test được: chạy entrypoint với target rác, đòi exit khác 0. Ghi thành yêu cầu của Plan 3.

---

## 8. `init` và `doctor`

### 8.1 `init` dò sẵn phần deploy

Cùng khuôn đã có với `lintCommand` (§8.3 spec chính): dò `scripts/deploy*`, script `deploy` trong `package.json`, target `deploy:` trong `Makefile`.

- Tìm được → điền `entrypoints`, sinh sẵn `selfProtect.protectedPaths["deploy.script"]`.
- Không tìm được → **để trống và nói ra**, không đoán.
- `targets` **luôn để trống**. `init` không suy ra được tên môi trường, và đoán ở đây là đoán chính thứ cần review.

### 8.2 `doctor` phải nói khi chưa khai

```
⚠ deploy — dự án chưa khai entrypoint hay target nào, nhóm deploy KHÔNG cưỡng chế gì
```

Và khi khai **một nửa** (có `entrypoints`, `targets` rỗng) cũng phải nói — vì lúc đó mọi lệnh deploy đều bị `deploy.undeclared-target` chặn, tức guardrail chặn 100% chứ không phải bảo vệ đúng. Hai trạng thái đó khác nhau và phải hiện khác nhau.

### 8.3 `doctor` phát hiện alias bị repoint

Ngoài đường nóng, `doctor` resolve `name` của target trong `~/.ssh/config` (khả thi trên môi trường thật, §2.5). Nếu resolve được và host khác thường thì cảnh báo.

Đây là **phát hiện**, không phải cưỡng chế — cùng khuôn với bản ghi trust (doctor báo có/không và nói thẳng nó không kiểm được hash). Gặp `Include`/`Match` thì phải nói **"không resolve được"**, không được đoán.

---

## 9. Giới hạn đã biết — ghi vào README, không che

1. **Guardrail không thấy bên trong script.** Host, ssh, và mọi thứ script làm đều ngoài tầm. Đảm bảo có được là "không có cửa nào khác ngoài script đã review", **không phải** "deploy đi đúng chỗ".
2. **Script từ chối target lạ là điều kiện không cưỡng chế được** (§7). Chuỗi chỉ mạnh bằng mắt này.
3. **Alias `~/.ssh/config` có thể bị repoint** và guardrail không biết (§3.5). `doctor` phát hiện được, nhưng chỉ khi có người chạy nó.
4. **Không nở biến môi trường.** `./deploy.sh $TARGET` — guardrail thấy `$TARGET`, không thấy giá trị. Cùng giới hạn §15 #12 spec chính. Hệ quả cụ thể: dạng này bị `deploy.undeclared-target` chặn — lệch về phía chặn, đúng hướng, nhưng là ma sát thật cần ghi.
5. **Deploy không hoàn tác được.** Với nhóm này, tầng 1 mỏng hơn các nhóm khác: dev tháo hook được, `python -c` lách được, và một URL public đã tồn tại thì có thể đã bị index. Sức nặng thật nằm ở tầng 2/3 và ở kiểm soát phía nhà cung cấp.
6. **`requireHumanEscape` mạnh trong phiên, không airtight qua phiên.** Agent KHÔNG tự phát escape được trong phiên (đo ở Task 9/10), nhưng nó ghi được `export CODEX_GUARDRAIL_ALLOW=deploy.target.prod` vào `~/.zshrc` và **phiên Codex sau thừa hưởng** — cùng giới hạn §15 #3/#10 spec chính, và các file rc cố ý không nằm trong `selfProtect.protectedPaths`. Nên nó chặn được "agent tự cho phép mình ngay lúc này", không chặn được "agent cài sẵn rồi đợi".

7. **`ask` chỉ đáng tin khi có người thật trả lời.** Nếu phiên chạy ở chế độ bỏ qua quyền, hoặc chạy không người trực (cron, CI, agent nền), thì prompt không có ai bấm. Guardrail hạ về `deny` trong trường hợp đó (§3.9), nghĩa là **deploy không chạy được trong phiên không người trực** — đó là hành vi đúng cho một hành động không hoàn tác được, nhưng phải nói ra vì nó là ma sát thật.

8. **Thứ mạnh nhất không phải guardrail.** Nếu deploy token không nằm trên máy dev thì AI đoán gì cũng không deploy được. Deploy từ CI với protected environment. Guardrail không thay được điều đó, và tài liệu không được ngụ ý là thay được.

---

## 10. Kiểm thử

Ngoài các nguyên tắc đã có (§14 spec chính), nhóm này bắt buộc:

- **Cả hai chiều cho từng rule.** Đặc biệt `deploy.branch-mismatch`: phải có ca branch ĐÚNG được cho qua, không chỉ ca sai bị chặn.
- **Tổ hợp sai không biểu diễn được** (§3.4): test rằng `branch=develop` + `target=prod` bị chặn, kể cả khi cả hai giá trị đều xuất hiện trong policy.
- **Chưa khai `deploy` thì nhóm là no-op hoàn toàn** — không được chặn oan dự án chưa cấu hình.
- **Đường allow không spawn `git`** (§5.3), kiểm qua test độ trễ: phần dôi của đường allow không được tăng.
- **Nền tảng:** `./scripts/deploy.sh` và `scripts\deploy.sh` phải khớp cùng một entry. Team có dev Windows (§2.5), và `tokenize()` vừa phải sửa đúng lớp lỗi này ở `d0ccc88`.
- **Mutation test** cho mỗi assert mới, theo nếp đã dùng cả Plan 1.

---

## 11. Ẩn số cần làm rõ trước khi code

1. **Script nhận target qua tham số vị trí hay cờ?** `./deploy.sh prod` hay `./deploy.sh --env=prod`. Ảnh hưởng cách bóc target ở §5.2. Mỗi dự án một kiểu thì có thể cần khai thêm, ví dụ `targetArg: "positional" | "--env"`.
2. ~~Có dự án nào deploy nhiều target trong một lệnh không?~~ **ĐÃ CHỐT 2026-08-28: deploy TUẦN TỰ, mỗi lệnh một đích.** Hệ quả: §5.3 không cần vòng lặp, và lệnh nhiều đích bị `deploy.ambiguous-target` chặn (§5.4).
3. **Mười công cụ lọt ở §2.1 có cái nào team đang dùng hợp lệ không?** Thêm vào `infra.denyBinaries` là chặn cứng; nếu `docker push` đang dùng cho registry nội bộ thì cần cửa thoát theo subcommand — vốn đã là mục nợ Plan 2.

4. **`ask` có thật sự hỏi dưới `permission_mode: "bypassPermissions"` không?** ẨN SỐ CHẶN THIẾT KẾ. Mọi payload thật Task 0 bắt được đều ở chế độ đó. Cần một spike đúng kiểu Task 0: phát `permissionDecision: "ask"` từ hook, chạy lệnh thật trong Codex, xem có prompt hay tự chạy. Ba kết quả, ba thiết kế khác nhau:
   - Có hỏi → `ask` là cơ chế chính, `requireHumanEscape` chỉ còn cho phiên không người trực.
   - Tự duyệt → `ask` VÔ DỤNG ở chế độ này; `requireHumanEscape` là cơ chế duy nhất, và phải ghi vào README rằng confirm không khả dụng khi chạy bypassPermissions.
   - Coi là hook lỗi → tuyệt đối không dùng `ask`, vì theo Task 0 hook lỗi = CHO LỆNH CHẠY.

   Cho tới khi đo, thiết kế giả định kết quả xấu nhất.

5. **Tên chính xác của các chế độ `permission_mode`.** Chỉ thấy `bypassPermissions` trong payload thật. Cần biết đủ tập giá trị để phân biệt "chế độ có hỏi" với "chế độ bỏ qua" — hardcode một chuỗi rồi đoán phần còn lại là cách sinh ra lỗ im lặng.
