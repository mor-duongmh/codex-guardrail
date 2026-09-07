# SDD ledger — plan: docs/superpowers/plans/2026-08-25-codex-guardrail-engine.md

Ruling: làm trên branch feat/plan-1-engine thay vì git worktree — repo mới, chỉ có local, không có việc song song; worktree chỉ thêm một lớp đường dẫn cho mọi dispatch mà không cô lập thêm gì. Nếu sai: phải stash/switch khi cần đụng master, sửa rẻ.

## Pre-flight conflict scan

| # | Task ↔ Task | Produces vs Consumes | Tìm thấy |
|---|---|---|---|
| 1 | 0 → 4 | 0 hứa `{pretooluse-shell,pretooluse-apply-patch,posttooluse-shell,sessionstart}.json`; 4 đọc `fixtures/codex-events/*.json` | **XUNG ĐỘT.** Fixture thật tên khác và nhiều hơn: `pre-bash-simple`, `pre-bash-chained`, `post-bash-simple`, `pre-apply-patch-add`, `pre-apply-patch-update`, `session-start` |
| 2 | 0 → — | 0 hứa `fixtures/codex-events/README.md` | Không tạo |
| 3 | 2 → 6,7,8,9 | 2 tạo `lib/result.mjs` (`ALLOW`, `deny`), Test chỉ liệt `tests/glob.test.mjs` | ~~THIẾU TEST~~ — **báo động sai.** `glob.test.mjs` có import `ALLOW, deny` và test `'ALLOW là hằng đóng băng, deny sinh đủ bốn khoá'` (kiểm `Object.isFrozen` + 4 khoá). Hai module test chung một file. |
| 4 | 9 → spec | 9 Produces chỉ 2 ruleId (`escape-inline`, `policy-file`) | **THIẾU.** Spec định nghĩa 4: thêm `hooks-file`, `install-dir` |
| 5 | 10 → 11 → 12 | cả ba đụng `bin/guardrail.mjs` (10 tạo, 11+12 modify) | Không xung đột — tuần tự, mỗi task thêm một nhánh subcommand |
| 6 | 1 → 6,7,8,9 | `parseCommand`, `basename` | Khớp |
| 7 | 3 → 4,12 | `findProjectRoot`, `loadPolicy`, `PolicyError` | Khớp |
| 8 | 5 → 12 | `readEntries`, `auditPath` | Khớp |
| 9 | 8 → 10 | `currentBranch` | Khớp |

Tự-nhất-quán từng task: Task 1 (code đầy đủ cho package.json/.gitignore/tokenize.mjs + 12 test, file tạo = file test), Task 2–9 (mỗi task 1 module + test cùng tên), Task 10 (2 module + 2 test), Task 11–12 (modify bin đã tồn tại từ 10), Task 13 (không API mới) — không thấy task nào tự mâu thuẫn.

Ruling: fixture dùng TÊN THẬT trong repo, không dùng tên trong Task 0 — tên cũ viết trước khi thu payload và mã hoá sai tên tool (`shell`). Task 4 dispatch phải liệt tên file tường minh. Nếu sai: sửa một dòng import trong test Task 4.
Ruling: bỏ `fixtures/codex-events/README.md` — xuất xứ fixture đã nằm trong spike doc, thêm README là trùng lặp. Nếu sai: người sau không biết fixture ở đâu ra; giảm nhẹ bằng con trỏ tới spike doc. Ghi vào deferred minor.
Ruling (ĐÃ RÚT): tôi ra phán quyết "Task 2 phải thêm test cho result.mjs" khi chỉ đọc mục Test của brief. Đọc nội dung test thì thấy nó đã phủ rồi — phán quyết rút lại, Task 2 dispatch KHÔNG mang yêu cầu này. Bài học: đọc nội dung test, không đọc danh sách file test.
Ruling: Task 9 làm đủ 4 ruleId theo spec, và phải bắt xoá file qua `Bash`+`rm` (hợp đồng Task 0), không chỉ qua `apply_patch`. Nếu sai: guardrail bị vô hiệu bằng `rm codex-guardrail.json` — đúng lỗ mà self-protect sinh ra để bịt.

Task 1: minor (deferred): thiếu `tests/fixtures/codex-events/README.md`

## Nhật ký task

Task 1: dispatched (haiku, transcription — brief chứa code đầy đủ), BASE=0672d81
Task 1: implemented (commit f667406, 12/12 test pass theo báo cáo implementer), review dispatched (sonnet)

Task 1: review 1 → Needs fixes. 2 Important (plan-mandated), 2 Minor.
Ruling: finding plan-mandated này ĐÚNG và load-bearing, cân với plan thì plan sai. Brief cho sẵn test `'tách theo ; && || | và newline'` mà thân test chỉ assert 3/5 toán tử — tên test hứa nhiều hơn nó kiểm, đúng lớp defect "test không chốt được gì". Spec là thẩm quyền ràng buộc, và spec đòi rule soi được MỌI lệnh con; Task 0 đã đo Codex nối `&&` như thói quen. 4 task rule sắp xây lên module này, nên khoá hành vi bây giờ rẻ hơn phát hiện sau. Vào fix loop round 1. Nếu sai: thêm 3 assertion vô ích, tốn vài phút.
Task 1: minor (deferred): báo cáo khai p95=39.3ms không có phương pháp đo (percentile cần lặp nhiều lần). Task 13 mới sở hữu `tests/latency.test.mjs` — con số này là ước lượng thô, không phải bằng chứng ngân sách 150ms.
Task 1: minor (deferred): `tokenize`/`splitSegments` chỉ được test gián tiếp qua `parseCommand`; debug lỗi tách segment độc lập sẽ khó hơn.
Task 1: minor (deferred): `package.json` khai `"bin"` trỏ `bin/guardrail.mjs` chưa tồn tại (Task 10 tạo) — đúng phạm vi, ghi lại để final review biết.
Task 1: fix round 1/5 — implementer sửa test (commit f93fffd, 13/13 pass); code lib/tokenize.mjs KHÔNG đổi (đã đúng từ đầu). Re-review dispatched (haiku, diff 13 dòng/1 file).
Task 1: fix round 1/5 (2 addressed, 0 open; commits f667406..f93fffd)
Task 1: complete (commits 0672d81..f93fffd, review clean)
Task 2: dispatched (haiku, transcription — brief chứa code đầy đủ), BASE=f93fffd
Task 2: implemented (commit 7437fc1, 8/8 test pass theo báo cáo), review dispatched (sonnet)

Task 2: review 1 → Needs fixes. 1 Important (plan-mandated, bug cross-platform thật), 1 Minor.
Ruling: finding ĐÚNG, tôi tự xác minh bằng mô phỏng code path với homedir Windows. `normalizePath` thay `\`→`/` TRƯỚC khi `expandHome` nối `homedir()` thô, nên trên Windows ra chuỗi lẫn separator; `SPECIAL` không có `\` nên backslash sống sót vào regex và `\D`/`\U` bị hiểu là escape sequence. Kết quả đo được: pattern `~/.aws/credentials` KHÔNG khớp path thật `C:/Users/Duong/.aws/credentials`. Đây là lỗ guardrail thật trên Windows, và 4 task rule sắp import module này.
Ruling: sửa bằng (a) đảo thứ tự — expandHome trước, thay `\`→`/` sau; (b) thêm tham số `home` tuỳ chọn cho `normalizePath`/`globToRegExp` để test tiêm được homedir kiểu Windows. Chọn (b) vì plan đã có tiền lệ dependency injection để test (Global Constraints: rule nhận `deps` làm tham số thứ ba). KHÔNG dựa vào CI matrix của Task 13 để bắt bug này: test hiện có normalize cả pattern lẫn path bằng cùng một hàm, nên nó PASS kể cả khi hàm sai — đúng lý do bug này trốn được. Nếu sai: một tham số tuỳ chọn không ai dùng, chi phí gần bằng không.
Task 2: minor (deferred): báo cáo implementer ghi sai số dòng file (35/4/54 vs thực tế 39/5/49).
Task 2: fix round 1/5 — commit 76966d8, 11/11 pass (8 cũ + 3 mới). Controller tự xác minh trên module thật với home Windows tiêm vào: pattern→`C:/Users/Duong/.aws/credentials`, regex không còn backslash thô, KHỚP=true; home `C:\dev` cho regex `^C:\/dev\/\.env$` và `C:/9ev/.env` KHÔNG khớp (chứng minh `\d` hết là char class). Re-review dispatched (haiku).
Task 2: fix round 1/5 (3 addressed, 0 open; commits 7437fc1..76966d8)
Task 2: complete (commits f93fffd..76966d8, review clean)
Task 3: dispatched (haiku), BASE=76966d8. Dispatch mang thêm chỉ dẫn: đọc code mẫu bằng mắt phê phán và BÁO nếu thấy sai, vì 2/2 finding trước đều nằm trong code mẫu của plan.
Task 3: implemented (commit e45016a, 10/10 pass theo báo cáo), review dispatched (sonnet)

Task 3: review 1 → Needs fixes. 1 Important (plan-mandated), 4 Minor, 1 ⚠️.
Ruling (⚠️ đã giải, KHÔNG phải gap): reviewer lo `loadPolicy` đọc+parse đĩa mỗi lần gọi mà không cache, sợ vỡ ngân sách p95<150ms. Không phải gap: hook là tiến trình sống ngắn — Codex spawn `node guardrail.mjs hook` MỚI cho mỗi tool call, nên cache trong tiến trình vô dụng, không có gì để cache qua các lần gọi. Một lần đọc + parse file ~58 dòng là dưới 1ms. Task 10 gọi `loadPolicy` đúng một lần mỗi lần hook chạy. Reviewer không có ngữ cảnh Task 10 nên không tự kết luận được. Nếu sai: Task 13 đo độ trễ thật sẽ phát hiện, và khi đó cache cũng không phải cách sửa.
Ruling: finding Important ĐÚNG, tôi tự xác minh: `{"selfProtect": null}` cho `policy.selfProtect === null`, không throw, không warning; `mergePolicy(base, false)` trả `false`. Brief chỉ nói "JSON không parse được" phải fail-closed, nên ca "JSON hợp lệ mà sai shape" lách qua được `catch`. Nhưng đây là cùng loại lỗ, chỉ tinh vi hơn — và nó tắt đúng nhóm selfProtect, nhóm bảo vệ chính guardrail. 4 task rule sắp đọc policy này. Vào fix loop. Nếu sai: thêm một type-guard không ai chạm tới.
Task 3: minor (deferred): `PolicyError` không set `this.name`, `err.name` in ra "Error".
Task 3: minor (deferred): message nối `err.message` gốc của JSON.parse (tiếng Anh) vào message tiếng Việt.
Task 3: minor (deferred): `try` bọc cả `readFileSync` lẫn `JSON.parse` → lỗi I/O cũng báo "sai cú pháp JSON".
Task 3: minor (deferred): thiếu test `findProjectRoot` khi lên tới gốc filesystem mà không thấy `.git` (code đúng, đã đọc tay, nhưng không có test khoá).
Task 3: fix round 1/5 — commit 09a4ff3, 13/13 pass. Controller tự xác minh 5 ca: {"selfProtect":null}→THROW, top-level false→THROW, merge hợp lệ→giữ nguyên default (psql/mysql/mysqldump còn), key MỚI không có trong default→KHÔNG throw, nhóm mới hoàn toàn→KHÔNG throw. Nỗi lo type-guard chặn oan cấu hình hợp lệ đã được loại bằng đo, không bằng suy luận. Re-review dispatched (haiku).
Task 3: minor (deferred): commit message 09a4ff3 có lỗi gõ "type-guard mảy" (chắc là "mảng"); commit message không sửa lại được sau này.
Task 3: fix round 1/5 (3 addressed, 0 open; commits e45016a..09a4ff3)
Task 3: complete (commits 76966d8..09a4ff3, review clean)
Ghi chú: re-reviewer SUY LUẬN từ code cho các ca falsy tôi yêu cầu nó tự nghĩ ra, không đo. Tôi tự soi lại logic: cur=undefined + val=null → không throw (key mới, không ghi đè default) — đúng; `[]` override array → union nên KHÔNG xoá được default. Điều cuối là thuộc tính thiết kế có chủ đích, không phải bug: dự án không được âm thầm rút bớt bảo vệ mặc định; muốn bỏ một mục thì dùng `allowBinaries`, thứ default.json đã có.

Task 4: implemented DONE_WITH_CONCERNS (commit 0279e65, 12/12 mới + 49/49 toàn repo).
Nghi vấn #3 của controller (envelope apply_patch ở tool_input.command nên PATCH_KEYS tìm không ra) → ĐÚNG, implementer xác nhận thực nghiệm và sửa bằng fallback sang COMMAND_KEYS khi tool==='apply_patch'. Controller tự đo lại: patchFiles = ["/home/dev/repo/hello.txt"] và ["/home/dev/repo/sua.txt"]. Trước khi sửa là rỗng → secrets.write-path và selfprotect.policy-file sẽ không bao giờ chặn được ghi file nhạy cảm qua apply_patch.
Bug thứ ba do IMPLEMENTER tự tìm, controller không nghĩ tới: ctx.stdout luôn null trên PostToolUse thật vì tool_response là CHUỖI THÔ, brief giả định object {stdout}. Đã sửa + có test. Controller đo lại: stdout = "total 8\ndrwxr-xr-x…". Nếu để nguyên thì redact.stdout (Plan 2) không bao giờ chạy.
Ruling: ctx.command của apply_patch phải là null, không phải patch envelope. Đo được hiện tại nó là envelope. Rule đọc ctx.command là rule soi LỆNH SHELL SẼ CHẠY; patch không phải lệnh. Để envelope vào đó sinh false positive: một patch thêm dòng `cat .env` hay `psql` vào file nguồn/tài liệu sẽ bị parseCommand tokenize thành lệnh và trigger secrets.read-path — chặn oan một lần sửa file hợp lệ. False positive là thứ khiến dev tắt guardrail, tức là chế độ hỏng giết cả dự án. Kiểm ngược: không rule nào ở Plan 1 cần thân patch qua ctx.command (selfprotect.escape-inline soi env var inline của lệnh sẽ chạy; đặt env trong patch không thực thi gì; selfprotect.policy-file và secrets.write-path đều dùng patchFiles). Nếu Plan 2 cần thân patch (quality.test-tampering, quality.suppress-error) thì cấp field riêng khi đó, không nhồi vào `command`. Nếu sai: mất truy cập thân patch ở Plan 1, nhưng không rule nào ở Plan 1 dùng nó.

Task 4: review 1 → Needs fixes. 5/5 phán quyết controller triển khai ĐÚNG (reviewer tự chạy buildContext trên payload thật để xác nhận, không chỉ tin test). 1 Important mới (plan-mandated), 2 Minor, 2 ⚠️.
Ruling: finding fail-closed ĐÚNG và nặng hơn reviewer mô tả. Tôi đo: `null`→TypeError (không phải ContextError); `true`/`42`/`"str"`/`[]`/`{}`→KHÔNG ném gì, trả ctx với event=unknown, tool=unknown, cwd=process.cwd() (đoán). Vì REGISTRY không có khoá 'unknown' nên rules.length===0 → ALLOW. Nghĩa là payload méo = guardrail cho qua mọi thứ, im lặng. Và TypeError bị runHook rethrow → uncaught → exit 1, mà Task 0 chỉ xác nhận exit 2 và exit 0+JSON là chặn được; exit 1 do crash CHƯA kiểm, có thể fail open. Cùng lớp lỗi với ruling exit-3 ở Task 10. Vào fix loop. Nếu sai: thêm hai phép kiểm kiểu không ai chạm.
Ruling (⚠️ #1 đã giải): cú pháp Move thật. Tôi đo regex hiện tại: `*** Move File:` bắt được, nhưng `*** Update File: /r/a.ts` + `*** Move to: /r/.env` chỉ ra `["/r/a.ts"]` — ĐÍCH không được bắt. Cú pháp apply_patch của OpenAI dùng `*** Move to:` cho đổi tên, nên `Move File:` có thể chưa từng tồn tại. Không chạy spike để xác minh: nhận CẢ HAI pattern là strictly safer và không cần biết cái nào thật. Hệ quả nếu để nguyên: agent đổi tên file thành `.env` thì secrets.write-path không thấy đích. Nếu sai: một nhánh regex không bao giờ khớp.
Ruling (⚠️ #2 đã giải): Task 10 bắt lỗi thế nào — plan đã viết `if (err instanceof ContextError) return failClosed(err); throw err;` nên mọi lỗi khác bị rethrow. Đó chính là lý do TypeError nguy hiểm. Không sửa Task 10 ở đây: sửa gốc ở context.mjs (ném đúng ContextError) rẻ và đúng hơn là bọc catch-all ở dispatcher, vì catch-all sẽ che cả bug thật của rule.
Task 4: minor (deferred): không có fixture/test phủ `*** Delete File:` (code xử đúng, đã đo, nhưng không có test khoá) — gộp vào acceptance của ruling Move.
Task 4: minor (deferred): `pick(input, COMMAND_KEYS)` gọi hai lần (extractPatchBody fallback + command), trùng lặp nhỏ, không đáng trừu tượng hoá.
Task 4: fix round 1/5 (7 addressed, 0 open; commits d189adc..a147d23)
Task 4: complete (commits 09a4ff3..a147d23, review clean)
Ruling (tôi tự xét, không phải finding): `cwd` vắng vẫn fallback process.cwd() thay vì fail-closed. Kiểm hướng hỏng: cwd sai → findProjectRoot không thấy .git → projectRoot=null → loadPolicy(null) → DEFAULT policy, tức deny-list mặc định. Hỏng về phía chặn NHIỀU hơn, không bỏ lọt. Nên không phải lỗ, không sửa. Mọi payload thật đều có cwd (đã xác nhận ở Task 0).

Task 5: implemented (commit d59620b, 69/69 pass — controller xác nhận số test đúng).
Ruling: PATTERNS của redact THIẾU nghiêm trọng, nặng hơn mức implementer mô tả ("add sau nếu lead muốn"). Tôi đo 5 ca lệnh thật: 4/5 LỘ. Lộ chuỗi kết nối postgres (`psql postgresql://admin:S3cr3tPw@...`), `mysql -pMyP4ssw0rd`, `AWS_SECRET_ACCESS_KEY=...`, `Authorization: Bearer <JWT>`. Chỉ GitHub PAT được che. Implementer khai JWT "đã phủ" — đo thì KHÔNG.
  Vì sao nặng: `psql` và `mysql` là hai mục ĐẦU của infra.denyBinaries, nên lần chặn phổ biến nhất của cả hệ thống ghi mật khẩu DB production dạng thô vào audit log. Audit log sinh ra để lead ĐỌC — có thể bị commit, share, sync. Cơ chế log của guardrail tự rò chính thứ guardrail bảo vệ. Đây là finding nặng nhất của cả phiên.
  Bất đối xứng quyết định hướng sửa: trong redact, che THỪA không tốn gì (log bị mask quá nhiều); che THIẾU là rò secret. Ngược hẳn với rule deny, nơi chặn oan là chế độ hỏng tệ nhất. Nên ở đây nghiêng về pattern rộng.
Ruling: quyền file audit 0644 → 0600. Mô hình đe doạ của chính dự án là "chạy trên máy dev khác"; trên máy dùng chung, 0644 cho mọi user local đọc lịch sử lệnh của người khác. Một flag. Trên Windows Node bỏ qua mode nên vô hại. Nếu sai: không ai đọc được log của mình bằng user khác, đúng ý định.
Task 5: fix round 1/5 — commit 09a69f4, 75/75 pass. Controller tự đo: cả 5 secret SẠCH (giá trị biến mất, không chỉ khác chuỗi gốc); 4 lệnh vô hại (`ls -la /etc/passwd`, `git push origin main`, `npm test -- --grep auth`, `psql -h db.prod -U admin -l`) giữ NGUYÊN → không che thừa, log còn dùng được; file mode 600, dir 700. Re-review dispatched.
Task 5: minor (deferred): pattern Bearer ăn luôn dấu `"` đóng — `Bearer eyJ..." api` → `Bearer *** api`. Thẩm mỹ, không rò.

Task 5: review 1 → Needs fixes. 1 CRITICAL, 4 Important, 2 Minor, 2 ⚠️.
LỖI CỦA CONTROLLER: xác minh của tôi ở fix round 1 bỏ lọt Critical. Tôi chỉ thử `-pMyP4ssw0rd` (dán liền), không thử `--password <val>` (cách space), rồi tuyên bố cả 5 ca SẠCH. Bộ ca thử lấy từ danh sách tôi tự viết trước đó và tôi KHÔNG mở rộng nó khi bản sửa thêm pattern mới. Bài học: khi implementer thêm pattern, ca thử phải sinh từ pattern MỚI, không tái dùng bộ cũ.
Ruling: Critical ĐÚNG, tôi đo lại: `psql -h prod-db --password S3cr3tPw` → `--p*** S3cr3tPw`, mật khẩu còn nguyên. Nguyên nhân: pattern `-p([^\s]+)` đứng TRƯỚC `password-flag-space` trong PATTERNS và khớp substring tự do, nên nó ăn `--p` của `--password` rồi để giá trị trần phía sau; pattern chuyên biệt không bao giờ chạy tới. Cùng gốc gây Important #2: `--production`→`--p***`, `--profile prod`→`--p*** prod`, `--progress`, `-parallelism` đều bị phá. Một bản sửa (ranh giới token cho `-p`) giải cả hai.
Ruling: `findSecretKinds` dùng `new RegExp(re.source)` làm mất cờ `i` → bất đồng bộ với `redact`. Đo: `redact("aws_secret_access_key=…")` che đúng nhưng `findSecretKinds` trả `[]`; bản chữ HOA thì trả đúng. Plan 2 (`redact.stdout`) dựa vào hàm này nên phải sửa.
Ruling: TOCTOU — dùng `appendFileSync(p, data, {mode:0o600})` và `mkdirSync(dir,{recursive:true,mode:0o700})` thay 2 lệnh chmodSync sau khi tạo. Đóng hẳn cửa sổ race, và bỏ luôn 2 syscall mỗi lần ghi. Đơn giản hơn code hiện tại.
Ruling: test quyền thư mục hiện tại VÔ GIÁ TRỊ — `mkdtempSync` đã tạo dir mode 0700 sẵn, nên test pass kể cả khi xoá dòng chmod. Phải chmod fixture về 0755 trước rồi mới assert đổi thành 0700.
Ruling (⚠️ #1 đã giải): số test thật = 75/75, khớp lời khai implementer. Số cộng tay của reviewer sai, tổng thì đúng.
Ruling (⚠️ #2 đã giải): `record()` chỉ được gọi khi decision là denied hoặc escaped, KHÔNG phải mọi tool call (theo runHook trong plan). Nên 2 syscall thừa chỉ xảy ra lúc chặn — hiếm. Không phải rủi ro ngân sách p95. Bản sửa TOCTOU xoá chúng luôn.
Task 5: fix round 2/5 — commit b653ed9, 82/82 pass. Controller xác minh với bộ ca SINH TỪ PATTERN (không tái dùng bộ cũ — bài học round 1): 10/10 ca rò đã che (gồm --password space, --password=, URL 2 scheme, env HOA+thường, Bearer, Basic, *_PASSWORD); 8/8 ca vô hại giữ nguyên (--production, --profile cả 2 dạng, --progress, -parallelism, `psql -p 5432` KHÔNG bị nuốt số cổng, git push, ls); findSecretKinds đồng bộ 3/3; file 600 dir 700; test dir-mode giờ chmod 0755 trước khi assert nên đã chốt được thật. Re-review dispatched (sonnet — module này hỏng thì hỏng im lặng, nâng một tier).

Task 5: re-review round 2 → 5/5 finding gốc ADDRESSED nhưng bản sửa mang 2 vấn đề MỚI. Cả hai đúng hai nghi vấn tôi gieo vào prompt re-review.
Ruling: CRITICAL mới ĐÚNG, tôi đo: `mysql -psecret` và `-psecret123` KHÔNG được che; `-pMyP4ssw0rd` che được vì chữ P HOA. Lookahead `(?![a-z])` phân biệt bằng KÝ TỰ ĐẦU CỦA GIÁ TRỊ, không bằng cấu trúc flag — mà mật khẩu thật đa số bắt đầu bằng chữ thường. Hai test `-p` mới đều dùng `MyP4ssw0rd` nên không chạm vùng đó. Đây là lỗi tệ hơn bản gốc ở một nghĩa: bản gốc rò dạng `--password <space>`, bản này rò dạng `-p<pass>` phổ biến hơn.
  Hướng sửa: phân biệt phải theo CẤU TRÚC (số dấu gạch / hình dạng flag), không theo case của giá trị. `--password` có `-p` đứng sau một `-` khác nên lookbehind `(?<!-)` loại được. Vướng còn lại là single-dash long flag kiểu terraform (`-parallelism=5`, `-var=x`) — terraform NẰM TRONG deny-list nên đây là ca thật. Quy ước dùng được: single-dash long flag của terraform luôn có `=`; nên che `-p<val>` khi không đứng sau `-` VÀ `<val>` không chứa `=`. Để implementer tự chọn cách, nhưng bắt buộc phủ ma trận test.
Ruling: IMPORTANT mới ĐÚNG và là REGRESSION. Tôi đo: file audit có sẵn 0644 → sau `record()` vẫn 0644. Round 2 có `chmodSync(p,0o600)` vô điều kiện mỗi lần ghi — chính dòng đó là cơ chế TỰ CHỮA, và bản sửa TOCTOU đã bỏ nó. `{mode}` của appendFileSync chỉ áp dụng khi file được TẠO MỚI. Với máy đã có audit log từ trước (tình huống thực tế phổ biến), cửa sổ world-readable không hề đóng. Sửa: giữ CẢ HAI — `{mode}` lúc tạo (đóng race cho file mới) VÀ `chmodSync` fail-open sau khi ghi (tự chữa file cũ). Tôi đã sai khi ra ruling "thay 2 lệnh chmodSync" ở round 2 mà không xét file đã tồn tại.
Task 5: fix round 3/5 — commit 2665f40, 92/92 pass. Controller đo ma trận đầy đủ: 0/6 rò (gồm `-psecret`, `-psecret123` chữ thường), 1/7 che thừa (`-parallelism=5` → `-p***=5`), tự chữa quyền OK (file 644→600, dir 755→700), audit ghi `mysql -p*** h`.
Ruling: CHẤP NHẬN ca che thừa `-parallelism=5` → `-p***=5`, không sửa tiếp. Tôi đã cân cách sửa "loại token có chứa `=`" và LOẠI nó: mật khẩu base64 thường kết thúc bằng `=` (padding), nên luật đó sẽ bỏ lọt `-pYWJjZA==`. Hành vi hiện tại che tới trước `=` nên base64 vẫn được che (`-p***=`), chỉ padding lộ ra — vô hại. Nghĩa là hành vi hiện tại là trade-off TỐT HƠN, không phải sót. Đúng chỉ thị ưu tiên tôi đã ra: che thừa không tốn gì, rò secret thì tốn.
Task 5: re-review round 3 → finding 1,2 ADDRESSED nhưng phát hiện CRITICAL còn sót (có từ round 2, ba vòng review đều bỏ qua).
Ruling: ĐÚNG, tôi đo: `mysql -p'my pass' db` → `mysql -p*** pass' db`, chữ "pass" lộ trần. `[^\s=]+` dừng ở khoảng trắng đầu nên chỉ nuốt `-p'my`, phần còn lại của giá trị in nguyên văn. 0 test phủ ca quote.
Ruling: chuyển sang implementer MỚI trên sonnet theo quy trình round 4-5. Lý do không phải implementer cũ yếu mà vì nó đã vá đúng dòng regex này BA lần, mỗi lần để hở một ranh giới khác (thứ tự pattern → case ký tự đầu → khoảng trắng trong quote). Đó là dấu hiệu không tự thấy được vấn đề của chính mình.
Ruling: hướng sửa ưu tiên là regex quote-aware (nếu ký tự sau `-p` là quote thì bắt tới quote đóng). Tôi CÂN NHẮC và không chọn hướng "dùng parseCommand của Task 1 để tokenize rồi soi argv" dù nó xử quote đúng sẵn: `redact` còn được dùng cho `stdout` ở Plan 2, nơi không có lệnh để tokenize, nên đổi sang command-aware sẽ tách redact thành hai đường và mở rộng phạm vi task. Nhưng nếu regex quote-aware lại hở lần nữa thì hướng tokenize là lựa chọn tiếp theo, không phải vá regex lần thứ năm.
Task 5: fix round 4/5 — commit 2d85ea4 (implementer MỚI, sonnet), 107/107 pass. Controller đo ma trận đầy đủ: 18/18 ca che SẠCH, 0/9 che thừa. Implementer mới làm ba việc ba round trước không làm: (a) tự tìm CÙNG lỗ ở `--password=` và `--password <space>`, verify (`psql --password 'S3cr3t Pw'` → rò `Pw'`) rồi mới sửa; (b) báo ba ranh giới nó KHÔNG sửa kèm bằng chứng đo; (c) hỏi controller quyết thay vì tự mở rộng hoặc im lặng bỏ qua.
Ruling: ba ranh giới tự báo — tôi đo lại, cả ba RÒ thật: `export DB_PASSWORD='hunter two'` → lộ `two`; `Authorization: Bearer a b c` trong quote → lộ `b c`; quote không đóng → lộ phần sau. Vào round 5 để đóng cả LỚP, không park. Lý do không park: module này tồn tại để không rò; một rò đã đo được trong chính module redact thì không phải "minor deferred" mà là hỏng đúng chức năng duy nhất của nó. Xét mức thực tế: ca env-sensitive là thật (passphrase có khoảng trắng); ca auth-header lý thuyết hơn (token JWT/OAuth là base64url, không có khoảng trắng); quote không đóng là lệnh méo, ít khi chạy được. Nhưng cùng một idiom sửa được cả ba nên tách ra không rẻ hơn.
Ruling: giữ NGUYÊN implementer round 4 cho round 5, không đổi lần nữa. Quy trình nói round 4-5 dùng implementer mới trên model mạnh hơn — việc reset "mắt mới" đã xảy ra ở round 4 và nó chứng minh kỷ luật (verify trước khi sửa, báo ranh giới còn hở). Áp cùng helper đã kiểm cho hai pattern nữa là việc cơ học, rủi ro thấp.
Task 5: fix round 5/5 — commit d5c89ef, 115/115 pass. Controller đo: ma trận 21 CHE + 9 GIỮ → 0 rò, 0 che thừa. Ca tôi tự thêm cũng đúng: `-d '{"a":1}'` không bị nuốt, multi-header giữ `X-Trace: t1`, secret nằm SAU JSON vẫn bị che.
LỖI CHỈ THỊ CỦA CONTROLLER: tôi bảo "áp cùng helper quote-aware" cho `auth-header`. Implementer verify TRƯỚC và phát hiện ca đó khác cấu trúc — quote bọc cả `Authorization: Bearer ...`, không nằm sát giá trị như `-p`/`env-sensitive` — nên áp máy móc sẽ KHÔNG đóng được. Nó dùng pattern riêng `auth-header-quoted` với backreference, và loại phương án "quét tới quote gần nhất" vì rủi ro nuốt nội dung sau (verify bằng `-d '{"a":1}'`). Chỉ thị tôi sai; nó không làm theo mù quáng. Đây là hành vi tôi muốn: verify chỉ thị trước khi thi hành.
Task 5: minor (deferred): dấu quote quanh `Authorization: Bearer ***` bị ăn (`-H Authorization: Bearer ***` thay vì `-H 'Authorization: Bearer ***'`). Thẩm mỹ, không rò.

Task 5: BREAKER BẬT sau round 5/5 — re-review còn 1 Critical + 1 Important mở. Controller tự phán quyết, KHÔNG dispatch round 6.

Task 5: parked — Critical `auth-header-quoted` rò đuôi khi giá trị header chứa quote nhúng — Ruling: THẬT nhưng KHÔNG load-bearing. Tôi đo và xác nhận cả 3 ca rò. Nhưng đầu vào làm nó hỏng đều là header Authorization MÉO: token Bearer theo RFC 6750 là base64url (ALPHA/DIGIT/-/./_/~/+//=), Basic là base64 — cả hai KHÔNG chứa quote hay khoảng trắng. Tôi đo token hợp lệ (`eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc-_123` và `dXNlcjpwYXNzd29yZA==`): che SẠCH. Nên phần bị rò là đuôi của một thứ không phải credential. Không task nào ở Plan 1 (6–13) dựa vào nhánh này. Nếu tôi sai: một header dị dạng chứa quote sẽ để lộ phần văn bản sau quote — không phải secret thật.

Task 5: parked — Important `valueSrc()` không "che tới hết chuỗi" đúng nghĩa khi quote cùng loại xuất hiện lại sau đó — Ruling: THẬT, log bị nuốt nội dung lệnh không liên quan (`export DB_PASSWORD='hunter2 && git commit -m "don't forget"` → `DB_PASSWORD=***t forget"`). Nhưng KHÔNG rò secret: `hunter2` và `sec` nằm TRONG vùng bị che (đã đo). Và điều kiện kích hoạt là quote không đóng — tức lệnh méo mà shell cũng không chạy được. Park. Nếu tôi sai: một dòng log trông như rác trong tình huống lệnh đã sai cú pháp.

Task 5: KẾT LUẬN CẤU TRÚC (đây mới là đầu ra đáng giá nhất của task này, cần tới final review và Plan 2):
SÁU lần sửa một dòng regex, mỗi lần đóng một ranh giới và mở một ranh giới khác — thứ tự pattern → case ký tự đầu → khoảng trắng trong quote → quote nhúng → quote cùng loại xuất hiện lại. Đó là bằng chứng REGEX TRÊN VĂN BẢN LỆNH THÔ là công cụ sai, không phải implementer bất cẩn. Hai lần tôi loại hướng tokenize (dùng `parseCommand` của Task 1, thứ xử quote và escape ĐÚNG sẵn) vì lý do bảo vệ được: `redact` còn dùng cho `stdout` ở Plan 2, nơi không có lệnh để tokenize. Lý do đó vẫn đúng, nhưng bằng chứng tích luỹ giờ nặng hơn nó.
Ruling cho Plan 2: tách `redact` thành HAI cửa vào — `redactCommand(cmd)` tokenize bằng `parseCommand` rồi che theo từng argv (diệt cả lớp lỗi ranh giới quote, và đây đúng là đường mang credential), và `redactText(s)` giữ pattern regex cho output tự do. Không làm bây giờ vì nó mở rộng phạm vi Task 5 và không task nào ở Plan 1 bị chặn.

Task 5: complete (commits a147d23..d5c89ef, 2 parked)
Task 6: dispatched (haiku), BASE=d5c89ef

Ruling (CHỈNH phán quyết pre-flight #4 về Task 9): tôi từng phán "Task 9 phải làm đủ 4 ruleId theo spec". Đọc brief thì thấy nó GỘP `policy-file`/`hooks-file`/`install-dir` thành một ruleId `selfprotect.policy-file` điều khiển bởi `policy.selfProtect.protectedPaths` (default.json có đủ 4 đường dẫn: `**/codex-guardrail.json`, `~/.codex/hooks.json`, `~/.codex/config.toml`, `~/.codex/guardrail/**`). Nên MỌI bảo vệ đều có mặt — chỉ khác ở độ mịn của ruleId, và thiết kế policy-driven này TỐT HƠN 4 ruleId hardcode.
Chỉnh lại: giữ thiết kế protectedPaths, nhưng tách ruleId theo đường dẫn nào khớp. Lý do: ruleId là thứ đi vào `CODEX_GUARDRAIL_ALLOW=<ruleId>`, nên gộp làm escape bị RỘNG hơn cần — dev cần sửa hợp lệ `codex-guardrail.json` sẽ mở luôn khoá cho `~/.codex/hooks.json`. Escape phải hẹp nhất có thể. Và `guardrail stats` gộp theo ruleId nên gộp cũng làm mất tín hiệu.
Chỉnh tiếp: nửa sau phán quyết pre-flight #4 ("phải bắt `rm` trên nhánh Bash") CŨNG là báo động sai. Brief Task 9 dòng 54 có test `'rm codex-guardrail.json'`, dòng 90 có `WRITE_BINS` gồm rm/tee/sed/mv/cp/truncate/ln/dd/patch. Plan đã xử.
TỰ KIỂM ĐIỂM: 2 trong 4 finding pre-flight của tôi là báo động sai (Task 2 "thiếu test result.mjs", Task 9 "thiếu 4 ruleId + thiếu rm"), và CẢ HAI cùng một nguyên nhân: tôi đọc mục Interfaces/Files của brief rồi kết luận, thay vì đọc CODE trong brief. Lần đầu tôi đã ghi bài học "đọc nội dung test, không đọc danh sách file test" mà vẫn tái phạm ở dạng khác. Với Task 7,8,10,11,12,13 còn lại: mọi nghi vấn phải đối chiếu code trong brief trước khi thành phán quyết.
Còn hiệu lực từ pre-flight: chỉ #1 (tên fixture — đã áp dụng ở Task 4) và phần tách ruleId theo protectedPaths của #4.

Task 6: implemented DONE (commit 475563a, 125/125). Implementer TỰ TÌM một bug thật trong brief: `parseCommand('env')` trả `[]` vì tokenizer strip tiền tố `env`, nên nhánh chặn `env` trần không bao giờ chạy. Đo xác nhận: `env`→[], `env | grep SECRET`→[["grep","SECRET"]] (env bị strip sạch).
Ruling: bug ĐÚNG, nhưng bản sửa (regex trên chuỗi lệnh thô) bỏ lọt 5 dạng — tôi đo: `env | grep SECRET`, `env > /tmp/dump.txt`, `printenv | grep AWS`, `printenv AWS_SECRET_ACCESS_KEY`, `ls && env` đều LỌT. Chỉ `env && cat` bị chặn. Dạng lọt gồm cái nguy hiểm nhất (pipe env vào grep để lọc secret) và `printenv <TÊN_BIẾN>` (đọc đúng một secret, chính xác hơn cả dump).
Ruling: hướng sửa dùng `splitSegments` thay vì regex trên chuỗi thô. Tôi đo: `splitSegments('env | grep SECRET')`→["env","grep SECRET"], `('ls && env')`→["ls","env"], `('set -euo pipefail')`→["set -euo pipefail"]. Và dùng chính hành vi tokenizer làm tín hiệu: nếu `parseCommand(segment)` rỗng mà từ đầu segment là `env` thì đó LÀ dump (vì env không có gì theo sau); còn `env FOO=1 cmd` cho parseCommand ra ["cmd"] nên KHÔNG phải dump. Đây là bài học Task 5 áp dụng đúng chỗ: tái dùng code đã đúng thay vì viết regex mới trên văn bản thô.
Task 6: implementer làm đúng một chỗ quan trọng — `set -euo pipefail`/`set -e`/`set -x` KHÔNG bị chặn (chỉ `set` trần bị chặn). Chặn `set -e` thì mọi script shell đứt.

Task 6: review 1 → Needs fixes. 3 Important, 4 Minor, 2 ⚠️. Reviewer xác nhận cả 4 ruleId ĐƯỢC implement thật (không chỉ khai ở Produces) — nó tự chạy để kiểm, đúng điều tôi yêu cầu.
Ruling: bypass redirect ĐÚNG. Tôi đo: `env > /tmp/dump.txt` chặn, nhưng `env >/tmp/dump.txt`, `env>/tmp/dump.txt`, `env>>file`, `printenv>x` đều LỌT. Nguyên nhân: regex redirect đòi operator là token riêng, mà `tokenize()` không tách theo `>`. Đây là bypass trên chính ca tôi ghi "bắt buộc chặn", và cú pháp shell hợp lệ phổ biến.
Ruling: chặn oan `printenv PATH` là HẬU QUẢ CỦA YÊU CẦU TÔI ĐẶT RA. Tôi bắt chặn `printenv AWS_SECRET_ACCESS_KEY`, implementer thoả mãn bằng cách chặn MỌI `printenv` có tham số. `printenv PATH`/`HOME`/`NODE_ENV` bị chặn — lệnh vô hại, cực phổ biến. Yêu cầu của tôi quá thô. Sửa: chỉ chặn khi TÊN BIẾN trông nhạy cảm, tái dùng khái niệm đã có trong redact.mjs (`*_SECRET*`, `*_TOKEN`, `*_PASSWORD`, `*_KEY`, `*_CREDENTIALS`, `AWS_*`). Chặn được ca nguy hiểm, cho qua ca vô hại.
Ruling: `MANAGER_READ` chạy trên `ctx.command` THÔ nên chặn oan `git commit -m "please run vault read later"` và `git commit -m "kubectl get secret notes"`. Cùng LỚP lỗi mà brief/implementer đã vá cho path token nhưng không vá cho pattern này. Sửa: chạy regex trên argv đã tokenize, không trên chuỗi nguyên văn.
Ruling (⚠️ #1 giải): `ls -la ~/.ssh` LỌT vì pattern `~/.ssh/**` đòi dấu `/` sau `.ssh`. PARK. Liệt kê thư mục tiết lộ có key nào tồn tại (do thám) chứ không tiết lộ nội dung key; `cat ~/.ssh/id_rsa` vẫn bị chặn đúng (đã đo). Thêm `~/.ssh` vào readPaths sẽ chặn cả `ls` vô hại. Rủi ro thấp hơn giá phải trả.
Ruling (⚠️ #2 giải): `python -c "print(open('.env').read())"` LỌT. PARK, và đây KHÔNG phải lỗi Task 6 — là trần cưỡng chế cố hữu của cách tiếp cận khớp văn bản: mọi interpreter (`python -c`, `node -e`, `ruby -e`, `perl -e`) đọc được file mà không nêu tên theo cách rule thấy. Chặn interpreter kèm `-c`/`-e` sẽ sinh false positive khổng lồ (chính tôi dùng `node -e` liên tục trong phiên này). Phải đưa vào mục "Known limits" của spec — đây là dữ kiện thiết kế cả team cần biết, không phải bug để vá. Ghi cho final review.
Task 6: fix round 3/5 — commit 3b26910. Sửa 3 Important + 4 Minor. Controller đo 41/41.
Task 6: fix round 4/5 — commit 452c612, 132/132 pass. Controller đo 52/52 (25 chặn + 27 cho qua), GỒM 6 ca chặn-oan tôi tự nghĩ cho bản sửa substitution: `echo "(env vars)"`, `git commit -m "$(date)"`, `awk '{print $1}'`, `echo "see (env) docs"`, `VERSION=$(node -p 1) npm test`, `docker build --build-arg X=$(git rev-parse HEAD) .` — tất cả cho qua đúng.
Ruling: implementer được giao QUYỀN QUYẾT giữa sửa và park cho ca `$(env)`/backtick/`(env)`; nó chọn SỬA và bản sửa không sinh chặn oan trên 6 ca rủi ro. Chấp nhận. Ghi lại vì đây là lần tôi giao quyết định thay vì ra lệnh, và kết quả tốt hơn cả hai hướng tôi nghiêng.
Ruling: BỎ ca `printenv STRIPE_SK` (lọt). `SK` quá ngắn và mơ hồ, thêm vào sẽ chặn oan nhiều thứ. Cân rồi loại có chủ đích, không phải sót.
Task 6: fix round 5/5 — commit b562586, 132/132. Implementer chọn hướng ĐỆ QUY (extractSubstitutions) như tôi nghiêng. Controller đo ma trận hợp nhất 70 ca: 69 đúng. Cả 6 ca wrapped printenv giờ CHẶN đúng; 5 ca chặn-oan mới tôi thêm cho hướng đệ quy (`grep -E "(env|prod)"`, `sed 's/(env)/x/'`, `echo $((1+2))`, `echo ${HOME}`) đều cho qua đúng.

Task 6: BREAKER BẬT sau round 5/5. Còn 2 finding mở. Controller tự phán quyết, KHÔNG dispatch round 6.

Task 6: parked — chặn oan `jq '.env' f.json` — Ruling: THẬT, nhưng CÓ TỪ TRƯỚC chứ không phải hồi quy round 5. `normalizePath` bỏ quote nên `'.env'` thành `.env` và khớp glob `**/.env` — cùng cơ chế đang chặn đúng `cat .env`. Sửa đúng cần biết SEMANTICS THAM SỐ THEO TỪNG BINARY (arg đầu của `jq`/`yq` là filter, không phải path), tức thêm một tầng kiến thức per-binary — thay đổi thiết kế đáng kể, không phải sửa nhỏ. Không task nào ở Plan 1 bị chặn bởi nó. Chuyển sang danh sách deferred cho final review triage với ngữ cảnh toàn branch. Nếu tôi sai: một dev dùng `jq '.env'` bị chặn oan và phải escape — khó chịu nhưng không mất an toàn.
Task 6: parked — test không khoá wrapped printenv (`grep -c "printenv PASSWORD)"` = 0) — Ruling: THẬT và là lần THỨ HAI đúng lỗ này xuất hiện trong task này (lần đầu ở round 2, tôi đã bắt sửa). Hành vi đã đúng — tôi tự đo 6/6 ca wrapped printenv đều chặn. Nhưng không có gì khoá lại, và đây chính xác là cách lỗ Task 5 sống qua ba vòng review. Park vì đã chạm cap, KÈM khuyến nghị rõ cho final review: đây là mục deferred đáng sửa nhất trong danh sách, chi phí gần bằng không (thêm hai test loop), và nó bảo vệ một hành vi đã tốn 5 round để đạt được.

Task 6: complete (commits d5c89ef..b562586, 2 parked)

## Task 7 — Rule `infra`

Task 7: pre-flight scan — CHẠY CODE THẬT trong brief (không đọc khai báo Interfaces), đo ma trận 23 ca: **11 SAI**. Hai chùm riêng biệt, cả hai là lỗi tầng thiết kế của plan chứ không phải lỗi chép của implementer.

Ruling (chùm 1 — LỌT, 5 ca): wrapper `npx`/`bunx`/`sudo` vô hiệu hoá deny-binary. Code chỉ soi `basename(argv[0])`, nên `npx wrangler deploy`, `npx supabase db reset`, `npx vercel --prod`, `bunx wrangler publish`, `sudo psql -l` đều LỌT (đo trực tiếp). Nghiêm trọng vì `npx <tool>` là cách gọi CHUẨN của `vercel`/`wrangler`/`supabase`/`flyctl` trong dự án JS — tức 4/21 entry trong denyBinaries gần như không được cưỡng chế. Đã xác nhận tokenizer KHÔNG strip `sudo`/`npx` (chỉ strip `env`). Lưu ý: `sudo docker system prune` bị chặn NHỜ MAY — do denyPattern khớp văn bản thô, không phải do deny-binary hoạt động.

Ruling (chùm 2 — CHẶN OAN, 6 ca): `denyPatterns` chạy regex trên `ctx.command` THÔ. Đúng LỚP lỗi đã tốn một round ở Task 6 (MANAGER_READ trên chuỗi thô). Đo: `rm -rf /tmp/build`, `rm -rf /Users/me/p/node_modules`, `rm -rf ~/Library/Caches/foo`, `git commit -m "docker system prune is dangerous"`, `git commit -m "chore: prep npm publish"`, `echo "never run docker volume rm"` — tất cả BỊ CHẶN OAN. Hai ca đầu là khiếm khuyết tai hại nhất phiên này: dev chạy `rm -rf` lên `/tmp` và `node_modules` nhiều lần MỖI NGÀY trong đúng loại dự án guardrail này nhắm tới. Theo bất đối xứng đã ghi: chặn oan → dev tắt guardrail → guardrail bảo vệ 0 thứ.

Ruling: pattern `rm\s+-rf\s+/` và `rm\s+-rf\s+~` SAI VỀ BẢN CHẤT, không chỉ sai chỗ áp dụng. Cần neo "chỉ đúng root" (`rm -rf /`, `/*`, `/ --no-preserve-root`, `~`) và cho qua mọi đường dẫn con. Đây là dữ liệu trong `policy/default.json` nên tôi CHO PHÉP tường minh sửa file đó — pattern là data, không phải code.

Ruling: brief KHÔNG CÓ test nào bắt được hai chùm này. Nếu không can thiệp, implementer sẽ ship 14 test xanh với 11 lỗ. Đây chính là lý do pre-flight scan tồn tại. Bắt buộc MÃ HOÁ ma trận thành test (không chỉ đo tay) — áp dụng trực tiếp bài học Task 6 "hành vi đúng mà không có gì khoá lại thì sẽ hồi quy".

Task 7: implemented DONE (commit 1f3ec9d, 153/153, +21 test). Controller tự đo 59 ca: **0 SAI, 0 THROW** — gồm ma trận 23 ca đã giao, 6 ca crash-risk wrapper trần (`sudo`/`npx`/`time`/`sudo -i`/`npx -y`/`nice -n 10` — không ném), fallout tập wrapper, chained segment, biến thể root, và nhánh ssh/scp. Đã xác minh test THẬT SỰ khoá ma trận (15/15 ca spot-check có trong test file, 21 test).
Ruling: implementer tự làm đúng 2 chỗ ngoài mandate — (a) `^(?:src)` thay vì `^src`, giữ đúng alternation cấp cao trong pattern của user (tôi sẽ làm sai chỗ này); (b) cho nhánh ssh dùng `effectiveArgv` nên `sudo ssh prod "psql"` bị chặn. Ghi nhận.
Ruling: implementer CỐ Ý loại `command` khỏi tập wrapper vì `command -v psql` là lệnh dò vô hại, và KHOÁ bằng test để không ai thêm lại. Đúng bất đối xứng. Chấp nhận.
Ruling: implementer CỐ Ý không viết test khẳng định `allow` cho các ca để lọt, lý do "test như thế khoá cứng cái lỗ, làm khó bản sau vá". Đúng. Ghi lại vì đây là nguyên tắc tôi chưa từng phát biểu nhưng nên áp cho các task sau.

Task 7: review 1 → Needs fixes. 2 Critical, 2 Important, 7 Minor. Reviewer làm mutation testing (16/17 breakage bị test bắt) + corpus chống chặn oan cho mọi hướng sửa nó đề xuất. Chất lượng review cao nhất phiên này.

Ruling (Critical 1 — XÁC NHẬN, tôi tự đo): **câu lệnh ghép shell vô hiệu hoá TOÀN BỘ rule.** `for f in *.sql; do psql -f $f; done`, `if [ -f a ]; then psql -l; fi`, `(psql -l)`, `{ psql -l; }`, `(cd /app && rm -rf /)`, `for d in */; do terraform apply; done` — LỌT HẾT. Nguyên nhân đo được: `parseCommand('for f in *.sql; do psql -f x; done')` → `[["for","f","in","*.sql"],["do","psql","-f","x"],["done"]]` — keyword `do` dính vào segment nên `basename(argv[0])`=`do`. Và `parseCommand('(cd /app && rm -rf /)')` → `[["(cd","/app"],["rm","-rf","/)"]]` — dấu `)` dính vào path nên phá luôn neo `$` của pattern rm. KHÔNG phải ca đối kháng: vòng `for` trên file .sql và `(cd dir && ...)` là cách agent viết lệnh bình thường. Cả denylist (`psql`/`terraform`/`aws`/`kubectl`) không được cưỡng chế bên trong bất kỳ vòng lặp hay subshell nào. Nguy hiểm hơn: `(cd infra && terraform apply)` LẠI bị chặn (dấu ngoặc rơi vào token khác), nên lỗ này vô hình khi test hời hợt.

Ruling (Critical 2 — XÁC NHẬN, phát hiện sắc nhất phiên này): **dạng `rm -rf /` duy nhất CHẠY ĐƯỢC lại không bị chặn.** Đo: `rm -rf --no-preserve-root /` LỌT, `rm --no-preserve-root -rf /` LỌT, `rm -r -f /` LỌT, `rm -f -r /` LỌT, `rm -rf -v /` LỌT, `rm --recursive --force /` LỌT. Trong khi `rm -rf /` bị CHẶN — mà GNU coreutils vốn đã TỪ CHỐI thi hành `rm -rf /` trần. Tức chúng ta đang chặn dạng vô hại và cho qua dạng gây chết. R3 tôi đặt ra chỉ liệt kê flag ĐỨNG SAU path (`rm -rf / --no-preserve-root`) nên implementer thoả mãn đúng chữ; dạng flag ĐỨNG TRƯỚC — dạng người ta thật sự copy-paste — lọt. Lỗi ở yêu cầu của tôi, không ở implementer.

Ruling (Important 2 — XÁC NHẬN): `ssh.denyHosts` bị lách bằng CHỮ HOA. Đo: `ssh API.ITALENT.ASIA` LỌT, `ssh Prod` LỌT, `scp a.txt PROD:/tmp/` LỌT, `ssh api.italent.asia.` (FQDN có dấu chấm cuối, hợp lệ) LỌT. Hostname DNS không phân biệt hoa thường (RFC 4343) nên chỉ cần giữ Shift là thoát một deny-list có hợp đồng "không được chạm". Sửa: lowercase hai phía + bỏ dấu chấm cuối. Rủi ro chặn oan bằng 0 vì case-insensitive ĐÚNG LÀ đặc tả của hostname.

Ruling (Important 1 — PARK, và đây là quyết định về THẾ TRẬN nên tôi không tự nới): R1 của tôi đóng được bypass `npx` nhưng ĐỒNG THỜI tạo ma sát hằng ngày: `npx wrangler dev`, `npx supabase start`, `npx vercel dev`, `npx supabase gen types --local` giờ bị chặn — đều là lệnh local, chỉ đọc, chạy nhiều lần mỗi ngày. Cùng HÌNH DẠNG sai với `printenv` ở Task 6: yêu cầu của tôi quá thô, implementer thoả mãn đúng chữ, chặn oan theo sau. Reviewer đề xuất chuyển 4 tool này từ `denyBinaries` sang `denyPatterns` theo subcommand (đã đo: 9/9 must-deny vẫn chặn, 9/9 local-dev cho qua).
Ruling: TÔI TỪ CHỐI hướng đó ở Task 7. Lý do: nó lật thế trận từ "deny-list công cụ" (mặc định an toàn, user chốt tường minh) sang "cho qua trừ subcommand đã biết là xấu" — mà danh sách subcommand xấu vốn không thể đầy đủ (`wrangler r2 object delete`, `wrangler kv key delete`, `supabase db remote commit`, `vercel env rm`...). Đổi thế trận là quyết định của user, không phải của tôi trong một fix round.
Ruling: nhưng chẩn đoán CỐT LÕI của reviewer thì ĐÚNG và quan trọng — **cửa thoát `allowBinaries` quá thô**: dev cần `supabase gen types` buộc phải mở luôn `supabase db reset --linked`. Đó đúng là đường dẫn tới "dev tắt guardrail". Fix thật là thêm `allowPatterns` (cửa thoát theo subcommand) — TÍNH NĂNG MỚI, thuộc Plan 2. Ghi vào Plan 2 kèm ngữ cảnh đo được.

Task 7: fix round 1/5 — commit 83616be, 160/160 (+7 test). Controller tự đo 79 ca: **0 SAI, 0 THROW**. Gồm ca mới tôi tự dẫn ra: bẫy prefix `do`, token đơn lẻ `do`/`(`/`{`/`!`/`then`/`((count++))`, vòng lặp lồng subshell, văn bản `(psql -l)` trong tham số, `find . -exec rm -rf {} \;`, pattern denyHosts viết HOA.
Ruling: implementer tìm được một bẫy tôi và reviewer đều không thấy — **`docker` BẮT ĐẦU bằng `do`**, nên nếu C1 sửa bằng prefix match thì `docker system prune`/`docker volume rm` bị VÔ HIỆU HOÁ ÂM THẦM. Nó dùng so khớp token CHÍNH XÁC và khoá bằng mutation test (nới thành prefix → 4 test đỏ). Đây là loại bug tệ nhất: bản sửa một lỗ lại mở lỗ khác, im lặng.
Ruling: implementer cũng tự phát hiện sketch của reviewer sai một chỗ — bóc `(`/`{` dính argv[0] biến token `{` ĐƠN LẺ thành chuỗi rỗng nên lọt qua danh sách keyword; `{ psql -l; }` vẫn lọt sau lượt sửa đầu. Nó tự đo ra và chỉ nhận kết quả bóc khi không rỗng.
Ruling: implementer tự chạy corpus 83 lệnh chống chặn oan (0 hồi quy) + tự đo lại 19 ca cố ý để lọt (không trôi hành vi), thay vì tin số của reviewer. Đúng yêu cầu.

Task 7: PHẢN BIỆN của implementer với reviewer — `rm -rf ~foo` KHÔNG nên là ca cho-qua-đúng. Ruling: **implementer ĐÚNG.** `~foo` là tilde expansion tới home của USER KHÁC, cùng hạng nghiêm trọng với `rm -rf ~`, không phải ca gần-giống. Reviewer liệt kê nó như allow đúng; yêu cầu R3 của tôi cũng cho qua. Cả reviewer và tôi đều sai chỗ này. Đây là lần THỨ BA implementer đúng và tôi sai trong dự án này (Task 5 auth-header, Task 6 `parseCommand('env')`, giờ là đây) — cả ba lần đều vì nó KIỂM CHỨNG trước khi làm theo.
Ruling: implementer CỐ Ý không viết test allow cho `~foo` và `/*.log` để không khoá cứng lỗ. Đúng nguyên tắc nó tự phát biểu ở round trước và tôi đã chấp nhận.

Task 7: ADJUDICATION nhóm 4 ca tranh chấp — KHÔNG dispatch round 2, gộp thành MỘT finding mạch lạc cho final review.
Đo được (đều LỌT): `rm -rf ~foo`, `rm -rf /*.log`, `rm -rf /tmp/a /`, `rm -rf . /`, `rm -rf /usr`, `rm -rf /etc`.
Ruling: `rm -rf / tmp/foo` (khoảng trắng sau `/` — tai nạn kinh điển) thì ĐÃ CHẶN đúng; dạng lọt là root ở vị trí tham số THỨ HAI.
Ruling: KHÔNG thêm nhánh regex nữa. Lý do là kết luận cấu trúc đã ghi ở Task 5/6: Task 5 và Task 6 đều đốt hết 5 round vì đúng kiểu "đóng một biên, mở biên khác" trên regex-trên-văn-bản. Tôi thử hướng regex cho `rm -rf ./build /` và thấy ngay nó chặn oan `rm -rf "dir with / slash"` — hình dạng thất bại y hệt. Cách sửa ĐÚNG là kiểm ở mức TOKEN: có token đường dẫn nào bằng đúng `/`, `~`, hay `~user`. Đó là một thay đổi thiết kế gọn, làm một lần, không phải bốn miếng vá.
Ruling: `rm -rf /usr`, `/etc` là KHOẢNG TRỐNG CỦA SPEC chứ không phải bug Task 7 — danh sách denyPatterns mặc định chưa bao giờ có thư mục hệ thống. Cần một danh sách `protectedRoots` tường minh, là bổ sung thiết kế. Chuyển cho final review kèm ngữ cảnh này.
Ruling: đã ghi cả 4 vào §15 của spec (giới hạn đã biết) + sửa lệch spec §6.2, và đổi `PreToolUse: shell` → `Bash` ở 7 heading (lệch từ Task 0 chưa ai vá). Commit 6588707.

Task 7: complete (commits 1f3ec9d..6588707, 160/160, 4 parked gộp thành 2 finding thiết kế)

## Task 8 — Rule `git-workflow`

Task 8: pre-flight scan — đo trực tiếp bằng `parseCommand`+`basename`+công thức `verb` của brief. **4 khiếm khuyết, đều CÙNG HÌNH DẠNG: giả định vị trí/khớp token chính xác trên bề mặt CLI của git.**

Ruling (G1 — Critical): `git -C <dir>` phá công thức `verb`. Đo: `git -C /repo push --force` cho `args=["-C","/repo","push","--force"]`, `verb="/repo"` (vì `find(a => !a.startsWith('-'))` bắt được giá trị của `-C` trước). Hệ quả: MỌI kiểm dựa trên verb bị bỏ — force-push không chặn, `needsBranchCheck` không bật nên protected-branch cũng không kiểm. `git -C` là dạng gọi bình thường, không phải lách.

Ruling (G2 — Critical): bypass wrapper/keyword shell TÁI DIỄN, y hệt Task 7. Đo: `sudo git push --force` cho `bin="sudo"`; `for b in a b; do git push --force origin $b; done` cho segment giữa có `bin="do"`. Cả hai bị `filter(b === 'git' || b === 'gh')` loại sạch trước khi kiểm bất cứ thứ gì. Đây là lần THỨ HAI cùng lỗ, ở rule thứ hai — tức nó là quan tâm CHUNG của mọi rule soi command, không phải đặc thù của infra.
Ruling: Task 7 đã giải đúng bằng `effectiveArgv` nhưng để private trong `infra.mjs`. Nhân bản logic an toàn ra hai chỗ là đúng lớp bug "sửa một chỗ quên chỗ kia". Vì vậy TÔI CHO PHÉP: tạo `lib/argv.mjs` chứa helper dùng chung, VÀ refactor `infra.mjs` để import từ đó. Bình thường tôi khoá file đã review, nhưng ở đây refactor an toàn kiểm chứng được vì test Task 7 khoá hành vi wrapper/keyword rất chặt (đã qua mutation test: nới token-match thành prefix-match thì 4 test đỏ, vì `docker` bắt đầu bằng `do`). Điều kiện: 160/160 cũ phải còn xanh.

Ruling (G3 — Important): `git commit -am` bỏ qua kiểm message. Đo: `git commit -am "sua loi"` cho `args=["commit","-am","sua loi"]`, `has('-m')` FALSE nên nhánh `git.commit-message` không chạy. `-am` là dạng cực phổ biến. `--message="..."` cũng lọt (đo: `args=["commit","--message=sua loi"]`).

Ruling (G4 — Important): dạng long-flag lọt ở 3 chỗ. Đo: `git clean --force -d` thì regex `/^-[a-z]*f/` KHÔNG khớp `--force` (sau `^-` thì `[a-z]*` không ăn được dấu gạch thứ hai) nên lọt; `git tag --delete v1.0.0` lọt vì chỉ kiểm `-d`; `git push --force-with-lease=refs/heads/x` lọt vì `has()` so khớp CHÍNH XÁC. Cùng nguyên nhân gốc với G1/G3: git nhận cả short/long/gộp/`=value` cho cùng một ý nghĩa.

Task 8: implemented DONE (commit b3ded68, 194/194, +34 test). 160 test cũ CÒN XANH NGUYÊN sau refactor. Controller tự đo 68 ca: **0 SAI, 0 THROW**.
Đã xác minh refactor G2 là PURE MOVE: diffstat `lib/rules/infra.mjs | 67 +----` với đúng 1 dòng thêm (`import { effectiveArgv } from '../argv.mjs'`) và 66 dòng xoá. Không đổi logic.
Đã xác minh tính chặt của test Task 7 còn nguyên sau khi chuyển sang `lib/argv.mjs`: nới token-match thành prefix-match thì đúng 4 test đỏ (`docker` bắt đầu bằng `do`), revert thì 160/160.

Ruling: implementer tự tìm thêm 3 khiếm khuyết ngoài G1-G4 tôi giao, cả ba cùng gốc với G1/G4:
- G5: `(cd /repo && git push --force)` cho token cuối là `--force)` — dấu ngoặc rơi vào CHÍNH CÁI CỜ nên khớp chính xác trượt; `(cd /r && git push)` cho `push)` làm chết luôn kiểm branch. Đây là ca NẰM TRONG danh sách phải-chặn tôi giao, tức nếu nó không tự tìm thì tôi sẽ bắt được ở vòng verify — nhưng nó tìm trước.
- G6: `args.includes('merge')` của brief CHẶN OAN `gh pr list --search merge` — lệnh chỉ đọc. Không chỉ là lọt mà là chặn oan, đúng chế độ hỏng tệ nhất. Sửa thành khớp theo VỊ TRÍ subcommand.
- `-n` BẤT ĐỐI XỨNG theo verb: `git commit -n` LÀ `--no-verify`, nhưng `git push -n` là `--dry-run`. Coi `-n` là no-verify toàn cục sẽ chặn oan `git push -n`. Nó tra man page rồi gate theo `verb === 'commit'`. Cũng miễn trừ dry-run khỏi kiểm `clean`, vì chặn `git clean -nfd` thì TỰ MÂU THUẪN với hint của chính rule ("xem trước bằng git clean -nd").
Ruling: cả ba đều ĐÚNG và tôi tự đo xác nhận. Đặc biệt `-n` bất đối xứng là loại tri thức chỉ có nếu THẬT SỰ đọc man page thay vì suy đoán.

Ruling: implementer sửa `protected-branch` để hỏi branch của thư mục `-C` (fold qua `resolve`, tích luỹ như git) chứ không phải của `ctx.cwd`. ĐÚNG: kiểm branch của cwd cho một repo khác thì vừa chặn oan vừa cho lọt. Đây là lỗi đúng đắn (correctness) mà brief không hề nghĩ tới.

Ruling: implementer chạy corpus 298 lệnh git/gh nhân 2 branch = 596 phép đo, 0 hồi quy; và đo code brief trên cùng corpus thấy brief CHẶN OAN 2 ca (`gh pr list --search merge`, `git clean -nfd`). Đúng yêu cầu "tự đo, không tin số của reviewer".

Task 8: 6 ca tôi tự dò thêm sau khi verify — phán quyết:
Ruling (F1, CHO PHÉP SỬA): `if git push --force; then echo ok; fi` và `while ! git push --force; do sleep 1; done` LỌT vì `SHELL_KEYWORDS` thiếu `if`/`while`/`until`. Đây là Critical 1 của Task 7 TÁI DIỄN ở vị trí ĐIỀU KIỆN, và ảnh hưởng CẢ HAI rule (`if psql -l; then` cũng lọt). Implementer ĐÚNG khi từ chối tự sửa và xin phép — đó là thay đổi HÀNH VI của logic dùng chung, không phải refactor tôi đã cho phép. Giờ tôi cho phép tường minh.
Ruling (F2, SỬA): `git push origin :feat/x` LỌT. Refspec dấu hai chấm đứng đầu là TƯƠNG ĐƯƠNG CHÍNH XÁC với `--delete` mà ta đã chặn — tức đường lách một rule đã cam kết. Sửa, kèm giữ cho qua `HEAD:refs/heads/x` và `feat/x:feat/x` (hai chấm ở giữa là push thường).
Ruling (F3, SỬA): `git push --mirror` LỌT. `--mirror` xoá ref trên remote không có ở local — thực chất force-push toàn repo. Rủi ro chặn oan gần 0.
Ruling (PARK): `git branch -D feat/x` — reflog cứu được ~90 ngày, và `-D` là lệnh dọn branch đã merge dùng HẰNG NGÀY. Chặn là ma sát thật, giá cao hơn giá trị. Cân rồi loại có chủ đích.
Ruling (PARK): `git update-ref -d refs/heads/main` — plumbing, hiếm khi agent dùng, và chặn nó mở ra cả họ plumbing (`symbolic-ref`, `push --receive-pack`...) không có điểm dừng rõ. Ghi cho final review.

## Task 9 — Rule `self-protect`

Task 9: pre-flight scan — đo trực tiếp trên `tokenize.mjs` + logic brief. **5 khiếm khuyết.** Task này quan trọng nhất về mặt thế trận: không có nó thì mọi rule khác chỉ là gợi ý.

Ruling (S1 — Important, CHẶN OAN tự bắn vào chân): `ctx.command.includes('CODEX_GUARDRAIL_ALLOW')` là substring trên chuỗi THÔ. Đo, 3/4 ca chặn oan: `git commit -m "docs: explain CODEX_GUARDRAIL_ALLOW usage"`, `grep -rn CODEX_GUARDRAIL_ALLOW README.md`, `echo "set CODEX_GUARDRAIL_ALLOW to escape"`. Nghĩa là **guardrail chặn chính việc viết tài liệu cho guardrail** — README của dự án này BẮT BUỘC phải nhắc tên biến đó (§9 spec yêu cầu ghi rõ cách escape). Đúng lớp lỗi đã tốn round ở Task 6 (MANAGER_READ) và Task 7 (denyPatterns).
Ruling: sửa phải nhận ra ĐÚNG dạng gán biến ở đầu segment. Đo được điểm khó: `parseCommand('CODEX_GUARDRAIL_ALLOW=x psql -l')` trả `argv=["psql","-l"]` — tokenizer STRIP luôn tiền tố gán biến (cả dạng không có `env`), nên KHÔNG thấy được trong argv. Nhưng `raw` giữ nguyên và `splitSegments` cũng giữ nguyên. Vậy phải soi `raw`/segment với neo đầu, không phải `includes`.

Ruling (S2 — Critical): bypass wrapper/keyword TÁI DIỄN lần THỨ BA, ở rule thứ ba. Đo: `sudo rm codex-guardrail.json` cho `bin="sudo"`; `for f in a; do rm codex-guardrail.json; done` cho `bin="for"`. Task 8 đã tạo `lib/argv.mjs` nên lần này chỉ cần import `effectiveArgv` — không được viết lại. Đây là bằng chứng quyết định tách helper dùng chung ở Task 8 là đúng: cùng một lỗ đã xuất hiện ở infra, git-workflow, và giờ self-protect.

Ruling (S3 — Important, CHẶN OAN trái nguyên tắc của chính brief): brief tự phát biểu "đọc policy của chính mình là việc bình thường và hữu ích, ghi thì không" — rồi vi phạm nó. `WRITE_BINS` có `sed` và `cp`, và code soi MỌI token trong argv, nên:
- `sed -n '1,5p' codex-guardrail.json` (chỉ IN, không `-i`) bị chặn — đây là ĐỌC.
- `cp codex-guardrail.json /tmp/backup.json` bị chặn — đây là ĐỌC rồi ghi ra chỗ khác, tức sao lưu policy, việc nên khuyến khích.
Phải phân biệt: `sed` chỉ là ghi khi có `-i`; `cp`/`mv` chỉ là ghi khi đường dẫn được bảo vệ là ĐÍCH (tham số cuối), không phải NGUỒN. Riêng `mv <protected> <chỗ khác>` VẪN phải chặn vì nó làm mất policy khỏi vị trí cũ.

Ruling (S4 — Important): `sub.raw.match(/>>?\s*(\S+)/)` khớp redirect trên chuỗi thô nên `echo "a > codex-guardrail.json"` chặn oan, và chỉ bắt redirect ĐẦU TIÊN. Task 6 đã giải đúng bài này trong `secrets.mjs` (kể cả dạng không có khoảng trắng). Đây là ứng viên thứ hai cho helper dùng chung — ghi lại cho final review, đừng nhân bản lần thứ ba.

Ruling (S5 — thiết kế, GIỮ phán quyết cũ từ pre-flight ban đầu): brief gộp mọi đường dẫn được bảo vệ vào MỘT ruleId `selfprotect.policy-file`. Nhưng ruleId chính là khoá của escape (`CODEX_GUARDRAIL_ALLOW=<ruleId>`), nên gộp làm escape RỘNG HƠN Ý ĐỊNH: người chỉ muốn sửa `codex-guardrail.json` của dự án (đã có CODEOWNERS làm tầng hai) lại được cấp luôn quyền sửa `~/.codex/hooks.json` — tức quyền THÁO HOOK, thứ không có tầng nào chắn. Hai mức nghiêm trọng khác nhau hẳn. Phải tách ruleId theo nhóm đường dẫn.

## Task 10 — Dispatcher (pre-flight, làm sớm trong lúc chờ fix Task 8)

Task 10: pre-flight — đọc CODE trong plan (dòng 2006–2379). Thiết kế đã LÀNH sau khi tôi vá theo Task 0: deny qua JSON, `bin/guardrail.mjs` luôn `exit(0)`, REGISTRY khoá `Bash`, `denyMessage` không kết thúc bằng dấu chấm/newline. Không có khiếm khuyết nghiêm trọng. 5 điểm cần xử lý:

Ruling (T10-1 — Minor nhưng gây hiểu sai lâu dài): commit message ở Step 9 vẫn ghi `exit code 0/2/3`, TRÁI với chính thiết kế đã sửa (luôn exit 0, deny qua JSON). Ai đọc `git log` về sau sẽ hiểu sai kênh chặn. Phải sửa message khi commit.

Ruling (T10-2 — cần biết, không phải bug): `hookEventName: 'PreToolUse'` bị HARDCODE trong `deny()`. Với `failClosed` gọi khi `buildContext` NÉM thì ta chưa biết event thật, nên hardcode là lựa chọn duy nhất còn lại — chấp nhận được vì Plan 1 chỉ khai `PreToolUse` trong REGISTRY. Nhưng khi Plan 2 thêm `PostToolUse` (rule redact) thì chỗ này thành sai thật. Ghi lại để Plan 2 không quên.

Ruling (T10-3 — cần biết): `SAFETY_GROUPS` chứa CẢ BỐN group của Plan 1, nên nhánh fail-open (`stderr += canh bao rule loi, bo qua`) là CODE KHÔNG THỂ CHẠM TỚI ở Plan 1. Không phải lỗi — nhánh đó dành cho rule chất lượng ở Plan 2. Nhưng đừng viết test khẳng định nhánh đó, và đừng để reviewer báo nó như dead code cần xoá: xoá đi thì Plan 2 phải viết lại.

Ruling (T10-4 — phụ thuộc Task 8): dispatch `import { currentBranch } from './rules/git-workflow.mjs'` và gọi `currentBranch(ctx.cwd)`. Task 8 đã ĐỔI hành vi `currentBranch` để tính theo thư mục `-C`. Phải xác minh sau khi Task 8 chốt rằng export vẫn còn và chữ ký vẫn là `(cwd)`.

Ruling (T10-5 — LỖ ESCAPE THẬT, tôi tự tìm): escape hợp lệ dựa vào biến môi trường của tiến trình hook, thừa hưởng từ Codex. `export` bên trong một tool call KHÔNG lan tới tiến trình cha nên an toàn — ĐÚNG như thiết kế. NHƯNG agent có thể ghi dòng export đó vào `~/.zshrc`/`~/.bashrc`/`~/.profile`, và phiên Codex SAU sẽ thừa hưởng. Các file rc đó KHÔNG nằm trong `selfProtect.protectedPaths`. Đây là đường tháo guardrail bền vững, chỉ chậm một phiên. Chuyển cho Task 9 hoặc final review: cân nhắc thêm file rc của shell vào protectedPaths, hoặc ghi vào §15 như giới hạn đã biết nếu thêm vào gây chặn oan (dev sửa .zshrc là việc thường).

Task 8: fix round 1/5 — commit 8cd171a, 201/201 (+7 test). Đã xác minh `git diff --numstat b3ded68 HEAD -- tests/` cho `111 0` và `47 0`, tức **0 dòng test cũ bị xoá hay sửa** — chỉ thêm. Controller tự đo 41 ca: 0 SAI, 0 THROW.
Đã xác nhận F1 đúng là lỗ CHUNG: `if psql -l; then`, `while psql -l; do`, `until psql -l; do`, `if ! psql -l; then` đều LỌT trước fix và CHẶN sau fix — tức nó vá cho cả `infra` lẫn `git-workflow` bằng một chỗ. Đây là lợi tức của quyết định tách `lib/argv.mjs` ở Task 8.
`SHELL_KEYWORDS` giờ: `if, while, until, do, then, else, elif, {, (, !`. Đã tự đo 10 binary trùng tiền tố (`ifconfig`, `ifup`, `ifdown`, `iftop`, `doctl`, `dotnet`, `do-release-upgrade`, `untilx`, `whiley`) — cho qua hết; `docker system prune` và `docker volume rm` vẫn chặn.

Ruling: implementer PHẢN BIỆN yêu cầu của tôi và ĐÚNG — lần THỨ TƯ trong dự án này. Tôi viết "nới token-match thành prefix-match thì test `ifconfig`/`iftop` phải đỏ" và đặt chúng làm bằng chứng khoá. SAI. Nó đo `effectiveArgv` trên bản prefix-match: `ifconfig` cho argv RỖNG (vì `ifconfig` bắt đầu bằng `if` nên bị bóc), rule bỏ qua, kết quả vẫn `allow` — nên test allow đó **XANH cả trên bản hỏng**, không bắt được gì. Prefix-match sai theo hướng LỌT, không phải chặn oan. Chốt đỏ THẬT là họ `docker` (tiền tố `do`): 4 test Task 7 cộng 1 test F1 mới = 5 test đỏ.
Ruling: bài học cho chính tôi — khi tôi chỉ định "ca X phải đỏ nếu làm hỏng Y", tôi phải TỰ ĐO chiều hỏng trước khi khẳng định. Tôi suy đoán prefix-match gây chặn oan mà không kiểm; thực tế nó gây lọt. Implementer giữ test `ifconfig`/`iftop` (chúng ghim một lớp lỗi khác: ai đó đưa binary thật vào denylist) nhưng SỬA COMMENT cho khớp đo được, với lý do "một comment sai còn tệ hơn không có comment". Đồng ý.

Task 8: fix round 2/5 dispatch — LỖ TÔI TỰ TÌM sau khi verify round 1: `git push origin +main:main` LỌT. Tiền tố `+` trong refspec THEO ĐẶC TẢ GIT có nghĩa là force cho ref đó. Ta đã chặn `--force`, `--force-with-lease`, `--mirror`, và `:<ref>`; `+<src>:<dst>` là dạng còn lại của cùng ý nghĩa.
Ruling: đáng sửa dù ít gặp hơn `--force`, vì lý do THẾ TRẬN: guardrail chặn `--force`, nên agent bị chặn sẽ đi tìm đường khác — và `+refspec` chính là cách tài liệu git chỉ ra để force-push một ref. Không phải bypass lý thuyết mà là THỨ TIẾP THEO một agent bị chặn sẽ thử. Rủi ro chặn oan bằng 0 vì `+` đứng đầu refspec luôn có nghĩa force.

Task 8: đã vá lệch spec §6.3 (implementer phát hiện, tôi sở hữu file spec nên tự sửa): bảng `git.dangerous-flag` giờ nêu đủ `--mirror` cộng refspec `:<ref>` và `+<src>:<dst>`; thêm ghi chú về lệnh hữu hiệu (wrapper/keyword), về cách tìm subcommand bỏ qua global option, về `commit -n` so với `push -n`, về `gh pr merge` khớp theo vị trí, và về việc mọi kiểm cờ phải nhận short/long/gộp/`=value`.
Task 8: đã thêm §15 giới hạn #10 (escape cài bền vững qua file rc của shell — lỗ tôi tự tìm ở pre-flight Task 10) và #11 (`git branch -D`, `git update-ref -d` cố ý cho qua).

Task 8: fix round 2/5 — implementer DỪNG TRƯỚC KHI COMMIT vì gặp đúng điều kiện tôi bảo phải dừng: yêu cầu mới của tôi XUNG ĐỘT với một test mà chính round 1 vừa thêm.

Chi tiết đã tự kiểm chứng (không tin lời báo):
- `tests/rules/git-workflow.test.mjs:42-44` bắt buộc `git push -f origin feat/x` DENY.
- `tests/rules/git-workflow.test.mjs:589` bắt buộc `git push origin +feat/x:feat/x` ALLOW, nằm trong test tên `F2: refspec có dấu hai chấm ở giữa vẫn là push thường`.
- Hai lệnh đó là CÙNG MỘT thao tác: force-push ref `feat/x`. Suite giữ hai kỳ vọng TRÁI NHAU cho một thao tác, phân biệt chỉ bằng cú pháp.
- `git log -S` xác nhận dòng 589 do commit 8cd171a (round 1) thêm — tức xung đột round 1 với round 2 của cùng task, không phải di sản cũ.

Ruling: implementer ĐÚNG cả về việc dừng lẫn về bản chất. Quy tắc "0 deletion trong tests" của tôi tồn tại để chặn implementer làm YẾU test cho code chạy được. Ở đây xoá dòng 589 làm guardrail CHẶT HƠN — ngược hẳn ý định quy tắc. Chữ của quy tắc bị vi phạm, tinh thần thì không. CHO PHÉP xoá đúng một dòng đó. Đây là ngoại lệ có kiểm chứng, KHÔNG phải nới quy tắc — lần sau vẫn phải dừng và hỏi.

Ruling (nguyên nhân gốc, bài học chung cho các task còn lại): lỗi round 1 là **phân loại theo HÌNH DẠNG chứ không theo NGHĨA**. `+feat/x:feat/x` có dấu hai chấm ở giữa nên bị xếp vào corpus "push thường", trong khi tiền tố `+` đã đổi nghĩa thành force. Khi thêm ca vào corpus CHO-QUA, phải hỏi "lệnh này LÀM GÌ", không phải "nó TRÔNG GIỐNG ca nào". Đây cũng là lời cảnh báo về chính phương pháp tôi đang dùng: corpus chống chặn oan càng lớn thì càng dễ lẫn vào một ca đáng chặn, và một ca như thế biến thành test sẽ KHOÁ CỨNG cái lỗ.

Ruling: đã đọc code fix — gate `verb === 'push'` là ĐÚNG và quan trọng: nhờ nó `git fetch origin +refs/heads/*:refs/remotes/origin/*` vẫn cho qua. Refspec fetch có `+` chỉ ghi đè remote-tracking ref ở LOCAL, vô hại và cực phổ biến (là refspec fetch mặc định của git). Nếu chặn cả fetch thì chặn oan diện rộng.
Implementer tự đo corpus 112 lệnh, 0 thay đổi verdict ngoài 3 ca chủ đích — gồm đúng các ca `+` ở vị trí KHÔNG phải push (`git fetch`, `git config remote.origin.fetch`, `git log --grep=+main`, `echo "+main:main"`, commit message chứa `+main:main`).

## Task 12 — điều tra `trusted_hash` (làm sớm trong lúc chờ Task 9)

Task 12: đã THỬ xác định cách Codex tính `trusted_hash` để `doctor` kiểm được thật thay vì rút về mức thấp. **KẾT QUẢ: KHÔNG xác định được.** Ghi lại để implementer Task 12 không lặp lại đường cụt này.

Đã làm:
- `~/.codex/config.toml` CÓ tồn tại (9519 byte, mode 0600). Grep có chủ đích `trusted_hash` và `^\[hooks` cho **0 match**. Chỉ có `enabled = ...` thuộc các section `[plugins."..."]`, không liên quan hook trust.
- Đọc danh sách header section: chỉ có `[projects."..."]`, `[features]`, `[notice.*]`, `[tui.*]`, `[marketplaces.*]`, `[plugins."..."]`. **KHÔNG có section `[hooks]` nào.**
- `strings -a` trên binary `/Applications/ChatGPT.app/Contents/Resources/codex` (220MB, Mach-O arm64) tìm `trusted_hash` cho 0 match; tìm `hook.*trust` cho 0 match; và tìm cả `PreToolUse` cũng 0 match, tức phép trích chuỗi KHÔNG tới được vùng chứa các chuỗi này (có thể bị nén hoặc đóng gói). Không đào thêm vì chi phí không tương xứng.
- Lưu ý về quyền riêng tư: chỉ grep có chủ đích và che value khi in, KHÔNG dump toàn bộ `config.toml` vì file đó có thể chứa token.

Ruling: GIỮ đúng mức rút về mà plan đã quy định — `doctor` báo trạng thái CÓ/KHÔNG có bản ghi trust, và ghi rõ trong output rằng KHÔNG kiểm được hash. Tuyệt đối không in dấu tick "đã tin cậy" khi chưa kiểm được. Mức này fail an toàn: nó cảnh báo chứ không trấn an sai.

Ruling (PHÁT HIỆN CÓ GIÁ TRỊ, ngoài dự kiến): vì `config.toml` trên máy này KHÔNG có section `[hooks]` nào, trạng thái "không có bản ghi trust" chính là **trạng thái MẶC ĐỊNH của máy mới**, không phải ca biên. Nghĩa là nhánh cảnh báo của `doctor` là nhánh CHÍNH, chạy cho mọi dev cho tới khi họ gõ `/hooks` và cấp tin cậy. Hệ quả cho Task 12: đừng thiết kế nhánh đó như ngoại lệ hiếm — nó là output thường thấy nhất, nên câu chữ phải rõ ràng và có hướng dẫn hành động đầy đủ ngay tại đó. Và nó xác nhận đúng cảnh báo của Task 0: đây là chế độ hỏng nguy hiểm nhất của cả hệ thống, vì im lặng là mặc định.

Task 9: implemented DONE (commit dfdccd3, 227/227, +24 test). Implementer dựng lại nguyên văn code brief rồi đo song song 33 ca: **brief SAI 19/33, bản mới SAI 0/33.**

Task 9: PHẢN BIỆN của implementer về tên ruleId — **nó ĐÚNG, tôi SAI, lần thứ NĂM.** Tôi gợi ý `selfprotect.project-policy` / `codex-config` / `audit-log`. Spec §6.5 ĐÃ CHỐT `selfprotect.policy-file` / `hooks-file` / `install-dir`. Và tên `audit-log` tôi gán cho `~/.codex/guardrail/**` còn SAI NGHĨA: §6.5 gọi đó là "thư mục cài guardrail", còn audit log ở `~/.codex/guardrail-audit.jsonl` (§9, dòng 278) — đường dẫn KHÁC. Đã tự kiểm chứng cả hai chỗ trong spec.
Ruling: hậu quả nếu làm theo tôi sẽ là VĨNH VIỄN — ruleId là khoá của escape và là danh định trong audit log, nên một tên sai bị đóng cứng vào cơ chế escape và mọi bản ghi. Đây là lần phản biện có hậu quả lâu dài nhất.
Ruling: implementer giữ `protectedPaths` dạng object `ruleId -> [glob]` và CHỨNG MINH §12 còn hiệu lực bằng test: thêm nhóm `selfprotect.ci-guard` qua override JSON, `rm guard-ci.yml` trả đúng ruleId mới, không sửa một dòng `.mjs`. Đúng yêu cầu tôi đặt ra.

Task 9: **LỖ AN NINH CRITICAL trong code ĐÃ COMMIT (Task 6) — implementer tự tìm ra.**
`lib/rules/secrets.mjs:155-156` dùng `(cfg.denyPaths ?? []).map(globToRegExp)`. `Array.map` truyền `(element, index, array)` nên `index` rơi vào tham số `home` của `globToRegExp(pattern, home = homedir())`. Tôi tự đo: `'~/.aws/**'` compile thành `^1\/\.aws\/.*$` — khớp một thư mục tên "1".
Hệ quả tôi tự đo qua `evaluate` trên policy mặc định, ĐANG LỌT: `cat ~/.kube/config` (cert và token cluster), `cat ~/.config/gcloud/x.json` (credentials GCP), `cat ~/.docker/config.json` (token registry), `cat ~/.aws/config`, `cat ~/.ssh/config`, `cat ~/.ssh/known_hosts`, và cả dạng đường dẫn tuyệt đối. Chặn đọc secret là CHỨC NĂNG CHÍNH của cả sản phẩm.
Ruling: đã CHO PHÉP sửa `secrets.mjs` dù nó off-limits. Mức độ vượt xa nguyên tắc khoá file.
Ruling (NGUYÊN NHÂN nó sống qua 5 round review của Task 6 — hai lý do CỘNG LẠI, cả hai đều là lỗi thiết kế test):
  1. Test gọi `globToRegExp` TRỰC TIẾP với `home` tường minh, nên không bao giờ đi qua đường `.map`. Test đang kiểm HELPER, không kiểm RULE.
  2. Các ca kiểm dùng `~/.aws/credentials` và `~/.ssh/id_rsa` — hai đường dẫn VẪN bị chặn nhờ pattern basename `**/credentials` và `**/id_rsa` trùng khớp TÌNH CỜ. Test viết trên hai đường dẫn đó XANH trên code hỏng.
Ruling: quy tắc mới cho mọi test rule-path còn lại: phải đi qua `evaluate`, VÀ phải dùng tên file mà không pattern basename nào phủ (`config`, `known_hosts`, `access_tokens.db`). Implementer đã xác minh bằng cách chạy test mới trên bản `git archive HEAD` sạch: 2 test đỏ trên HEAD, xanh sau fix. Đã ghi cả bẫy này vào spec §6.1.
Ruling: đã tự kiểm CẢ BỐN call site `.map(globToRegExp)` thay vì giả định. `git-workflow.mjs:231` cùng dạng nhưng TIỀM ẨN (git cấm `~` trong refname nên không giá trị nào bắt đầu bằng `~`); `infra.mjs` đã miễn nhiễm tình cờ nhờ fix case-insensitive ở Task 7 (gọi qua lambda); `self-protect.mjs` viết đúng ngay từ đầu kèm comment. Thiệt hại THẬT chỉ ở `secrets.mjs`.

Task 9: fix round 1/5 — commit c1f0d83 (C1 an ninh) và 49db057 (C2-C5), 239/239, `git diff --numstat` phần tests cho `64 0` và `122 0` tức 0 deletion. Controller tự đo 25 ca C3/C4 cộng 12 ca C1: đúng hết.
Ruling: implementer PHẢN BIỆN cách áp C3 và ĐÚNG — lần thứ SÁU. Tôi viết "nếu token là tổ tiên của tiền tố thì chặn" mà không giới hạn tham số nào. Áp đúng chữ vào mọi `writeTargets` sẽ chặn oan `cp report.json ~/.codex`, `mv report.json ~/.codex`, `echo x > ~/.codex` — đều là ghi VÀO thư mục, không phá nó. Nó thu hẹp về đúng tham số THẬT SỰ xoá thư mục: positional của `rm`, và NGUỒN của `mv`. Áp đúng bài học Task 8 "hỏi lệnh LÀM GÌ, không phải nó TRÔNG GIỐNG gì".
Ruling: điều kiện "bỏ qua pattern có tiền tố literal rỗng" là SỐNG CÒN và đã được đo, không phải suy đoán: `**/codex-guardrail.json` cho tiền tố rỗng, không bỏ qua thì mọi đường dẫn đều là tổ tiên của chuỗi rỗng và `rm -rf` lên bất cứ gì cũng bị chặn.
Ruling: C4 dùng ruleId MỚI `selfprotect.audit-log` cho `~/.codex/guardrail-audit.jsonl`, KHÔNG tái dùng `install-dir` vì hai thứ khác nghĩa và ruleId là khoá escape. Đúng. Đã thêm hàng này vào spec §6.5.

Task 9: C5 — ba bản copy `stripTrailingGroup` KHÔNG giống nhau. `git-workflow.mjs` và `self-protect.mjs` byte-identical (đã hợp nhất vào `lib/argv.mjs`, pure move). `infra.mjs` KHÁC: nó chạy trên chuỗi đã join và thêm `\s` vào character class, nên bóc ĐƯỢC NHIỀU token nhóm liên tiếp ở cuối, còn bản mảng chỉ bóc token cuối.
Ruling: PARK, không hợp nhất bây giờ. Implementer đúng khi từ chối tự chọn bản thắng. Bản `infra` mạnh hơn (bóc nhiều hơn), nên hướng hợp nhất ĐÚNG là nâng hai bản kia lên ngữ nghĩa bóc-nhiều — tức thay đổi hành vi cần verify riêng, không phải pure move. Chuyển cho final review kèm phân tích này.

Task 9: HỆ QUẢ NGOÀI DỰ KIẾN của C1 — implementer nêu và tôi phán quyết. Sửa lỗi làm `~/.ssh/**` LẦN ĐẦU hoạt động thật, kéo theo chặn oan: `cat ~/.ssh/id_rsa.pub` (khoá CÔNG KHAI), `cat ~/.ssh/known_hosts`, `cat ~/.ssh/config`, `ssh-keyscan gh.com >> ~/.ssh/known_hosts`. Tôi tự đo xác nhận cả bốn.
Ruling: THÊM `~/.ssh/known_hosts`, `~/.ssh/config`, `**/*.pub` vào `secrets.allowPaths`. Giữ `~/.ssh/**` trong denyPaths vì nó là catch-all duy nhất cho khoá riêng đặt tên tuỳ ý.
Ruling: vì sao đây KHÁC với việc tôi TỪ CHỐI nới `denyBinaries` ở Task 7 — vụ `npx wrangler` đòi đổi CHIẾN LƯỢC deny-list (từ cấp tool sang cấp subcommand), thứ user đã chốt tường minh; còn đây là dùng đúng van `allowPaths` mà spec đã thiết kế và đã có sẵn dữ liệu, cho ba đường dẫn chứng minh được là không phải secret. Dùng van theo đúng thiết kế thì không phải đổi thế trận.
Ruling: implementer TỪ CHỐI tự nới và đưa số đo để tôi quyết. Đúng — nới policy an ninh là quyết định của controller, không phải của implementer. Ghi nhận vì đây là ranh giới đúng.

Task 9: đã cập nhật spec — §6.5 (thêm hàng audit-log, escape-inline neo vào dạng gán biến thay vì substring, shape object của protectedPaths, phân biệt đọc/ghi theo nghĩa từng binary, điều kiện tiền tố rỗng của kiểm tổ tiên); §6.1 (ba allowPaths mới cộng ghi lại BẪY `.map(globToRegExp)` và bẫy test dùng tên file trùng pattern basename); §15 (thêm giới hạn #12 không nở biến môi trường, #13 glob trong token, #14 escape cấp sai chỗ khi hai rule cùng chặn).

Task 9: fix round 2/5 — implementer DỪNG TRƯỚC KHI COMMIT lần thứ hai, đúng điều kiện tôi đặt. Phán quyết `~/.ssh/known_hosts` vào allowPaths XUNG ĐỘT với test canary mà chính round trước vừa thêm.
Đã tự đọc khối comment `tests/rules/secrets.test.mjs:205-218` và xác nhận: `known_hosts` được chọn CÓ CHỦ ĐÍCH vì không pattern basename nào phủ nó, nên nó là chứng nhân DUY NHẤT chứng minh `~/.ssh/**` được cưỡng chế. Allow-path nó không chỉ làm đỏ một assert mà XOÁ MẤT chứng nhân.
Ruling: CHO PHÉP đổi điểm neo canary sang `~/.ssh/my_custom_key` (đã kiểm: không khớp `**/id_rsa`, `**/credentials`, `**/*.key`, `**/*.pem`, và không có đuôi `.pub` nên `~/.ssh/*.pub` không nới cho nó). Cột deletion = 1, cho phép cùng lý do Task 8: đổi neo GIỮ NGUYÊN ý định test chứ không làm yếu. Không đổi thì buộc phải hy sinh một trong hai: bản sửa chặn oan, hoặc chứng nhân. Quy tắc "0 deletion" VẪN đứng cho lần sau.

Task 9: PHẢN BIỆN `**/*.pub` — **implementer ĐÚNG, tôi SAI, lần thứ BẢY.** Tôi phán `**/*.pub`; nó đo corpus 336 đường dẫn `.pub` trên 14 thư mục: `**/*.pub` mở 160, `~/.ssh/*.pub` mở 48, và 176 vốn đã allow ở baseline. Khoảng cách 112 ca là TOÀN BỘ `~/.aws/**` và `~/.config/gcloud/**` mở qua đuôi `.pub` (96 ca) cộng 16 ca `.env.pub` đục lỗ toàn cục qua `**/.env.*` — lợi ích BẰNG KHÔNG vì file `.pub` trong repo chưa từng bị chặn.
Tôi tự đo lại và xác nhận: `~/.aws/credentials.pub`, `~/.config/gcloud/creds.pub`, `.env.pub`, `.env.production.pub` đều bị `**/*.pub` mở, còn `~/.ssh/*.pub` thì không.
Ruling: chốt `~/.ssh/*.pub`. Ghi nhận cách trình bày bằng chứng của implementer: nó TỰ NÊU điểm yếu lập luận của mình ("không có tên file thực tế nào lọt, đây là lập luận bán kính sát thương chứ không phải leak sống"). Nêu điểm yếu của chính mình làm bằng chứng ĐÁNG TIN HƠN, không kém hơn.
Ruling: đã bắt khoá lại chính phán quyết đã sửa của tôi bằng test (`.env.pub` và `~/.aws/credentials.pub` phải còn chặn), để không ai nới lại thành `**/*.pub`.

Task 9: fix round 2/5 XONG — commit 1c6fc8b, 245/245, `git diff --numstat` phần tests cho `109 1` tức ĐÚNG 1 deletion là dòng canary đã cho phép. Controller tự đo 15 ca: 6/6 allow, 9/9 deny. Canary mới `~/.ssh/my_custom_key` chặn đúng; `~/.ssh/backup/id_rsa.pub` cũng chặn (vì `*` không băng qua `/`) — một chốt phụ tốt implementer tự thêm.

Task 9: PHẢN BIỆN thứ TÁM — implementer sửa chính PHÉP ĐO LẠI của tôi. Tôi liệt `~/.docker/config.json.pub` như bằng chứng `**/*.pub` mở ra lỗ. Phép đo glob của tôi ĐÚNG (glob đó có khớp), nhưng SUY LUẬN của tôi sai: đường dẫn ấy `allow` ở CẢ baseline, nên nó không chứng minh được gì về việc nới rộng. Nó là CHỨNG NHÂN GIẢ, và nếu đưa vào test sẽ thành một assert vô nghĩa. Implementer bỏ ra và để lại comment giải thích để round sau không thêm lại.
Ruling: phân biệt này quan trọng — "glob có khớp đường dẫn X" KHÁC "thêm glob làm X từ chặn thành cho qua". Chỉ cái thứ hai mới là bằng chứng cho việc nới rộng. Tôi đã lẫn hai điều đó.

Task 9: LỖ TIỀN TẠI do phản biện #8 phát hiện — tôi tự đo xác nhận LỌT: `cat ~/.kube/config.bak`, `cat ~/.kube/config.old`, `cat ~/.docker/config.json.bak`. Nguyên nhân: `~/.kube/config` và `~/.docker/config.json` là pattern CHÍNH XÁC không có `**`, trong khi hai mục cùng loại (`~/.aws/**`, `~/.config/gcloud/**`) là cây `**`.
Ruling: SỬA, không park. Bản sao lưu kubeconfig chứa ĐÚNG cert và token cluster như bản gốc, và `cp ~/.kube/config ~/.kube/config.bak` là việc người ta làm trước khi đổi context. Cùng LỚP lỗi với bug `.map(globToRegExp)`: một denyPath không phủ đúng thứ nó tồn tại để phủ. Dispatch fix round 3/5 với yêu cầu đo chặn oan cho phần nới rộng (`~/.kube/cache`, `ls ~/.kube`, `~/.docker/daemon.json`).

Task 9: fix round 3/5 — commit c1fc033, 250/250, `git diff --numstat` phần tests cho `110 0` tức 0 deletion. Controller tự đo 7 ca phải chặn (đều chặn) và 11 ca chống chặn oan (đều cho qua đúng).
Chốt pattern: `~/.kube/config` thành `~/.kube/**`, `~/.docker/config.json` thành `~/.docker/config.json*`.
Ruling: implementer TỪ CHỐI hướng hẹp `~/.kube/config*` với lý do đo được — công cụ multi-cluster (`KUBECONFIG`, `kubectx`, `kubie`) dùng tên tuỳ ý (`kubeconfig-staging`, `configs/prod.yaml`), mỗi file là một credential đầy đủ. Đúng. Và nó CỐ Ý không nới docker thành cây `**` vì `~/.docker` còn chứa `buildx/`, `contexts/`, `daemon.json` vô hại, mà test cũ đã đòi `daemon.json` phải cho qua.
Ruling: implementer mutation-test thay vì tin màu xanh — revert hai pattern thì test 201, 202, 205 đỏ (chứng nhân thật), còn 203/204 xanh cả hai chiều vì chúng là chốt chống-nới-quá. Đúng yêu cầu tôi đặt ra sau bài học Task 6.

Task 9: PHẢN BIỆN thứ CHÍN — và là lần NGĂN ĐƯỢC THIỆT HẠI, không chỉ sửa nhận định. Tôi đề nghị: nếu `~/.kube/**` chặn oan cache của kubectl thì thêm allowPath hẹp thay vì thu pattern. Implementer chứng minh làm thế **TÁI TẠO ĐÚNG CÁI LỖ ROUND NÀY VỪA VÁ**: `normalizePath` không giải `..` và `matchesAny` so chuỗi thô, nên một entry allow hình `**` nằm trong cây deny mở ra đường đi xuyên. Đo được: thêm `~/.kube/cache/**` vào allowPaths làm `cat ~/.kube/cache/../config` lật từ deny sang ALLOW. Nó khoá lại bằng test 205.
Ruling: rút ra QUY TẮC THƯỜNG TRỰC — **không dùng `**` trong `secrets.allowPaths`**. Đây là lý do các carve-out `~/.ssh` hiện có an toàn: chúng một cấp (`*.pub`) hoặc chính xác. Đã ghi vào spec §6.1.
Ruling: và lập luận thứ hai của nó cũng đúng — cache của kubectl là "dead weight" với agent dưới guardrail này, vì `kubectl` và `helm` vốn đã nằm trong `infra.denyBinaries` (tôi tự kiểm: đều chặn). Nên không mất workflow nào mà policy chưa chặn sẵn. Kết luận: KHÔNG làm gì cả, đúng hơn cả hai hướng tôi nghiêng.

Task 9: TÔI SỬA LẠI MỘT NHẬN ĐỊNH CỦA IMPLEMENTER (chiều ngược lại, có số đo). Nó nói `~/.aws` và `~/.ssh` chỉ sống sót dạng `./` nhờ trùng khớp basename tình cờ. SAI. Tôi đo:
    cat ~/.aws/./config                      DENY
    cat ~/.config/gcloud/./access_tokens.db  DENY
    cat ~/.ssh/./my_custom_key               DENY
    cat ~/.docker/./config.json              LOT
`~/.aws/./config` KHÔNG có pattern basename nào phủ (`**/config` không tồn tại trong denyPaths) — nó chặn được vì `~/.aws/**` khớp xuyên qua `./`. Tức MỌI cây `**` đều miễn nhiễm với `./`; chỉ pattern KHÔNG phải `**` mới hở. Sau round này chỗ hở duy nhất còn lại là `~/.docker/config.json*`.
Ruling: PARK lỗ `.`/`..`, ghi §15 #14. Phạm vi hẹp hơn nhiều so với báo cáo, sửa gốc là cho `normalizePath` chuẩn hoá `.`/`..` — engine change trong `lib/glob.mjs`, siết cùng lúc mọi rule khớp đường dẫn, thuộc Plan 2. Và dạng chèn `./` là hành vi CỐ TÌNH, đã nằm dưới giới hạn #1.

Task 9: PARK — hai nhãn cũ trong `HOME_ONLY` (`tests/rules/secrets.test.mjs:227,229`) còn ghi `~/.kube/config` và `~/.docker/config.json`, là tên pattern KHÔNG còn tồn tại trong policy. Assert vẫn đúng và vẫn xanh; chỉ là chuỗi thông báo sai tên. Implementer để nguyên đúng theo quy tắc 0-deletion và giao lại cho tôi. Chuyển final review: sửa một từ mỗi dòng.

Task 9: complete (commits dfdccd3..872f893, 250/250, 4 round, 3 parked)

## Task 10 — Dispatcher (dispatch)

Task 10: dispatch với 5 điểm pre-flight đã ghi ở trên (commit message sai exit code, hardcode hookEventName, nhánh fail-open không chạm tới được, thứ tự rule, và lệch có ý thức về `warnings`). Nhấn mạnh với implementer hai bài học đắt nhất: test phải kiểm THỨ THẬT (`runHook` với payload JSON, `spawnSync` thật vào bin — không mock), và phải mutation-test để chứng minh assert có giá trị.

Task 10: implemented DONE (commit ad13aac, 281/281, +31 test, 0 deletion). Thiết kế đã lành sau khi tôi vá theo Task 0 — không có khiếm khuyết tầng thiết kế như Task 7/8/9. Cả 5 điểm pre-flight được xử lý đúng, gồm giữ nhánh fail-open không-chạm-tới-được kèm comment (dành cho Plan 2) và giữ lệch có ý thức về `warnings` KÈM TEST ghim lại, để một bản "tốt bụng" sau này thêm cảnh báo vào sẽ làm đỏ.
Ruling: implementer làm mutation-test 12 phép, 12 killed, 0 survivor. Nó cũng tự nêu đúng một property KHÔNG quan sát được (nhánh fail-open) thay vì bịa test cho nó. Đúng.
Đo độ trễ: `runHook` allow p95 = 0.10ms, deny p95 = 5.92ms, CLI `spawnSync` đầy đủ (gồm khởi động Node) allow 26.6ms và deny 35.3ms. Ngân sách §13 là 150ms nên còn khoảng 4x dư. `currentBranch()` được giới hạn vào nhánh deny/escaped nên đường allow (đa số tuyệt đối) không phải trả phí spawn `git`.
Xác nhận `currentBranch` còn export từ `lib/rules/git-workflow.mjs` và chữ ký còn `(cwd)` — đúng điều tôi yêu cầu kiểm sau khi Task 8 đổi hành vi của nó.

Task 10: **PHẢN BIỆN THỨ MƯỜI, và là khiếm khuyết NGHIÊM TRỌNG NHẤT phiên này.** Plan (do CHÍNH TÔI vá sau Task 0) dùng `process.stdout.write(stdout); process.exit(0)` trong `bin/guardrail.mjs`. Ý định của tôi đúng (không bao giờ báo deny qua exit code) nhưng cách viết SAI: trên macOS, stdout khi là PIPE được ghi KHÔNG ĐỒNG BỘ, và `process.exit()` phá handle trước khi libuv drain.
Tôi tự đo độc lập, viết 300000 byte vào stdout là pipe:
    process.exit(0)     nhan duoc   8192 / 300000   <== MAT DU LIEU
    process.exitCode=0  nhan duoc 300000 / 300000
Hệ quả: mất stdout = **mất chính cái deny**. Codex thấy JSON cắt cụt, và theo Task 0 thì hook lỗi = CHO LỆNH CHẠY. Tức đúng cái lỗ guardrail tồn tại để bịt, bị tái tạo ở 2 dòng cuối của entry point. Sửa: `process.exitCode = 0` (và `= 1` cho nhánh usage) — vẫn giữ bảo đảm "luôn exit 0" nhưng để Node flush trước khi thoát.

Task 10: TÔI KIỂM LẠI TÍNH VỚI TỚI ĐƯỢC của lỗ này và ban đầu NGHI NGỜ SAI, rồi tự sửa. Implementer nói `cat <đường-dẫn-dài>/.env` cho payload 20589 byte. Tôi đo đường `secrets.read-path`: stdout đứng yên ở 523 byte bất kể lệnh dài bao nhiêu (1 file 61B đến 1000 file 46798B) — vì reason chỉ nhúng TOKEN KHỚP, không nhúng cả lệnh. Và token khớp là đường dẫn nên bị chặn trên bởi PATH_MAX (khoảng 1024 trên macOS), tối đa chừng 2KB.
Nhưng tôi đã probe SAI RULE. Đo `git.commit-message` — reason nhúng CẢ MESSAGE, thứ không có giới hạn nào:
    msg=  8000B  ->  stdout=  8483B   <== VUOT 8192
    msg= 20000B  ->  stdout= 20483B
Ruling: lỗ CÓ THẬT và CHẠM ĐƯỢC bằng input thực tế — một commit message dài nhiều đoạn không khớp conventional-commits. Con số 20589 của implementer khớp về độ lớn, chỉ khác đường đi. Nghi ngờ ban đầu của tôi sai vì tôi chọn sai rule để đo.
Ruling: bài học cho chính tôi — khi kiểm chứng một báo cáo về "kích thước payload", phải hỏi payload đó SINH TỪ ĐÂU rồi mới chọn đường đo. Tôi đo đường mà reason nhúng token (bị chặn trên) thay vì đường mà reason nhúng dữ liệu do người dùng cung cấp (không bị chặn trên).

Task 10: PARK — `git.commit-message` nhúng message KHÔNG GIỚI HẠN vào reason. Hai lý do đáng cắt bớt (ví dụ 200 ký tự cộng dấu lược): (a) Codex nối `. Command: <lệnh>` sau reason, nên một reason 20KB là message không dùng được trên terminal; (b) phòng thủ nhiều lớp cho đúng lớp lỗi cắt cụt vừa vá. KHÔNG làm bây giờ vì `process.exitCode` đã bịt chế độ hỏng thật; đây thuần UX. Chuyển final review.
Task 10: PARK — `package.json` có script `test:latency` trỏ tới `tests/latency.test.mjs` nhưng file đó CHƯA tồn tại nên script fail. Thuộc Task 13 (nó sở hữu phép đo p95 thật). Ghi để Task 13 không bỏ sót.
Task 10: complete (commit ad13aac, 281/281, 2 parked)

## Task 11 — install / uninstall

Task 11: dispatch. Nhấn mạnh khối "Bổ sung bắt buộc theo Task 0" (matcher `Bash` và `apply_patch`, in nguyên khối hướng dẫn `/hooks`, install chỉ báo thành công MỘT NỬA, và TUYỆT ĐỐI không nhắc cờ bypass trust trong tài liệu cho dev).
Ruling: thêm một yêu cầu an toàn KHÔNG có trong plan — mọi test phải chạy trên thư mục tạm qua điểm tiêm (`CODEX_HOME` hoặc tương đương), TUYỆT ĐỐI không test nào đọc/ghi `~/.codex/` thật. `install`/`uninstall` sửa file THẬT của người dùng; một test chạy sai đường dẫn sẽ phá cấu hình Codex của chính họ. Cộng thêm: merge không ghi đè, idempotent, và JSON hỏng sẵn thì báo lỗi mà KHÔNG ghi gì.

## Task 11 — install / uninstall

Task 11: implemented DONE (commit 1410492, 310/310, +29 test, 0 deletion). Controller tự kiểm end-to-end trong sandbox, không chỉ đọc báo cáo.
Xác minh `~/.codex/` THẬT của người dùng còn nguyên: `hooks.json` vẫn 2 hook (`SessionStart`, `SubagentStart`), 0 entry chứa "guardrail"; và `~/.codex/guardrail`, `~/.codex/.guardrail-installed.json`, `~/.codex/hooks.json.bak` đều KHÔNG tồn tại. Cách ly test giữ được.
Xác minh exec bit: `git ls-tree HEAD bin/guardrail.mjs` cho `100755`. Implementer tự phát hiện Edit tool làm mất exec bit (100755 thành 100644) ở commit đầu, đã chmod rồi amend. Nếu để lọt thì `npx` không chạy được — lỗi phân phối, khó truy.

Controller tự đo trong sandbox (không tin báo cáo):
- `hooks.json` HỎNG có sẵn hook người khác cho exit 1, message rõ, **sha256 KHÔNG ĐỔI**, và thư mục chỉ còn đúng `hooks.json` (không `.bak`, không `guardrail/`, không sidecar). Tức không cài nửa vời.
- `hooks.json` HỢP LỆ có `morkit.sh` (SessionStart) và `other-tool.sh` (PreToolUse/Bash) cho kết quả: sau install CẢ HAI CÒN NGUYÊN, guardrail thêm entry `Bash` và `apply_patch`. Merge đúng, không ghi đè.
- Idempotent: install lần 2 cho sha256 y nguyên.

Task 11: **PHẢN BIỆN THỨ MƯỜI MỘT — khiếm khuyết PHÁ DỮ LIỆU nghiêm trọng nhất của plan.** `readJson()` trong plan làm `catch { return fallback }` rồi vẫn `writeFileSync`. Nghĩa là `hooks.json` sai một dấu phẩy thì guardrail **XOÁ TRẮNG hook của mọi tool khác** và ghi lại file chỉ có entry của mình. Trên máy này file đó đang giữ hook thật của người dùng. Implementer đổi sang "đọc-hiểu-được hoặc từ chối", và kiểm cả HÌNH DẠNG (nếu `hooks` là array thì merge xong `JSON.stringify` sẽ âm thầm đánh rơi khoá vừa thêm). Mutation M08 tái hiện đúng bản plan làm 2 test đỏ.
Ruling: đây là lớp lỗi khác hẳn các lỗ trước — không phải "bỏ lọt cái đáng chặn" mà là "phá dữ liệu của người khác". Và nó nằm trong code chạy MỘT LẦN lúc cài, tức ít có cơ hội được phát hiện lại.

Task 11: sáu khiếm khuyết khác implementer tự tìm trong plan, đều đúng lớp "thao tác file dùng chung mà không phòng vệ":
- Plan copy runtime TRƯỚC khi đọc `hooks.json` nên mọi lỗi để lại `~/.codex/guardrail/` cài nửa vời. Đã đảo thứ tự: kiểm hết mọi điều kiện từ chối trước khi ghi byte đầu tiên.
- Plan Step 4 dùng `process.exit(res.ok ? 0 : 1)` trái nếp Task 10. Implementer đo lại và TỰ GIỚI HẠN kết luận: ở cỡ khoảng 1KB của install thì `exit()` cũng qua nên "chưa phải bug đang chảy máu", vẫn đổi vì `exitCode` không có ngưỡng nào để vượt. Nó còn tự sửa comment ban đầu vì bản đầu nói quá so với số đo. Đúng mực.
- Plan Step 4 KHÔNG in gì về `/hooks` — code sketch trái với chính yêu cầu (2) ở đầu task. Làm y plan thì yêu cầu quan trọng nhất bị bỏ.
- `uninstall` của plan ghi `hooks.json` vô điều kiện nên người chưa từng có file đó vẫn bị tạo file rỗng.
- `uninstall` của plan KHÔNG backup dù `install` có — bất đối xứng vô lý cho thao tác cũng sửa file dùng chung.
- `uninstall` của plan crash trên sidecar hỏng. Đã đổi thành thông báo rõ và KHÔNG đoán bừa entry nào là của mình — xoá nhầm hook tool khác còn tệ hơn để lại hook của mình.
- `CODEX_HOME` rỗng với `??` của plan làm mọi đường dẫn thành tương đối theo cwd, tức test ghi vào repo. Đã coi chuỗi rỗng là chưa đặt.

Task 11: ba điểm về CHẤT LƯỢNG TEST đáng ghi thành nguyên tắc chung:
- Test dùng **literal dán cứng** cho khối hướng dẫn trust, KHÔNG import hằng số — vì import thì sửa lời văn vẫn xanh. Áp cho mọi dòng output quan trọng.
- Test quét cờ bypass bằng regex `bypass|dangerous` thay vì tên cờ đầy đủ, để **chính test cũng không dạy tên cờ đó** cho ai đọc repo.
- Implementer thử một tripwire patch `node:fs` để chứng minh không chạm `~/.codex`, TỰ ĐO thấy nó VÔ DỤNG với ESM named import (binding không đổi khi patch namespace object), và **không dùng nó làm bằng chứng**. Thay vào đó chạy suite với `HOME` trỏ thư mục tạm rỗng rồi xác nhận thư mục vẫn rỗng, cộng sha256 trước và sau. Loại bỏ bằng chứng của chính mình khi đo thấy nó không chứng minh được gì — đây là hành vi đúng nhất trong cả phiên.
Task 11: 18/18 mutation killed.
Task 11: implementer TỰ TẠO rồi TỰ CHỐT một hiểm hoạ: nó đổi sang xoá-rồi-copy để bản cài không thành bản trộn hai phiên bản, việc đó sinh ra khả năng `install` chạy từ chính bản đã cài sẽ XOÁ NGUỒN. Đã chốt: nguồn trùng đích thì từ chối, có test. Ghi nhận vì nó tự nêu ra thay vì để tôi phát hiện.
Task 11: mở rộng interface có khai báo: `install()` trả thêm `trustNotice`; thêm export `hooksPath()` và `TRUST_NOTICE` để Task 12 và Task 13 trích cùng một nguồn văn bản thay vì chép tay.
Task 11: complete (commit 1410492, 310/310)

## Task 12 — doctor / stats

Task 12: dispatch, kèm toàn bộ kết quả điều tra `trusted_hash` của tôi để nó không lặp đường cụt, và nhấn mạnh phát hiện quan trọng nhất: vì `config.toml` không có section `[hooks]` nào, "chưa có bản ghi trust" là trạng thái MẶC ĐỊNH của máy mới, nên nhánh cảnh báo là nhánh CHÍNH chứ không phải ca biên — câu chữ phải đầy đủ hướng dẫn hành động ngay tại đó.
Ruling: thêm yêu cầu riêng tư không có trong plan — `config.toml` của người dùng CÓ THỂ chứa token, nên `doctor` chỉ được đọc đúng thông tin trust nó cần và KHÔNG được in lại nội dung file ra output.

Task 12: complete (commit fdd7b50). Agent treo 600s sau khi commit nên KHÔNG có báo cáo — controller tự dựng lại trạng thái và tự xác minh mọi claim.
Task 12: TỰ SỬA MỘT SAI SỐ CỦA CHÍNH TÔI. Tôi đã nói với implementer rằng `~/.codex/config.toml` KHÔNG có section `[hooks]`, và dùng đó làm căn cứ để nói "chưa có bản ghi trust là trạng thái mặc định". SAI: file đó có 26 entry `hooks.state` và 25 `trusted_hash`. Nguyên nhân: tôi `grep enabled | head -20`, và có 20 dòng `[plugins]` ở khoảng 61-118 nên output bị cắt trước dòng 180. Tức tôi kết luận từ một khung nhìn BỊ CẮT của chính phép đo của mình. Bài học: `head` trên kết quả grep là cắt dữ liệu, không phải xem dữ liệu — muốn kết luận "không tồn tại" thì phải đếm, không được xem 20 dòng đầu. Sai số này KHÔNG lan vào spec.
Task 12: `doctor` không bao giờ in dấu tick "đã tin cậy". Đã thử 78 tiền ảnh sha256 đối chiếu 25 hash thật, không khớp cái nào, nên cách Codex tính `trusted_hash` vẫn chưa xác định. Chỉ báo CÓ/KHÔNG CÓ bản ghi, kèm nói thẳng là hash không kiểm được — một bản ghi cũ với hash lệch trông y như bản ghi hợp lệ.

## Task 13 — CI, độ trễ, README

Task 13: complete (commit 1cd95a1, +latency/readme/CI). 359/359.
Task 13: KHIẾM KHUYẾT HẠ TẦNG NGHIÊM TRỌNG NHẤT PHIÊN. `node --test tests/` — ĐÚNG lệnh tôi dùng để verify mọi task cả phiên — chỉ chạy trên Node 20. Node 22 và 24 ném MODULE_NOT_FOUND. Máy này chạy Node 20 nên mọi phép đo của tôi vẫn thật, nhưng `npm test` đã ship sẽ ĐỎ với bất kỳ ai dùng Node mới hơn, và 6/9 ô của ma trận CI sẽ đỏ. Dạng đúng là `node --test` KHÔNG tham số. Ma trận bắt được lỗi này TRƯỚC KHI nó từng chạy — đó chính là luận điểm cho việc có ma trận.
Task 13: test độ trễ gần như là no-op trên Node 24. Spawn nào đi TRƯỚC trong mỗi vòng đo bị phạt ~27ms, theo VỊ TRÍ chứ không theo loại. Đo baseline trước làm baseline CHẬM HƠN hook, nên overhead ra số ÂM và assert không bao giờ đỏ được. Implementer tìm ra bằng cách đảo thứ tự spawn, vá bằng một spawn mồi, rồi chạy lại KHÔNG có spawn mồi để chứng minh bản vá có tải. Nó cũng từ chối `RUNS = 20` của plan vì p95 của 20 mẫu là mẫu tệ thứ hai đeo nhãn p95.
Task 13: PHẢN BIỆN THỨ MƯỜI HAI. Tôi nói `tests/install.test.mjs` đã chặn văn bản cờ bypass trong README. KHÔNG ĐÚNG — nó chỉ quét `lib/install.mjs` và `bin/guardrail.mjs`. Nghĩa là không có gì ngăn một bản sửa README sau này dạy dev cách tắt cơ chế tin cậy. `tests/readme.test.mjs` bịt lỗ đó, và còn ghim khối hướng dẫn trust phải nằm KỀ lệnh cài chứ không trôi xuống mục troubleshooting.

## Final review toàn nhánh

Final review: tôi tự làm inline, KHÔNG dispatch agent — phần lớn việc cần ngữ cảnh toàn nhánh mà tôi đã có, và phiên đã rất đắt.
Final review: BA LỖ THẬT ĐANG CHẢY MÁU, cùng MỘT lớp bug — soi argv theo VỊ TRÍ nên tiền tố đẩy vị trí đi. Không lỗ nào bị bất kỳ review theo-task nào bắt được, vì mỗi lỗ nằm ở giao của hai task.
  L1. `secrets.env-dump` lọt 10/10 dạng wrapper (`sudo printenv PASSWORD`, `npx env`). Ledger từng ghi mục này là "chỉ thiếu test, hành vi đã đúng" (Task 6 đo 6/6 chặn) — hành vi ĐÃ hồi quy im lặng sau khi lib/argv.mjs tách ra ở Task 8, đúng như ghi chú lúc đó dự đoán. `secrets` là rule duy nhất không đi qua effectiveArgv.
  L2. `secrets.manager-read` lọt qua wrapper. `sudo vault read` và `sudo op read` LỌT HOÀN TOÀN vì hai binary đó không nằm trong infra.denyBinaries nên không rule nào đỡ. Với aws/gcloud/kubectl thì infra đỡ nhưng báo `infra.deny-binary` — nới rule đó để dùng `aws s3 ls` sẽ mở lại đường đọc secret.
  L3. `effectiveArgv` bỏ cờ mà không bỏ GIÁ TRỊ của cờ: `sudo -u postgres psql -c "drop table t"` LỌT. Một cờ `-u` vô hiệu hoá cả 21 entry denyBinaries. argv.mjs ghi đây là giới hạn chấp nhận được với lý do "không đoán bừa cờ nào ăn giá trị" — lý do không đứng được, vì tập wrapper đã hẹp và cố định nên tập cờ của chúng là tra bảng.
Final review: lỗ thứ tư tìm được bằng MA TRẬN chứ không bằng đọc code — 7 nhóm rule x 11 dạng bọc, 1/77 lọt: `(cat .env)`. Hệ quả KHÔNG ĐỀU và đó là phần đáng lo: chỉ pattern kết bằng tên file chính xác bị lách, pattern cây `**` vẫn chặn vì `**` hút luôn dấu `)`. Nên các ca kiểm tay hay dùng (`~/.aws/**`) vẫn xanh trong khi `**/.env` hở. `(cd app && cat .env)` là dạng agent viết rất tự nhiên. Sau vá: 77/77.
Final review: BÀI HỌC PHƯƠNG PHÁP. Ba lỗ L1-L3 đều đã "được ghi" trong ledger hoặc comment code như giới hạn chấp nhận được, và cả ba đều SAI ở mức đánh giá chứ không sai ở mức phát hiện. Đọc lại ghi chú cũ không đủ; phải ĐO LẠI. Một mục parked ghi "hành vi đã đúng, chỉ thiếu test" là mục nguy hiểm nhất trong danh sách, vì nó vừa được miễn kiểm tra vừa không được khoá.
Final review: tôi tự làm nặng thêm một mục đã ghi — bản vá subshell thêm bản THỨ TƯ của lớp ký tự `[)};]+$`. Đã gộp về `stripGroupSuffix`. Giữ bản của infra.mjs riêng vì hành vi khác (bóc trên chuỗi join, có `\s`), đúng ruling cũ.
Final review: 4 giới hạn KHÔNG có ở cả spec lẫn README, đã ghi. Đáng lo nhất: thư mục hệ thống không được bảo vệ (4/4 lệnh xoá /usr /etc /System /var/lib đều lọt) trong khi bảng "Rule mặc định" nói infra có "5 mẫu lệnh phá huỷ", đọc lên như thể đã phủ. KHÔNG vá: mẫu thô `/var/**` chặn oan việc script build làm hằng ngày, nên protectedRoots cần thiết kế riêng.
Final review: giữ nguyên các quyết định deferred cũ đã cân có lý do — jq/yq chặn oan (cần ngữ nghĩa per-binary), `.`/`..` (cần sửa normalizePath, engine change), `git branch -D` / `update-ref -d` (cố ý), `ls ~/.ssh` (do thám không phải nội dung), hợp nhất stripTrailingGroup của infra (cần verify riêng).
Final review: độ trễ sau mọi thay đổi p95 allow=24.9ms deny=33.5ms trên ngân sách 150ms, dôi 8.5/17.1ms. Không ăn vào ngân sách.
Final review: 39 -> 45 commit, 359 -> 369 test, 6 commit mới (4 fix, 1 docs, 1 refactor).
Final review: QUYẾT ĐỊNH CỦA NGƯỜI DÙNG — nới 4 CLI cloud (wrangler/vercel/supabase/flyctl) theo subcommand: ĐỂ PLAN 2, giữ chặn cứng ở bản này. Lý do đúng: đây là nới một rule an toàn, xứng đáng có task riêng với verify đầy đủ thay vì nới dựa trên số đo của agent khác mà controller chưa tự đo lại. Đã ghi ở README giới hạn #10.
Final review: QUYẾT ĐỊNH CỦA NGƯỜI DÙNG — merge `--no-ff` vào master, giữ history. Xong: master 0672d81 -> 130aa24, merge commit có, 369/369 test xanh TRÊN MASTER, độ trễ p95 allow=25.8ms deny=34.3ms trên ngân sách 150ms. Nhánh feat/plan-1-engine giữ lại, không xoá.

## Còn nợ cho Plan 2 (chốt sau final review)

1. `protectedRoots` tường minh — xoá /usr /etc /System /var/lib đang lọt. Chặn thư mục cấp 1, KHÔNG chặn con của nó (`rm -rf /tmp/build-cache` phải qua).
2. Nới 4 CLI cloud theo subcommand — quyết định của người dùng, cần task riêng có verify.
3. Ngữ nghĩa tham số per-binary cho `jq`/`yq` — bỏ chặn oan `jq '.env' f.json`.
4. `normalizePath` giải `.` và `..` — engine change trong lib/glob.mjs, siết mọi rule khớp đường dẫn cùng lúc.
5. Tách `redactCommand` / `redactText`.
6. `allowPatterns` làm cửa thoát.
7. `PostToolUse` vào REGISTRY — khi đó `hookEventName` hardcode trong dispatch.deny() thành sai.
8. Kiểm xoá root ở mức TOKEN thay vì regex — `rm -rf ./build /` (root ở tham số thứ hai) đang lọt.
9. Hợp nhất biến thể stripTrailingGroup của infra.mjs — cần nâng ngữ nghĩa, không phải move thuần.
10. Nở biến môi trường (`$HOME`) và glob trong token (`~/.codex*`) — hai lỗ cùng gốc "so đường dẫn theo văn bản".

## Sau final review — lỗ trung thực thứ hai

doctor/unenforced: tìm được khi KIỂM KÊ việc còn lại, không phải khi review code. `policy/default.json` khai 4 nhóm mà REGISTRY không có rule nào, doctor chỉ cảnh báo 1/4 (`convention.lint`). Ba nhóm im lặng: `quality.protectedPaths` (9 mẫu THẬT gồm `.github/workflows/**`, `package-lock.json`, `dist/**`), `net.allowHosts` (7 host, allow-list không cưỡng chế tức mạng mở hoàn toàn), `deps` (ghi thẳng `"enabled": true`).
doctor/unenforced: Ruling — cùng lớp lỗi với "README hàm ý phủ nhiều hơn thực tế" mà final review vừa xử, nhưng ở tầng CẤU HÌNH nên tệ hơn: dev được bảo là hãy đọc và mở rộng `codex-guardrail.json`, tức policy file LÀ tài liệu. Khai mà không cưỡng chế thì người đọc không có cách nào biết.
doctor/unenforced: dùng BẢNG `UNENFORCED` chứ không ba nhánh if — Plan 2 thêm rule cho nhóm nào thì xoá đúng một dòng, và quên xoá thì doctor nói sai theo hướng AN TOÀN (báo chưa cưỡng chế trong khi đã có) chứ không hứa hão.
doctor/unenforced: 2 mutation đều bị giết (hardcode số lượng; bỏ hẳn entry `net`). Test ghim cả chiều ngược: `deps.enabled: false` thì thôi cảnh báo, còn hai nhóm MẢNG thì project không tắt được vì mergePolicy HỢP mảng chứ không thay — nên cảnh báo của chúng luôn hiện, đúng thực tế.
doctor/unenforced: merge --no-ff vào master. 130aa24 -> f92156c, 371/371 xanh trên master.

## Cài thật lên máy — xác nhận sống rủi ro trust-theo-vị-trí

install/real: chạy `guardrail install` lên `~/.codex` THẬT. Kết quả đúng thiết kế: 2 event cũ của người dùng (`SessionStart`, `SubagentStart`) GIỮ NGUYÊN Y NGUYÊN (so JSON.stringify với bak), guardrail thêm `PreToolUse` 2 group matcher `Bash` và `apply_patch`, có backup `hooks.json.bak`, có sidecar.
install/real: `config.toml` KHÔNG bị đụng vì `codex_hooks` đã `= true` sẵn. Đúng nếp "không sửa thứ không cần sửa" — và tốt cho một file 9519 byte có thể chứa token.
install/real: **XÁC NHẬN SỐNG §15 #15 (trust gắn với VỊ TRÍ).** Ngay sau khi cài, doctor báo "Có bản ghi trust cho đủ 2 entry" — trong khi guardrail vừa mới được cài lần đầu và chưa ai grant trust cho nó. Nguyên nhân: `config.toml` có 26 bản ghi `hooks.state` từ trước, trong đó CÓ SẴN `~/.codex/hooks.json:pre_tool_use:0:0` và `:1:0` — đúng hai vị trí guardrail vừa chiếm. Bản ghi đó được ghi cho một hook KHÁC từng nằm ở vị trí đó.
install/real: Ruling — đây chính xác là chế độ hỏng mà §15 #15/#16 mô tả, và nó xảy ra ở lần cài ĐẦU TIÊN chứ không phải ca biên hiếm. Quyết định "doctor KHÔNG bao giờ in ✓ đã tin cậy" ở Task 12 được trả công ngay tại đây: nếu doctor tin bản ghi tồn tại là bằng chứng, nó sẽ báo XANH cho một hook mà Codex gần như chắc chắn đang bỏ qua (hash không khớp). Thay vào đó nó báo ⚠ và nói thẳng là không kiểm được hash.
install/real: Bài học cho README/Plan 3 — "có bản ghi trust" là tín hiệu VÔ GIÁ TRỊ trên máy đã từng cài tool hook khác. Bước /hooks là bắt buộc kể cả khi doctor thấy bản ghi.

## doctor: phát hiện Codex CLI thiếu/hỏng

doctor/cli: tìm ra khi trả lời câu "chạy được trên app ChatGPT desktop không". `/opt/homebrew/bin/codex` là symlink treo tới cask `0.130.0` đã mất — KHÔNG có Codex CLI nào chạy. Guardrail cài xong, hooks.json đúng, trust có bản ghi, sidecar đủ; doctor báo "✓ Đã cài" và exit 0 trong khi chặn 0 thứ.
doctor/cli: Ruling — đây là lý do THẬT của `printenv PASSWORD` không bị chặn. Hai giả thuyết tôi đưa ra trước đó (trust chưa cấp; hook cấp project ghi đè global) đều SAI. Bài học: tôi suy luận từ tầng phức tạp nhất trở xuống (trust theo vị trí, precedence file) mà bỏ qua câu hỏi rẻ nhất — "cái binary có chạy được không". Kiểm điều kiện tồn tại trước khi kiểm điều kiện tinh vi.
doctor/cli: phân biệt HỎNG vs THIẾU vì hai hành động khác nhau. `existsSync` một mình KHÔNG phân biệt được — nó đi theo symlink nên symlink treo trả false y như không có file; phải `lstatSync` để thấy symlink rồi `existsSync` để biết đích giải được. Mutation đổi lstat->exists làm 1 test đỏ, nên chi tiết này có tải.
doctor/cli: ca THIẾU nêu thẳng app ChatGPT desktop. ĐO ĐƯỢC: app đó CÓ hệ thống hooks riêng (chuỗi i18n `settings.hooks.event.preToolUse` = "Before a tool executes", cùng preCompact/permissionRequest/promptHandler) nhưng `app.asar` 269MB có 0 hit `hooks.json` và 0 hit `codex_hooks`. Kết luận: app KHÔNG đọc file hook của Codex CLI, nên `guardrail install` không wire được vào đó. Đây là khoảng trống PHẠM VI, không phải bug.
doctor/cli: test tiêm `codex` giả vào PATH trong `sandbox()` để suite không phụ thuộc máy chạy (runner CI không có Codex CLI). 3/3 mutation killed. 374/374 xanh. merge --no-ff: f92156c -> c0c7243.
doctor/cli: CẢNH BÁO CHO SPIKE SAU — Codex trên máy giờ là `codex-cli 0.150.1` (cask cài 11:06), và `0.130.0` đã bị xoá hẳn. Hợp đồng hook mà Task 0 đo (tool `Bash`/`apply_patch`, deny bằng JSON trên stdout + exit 0, Codex nối `. Command: <lệnh>`) được đo TRƯỚC lần nâng cấp này. Phải đo lại trên 0.150.1 trước khi tin. `codex --help` của 0.150.1 vẫn có cờ bypass trust, tức cơ chế trust còn nguyên.

## Entropy: bị loại ở tầng 1 có đo, và gắn thành yêu cầu của redact.stdout

entropy/reject: người dùng hỏi tích hợp validator `secrets_present` (Guardrails AI). Đo trên máy thật: cài 361MB/107 package; `import guardrails` cold 998ms; import+validate 925ms; `import detect_secrets` riêng 79ms. Hook chạy mọi tool call với tiến trình mới, ngân sách 150ms p95 (hiện 27.8ms) — 925ms vượt hơn 6 lần. Loại đường tích hợp package.
entropy/reject: **TÔI ĐỀ XUẤT SAI rồi tự bác bằng số đo.** Tôi nói "port ngưỡng entropy sang JS, ~30 dòng là xong". Đo ra: base64 secret 4.78 bit nhưng base64-CỦA-VĂN-BẢN-THƯỜNG 4.54 và `sha512-` của package-lock 5.53 — biên chỉ 0.24 bit, không đủ để tin. Ngưỡng hex 3.0 còn tệ hơn: git sha 3.80, sha256 checksum 3.67, tức băm nát mọi output `git log` và mọi lockfile. `detect-secrets` tránh được vì nó chỉ soi giá trị trong quote/sau dấu gán, không soi token trần — tầng ngữ cảnh mà bản port ngây thơ không có.
entropy/reject: đối chiếu 12 mẫu: detect-secrets 6/12, redact.mjs 7/12. Phần chỉ detect-secrets bắt = đúng 2 detector entropy; phần chỉ redact.mjs bắt = `sk-` (OpenAI key), `API_TOKEN=`, `DB_PASS=`. Nên THAY redact.mjs bằng nó là HỒI QUY. Tôi từng ngụ ý ngược lại và đã sửa lại trước người dùng.
entropy/reject: **NGƯỜI DÙNG PHẢN BIỆN ĐÚNG.** Tôi khuyên "đẩy sang tầng 2", họ hỏi lại: chưa triển khai CI thì đẩy sang tầng 2 có sai mục đích không. Đúng — tôi trộn QUYẾT ĐỊNH VỀ VỊ TRÍ với TUYÊN BỐ VỀ ĐỘ PHỦ. Tầng 2 chưa tồn tại nên không gì phủ nó cả; nói "để tầng 2 làm" biến quyết định thành khoảng không, đúng cùng lớp lỗi với `deps.enabled: true` mà tôi vừa vá cùng phiên. Và tôi gộp hai việc khác nhau (redact stdout vs quét diff CI) làm một.
entropy/reject: Ruling sau phản biện — vị trí đúng KHÔNG phải một tầng mà là một deliverable có tên: `redact.stdout` (Plan 2, §6.9). Đo được lý do: `redact()` có ĐÚNG MỘT chỗ gọi thật (`lib/audit.mjs` che `command` trước khi ghi log), `stats.mjs` không in `command`, log là 0600 trong thư mục 0700, REGISTRY chưa có PostToolUse. Nên hôm nay entropy chỉ mua được vệ sinh của một file cục bộ riêng tư — KHÔNG ảnh hưởng thứ agent đọc. Giá trị VÀ rủi ro của entropy cùng tăng đúng lúc `redact.stdout` ra đời, nên phải quyết ở đó.
entropy/reject: ghi §15 #22 kèm toàn bộ bảng số đo, và thêm khối "Yêu cầu bắt buộc" vào §6.9 buộc người làm `redact.stdout` phải quyết dứt điểm câu hỏi entropy, cấm viện "để tầng CI làm". Cố ý KHÔNG thêm vào README: `redact()` hiện chỉ chạm audit log và README không hứa redact stdout, nên thêm vào đó là tài liệu hoá một mối lo của Plan 2 ở chỗ chưa có gì để lo.

## CHUỖI ĐẦY ĐỦ ĐÃ ĐÓNG — cưỡng chế thật trong Codex 0.150.1

e2e/confirmed: người dùng grant trust rồi chạy `psql --version` trong Codex thật. Xác minh ĐỘC LẬP qua audit log, không dựa vào lời kể:
    2026-08-27T04:31:15.092Z  denied  infra.deny-binary  tool=Bash  cmd="psql --version"
Entry này ở 04:31, sau mọi probe cục bộ của tôi (muộn nhất 03:34), nên nó đến từ phiên Codex thật.
e2e/confirmed: bản ghi trust ĐÃ ĐỔI HASH — trước grant là `a0ceb2441c6f…`/`1883537e7a7a…` (rác từ hook cũ), sau grant là `e84f23935063…`/`130079cc9805…`. Xác nhận dứt điểm hai điều: (a) bản ghi cũ đúng là rác như doctor đã từ chối tin, (b) Codex ghi lại hash khi grant.
e2e/confirmed: **HỢP ĐỒNG HOOK CỦA TASK 0 VẪN ĐÚNG TRÊN codex-cli 0.150.1.** Đây là rủi ro tôi đã nêu khi phát hiện cask nhảy 0.130.0 -> 0.150.1: deny qua JSON trên stdout + exit 0 vẫn được tôn trọng, tool `Bash` vẫn đúng tên, và lệnh bị chặn thật chứ không chỉ cảnh báo. Không cần spike đo lại hợp đồng.
e2e/confirmed: chuỗi đủ 6 mắt: install merge hooks.json -> /hooks liệt kê (sau khi sửa cách nhận diện) -> grant trust đổi hash -> Codex gọi hook trên tool call thật -> guardrail deny -> audit log ghi lại. Tầng 1 của thiết kế ba tầng đã cưỡng chế được trên máy thật.

---

**Ruling #87 — đường dẫn nằm chung token với cờ thì vòng quét token không thấy (2026-09-04).**
Phát hiện khi đo giới hạn #6 của claude-guardrail: ở đó `dd if=.env` lọt. Kiểm chéo sang engine
này thì lọt rộng hơn — `dd if=.env of=/tmp/leak`, `grep --file=.env x`, `tar --file=.env -c` đều
allow, trong khi `openssl enc -in .env` (đường dẫn là token riêng) và `dd if=$HOME/.ssh/id_rsa`
(pattern cây `**` hút cả tiền tố) thì deny. Đối chứng hai chiều: `npm test`->allow, `psql -l`->deny.
Nguyên nhân: vòng lặp ở lib/rules/secrets.mjs so CẢ token `if=.env` với pattern, nên chỉ pattern
tên file CHÍNH XÁC (`**/.env`) hở — ĐÚNG cái bẫy mà comment về dấu nhóm ngay trên nó đã ghi, chỉ
khác nguồn. Comment đó đã cảnh báo hình dạng lỗi này mà không ai nối sang trường hợp cờ.
Ruling: bóc phần sau `=` của token và kiểm như một đường dẫn. Bóc cho token bắt đầu bằng `-`
(cờ dài GNU, nhận ra được bằng hình dạng) và enumerate `if=`/`of=` (cú pháp operand riêng của
`dd`, không có dấu gạch nên không nhận ra được bằng hình dạng).
KHÔNG bóc hai chỗ, có chủ ý: `--exclude=`/`--ignore=` là cờ ĐANG TRÁNH secret, chặn nó là dạy dev
tắt guardrail; và gán biến môi trường (`ENV_FILE=.env npm start`) không tự đọc file, chặn nó là
chặn oan workflow dotenv thật. Ghi thành giới hạn README #21 kèm test ghim nội dung, để người sau
không "vá cho kín".
Đột biến 4 đòn, cả hai chiều: hẹp lại nhánh cờ dài -> BẮT; bỏ enumerate if=/of= -> BẮT; bóc MỌI
token có `=` (quá rộng) -> BẮT bởi test chống chặn oan; bỏ kiểm allowPaths ở nhánh mới -> BẮT.
Xác minh đầu-cuối qua runHook, 10 lệnh khớp hết. 487/487.
Cost nếu sai: `dd if=.env of=<đích>` là một đường đọc VÀ mang secret ra ngoài trong một lệnh.
