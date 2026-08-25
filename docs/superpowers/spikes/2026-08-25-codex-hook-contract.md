# Spike: hợp đồng hook của Codex

- **Ngày:** 2026-08-25
- **Task:** Plan 1 / Task 0
- **Bản Codex đã kiểm:** `codex-cli 0.149.0-alpha.4.3` (binary trong `/Applications/ChatGPT.app/Contents/Resources/codex`)
- **Trạng thái:** câu hỏi gating ĐÃ trả lời. Phần thu fixture còn dở, chờ grant trust.

## Bối cảnh môi trường — phải biết trước khi đọc kết quả

- `codex` trong PATH là **symlink chết**: `/opt/homebrew/bin/codex` → `/opt/homebrew/Caskroom/codex/0.130.0/codex-aarch64-apple-darwin`, thư mục Caskroom rỗng.
- Binary thật là bản **0.149.0-alpha.4.3** đi kèm `ChatGPT.app`. Mọi tài liệu morkit viết cho 0.120/0.130 đều có thể lệch.
- `codex doctor` sạch, `[features] hooks` đang bật (42 cờ). Không có managed config / policy tổ chức nào chặn.
- `node` do nvm quản lý (`~/.nvm/versions/node/v20.19.2/bin/node`), **không** nằm trên PATH tối thiểu.

## Câu hỏi 1 (gating): exit code non-zero có chặn thật không?

**CÓ.** Kết quả **A**, xác nhận từ hai nguồn độc lập:

- Binary chứa chuỗi `"Command blocked by PreToolUse hook: "`.
- Tài liệu chính thức (`learn.chatgpt.com/docs/hooks`) nói hook chặn bằng cách "exit with code 2 và ghi lý do vào stderr".

Kiến trúc hook trong spec **không sụp**. Plan 1 đi tiếp được.

**Nhưng có kênh tốt hơn exit code** — Codex nhận JSON có cấu trúc:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Destructive command blocked."
  }
}
```

Các struct tương ứng trong binary: `PreToolUseDecisionWire`, `PreToolUseHookSpecificOutputWire`, `PreToolUsePermissionDecisionWire`, với giá trị `approve` / `block` / `allow` / `deny` / `ask`.

→ **Ảnh hưởng plan:** Task 10 nên dùng JSON output làm kênh chính, exit code 2 làm dự phòng. Lý do đi trong trường có cấu trúc, không phụ thuộc Codex có forward stderr hay không. Golden test cho `denyMessage` phải đổi theo.

## Câu hỏi 2: hook có tự cháy khi wire vào `~/.codex/hooks.json`?

**KHÔNG, nếu chưa được trust.** Đây là phát hiện lớn nhất của spike.

Tài liệu: *"Non-managed hooks require explicit review before execution. Use `/hooks` in the CLI to inspect sources, review new hooks, and grant trust. Codex tracks trust against each hook's current hash — new or changed hooks are marked for review and skipped until trusted."*

Chứng cứ khớp:
- Binary có `bypass_hook_trust`, và struct `HookStateToml { enabled, trusted_hash }` — bản ghi trust là TOML, băm theo nội dung hook.
- `~/.codex/config.toml` không có mục nào như vậy → chưa grant.
- Thử thực tế: wire 4 entry (`PreToolUse`/`shell`, `PreToolUse`/`apply_patch`, `PostToolUse`/`shell`, `SessionStart` không matcher), chạy `codex exec` cho nó thực thi `ls -la` → **không entry nào cháy**, kể cả entry không có matcher.

Đã loại các giả thuyết khác:
- **Không phải PATH.** Lệnh hook được đổi sang đường dẫn node tuyệt đối + marker ghi bằng shell builtin, kiểm với `env -i` (PATH trống) thì chạy tốt.
- **Không phải sai đường dẫn file.** Tài liệu xác nhận `~/.codex/hooks.json` là một trong bốn nơi Codex đọc (cùng `~/.codex/config.toml`, `<repo>/.codex/hooks.json`, `<repo>/.codex/config.toml`).
- **Không phải sai schema.** Dạng `{hooks: {PreToolUse: [{matcher, hooks: [{type, command}]}]}}` đúng như ví dụ trong tài liệu.
- **Không phải cờ tắt.** `hooks` nằm trong danh sách cờ đang bật.
- **Không phải policy tổ chức.** Không có `managed_config.toml`.

Một chi tiết phụ đáng sửa: config đang dùng `[features] codex_hooks` — **deprecated** ở 0.149, tên mới là `[features] hooks`. Runtime in cảnh báo. Alias vẫn nhận nhưng nên đổi.

### Ảnh hưởng plan — ba điểm

1. **`guardrail install` không thể là một lệnh.** Mỗi dev phải tự mở `/hooks` và grant trust. Không tự động hoá được — đó chính là cơ chế ngăn plugin lạ tự cài hook. `install` phải in hướng dẫn này thành bước bắt buộc, và README phải nói rõ.
2. **Thiết kế hiện tại vô tình đúng ở chỗ quan trọng.** Lệnh hook cố định (`node .../guardrail.mjs hook`), mọi biến động rule nằm trong `codex-guardrail.json` — file *không phải* hook. Trust băm theo nội dung hook nên chỉ phải grant **một lần**; sửa policy về sau không làm đứt trust. Nếu rule nằm trong chính hook command thì mỗi lần đổi rule là cả team phải re-trust.
3. **Dev không grant trust thì guardrail không bao giờ chạy, và không ai biết.** Thêm một lý do cho tầng CI, và `doctor` (Task 12) phải phát hiện được trạng thái chưa-trust — đọc `trusted_hash` trong `config.toml` và so với hash hook hiện tại.

## Câu hỏi 3: định dạng payload, stdout ở PostToolUse, tool đọc file

**CHƯA TRẢ LỜI** — cần grant trust trước mới thu được payload thật.

Biết trước từ binary (chưa xác nhận bằng payload thật):
- Trường payload: `session_id`, `turn_id`, `agent_id`, `agent_type`, `transcript_path`, `hook_event_name`, `model`, `permission_mode`, `trigger`, `tool_name`, `tool_input`, `tool_use_id`, `tool_response`.
- `PostToolUse` **có** `tool_response` → rule `redact.stdout` (Plan 2) khả thi.
- Có `SessionStartHookSpecificOutputWire` với `additionalContext` → bơm ngữ cảnh cho rule convention (Plan 2) khả thi.
- Trường cấu hình mỗi hook: `matcher`, `command`, `type`, `timeout` / `timeoutSec`, `async`, `asyncRewake`, `shell`, `statusMessage`, `if`.
- Event đầy đủ: `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`, `PostCompact`, `SessionStart`, `SessionEnd`, `UserPromptSubmit`, `SubagentStart`, `SubagentStop`, `Stop` — **nhiều hơn** danh sách morkit ghi cho 0.130 (có thêm `SessionEnd`, `SubagentStart`, `SubagentStop`).
- **Tên tool cần xác nhận:** ví dụ trong tài liệu dùng `matcher: "Bash"` (vocab Claude Code), nhưng Codex gọi tool shell là gì thì chưa rõ. Nếu là `Bash` chứ không phải `shell` thì matcher trong Task 11 sai. Đây là việc phải xác nhận bằng payload thật, không đoán.

## Việc còn lại để đóng Task 0

1. Người dùng mở `/Applications/ChatGPT.app/Contents/Resources/codex`, gõ `/hooks`, grant trust cho 4 entry spike.
2. Bảo Codex chạy `ls -la` và sửa một file; đóng mở lại phiên.
3. Đọc `~/guardrail-spike/`, xác nhận tên khoá và tên tool, chuẩn hoá thành fixture (thay giá trị thật bằng giá trị vô hại).
4. Đổi `dump-hook.mjs` → `deny-always.mjs` cho `PreToolUse`/`shell`, xác nhận Codex thật sự chặn và có thấy stderr.
5. Tháo wiring, xoá `~/guardrail-spike`, restore `~/.codex/hooks.json` từ `.spike-bak`.
