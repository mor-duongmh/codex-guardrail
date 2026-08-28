# codex-guardrail — nhóm rule `deploy.*`

**Ngày:** 2026-08-28
**Trạng thái:** §11 đã đóng hết — sẵn sàng lập plan. Còn một rủi ro dư chưa đóng bằng quan sát: `ask` chưa từng thấy đi hết một vòng trong Codex (§11.4).
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

**Xử lý 10 mục lọt (chốt 2026-08-28):** 6 mục đầu bịt bằng dữ liệu policy — `surge`/`gh-pages` vào `denyBinaries`, `netlify deploy`/`firebase deploy`/`railway up`/`docker push` vào `denyPatterns` (§6.0, đo ở §11.3 và §2.6). 4 mục còn lại (`scp`/`rsync`/`ssh`/`curl`) **không chặn mà hỏi** — §5.7.

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

### 2.7 Phiên Codex thật KHÔNG có project root — và đó là trạng thái thường, không phải ca biên

Đo được 2026-08-28 trên máy lead, và đây là số đo đổi hướng nhiều nhất trong spec này.

Entry thật từ phiên Codex:

```json
{"ts":"2026-08-28T07:45:15.524Z","ruleId":"infra.deny-binary","repo":null,"branch":null,
 "cwd":"/Users/haiduong","command":"psql --version","permissionMode":"default"}
```

`pwd` chạy trong CHÍNH phiên đó in `/Users/haiduong`. Nên:

- `cwd` Codex gửi là **đúng** — schema khai `cwd` là trường BẮT BUỘC, và giá trị khớp `pwd`
- `findProjectRoot` trả null là **đúng** — home không có `.git`
- **Không có bug nào trong guardrail.** Lead mở Codex từ home, không từ thư mục dự án.

Hệ quả, và nó nghiêm trọng:

```
ctx.projectRoot = null
  -> loadPolicy(null) trả CHỈ policy mặc định
  -> codex-guardrail.json của dự án KHÔNG BAO GIỜ được đọc
```

| Thứ | Trạng thái khi mở Codex từ home |
|---|---|
| `infra.allowBinaries` nới qua PR | vô hiệu |
| `selfProtect.protectedPaths` dự án thêm (kể cả `deploy.script`) | vô hiệu |
| `git.protected-branch` | không biết branch |
| `deploy.entrypoints` / `deploy.targets` | vô hiệu |
| CODEOWNERS gác file policy (tầng 3) | không có tác dụng |

**Đây là cách team đang thực sự dùng**, nên nhóm `deploy` phải coi ca này là trạng thái hạng nhất, không phải ca biên. Xem §3.10.

### 2.6 Bịt ở mức subcommand: đo được, không cần code

`docker push` không được chặn bằng cách thêm `docker` vào `denyBinaries` — dev dùng `docker ps`/`build`/`compose` liên tục. Nhưng `infra.denyPatterns` khớp **tiền tố của lệnh hữu hiệu từng segment**, nên nó bịt được ở mức subcommand. Đây là cơ chế đang chặn `npm publish` sẵn.

Đo với `denyPatterns: ['docker\\s+push\\b']`:

| Kết quả | Lệnh |
|---|---|
| CHẶN | `docker push docker.io/me/app:latest` |
| CHẶN | `sudo docker push docker.io/me/app` (wrapper được `effectiveArgv` bóc) |
| CHẶN | `cd build && docker push me/app` (khớp theo segment) |
| cho qua | `docker ps`, `docker ps -a`, `docker build -t app .`, `docker compose up -d` |
| cho qua | `docker images`, `docker exec -it app sh`, `docker logs -f app`, `docker run --rm alpine echo hi` |
| cho qua | `grep -rn "docker push" docs/`, `echo docker push` |

4/4 chặn, 10/10 cho qua, kể cả hai bẫy false-positive điển hình (`grep`, `echo`).

**Hệ quả cho thiết kế:** mục nợ "`allowBinaries` thô ở mức binary" (§15 #10 spec chính) KHÔNG chặn nhóm `deploy`. Với công cụ mà chỉ MỘT subcommand là nguy hiểm, `denyPatterns` đã đủ. Cửa thoát theo subcommand vẫn cần cho chiều ngược lại (`wrangler dev` bị chặn oan trong khi `wrangler deploy` phải chặn), nhưng đó là bài toán riêng.

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

   **Tập chế độ, đo dứt điểm** từ JSON Schema NHÚNG TRONG binary codex 0.150.1:

   ```
   "permission_mode": { "enum": ["default","acceptEdits","plan","dontAsk","bypassPermissions"] }
   ```

   Sự tồn tại của một chế độ tên đúng là **`dontAsk`**, TÁCH BIỆT với `bypassPermissions`, là bằng chứng mạnh rằng `ask` ĐƯỢC tôn trọng ở các chế độ khác — nếu không thì không cần một chế độ riêng để tắt nó.

   **CẢNH BÁO VỀ MỘT KHẲNG ĐỊNH SAI ĐÃ TỪNG NẰM Ở ĐÂY:** bản trước của mục này viết "mọi payload THẬT Task 0 bắt được đều có `bypassPermissions`". Sai. Fixture trong `tests/fixtures/codex-events/` là **viết tay** — `session_id` là UUID giả `01a00000-0000-7000-...`, ledger không nhắc `permission_mode` lần nào, và thư mục dump của `spike/dump-hook.mjs` (`~/guardrail-spike/`) không tồn tại. Giá trị `bypassPermissions` trong fixture là thứ ai đó gõ vào test, KHÔNG phải số đo. **Chế độ thật của máy dev: chưa biết** — `~/.codex/config.toml` không khai `approval_policy` hay `sandbox_mode` nào nên Codex dùng mặc định của nó.

   Đã làm để biết mà không phải dựng phiên spike: `buildContext` đọc `permission_mode` vào ctx và `dispatch` ghi nó vào audit log. Lần chạy bất kỳ tiếp theo trong Codex sẽ lộ chế độ thật, miễn phí. Bắt buộc còn lại:

   - ~~`buildContext` phải đọc `permission_mode` vào ctx.~~ **XONG** — cộng ghi vào audit log.
   - Nhóm `deploy` chỉ phát `ask` khi mode KHÔNG phải chế độ bỏ qua quyền. Ở chế độ bỏ qua quyền, `ask` **hạ về `deny`** và dùng `requireHumanEscape` (§5.8) làm cửa duy nhất.
   - Chưa đo được hành vi thật của `ask` dưới `bypassPermissions` thì thiết kế phải GIẢ ĐỊNH nó không hỏi. Xem §11.4.

10. **Không có project root thì `deploy.*` CHẶN TẤT CẢ, và nói rõ vì sao.** Đo được ở §2.7: phiên thật không có project root, nên `deploy.targets` rỗng.

    **SỬA 2026-08-28 — tuyên bố "chặn tất cả" ở trên là SAI, và đây là cách nó sai.** Tôi từng ghi nguyên tắc: *deny-list suy giảm êm, allow-list suy giảm thành chặn tất cả*. Nửa sau không đúng, vì một rule allow-list có HAI phần:

    1. **cò súng** — "lệnh này thuộc loại được quản" (`deploy.entrypoints`)
    2. **danh sách cho phép** — "giá trị nào hợp lệ" (`deploy.targets`)

    Cả hai đều là dữ liệu dự án. Mất policy là mất luôn **cò súng**, nên không lệnh nào bị coi là deploy, và nhóm cưỡng chế **con số không** — không phải chặn tất cả. `./scripts/deploy.sh` chạy thẳng.

    Nguyên tắc đúng: **allow-list suy giảm thành chặn tất cả CHỈ KHI cò súng nằm ở policy mặc định.** Nếu cò súng cũng là dữ liệu dự án thì nó suy giảm thành *không cưỡng chế gì* — hướng sai an toàn ngược lại hoàn toàn.

    Trạng thái thật khi mở Codex từ home, tách theo hai đường deploy:

    | Đường | Có được bảo vệ? | Vì sao |
    |---|---|---|
    | công cụ trực tiếp (`surge`, `netlify deploy`, `vercel --prod`…) | **có** | deny-list ở policy MẶC ĐỊNH (§6.0), không cần dữ liệu dự án |
    | script của dự án (`./scripts/deploy.sh prod`) | **KHÔNG** | chỉ dự án biết tên script, và policy dự án không được đọc |

    Nên nửa đầu nguyên tắc vẫn đúng và đang cứu chúng ta: `infra` deny-list giữ được đường thứ nhất. Lỗ là đường thứ hai.

    **Cách bịt, và nó cần cò súng ở bản mặc định:** thêm `deploy.detectScripts` vào `policy/default.json` — glob theo TÊN script (`**/deploy*.sh`, `**/deploy*.ps1`, `**/publish*.sh`), khớp chỉ khi script đó là **lệnh đang được thi hành** (argv[0] sau khi bóc wrapper), không phải khi nó là tham số. Đây không phải danh sách tên công cụ (§3.1 vẫn giữ) mà là một phỏng đoán về tên file, và nó chỉ dẫn tới `deploy.no-project-root` — một message bảo "mở Codex từ thư mục dự án", không phải một quyết định về đích.

    Bắt buộc đo trước khi nhận: `cat scripts/deploy.sh`, `vim deploy.sh`, `git diff scripts/deploy.sh`, `grep -rn deploy scripts/` đều phải qua. Nếu số đo cho thấy chặn oan, bỏ `detectScripts` và chấp nhận rằng đường thứ hai không bịt được — nhưng khi đó §9 #9 phải nói đúng là "không cưỡng chế gì", không được nói là "chặn tất cả".

    Ba lựa chọn, và lý do chọn cái thứ nhất:

    - **(chọn) Chặn, kèm message chỉ đúng nguyên nhân.** Fail-closed, và deploy từ một phiên không biết mình đang ở dự án nào thì đúng là không nên chạy.
    - Để rơi vào `deploy.undeclared-target`: cùng kết quả nhưng message sai hướng — nó bảo "khai target vào file policy", trong khi file đó không được đọc.
    - Cho qua: không xét, deploy là hành động không hoàn tác được.

    ruleId riêng `deploy.no-project-root` để message nói được nguyên nhân thật, và để escape của nó không lẫn với `deploy.undeclared-target`.

    Hạ tầng cho việc này ĐÃ CÓ (làm 2026-08-28, ngoài spec này): `doctor` đọc audit log và báo `✗ N/M lần chạy hook KHÔNG tìm được project root` kèm cwd thật; và deny message của mọi rule tự thêm cảnh báo `⚠ Đang chạy POLICY MẶC ĐỊNH` khi `projectRoot` là null.

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

### 5.0 Cách khớp entrypoint và bóc target — dùng chung cho §5.2–§5.4

**Khớp entrypoint:** tiền tố của `effectiveArgv(segment.argv)`, cùng ngữ nghĩa với `infra.denyPatterns` và `deploy.denyDirect` (§5.6) — không sinh thêm kiểu khớp thứ hai. Phải là **tiền tố nhiều token**, không phải `argv[0]`: `npm run deploy -- prod` cho argv `["npm","run","deploy","--","prod"]` (đo 2026-08-28), nên entrypoint `npm run deploy` chỉ khớp được bằng tiền tố.

**Bóc target: quét TOÀN BỘ argv sau entrypoint, không quan tâm vị trí hay cờ.** Mỗi token, so cả token nguyên và phần sau dấu `=` đầu tiên với `name` của các target đã khai. Số target khớp được là 0 → §5.2, đúng 1 → §5.3/§5.5, nhiều hơn 1 → §5.4.

Đo trên các dạng gọi thật (2026-08-28):

| Lệnh | argv hữu hiệu sau entrypoint | Token khớp `prod` |
|---|---|---|
| `./deploy.sh prod` | `prod` | ✓ |
| `./deploy.sh --env=prod` | `--env=prod` | ✓ (sau `=`) |
| `./deploy.sh --env prod` | `--env`, `prod` | ✓ |
| `make deploy ENV=prod` | `ENV=prod` | ✓ (sau `=`) |
| `./deploy.sh --dry-run prod` | `--dry-run`, `prod` | ✓ |
| `./deploy.sh --config prod.json` | `--config`, `prod.json` | — không khớp, đúng |
| `./deploy.sh` | *(rỗng)* | — → §5.2 |
| `./deploy.sh staging prod` | `staging`, `prod` | 2 → §5.4 |

**Đây là lý do §11.1 đóng được mà KHÔNG cần `targetArg` trong schema.** Câu hỏi "vị trí hay cờ" chỉ có nghĩa với một bộ bóc theo vị trí; quét cả argv làm nó không còn là câu hỏi, và phủ luôn dạng `ENV=prod` của Makefile mà cả hai lựa chọn `"positional" | "--env"` đều bỏ sót. Một trường schema ít hơn là một trường mỗi dự án không phải khai đúng.

**So khớp là chính xác cả token, không phải chứa.** Token `prod.json` không khớp target `prod`. Ca mơ hồ lệch về phía `deploy.no-target`/`undeclared-target` (chặn), không về phía cho qua.

#### 5.0.1 Lỗ vừa đo được: gọi entrypoint qua trình thông dịch

Đo cùng lượt trên (2026-08-28), `effectiveArgv` KHÔNG bóc trình thông dịch shell:

| Lệnh | argv hữu hiệu | Khớp entrypoint `./scripts/deploy.sh`? |
|---|---|---|
| `bash scripts/deploy.sh prod` | `bash`, `scripts/deploy.sh`, `prod` | **KHÔNG** |
| `sh ./deploy.sh prod` | `sh`, `./deploy.sh`, `prod` | **KHÔNG** |
| `source ./deploy.sh prod` | `source`, `./deploy.sh`, `prod` | **KHÔNG** |
| `env TARGET=prod ./deploy.sh` | `./deploy.sh` | có — `env` đã được bóc |
| `cd frontend && ./deploy.sh prod` | segment 2: `./deploy.sh`, `prod` | có — quét theo segment |

Ba dạng đầu **đi vòng toàn bộ nhóm `deploy`**: không khớp entrypoint thì không rule nào trong nhóm chạy, và lệnh được cho qua. Đây là lỗ hở thật, không phải ma sát.

**Cách bịt: thêm `bash`, `sh`, `zsh`, `source`, `.` vào `WRAPPERS` trong `lib/argv.mjs`** — một chỗ, không phải một bộ bóc riêng cho deploy. Lý do chọn sửa chỗ dùng chung:

- Bóc wrapper chỉ **phơi ra** lệnh thật, nên nó chỉ có thể làm rule cưỡng chế NHIỀU hơn, không thể làm cho qua nhiều hơn. Với 4 nhóm deny-list đang có, hướng đó là hướng đúng.
- Dạng `-c` không đổi gì: `bash -c "psql -l"` hôm nay cho `basename` là `bash`, sau khi sửa cho `"psql -l"` — cả hai đều không khớp `psql`. Lỗ `-c` là lỗ riêng, đã ghi ở §15 spec chính, và mục này không tuyên bố bịt nó.

**Bắt buộc:** thay đổi này chạm 4 nhóm rule đang có, nên phải chạy TOÀN BỘ suite (409 test lúc chốt spec) chứ không chỉ test của deploy, và phải có test cho từng dạng trong bảng trên.

### 5.1 `deploy.no-project-root` — `PreToolUse: Bash`

`ctx.projectRoot` là null **và** lệnh trông như một lệnh deploy.

Mệnh đề thứ hai là phần khó, và §3.10 giải thích vì sao: khi `projectRoot` null thì `deploy.entrypoints` rỗng, nên **không thể** dùng entrypoint làm cò súng — chính cò súng cũng đã mất. Cò súng phải nằm ở policy MẶC ĐỊNH: `deploy.detectScripts` (glob theo tên script) cộng phần `infra` đã chặn sẵn công cụ trực tiếp.

Phải là ruleId RIÊNG, không dồn vào `deploy.undeclared-target`: nguyên nhân khác nhau thì hành động khác nhau, và message của `undeclared-target` sẽ chỉ người dùng sửa một file đang không được đọc.

```
✗ guardrail chặn: deploy.no-project-root

  Vì sao: không tìm được .git từ cwd (/Users/haiduong), nên không đọc được
          codex-guardrail.json — guardrail không biết dự án này được deploy đi đâu
  Làm gì tiếp: mở Codex TỪ thư mục dự án rồi thử lại
```

Rule này chạy TRƯỚC `deploy.no-target` và `deploy.undeclared-target`: không biết dự án thì hai câu hỏi kia vô nghĩa.

### 5.2 `deploy.no-target` — `PreToolUse: Bash`

Lệnh khớp một `deploy.entrypoints` (§5.0) nhưng **không token nào khớp một target đã khai**. Đây là rule trả lời trực tiếp §1: *chưa chỉ định = chặn.*

Lưu ý: "không có target" ≠ "không có tham số". `./deploy.sh --dry-run` có tham số nhưng không có target, và nó phải bị chặn ở mục này.

```
✗ guardrail chặn: deploy.no-target

  Vì sao: ./scripts/deploy.sh được gọi mà không chỉ định deploy lên đâu
  Target đã khai: staging (develop), prod (release/*)
  Làm gì tiếp: hỏi người dùng deploy lên môi trường nào, rồi gọi lại kèm tên đó
```

Chỉ bật khi `requireExplicitTarget: true` (mặc định `true`).

### 5.3 `deploy.undeclared-target` — `PreToolUse: Bash`

Message phải **liệt kê các target đã khai**. Đó là thứ biến câu hỏi mở thành câu hỏi đóng, tức là phần giải quyết §1.

**Trùng lối với §5.2 là có chủ ý.** Với cách bóc ở §5.0 (đếm số target khớp: 0 / 1 / >1), "có tham số nhưng tham số lạ" và "không có tham số nào" đều cho số khớp là 0 — guardrail **không phân biệt được** `./deploy.sh` với `./deploy.sh xyz`. Hai ruleId vẫn tách vì hint khác nhau, nên tín hiệu để chọn là **argv sau entrypoint có rỗng hay không**:

| Lệnh | Số target khớp | ruleId |
|---|---|---|
| `./deploy.sh` | 0, argv rỗng | `deploy.no-target` |
| `./deploy.sh --dry-run` | 0, argv KHÔNG rỗng | `deploy.no-target` — xem §5.2 |
| `./deploy.sh xyz` | 0, argv KHÔNG rỗng | `deploy.undeclared-target` |

Hai dòng giữa xung đột: cả hai đều là "0 khớp, argv không rỗng". Phân biệt bằng **có token nào không bắt đầu bằng `-`** — `--dry-run` thì không, `xyz` thì có. Đây là heuristic, không phải suy luận chắc chắn, và nó **không ảnh hưởng quyết định** (cả hai đều chặn) — chỉ ảnh hưởng câu hint và ruleId người dùng gõ để escape. Ghi ra vì một heuristic không ghi ra là một heuristic sẽ bị người sau tưởng là định lý.

Cũng vì thế `./deploy.sh $TARGET` rơi vào `deploy.undeclared-target` (§9 #4): `$TARGET` không bắt đầu bằng `-`.

### 5.4 `deploy.ambiguous-target` — `PreToolUse: Bash`

Lệnh khớp entrypoint và nêu **nhiều hơn một** target đã khai (`./deploy.sh staging prod`).

Đây KHÔNG phải mục trang trí. Nếu cho qua rồi lấy target đầu tiên, guardrail sẽ áp `branches` của `staging` trong khi script deploy cả `prod` — tức một đường lách thật. Và vì deploy là tuần tự (§11.2), lệnh nhiều đích nằm ngoài cách dùng đã khai.

```
✗ guardrail chặn: deploy.ambiguous-target

  Vì sao: lệnh nêu 2 đích (staging, prod) — không xác định được branch rule nào áp
  Làm gì tiếp: deploy tuần tự, mỗi lệnh một đích
```

Không có target nào thì là `deploy.no-target` (§5.2); nhiều hơn một thì là mục này. Nghĩa là entrypoint chỉ chạy với **đúng một** target.

### 5.5 `deploy.branch-mismatch` — `PreToolUse: Bash`

Target khai hợp lệ, nhưng branch hiện tại không khớp `branches` của **chính target đó**. So bằng `globToRegExp` (đã có) nên `release/*` hoạt động.

Chỉ có ĐÚNG MỘT target mỗi lệnh (§11.2 đã chốt: deploy tuần tự), nên không cần vòng lặp qua nhiều target.

**Ràng buộc latency:** chỉ gọi `currentBranch()` khi lệnh ĐÃ khớp một entrypoint. Deploy là việc hiếm, còn hook chạy trên mọi tool call — spawn `git` trên đường allow là trả phí cho việc không xảy ra. Cùng nếp với `git.*` (Task 10: `currentBranch` chỉ gọi trên nhánh deny/escaped).

### 5.6 `deploy.direct-tool` — `PreToolUse: Bash`

Lệnh dùng công cụ deploy trực tiếp thay vì đi qua entrypoint. Nhận diện **không theo tên binary cứng trong code** (§3.1) mà theo `deploy.denyDirect` — mảng regex do dự án khai, mặc định `[]` — cộng phần `infra.denyBinaries` đã chặn 9 công cụ ở §2.1.

`denyDirect` khớp **tiền tố của lệnh hữu hiệu từng segment**, cùng ngữ nghĩa với `infra.denyPatterns` (§6.2 spec chính) để không sinh thêm một kiểu khớp thứ hai mà người viết policy phải học riêng. Nghĩa là nó đi qua `effectiveArgv` nên `sudo`/`npx`/`nice -n` được bóc trước khi so.

Mười công cụ lọt ở §2.1 được xử bằng **dữ liệu policy** (thêm vào `infra.denyBinaries`), không bằng logic mới — vì danh sách đó vốn đã là dữ liệu dự án nới được.

**Thứ tự trong REGISTRY:** `deploy` chạy **trước** `infra`. Lý do: `vercel --prod` bị cả hai bắt, và ruleId được báo là ruleId người dùng sẽ gõ để escape. `deploy.direct-tool` nói "hãy dùng script", còn `infra.deny-binary` chỉ nói "binary bị chặn" — cái đầu hành động được, cái sau không.

### 5.7 `deploy.undeclared-destination` — `PreToolUse: Bash` — quyết định `ask`

Nhóm B (`scp`, `rsync`, `ssh`, `curl`) **không chặn** — dev dùng hằng ngày. Thay vào đó **hỏi** trước khi chạy.

Nhưng hỏi mọi lần dùng bốn công cụ đó là sai: chúng không hiếm, nên nó sinh prompt fatigue và **huấn luyện dev bấm qua cả confirm deploy** (§3.9). Điều kiện hỏi phải hẹp hơn nhiều, theo HAI tín hiệu:

**1. Đích chưa được khai.** Không phải "dùng curl" mà "curl tới host không có trong danh sách".

**2. Lệnh ĐẨY dữ liệu ra, không phải lấy dữ liệu về.** Đây là tín hiệu giảm số prompt nhiều nhất, vì tải-về là việc thường xuyên còn đẩy-lên thì hiếm:

| Chiều | Ví dụ | Hỏi? |
|---|---|---|
| lấy về | `curl https://x`, `scp remote:file .`, `rsync remote:d ./` | không |
| đẩy lên | `curl -X POST --data-binary @dist.zip`, `curl -F`, `curl -T` | **hỏi** |
| đẩy lên | `scp ./dist host:/var/www`, `rsync ./dist host:/var/www` | **hỏi** |
| chạy lệnh từ xa | `ssh host "..."` | **hỏi** — không phải đọc |

Nhận diện chiều: với `scp`/`rsync`, tham số ĐÍCH (cuối) có dạng `host:path` thì là đẩy lên; với `curl`, có `-X POST|PUT`, `-d`/`--data*`, `-F`, `-T`/`--upload-file` thì là đẩy lên. Tách host dùng lại đúng đường đã có — `infra.ssh-deny-host` đã bóc được host từ cả `ssh` lẫn `scp` (đo ở §2.2).

```
⚠ guardrail hỏi: deploy.undeclared-destination

  Lệnh này ĐẨY dữ liệu tới 1.2.3.4 — host không có trong danh sách đã khai.
  Đích đã khai: staging.acme.internal, prod-1.acme.internal
  Xác nhận đây là chỗ bạn muốn gửi tới?
```

**Ở chế độ bỏ qua quyền, `ask` hạ về `deny`** (§3.9). Nghĩa là nhóm B chuyển từ "hỏi" sang "chặn" trong đúng những phiên mà prompt không có ai bấm — bao gồm phiên không người trực. Đây là ma sát thật, ghi ở §9.9.

### 5.8 `deploy.target.<name>` — đích hệ quả cao đòi người xác nhận

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

### 5.9 `deploy.script` — dự án tự khai, không phải rule của plugin

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

**Không có `targetArg`** — §11.1 đóng bằng cách bóc target không phụ thuộc vị trí (§5.0), nên trường đó không tồn tại.

### 6.0 Phần nhóm A vào `infra`, không vào `deploy`

Quyết định §11.3 hiện ra trong `policy/default.json` như dữ liệu của nhóm `infra` đang có, **không** thêm cấu trúc mới:

```json
{
  "infra": {
    "denyBinaries": ["...21 mục đang có...", "surge", "gh-pages"],
    "denyPatterns": ["...5 mục đang có...",
      "netlify\\s+deploy(?![\\w-])",
      "firebase\\s+deploy(?![\\w-])",
      "railway\\s+up(?![\\w-])",
      "docker\\s+push(?![\\w-])"
    ]
  }
}
```

Zero code — cả hai trường đã được `infra.mjs` đọc. Nhưng theo §6.1, mọi mục ở đây là **không thể xoá bởi dự án**, nên mỗi mục phải chịu được phép thử "một lệnh local hằng ngày có bị chặn oan không". Số đo cho 3 pattern netlify/firebase/railway: 8/8 publish chặn, 12/12 local qua (§11.3). Cho `docker push`: 4/4 và 10/10 (§2.6).

`(?![\w-])` không phải trang trí: nó là thứ giữ `netlify deploying-notes.md` không bị coi là `netlify deploy`.

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

8. **Nhóm B chuyển từ "hỏi" sang "chặn" trong phiên không người trực.** Hệ quả của §3.9: ở chế độ bỏ qua quyền hoặc phiên không có người, `scp`/`rsync`/`ssh`/`curl` đẩy dữ liệu tới host chưa khai sẽ bị CHẶN chứ không hỏi. Đúng hướng an toàn, nhưng nghĩa là một script CI dùng `rsync` tới host chưa khai sẽ vỡ — phải khai host đó, hoặc chạy ngoài Codex.

9. **Mở Codex ngoài thư mục dự án thì đường script KHÔNG được bảo vệ** (§2.7, §3.10). Đây là bản sửa của một câu sai tôi từng viết ("chặn tất cả"): cò súng của nhóm cũng là dữ liệu dự án, nên mất policy là nhóm cưỡng chế **con số không**, không phải chặn hết. Công cụ deploy trực tiếp vẫn bị `infra` chặn vì deny-list nằm ở bản mặc định; `./scripts/deploy.sh prod` thì chạy thẳng. `deploy.detectScripts` (§3.10) bịt được nếu số đo cho phép — chưa đo thì không được tuyên bố là đã bịt. Thứ chắc chắn có tác dụng vẫn là đổi thói quen: mở Codex TỪ thư mục dự án.

10. **Gọi entrypoint qua trình thông dịch đi vòng cả nhóm.** `bash ./deploy.sh prod` / `sh ...` / `source ...` không khớp entrypoint nào (đo ở §5.0.1). §5.0.1 bịt ba dạng đó bằng cách thêm chúng vào `WRAPPERS`, nhưng danh sách trình thông dịch **không thể đầy đủ** — `perl -e`, `python -c`, một wrapper tự viết trong repo đều gọi được script mà không khớp tiền tố nào. Cùng bản chất với §15 #4 spec chính: tầng 1 chặn đường mặc định, không chặn người quyết tâm.

11. **Chặn `netlify`/`firebase`/`railway` ở mức subcommand, không mức binary** (§11.3). Nghĩa là `netlify deploy` bị chặn còn `netlify dev` qua — chủ ý, để không biến một lệnh hằng ngày thành escape từng phiên. Cái giá: một subcommand publish mới hoặc đổi tên (`netlify deploy` → dạng khác) sẽ **lọt cho tới khi có người thêm pattern**. Deny-list theo subcommand không tự phủ tương lai, và `guardrail doctor` không phát hiện được thiếu sót kiểu này.

12. **Thứ mạnh nhất không phải guardrail.** Nếu deploy token không nằm trên máy dev thì AI đoán gì cũng không deploy được. Deploy từ CI với protected environment. Guardrail không thay được điều đó, và tài liệu không được ngụ ý là thay được.

---

## 10. Kiểm thử

Ngoài các nguyên tắc đã có (§14 spec chính), nhóm này bắt buộc:

- **Cả hai chiều cho từng rule.** Đặc biệt `deploy.branch-mismatch`: phải có ca branch ĐÚNG được cho qua, không chỉ ca sai bị chặn.
- **Tổ hợp sai không biểu diễn được** (§3.4): test rằng `branch=develop` + `target=prod` bị chặn, kể cả khi cả hai giá trị đều xuất hiện trong policy.
- **Chưa khai `deploy` thì nhóm là no-op hoàn toàn** — không được chặn oan dự án chưa cấu hình.
- **Đường allow không spawn `git`** (§5.5), kiểm qua test độ trễ: phần dôi của đường allow không được tăng.
- **Nền tảng:** `./scripts/deploy.sh` và `scripts\deploy.sh` phải khớp cùng một entry. Team có dev Windows (§2.5), và `tokenize()` vừa phải sửa đúng lớp lỗi này ở `d0ccc88`.
- **Mutation test** cho mỗi assert mới, theo nếp đã dùng cả Plan 1.

---

## 11. Ẩn số cần làm rõ trước khi code

1. ~~Script nhận target qua tham số vị trí hay cờ?~~ **ĐÃ ĐÓNG 2026-08-28: câu hỏi không cần trả lời.** Chỉ định là *chặn khi chưa nêu đích*, và cách bóc đạt được điều đó mà không cần biết dạng: **quét toàn bộ argv, so cả token nguyên và phần sau `=`** (§5.0). Phủ được cả 4 dạng (`prod`, `--env=prod`, `--env prod`, `ENV=prod`), nên **schema KHÔNG có `targetArg`** — một trường ít hơn là một trường mỗi dự án không khai sai được.

   Đo cùng lượt lại lộ ra một lỗ chưa ai hỏi tới: `bash ./deploy.sh prod` không khớp entrypoint nào, tức đi vòng cả nhóm `deploy`. Ghi ở §5.0.1 kèm cách bịt, và ở §9 #11.
2. ~~Có dự án nào deploy nhiều target trong một lệnh không?~~ **ĐÃ CHỐT 2026-08-28: deploy TUẦN TỰ, mỗi lệnh một đích.** Hệ quả: §5.5 không cần vòng lặp, và lệnh nhiều đích bị `deploy.ambiguous-target` chặn (§5.4).
3. **Mười công cụ lọt ở §2.1 — cái nào team đang dùng hợp lệ?** Đã chốt một phần 2026-08-28:

   - `docker push`: **team không dùng bao giờ.** Bịt bằng `denyPatterns: ['docker\\s+push\\b']`, đã đo ở §2.6 — 4/4 chặn, 10/10 lệnh docker hằng ngày vẫn qua. Zero code.
   - **Nhóm A — ĐÃ CHỐT 2026-08-28: CHẶN, nhưng hai mức khác nhau.** Lý do coi là an toàn để chặn: `surge`/`gh-pages` đúng là ca "domain free" ở §1. Nhưng lý do tôi từng nêu — "không có công dụng local nào" — **sai với 2 trong 5 công cụ**, và số đo bắt được:

     ```
     surge      (chưa cài)
     gh-pages   (chưa cài)
     netlify    /Users/haiduong/.nvm/versions/node/v20.19.2/bin/netlify
     firebase   /Users/haiduong/.nvm/versions/node/v20.19.2/bin/firebase
     railway    (chưa cài)
     ```

     `netlify` và `firebase` **đã cài trên máy lead**, tức đang được dùng. Và cả hai đều có chế độ local dùng hằng ngày (`netlify dev`, `firebase emulators:start`, `firebase login`). Chặn ở mức binary sẽ chặn luôn những lệnh đó — đúng lớp ma sát đã đo được với `wrangler dev` và `vercel dev`.

     Nên chia theo **công cụ có chế độ local hay không**:

     | Công cụ | Mức chặn | Vì sao |
     |---|---|---|
     | `surge` | `denyBinaries` | gọi trần `surge` là deploy luôn — không có chế độ local để giữ |
     | `gh-pages` | `denyBinaries` | chỉ có một việc: đẩy lên `gh-pages` |
     | `netlify` | `denyPatterns: netlify\s+deploy(?![\w-])` | giữ `dev`, `link`, `env:list`, `status` |
     | `firebase` | `denyPatterns: firebase\s+deploy(?![\w-])` | giữ `emulators:start`, `login`, `projects:list`, `init` |
     | `railway` | `denyPatterns: railway\s+up(?![\w-])` | giữ `logs`, `run`, `status` |

     Đo 3 pattern trên (2026-08-28): **8/8 lệnh publish bị chặn** (gồm dạng bọc `npx netlify deploy --prod --dir=dist` và `sudo railway up`), **12/12 lệnh local qua được**. Cùng khuôn và cùng mức bằng chứng như `docker push` ở §2.6 — zero code, chỉ thêm dữ liệu policy.

     **Vì sao không chặn cứng cả 5 cho gọn:** `mergePolicy` HỢP mảng (§2.3), nên thứ gì vào `denyBinaries` của bản mặc định thì **không dự án nào xoá được, mãi mãi**. Với `psql`/`aws` đó là chủ ý. Với `netlify dev` thì đó là một lệnh hằng ngày phải escape từng phiên đến hết đời dự án — và một guardrail như thế bị dev tháo, đúng chế độ hỏng tệ nhất ở §1.
   - **Nhóm B — ĐÃ CHỐT 2026-08-28: KHÔNG chặn, mà HỎI.** `scp`, `rsync`, `ssh`, `curl`. Cơ chế ở §5.7: chỉ hỏi khi đích chưa khai VÀ lệnh đẩy dữ liệu ra. Hai điều kiện đó giữ số prompt thấp, vì tải-về thường xuyên còn đẩy-lên hiếm.


4. **`ask` có thật sự hỏi ở chế độ mà máy dev đang chạy không?** ẨN SỐ CHẶN THIẾT KẾ, và mức nghiêm trọng đã TĂNG sau quyết định không chặn nhóm B: trước đây nó chỉ ảnh hưởng UX của confirm deploy; giờ nó quyết định nhóm B **có được bảo vệ hay không**. Nếu `ask` không hỏi và ta cũng không chặn, `scp`/`rsync`/`ssh`/`curl` tới host lạ là lỗ hoàn toàn hở. Mọi payload thật Task 0 bắt được đều ở chế độ đó. Cần một spike đúng kiểu Task 0: phát `permissionDecision: "ask"` từ hook, chạy lệnh thật trong Codex, xem có prompt hay tự chạy. Ba kết quả, ba thiết kế khác nhau:
   - Có hỏi → `ask` là cơ chế chính, `requireHumanEscape` chỉ còn cho phiên không người trực.
   - Tự duyệt → `ask` VÔ DỤNG ở chế độ này; `requireHumanEscape` là cơ chế duy nhất, và phải ghi vào README rằng confirm không khả dụng khi chạy bypassPermissions.
   - Coi là hook lỗi → tuyệt đối không dùng `ask`, vì theo Task 0 hook lỗi = CHO LỆNH CHẠY.

   **ĐÃ CHỐT 2026-08-28: đi tiếp với `ask` là cơ chế chính, KHÔNG chờ spike.** Cơ sở là #6 bên dưới: chế độ thật của máy dev là `default`, và `dontAsk` tồn tại như một chế độ RIÊNG — nếu `default` cũng không hỏi thì `dontAsk` không có lý do tồn tại.

   Điều này **không** đóng ẩn số bằng quan sát trực tiếp, và spec không được nói là đã đóng. Cụ thể phần chưa biết: chưa từng thấy một lượt `ask` đi hết vòng và Codex hiện prompt. Nên hai thứ vẫn bắt buộc:

   - **Nhánh hạ `ask` → `deny`** ở chế độ `dontAsk`/`bypassPermissions` (§3.9) vẫn phải code, vẫn phải có test. Nó là đường phòng bị, không phải đường chính.
   - **Test đầu tiên chạm `ask` phải là một lượt thật trong Codex**, không phải chỉ unit test `runHook`. Nếu Codex coi `ask` là hook lỗi thì theo Task 0, hook lỗi = CHO LỆNH CHẠY — tức nhóm B từ "hỏi" thành "hở hoàn toàn", và unit test sẽ xanh trong khi thực tế hở. Đây là đúng lớp lỗi mà cả dự án tồn tại để chống, nên nó không được kiểm bằng mock.

   Cho tới lượt thật đó, mọi tuyên bố trong README về confirm nhóm B phải viết ở dạng "thiết kế để hỏi", không phải "sẽ hỏi".

5. ~~Tên chính xác của các chế độ `permission_mode`.~~ **ĐÃ CHỐT 2026-08-28** từ JSON Schema nhúng trong binary: `default`, `acceptEdits`, `plan`, `dontAsk`, `bypassPermissions`. Xem §3.9.

6. ~~Máy dev thật đang chạy chế độ nào?~~ **ĐÃ ĐO 2026-08-28.** Entry thật từ phiên Codex của lead:

   ```json
   {"ts":"2026-08-28T07:45:15.524Z","decision":"denied","ruleId":"infra.deny-binary",
    "event":"PreToolUse","tool":"Bash","repo":null,"branch":null,
    "command":"psql --version","permissionMode":"default"}
   ```

   Chế độ là **`default`** — KHÔNG phải `bypassPermissions`. Cộng với việc `dontAsk` tồn tại như một chế độ RIÊNG, đây là bằng chứng mạnh nhất có được rằng `ask` được tôn trọng ở chế độ team này đang chạy. Nhánh hạ-về-`deny` (§3.9) vẫn phải làm, nhưng nó là đường phòng bị chứ không phải đường chính.

   Ẩn số #4 (`ask` có thật hỏi không) vẫn chưa đóng bằng quan sát trực tiếp một lượt `ask`, nhưng rủi ro đã đổi hẳn: từ "chế độ có lẽ chặn ask" thành "chế độ chính là chế độ hỏi".

7. **`repo` và `branch` là `null` trong phiên Codex THẬT.** Phát hiện ngoài dự kiến từ chính entry trên. Các entry trước đó có `repo`/`branch` đầy đủ đều là probe của tôi chạy với cwd = thư mục repo. Trong phiên thật, `findProjectRoot(ctx.cwd)` trả null.

   **Đây chặn §5.3 và một dòng của §4:** `deploy.branch-mismatch` dựa hoàn toàn vào `currentBranch()`. Nếu branch là null trong phiên thật thì rule đó không quyết định được gì, và cả cột "branch — guardrail đảm bảo" trong bảng §4 sụp.

   Cần biết: Codex gửi `cwd` là gì (thư mục dự án, hay thư mục khác), và vì sao không tìm được `.git`. Trước khi trả lời được, KHÔNG được coi branch là thông tin guardrail nắm chắc.
