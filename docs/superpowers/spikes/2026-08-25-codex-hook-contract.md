# Spike: hợp đồng hook của Codex

- **Ngày:** 2026-08-25, hoàn tất 2026-08-26
- **Task:** Plan 1 / Task 0 (gating)
- **Bản Codex đã kiểm:** `codex-cli 0.149.0-alpha.4.3`, binary trong `/Applications/ChatGPT.app/Contents/Resources/codex`
- **Trạng thái:** ĐÓNG. Cả ba câu hỏi đã trả lời bằng payload và hành vi thật, không phải suy từ binary.

## Bối cảnh môi trường — phải biết trước khi đọc kết quả

- `codex` trong PATH là **symlink chết**: `/opt/homebrew/bin/codex` → Caskroom 0.130.0 rỗng. Binary thật đi kèm `ChatGPT.app`.
- Mọi tài liệu morkit viết cho 0.120/0.130 đều có thể lệch so với 0.149.
- `[features] hooks` đang bật. Config máy này còn dùng tên cũ `codex_hooks` — **deprecated**, runtime in cảnh báo, nên đổi.
- `node` do nvm quản lý (`~/.nvm/versions/node/v20.19.2/bin/node`), **không** nằm trên PATH tối thiểu → lệnh hook phải dùng đường dẫn node tuyệt đối.

## Câu hỏi 1 (gating): PreToolUse có chặn thật không?

**CÓ — cả hai kênh, và lý do tới model nguyên văn.**

Kiểm bằng cách bảo Codex chạy `echo LENH_DA_CHAY_MARKER` với hook luôn-chặn:

| Kênh | Lệnh có chạy? | Model thấy lý do? |
|---|---|---|
| JSON `permissionDecision: "deny"` + exit 0 | Không | Có |
| exit code 2 + stderr | Không | Có |

Cả hai kênh cho ra **cùng một chuỗi** trong luồng model:

```
Command blocked by PreToolUse hook: <lý do>. Command: echo LENH_DA_CHAY_MARKER
```

Codex tự thuật lại cho người dùng: *"Không chạy được: lệnh bị guardrail chặn trước khi thực thi."*
**Dấu tiếng Việt sống nguyên vẹn** qua cả hai kênh → thông điệp chặn viết tiếng Việt được.

**Thông điệp nhiều dòng sống nguyên vẹn.** Kiểm bằng đúng khuôn golden 8 dòng của `denyMessage()`:
Codex giữ cả thụt lề, dòng trắng và dấu tiếng Việt, rồi model tuân thủ và tự diễn giải lại cho người
dùng ("*Không chạy được: guardrail chặn `psql` vì đây là thao tác trực tiếp với database. Mình đã dừng,
không thử cách khác.*"). Một tật nhỏ: Codex nối `. Command: <lệnh>` **ngay sau** reason, nên reason kết
thúc bằng `.` hoặc newline sẽ ra `CODEOWNERS).. Command:` — bỏ dấu chấm cuối là xong.

→ **Chọn kênh JSON làm chính** (Task 10). Không phải vì nó truyền lý do tốt hơn — hai kênh tương đương — mà vì exit 0 phân biệt được *cố ý chặn* với *hook crash*, để dành exit code khác cho fail-closed nội bộ. Giữ exit 2 làm dự phòng.

## Câu hỏi 2: hook có tự cháy khi wire vào `~/.codex/hooks.json`?

**KHÔNG, nếu chưa được trust — và Codex bỏ qua IM LẶNG.**

Tài liệu: *"Non-managed hooks require explicit review before execution. Use `/hooks` in the CLI... Codex tracks trust against each hook's current hash — new or changed hooks are marked for review and skipped until trusted."*
Struct trong binary: `HookStateToml { enabled, trusted_hash }`.

Đã loại hết giả thuyết khác: không phải PATH (kiểm với `env -i`), không phải sai đường dẫn file, không phải sai schema, không phải cờ tắt, không phải managed policy.

**Có đường automation chính thức:**

```
--dangerously-bypass-hook-trust
    Run enabled hooks without requiring persisted hook trust for this
    invocation. DANGEROUS. Intended only for automation that already
    vets hook sources
```

Chỉ dùng cho spike/CI của chính mình. **Không** đưa vào tài liệu cho dev — bảo dev bypass trust là dạy họ tắt đúng cơ chế bảo vệ họ khỏi hook lạ.

### Ảnh hưởng plan — ba điểm

1. **`guardrail install` không thể là một lệnh.** Mỗi dev phải tự `/hooks` → grant trust. Không tự động hoá được, và đó là *tính năng* chứ không phải lỗi. `install` phải in bước này thành việc bắt buộc; README nói rõ.
2. **Thiết kế hiện tại vô tình đúng ở chỗ quan trọng.** Lệnh hook cố định, mọi biến động rule nằm trong `codex-guardrail.json` — file *không phải* hook. Trust băm theo nội dung hook nên grant **một lần**; sửa policy không làm đứt trust. Nếu rule nằm trong hook command thì mỗi lần đổi rule là cả team phải re-trust.
3. **Dev không grant trust thì guardrail không chạy, và không ai biết.** Thêm lý do cho tầng CI. `doctor` (Task 12) phải phát hiện trạng thái chưa-trust bằng cách so `trusted_hash` với hash hook hiện tại.

## Câu hỏi 3: định dạng payload

Thu bằng `dump-hook.mjs`, chuẩn hoá vào `tests/fixtures/codex-events/`.

Trường thật sự có (PreToolUse/PostToolUse): `session_id`, `turn_id`, `transcript_path`, `cwd`, `hook_event_name`, `model`, `permission_mode`, `tool_name`, `tool_input`, `tool_use_id`; PostToolUse thêm `tool_response`. SessionStart: không có `turn_id`/`tool_*`, có `source` (`startup`).

Bốn điều lệch với giả định trong plan — mỗi điều đều làm sai rule nếu không sửa:

1. **`tool_name` là `Bash`, không phải `shell`.** Vocab Claude Code, không phải vocab Codex như morkit ghi. Matcher trong Task 11 sai → phải sửa. Tool sửa file là `apply_patch`.
2. **`apply_patch` KHÔNG có field đường dẫn.** `tool_input.command` là nguyên văn patch envelope; đường dẫn nằm trong thân text:
   `*** Begin Patch` / `*** Add File: <abs>` hoặc `*** Update File: <abs>` / hunk / `*** End Patch`.
   → `secrets.write-path`, `selfprotect.policy-file`, `selfprotect.hooks-file`, `quality.ci-generated-file` phải **parse envelope** để lấy path, không đọc `tool_input.file_path`.
3. **Xoá file đi qua `Bash` với `rm`, không qua `apply_patch`.** Quan sát thật: `rm -- xoa.txt`. Envelope có `*** Delete File:` nhưng Codex không chọn đường đó. → self-protect phải bắt cả nhánh Bash.
4. **Codex nối lệnh bằng `&&` như thói quen, không phải ngoại lệ.** Quan sát thật:
   `pwd && rg -n --fixed-strings 'dong hai' sua.txt && ls -ld xoa.txt`
   `rm -- xoa.txt && rg -n 'x' sua.txt && test ! -e xoa.txt`
   → `lib/tokenize.mjs` **bắt buộc** tách theo `&&`, `||`, `;`, `|` rồi soi từng đoạn. Rule chỉ soi lệnh đầu là lọt ngay ở lượt đầu tiên, không cần ai cố né. Đây là ca test quan trọng nhất của Task 1, không phải ca biên.

Thêm: `cwd` có trong payload → `lib/context.mjs` lấy repo root từ đó, không cần `process.cwd()`. `permission_mode` có sẵn (thấy `bypassPermissions`). `tool_response` là chuỗi thô → `redact.stdout` (Plan 2) khả thi. Matcher là **regex** (`".*"` khớp mọi tool) và **bỏ trống cũng khớp mọi tool**.

Event đầy đủ ở 0.149: `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`, `PostCompact`, `SessionStart`, `SessionEnd`, `UserPromptSubmit`, `SubagentStart`, `SubagentStop`, `Stop` — nhiều hơn danh sách morkit ghi cho 0.130.

## Tổng kết ảnh hưởng plan

Kiểm lại plan sau khi có dữ kiện thật: **plan vững hơn dự đoán.** Hai thứ tôi tưởng phải thêm thì
đã có sẵn — `tokenize.mjs` đã tách `&&`/`||`/`;`/`|` (test `'tách theo ; && || | và newline'`), và
`context.mjs` đã parse header `*** Update|Add|Delete|Move File:`. Quan sát thật chỉ **xác nhận** hai
thiết kế đó là đúng chứ không phải phòng xa. Phần thật sự phải sửa hẹp hơn:

| Task | Phải sửa | Trạng thái |
|---|---|---|
| Global | Thêm khối hợp đồng hook đã đo; đổi mục "Exit code" thành "Kênh chặn = JSON" | ✅ đã vá |
| 4, 10, 11 | `tool_name`/matcher/REGISTRY: `shell` → `Bash` | ✅ đã vá (18 chỗ) |
| 10 | Deny qua JSON `permissionDecision`, hook **luôn** exit 0; test đọc lý do từ stdout; reason không kết bằng dấu chấm/newline | ✅ đã vá |
| 9 | Self-protect bắt `rm` trên nhánh Bash (xoá file không đi qua `apply_patch`) | ⚠️ còn phải làm khi tới Task 9 |
| 11 | `install` in bước `/hooks` grant trust như việc bắt buộc; không đề cập cờ bypass trong tài liệu dev | ✅ đã vá |
| 12 | `doctor` phát hiện hook chưa trust | ✅ đã vá (kèm ghi chú: cách tính `trusted_hash` chưa xác định) |

Fixture: `tests/fixtures/codex-events/` — `session-start`, `pre-bash-simple`, `pre-bash-chained`, `post-bash-simple`, `pre-apply-patch-add`, `pre-apply-patch-update`.
