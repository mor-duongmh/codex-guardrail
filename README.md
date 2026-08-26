# codex-guardrail

Lớp cưỡng chế guardrail cho Codex CLI. Chặn agent làm bốn nhóm việc nguy hiểm:
đọc secret, tự thao tác database/cloud, tự chạy git lệch quy trình, và tự sửa
chính cấu hình đang bảo vệ bạn.

Hook chạy trên hai tool của Codex: `Bash` và `apply_patch`. Không dependency
runtime, cần Node >= 20.

## Cài

Repo chưa publish lên registry, nên cài từ bản clone:

```
git clone <url repo này> codex-guardrail
cd codex-guardrail
node bin/guardrail.mjs install
```

`install` copy runtime vào `~/.codex/guardrail`, bật `codex_hooks = true` trong
`~/.codex/config.toml`, và **merge** hai entry vào `~/.codex/hooks.json` — entry
của tool khác trong file đó được giữ nguyên.

Muốn có lệnh `guardrail` trên PATH (mọi message của tool đều nói `guardrail ...`)
thì thêm `npm link` trong thư mục clone.

### Rồi làm bước này. Không làm thì guardrail chặn 0 thứ.

`install` in đúng khối dưới đây ở cuối, và `guardrail doctor` in lại nó cho tới
khi bạn làm xong:

```
⚠ Còn MỘT bước bạn phải tự làm — guardrail chưa chạy nếu thiếu bước này.

  Codex bỏ qua mọi hook chưa được cấp tin cậy, và không báo gì cả.

  1. Mở Codex CLI
  2. Gõ: /hooks
  3. Duyệt và cấp tin cậy (grant trust) cho các mục codex-guardrail

  Chỉ phải làm MỘT LẦN. Sửa codex-guardrail.json về sau không làm mất tin cậy,
  vì rule nằm trong file policy chứ không nằm trong lệnh hook.

  Kiểm lại bằng: guardrail doctor
```

Đây là bước dễ bỏ nhất và tốn kém nhất khi bỏ: Codex bỏ qua **im lặng** mọi hook
chưa được cấp tin cậy. Hook cài đúng, `hooks.json` đúng, mà guardrail vẫn không
chặn gì — và Codex không nói một câu nào. Nghĩa là bạn tưởng mình được bảo vệ
trong khi không.

Khởi động lại Codex sau khi cài. Rồi chạy `guardrail doctor` — nó thoát mã 1 và
nói thẳng nếu chưa được cấp tin cậy, nên dùng được luôn để xác nhận.

## Ba tầng

1. **Hook local** — chặn agent ngay lúc nó định làm. Đây là phần này.
2. **CI check** — bắt lại các rule thấy được trong diff. Chưa có ở bản này.
3. **CODEOWNERS** — khoá `codex-guardrail.json` để nới policy phải có lead duyệt.

Tầng 1 chặn được nhiều nhất nhưng dev nào cũng tháo được (`~/.codex/hooks.json`
là file của họ). Tầng 2 và 3 tồn tại chính vì thế.

## Rule mặc định

`guardrail doctor` in danh sách đang hiệu lực. Bản mặc định (`policy/default.json`):

| Nhóm | Chặn gì |
|---|---|
| `secrets` | 19 mẫu đường dẫn secret (`.env`, `~/.aws/**`, `~/.ssh/**`, ...), 6 mẫu miễn |
| `infra` | 21 binary thao tác database/cloud (`psql`, `terraform`, `aws`, ...) và 5 mẫu lệnh phá huỷ |
| `git` | branch được bảo vệ `main`, `master`, `develop`, `release/*`; cờ phá huỷ; commit message lệch convention |
| `selfprotect` | sửa/xoá chính `hooks.json`, `codex-guardrail.json`, thư mục runtime của guardrail |

Nới cho một dự án: tạo `codex-guardrail.json` ở gốc repo đó. Mảng thì **hợp**
với mặc định chứ không thay thế, nên thêm `infra.allowBinaries: ["supabase"]` là
thêm vào, không mất phần còn lại. Tạo file bằng tay: bản này chưa có subcommand
sinh sẵn (để lại plan sau), và không chỗ nào chỉ bạn tới lệnh chưa tồn tại.

## Escape

Đường tốt: thêm entry vào `codex-guardrail.json`, mở PR, lead duyệt qua CODEOWNERS.

Đường nhanh, **người gõ trong shell trước khi mở Codex**, không phải agent:

```
export CODEX_GUARDRAIL_ALLOW=infra.deny-binary
```

Nhiều rule thì cách nhau bằng dấu phẩy. **Không hỗ trợ `*`** — không có cách tắt
tất cả bằng một chuỗi.

Escape là **theo từng ruleId**. Một lệnh có thể trúng hai rule (`rm -rf ~` trúng
cả `infra.deny-pattern` lẫn `selfprotect.hooks-file`); ruleId trong message là
rule chặn TRƯỚC, nới nó xong thì rule còn lại vẫn chặn. Đó là hành vi đúng, chỉ
dễ gây bối rối.

Nếu `CODEX_GUARDRAIL_ALLOW` xuất hiện *trong* command thì bị chặn ngay bằng
`selfprotect.escape-inline` — đó là agent tự phát escape cho chính nó, không phải
người quyết định.

## Điều chỉnh rule về sau

| Mức | Cách làm |
|---|---|
| Một dự án | Sửa `codex-guardrail.json`, mở PR |
| Mọi dự án | Sửa `policy/default.json` trong repo này, bump tag |
| Loại rule mới | Thêm module vào `lib/rules/`, đăng ký vào `lib/dispatch.mjs` |

`guardrail stats` tổng hợp audit log: rule nào chặn oan nhiều nhất (nên nới) và
rule nào chưa bắn lần nào (nên bỏ cho gọn). Cố ý **không** có cơ chế rule tự nới
— guardrail tự nới sẽ mất tác dụng đúng lúc cần nhất, và bên bị chặn lại chính
là bên có động cơ nới.

Gỡ: `guardrail uninstall`. Nó gỡ đúng entry của mình và giữ entry của tool khác.

## Giới hạn đã biết

Danh sách này ghi ra chứ không che. Guardrail chống **tai nạn** và chống **agent
hớ hênh**; nó không phải hàng rào an ninh.

1. **Không chống người cố tình lách.** `$(printf 'ps'; printf 'ql')` không bắt
   được. Ai muốn lách thì lách được.
2. **Interpreter đọc được file mà không nêu tên file theo cách rule thấy.** Đo
   được: `python -c "print(open('.env').read())"` lọt, `node -e` / `ruby -e` /
   `perl -e` cũng vậy. Đây là trần của cách khớp theo đường dẫn, không phải bug
   vá được — chặn mọi interpreter kèm `-c`/`-e` sinh false positive khổng lồ.
   Đừng tin guardrail quá mức vì mục này.
3. **Escape cài được bền vững qua file rc của shell.** `export` bên trong một
   tool call KHÔNG lan tới tiến trình Codex, nên không dùng được để tự phát
   escape — đó là chủ ý. Nhưng agent ghi `export CODEX_GUARDRAIL_ALLOW=<ruleId>`
   vào `~/.zshrc` / `~/.bashrc` / `~/.profile` thì **phiên Codex sau thừa hưởng**,
   và các file đó cố tình không nằm trong `selfProtect.protectedPaths` (thêm vào
   sẽ chặn oan việc sửa dotfile, thứ dev làm bình thường).
4. **Bản ghi tin cậy của Codex gắn với VỊ TRÍ của entry trong `hooks.json`, nên
   guardrail có thể bị vô hiệu hoá âm thầm.** Khoá trust là
   `<đường dẫn hooks.json>:<event>:<chỉ số group>:<chỉ số hook>`. Hai con số là
   VỊ TRÍ: một tool khác cài sau mà chèn group vào TRƯỚC guardrail sẽ làm chỉ số
   đổi, bản ghi trust không còn khớp, và Codex quay lại bỏ qua hook — **không báo
   gì cả**. `install` của guardrail nối group vào cuối nên không phá trust của
   tool khác, nhưng không kiểm soát được thứ tự tool khác chọn. **Chạy
   `guardrail doctor` sau khi cài thêm bất kỳ tool nào có hook.**
5. **`doctor` không kiểm được `trusted_hash`.** Cách Codex tính hash đó chưa xác
   định (đã thử 78 tiền ảnh sha256 đối chiếu 25 hash thật, không khớp cái nào).
   Nên `doctor` chỉ báo CÓ / KHÔNG CÓ bản ghi trust và không bao giờ in dấu tick
   "đã tin cậy": một bản ghi cũ với hash lệch trông y như bản ghi hợp lệ.
6. **`grep -r` và `git diff` vẫn lôi được secret ra** mà không hiện đường dẫn nào.
7. **`ssh` chỉ soi được lệnh remote viết thẳng trong command.** ProxyJump, `-F`
   custom config, lệnh remote sinh động, hay `ssh h1 "ssh h2 psql"` lồng hai tầng
   thì lọt.
8. **Không có bước nở biến môi trường.** Đo được: `rm -rf ~/.codex` bị chặn còn
   `rm -rf "$HOME/.codex"` và `rm -rf ${HOME}/.codex` LỌT. Hook không biết giá
   trị biến lúc chạy.
9. **Glob nằm trong chính token thì lọt.** `rm -rf ~/.codex*` LỌT vì rule so
   đường dẫn theo văn bản, không coi token là một glob có thể khớp đường dẫn được
   bảo vệ.
10. **Cửa thoát `allowBinaries` thô ở mức binary, không ở mức subcommand.** Cần
    `supabase gen types` thì buộc phải mở `allowBinaries: ["supabase"]`, tức mở
    luôn `supabase db reset --linked`. Đây là đường dẫn thực tế tới "dev tắt
    guardrail"; cửa thoát theo subcommand thuộc bản sau.
11. **Guardrail chỉ cưỡng chế thứ dự án đã có.** Repo không có lint thì
    `convention.lint` không có gì để chạy, và `doctor` nói thẳng điều đó.
12. **Không có telemetry.** Dev tháo hook thì không ai biết — lý do tầng CI và
    CODEOWNERS tồn tại.

## Phát triển

```
npm test              # toàn bộ, ~5s (gồm test độ trễ)
npm run test:latency  # chỉ test độ trễ
```

`npm test` là `node --test` **không tham số** một cách có ý: dạng thư mục
`node --test tests/` chỉ chạy trên Node 20, còn Node 22 và 24 ném
`MODULE_NOT_FOUND`. Đừng "dọn" nó lại thành đường dẫn thư mục.

Test độ trễ giữ ngân sách p95 < 150ms của hook (nó chạy trên **mọi** tool call).
Nó in số đo mỗi lần chạy, kể cả khi xanh, để thấy được đà trượt.
