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
  3. Tìm HAI mục PreToolUse có lệnh chứa guardrail/bin/guardrail.mjs
     (matcher "Bash" và matcher "apply_patch") rồi cấp tin cậy cho cả hai.
     Danh sách KHÔNG hiện chữ "codex-guardrail" — hooks.json chỉ chứa đường dẫn
     lệnh, nên hãy nhận diện bằng đoạn guardrail.mjs.

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
| `infra` | 23 binary thao tác database/cloud và publish (`psql`, `terraform`, `aws`, `surge`, `gh-pages`, ...) và 9 mẫu lệnh phá huỷ / publish (`docker push`, `netlify deploy`, `firebase deploy`, `railway up`, ...) |
| `git` | branch được bảo vệ `main`, `master`, `develop`, `release/*`; cờ phá huỷ; commit message lệch convention |
| `deploy` | deploy phải NÊU RÕ đích, đích phải đã khai, branch phải khớp đích; đích hệ quả cao đòi người xác nhận; đẩy dữ liệu tới host chưa khai thì **hỏi** |
| `selfprotect` | sửa/xoá chính `hooks.json`, `codex-guardrail.json`, thư mục runtime của guardrail |

`policy/default.json` còn khai bốn nhóm nữa — `convention`, `quality`, `net`,
`deps` — mà bản này **chưa có rule nào cưỡng chế**. Chúng để dành cho bản sau.
`guardrail doctor` in ⚠ cho từng nhóm kèm số lượng, nên đừng đọc
`quality.protectedPaths` hay `deps.enabled: true` trong file policy như thể
chúng đang có hiệu lực — 9 mẫu đường dẫn của `quality` hiện không bảo vệ gì.

Nới cho một dự án: tạo `codex-guardrail.json` ở gốc repo đó. Mảng thì **hợp**
với mặc định chứ không thay thế, nên thêm `infra.allowBinaries: ["supabase"]` là
thêm vào, không mất phần còn lại.

`guardrail init` sinh sẵn file đó bằng cách **suy ra từ repo**: default branch từ
`origin/HEAD`, quy ước commit từ 50 commit gần nhất, lệnh lint từ `package.json`
/ `Makefile` / `pyproject.toml` / `composer.json`, và file quy ước từ những file
có thật. Thiếu thông tin thì nó **để trống chứ không đoán** — đáng chú ý nhất:
nếu repo chưa theo conventional commits thì nó KHÔNG áp quy ước đó, vì áp bừa sẽ
chặn oan mọi commit tiếp theo. `init` **không ghi đè** file đang có.

## Nhóm `deploy` — bài toán "AI tự đoán deploy đi đâu"

Nhóm này khác bốn nhóm kia ở một điểm quyết định: nó là **allow-list**. Bốn nhóm
kia liệt kê cái BỊ CẤM nên chúng bảo vệ được ngay từ bản mặc định; `deploy` liệt
kê cái ĐƯỢC PHÉP nên nó **không cưỡng chế gì tới khi dự án khai**.

Khai vào `codex-guardrail.json` ở gốc repo:

```json
{
  "deploy": {
    "entrypoints": ["./scripts/deploy.sh"],
    "targets": [
      { "name": "staging", "branches": ["develop"] },
      { "name": "prod", "branches": ["release/*"], "requireHumanEscape": true }
    ],
    "declaredHosts": ["staging.acme.internal", "*.prod.acme.internal"]
  }
}
```

`guardrail init` dò sẵn `entrypoints` và sinh luôn bảo vệ cho chính script đó.
Nó **không đoán** `targets` — tên môi trường là đúng thứ cần người review.

Đích được bóc từ **toàn bộ tham số**, không theo vị trí, nên bốn dạng dưới đây
tương đương: `./deploy.sh prod`, `./deploy.sh --env=prod`, `./deploy.sh --env prod`,
`make deploy ENV=prod`.

Ba trạng thái mà `guardrail doctor` phân biệt, vì chúng khác nhau về hành động:

| Trạng thái | Nghĩa |
|---|---|
| chưa khai `entrypoints` | nhóm KHÔNG cưỡng chế gì với script của dự án |
| có `entrypoints`, `targets` rỗng | **MỌI** lệnh deploy bị chặn — không phải "đang bảo vệ đúng" |
| khai đủ | đang bảo vệ |

**Nhóm B không bị chặn, mà được hỏi.** `scp`/`rsync`/`ssh`/`curl` là lệnh hằng
ngày, chặn chúng là cách nhanh nhất để dev tháo guardrail. Guardrail chỉ hỏi khi
**cả hai** điều kiện đúng: đích không có trong `declaredHosts`, VÀ lệnh **đẩy**
dữ liệu ra (`scp ./x host:/y`, `rsync ./x host:/y`, `ssh host "..."`, `curl -X POST`
/ `-d` / `-F` / `-T`). Tải-về không bị hỏi. Đo trên 24 lệnh thật hay gõ: 0 prompt.

Điều đó cũng nghĩa là: `declaredHosts` rỗng thì nhóm B **không được hỏi gì**.
`doctor` in ⚠ cho trạng thái đó.

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
rule nào chưa bắn lần nào (nên bỏ cho gọn). Cột `hỏi` đếm riêng số lần guardrail
xin xác nhận — dev bấm OK là lệnh chạy, nên **đừng nới policy vì con số ở cột
đó**: nó là rule đang làm đúng việc, không phải rule chặn oan. Cố ý **không** có cơ chế rule tự nới
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

13. **Thư mục hệ thống KHÔNG được bảo vệ.** Đo được: `rm -rf /usr`, `rm -rf /etc`,
    `rm -rf /System`, `rm -rf /var/lib` đều LỌT. Mẫu mặc định chỉ phủ `/` và `/*`.
    Đừng đọc mục "Rule mặc định" ở trên như thể nó phủ mọi lệnh xoá nguy hiểm.
    Chưa vá ngay vì bản vá thô còn tệ hơn lỗ: `rm -rf /tmp/build-cache` và
    `rm -rf /var/folders/...` là việc script build làm hằng ngày, nên một mẫu
    `/var/**` sẽ chặn oan hàng loạt. Danh sách `protectedRoots` tường minh
    thuộc bản sau.
14. **Liệt kê thư mục secret vẫn được.** `ls -la ~/.ssh` và `ls ~/.aws` LỌT.
    Cố ý: liệt kê cho biết CÓ khoá nào tồn tại chứ không cho biết NỘI DUNG
    khoá, và `cat ~/.ssh/id_rsa` vẫn bị chặn. Chặn `ls` là chặn oan.
15. **`jq` và `yq` bị chặn oan.** `jq '.env' package.json` bị chặn vì `.env`
    trông y như một đường dẫn — trong khi nó là filter của jq. Gặp thì escape
    theo `secrets.read-path`. Sửa đúng cần rule biết ngữ nghĩa tham số của
    từng binary, thuộc bản sau.
16. **Một số lệnh git phá huỷ được cố ý cho qua.** `git branch -D` (reflog cứu
    được khoảng 90 ngày, và đây là lệnh dọn branch dùng hằng ngày) và
    `git update-ref -d` (plumbing, chặn nó mở ra cả họ plumbing không có điểm
    dừng rõ). Cân rồi loại, không phải bỏ sót.
17. **Chèn `./` hoặc `../` vào giữa đường dẫn thì lách được các mẫu chính xác.**
    `cat ~/.docker/./config.json` LỌT còn `cat ~/.docker/config.json` bị chặn,
    vì bước chuẩn hoá đường dẫn chưa giải `.` và `..`. Các mẫu dạng cây (`**`)
    không bị ảnh hưởng.
18. **Mở Codex NGOÀI thư mục dự án thì đường script không được bảo vệ.**
    `codex-guardrail.json` chỉ được đọc khi tìm được `.git` từ `cwd` mà Codex
    gửi. Mở từ home thì policy dự án không bao giờ được đọc, nên `deploy.targets`
    rỗng và nhóm `deploy` **không cưỡng chế gì** với script của dự án — đây là
    chỗ một rule allow-list suy giảm ngược hướng với deny-list. Công cụ deploy
    trực tiếp vẫn bị `infra` chặn (deny-list nằm ở bản mặc định). Guardrail bịt
    một phần bằng `deploy.detectScripts` (chặn lệnh trông-như-deploy kèm message
    "mở Codex từ thư mục dự án"), nhưng nó khớp theo TÊN file nên `redeploy.sh`
    hay một tên riêng của dự án sẽ lọt. Cách chắc chắn duy nhất: **mở Codex TỪ
    thư mục dự án**, rồi `guardrail doctor` sẽ báo `✓ Hook thật đọc được project
    root`.
19. **Danh sách trình thông dịch và wrapper không thể đầy đủ.**
    `bash ./deploy.sh`, `sh`, `zsh`, `source`, `.`, `pwsh` đều được bóc để lộ
    script thật, và `sudo`, `env`, `npx`, `nice`, `time`, `xargs`, `timeout`,
    `nohup`, `exec`, `stdbuf`, `watch` cũng vậy. Nhưng `perl -e`, một wrapper tự
    viết trong repo, hay một tên shell khác vẫn gọi được script mà không khớp
    entrypoint nào. Cùng bản chất với giới hạn #1: danh sách này chỉ dài ra được
    khi có người thêm, và `doctor` không phát hiện được thiếu sót kiểu đó.
20. **`netlify` / `firebase` / `railway` bị chặn ở mức SUBCOMMAND, không mức
    binary.** `netlify deploy` bị chặn còn `netlify dev` qua — chủ ý, vì chặn cả
    binary sẽ biến một lệnh hằng ngày thành escape từng phiên đến hết đời dự án
    (mảng trong bản mặc định không xoá được). Cái giá: một subcommand publish
    mới hoặc đổi tên sẽ **lọt** cho tới khi có người thêm pattern, và `doctor`
    không phát hiện được thiếu sót kiểu này.

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
