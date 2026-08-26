# Plan Review Checklist — `be-feature`

> **File cổng (gate)** — sinh tự động bởi skill `plan-review-gate`. Việc thực thi
> plan bị **CHẶN** cho tới khi `Overall Decision:` = `OK`.
>
> ⚠️ Giữ nguyên 3 từ khoá kỹ thuật `Overall Decision:`, `OK`, `NOT OK` — hook dùng
> chính tả này để parse. Mọi nội dung khác có thể viết thoải mái bằng tiếng Việt.

## Meta Info

- **Plan file:** `/Users/haiduong/Documents/work/codex-guardrail/docs/superpowers/plans/2026-08-25-codex-guardrail-engine.md`
- **Variant:** `be-feature`
- **Task ID / Ticket:**
- **Task Title:**
- **Reviewer (Developer):**
- **Review Date:**
- **AI Agent Output Ref:**

## Cách dùng

1. Tick từng item: `[x]` Pass, để trống = Fail, ghi `N/A` nếu không áp dụng.
2. Ghi rõ rework cần thiết ở phần **Review Summary → Feedback to AI Agent** để agent biết phải sửa gì.
3. Tổng kết Critical / Major / Minor issues.
4. Đặt **Overall Decision:** `OK` (mở gate) hoặc `NOT OK` (chặn, loop lại writing-plans).

## Nguyên tắc quyết định

- **Critical** issue → `NOT OK`, loop lại writing-plans.
- **Major** issue → cân nhắc `NOT OK` hoặc yêu cầu agent sửa plan trước khi code.
- Chỉ **Minor** → có thể `OK`, note lại để agent lưu ý.

| Severity | Ý nghĩa | Hành động |
|----------|---------|-----------|
| **Critical** | Sai root cause, sai architecture, phá vỡ system, security risk nghiêm trọng | NOT OK → Loop lại Planning |
| **Major** | Miss requirement quan trọng, sai convention, thiếu test plan edge case chính | NOT OK → Agent sửa plan trước khi code |
| **Minor** | Cải thiện nhỏ, optimization, naming chưa tối ưu | OK với note → Agent lưu ý khi code |

---

## BE - Feature

**Backend Feature Development - Review Checklist**

### 1. Requirement Alignment

- [ ] Agent đã hiểu đúng scope và mục tiêu của task chưa?
- [ ] Tất cả acceptance criteria từ PM/BA đã được cover trong plan?
- [ ] Các business rule và edge case quan trọng đã được liệt kê?
- [ ] Plan có giả định nào không có trong requirement gốc? (nếu có, đã flag để confirm chưa?)
- [ ] Có dependency với task/team khác không? Đã align chưa?

### 2. API & Contract Design

- [ ] API endpoint, method, path tuân theo convention của project?
- [ ] Request/Response schema đầy đủ (required/optional, data type, validation rule)?
- [ ] Error response format nhất quán với các API hiện có (status code, error code, message)?
- [ ] Authentication/Authorization requirements đã xác định rõ cho từng endpoint?
- [ ] API versioning strategy được xử lý đúng (nếu breaking change)?

### 3. Data Layer & Database

- [ ] Schema change (migration) được thiết kế đúng: field types, index, constraint, nullable?
- [ ] Có xử lý backward compatibility cho dữ liệu hiện có không?
- [ ] Query được thiết kế tránh N+1, có index phù hợp?
- [ ] Transaction boundary và rollback scenario đã được xử lý?
- [ ] Sensitive data (password, PII) có được hash/encrypt đúng cách?

### 4. Business Logic & Architecture

- [ ] Logic đặt đúng layer (controller/service/repository) theo pattern của project?
- [ ] Có tái sử dụng service/utility có sẵn thay vì tạo trùng lặp?
- [ ] Dependency injection và interface abstraction đúng chuẩn?
- [ ] External service call (3rd party API, queue) có retry/timeout/circuit breaker?

### 5. TDD Planning

- [ ] Task được chia đủ nhỏ để mỗi item = 1 cycle Red-Green-Refactor?
- [ ] Thứ tự task hợp lý (core logic trước, integration sau)?
- [ ] Mỗi task đã xác định rõ test case đầu tiên sẽ viết là gì?
- [ ] Định nghĩa Done (DoD) cho task đã rõ ràng và đo lường được?
- [ ] Test strategy rõ cho cả unit test (service logic) và integration test (API + DB)?
- [ ] Mock/stub cho external dependency được kế hoạch hóa?

### 6. Risk & Impact

- [ ] Thay đổi có ảnh hưởng tới module/feature khác đang chạy? (regression risk)
- [ ] Có cần migration data, update config, hay thay đổi docs không?
- [ ] Security concern (auth, input validation, sensitive data) đã được cân nhắc?
- [ ] Performance impact đã được đánh giá (query cost, response time)?
- [ ] Impact tới downstream service (consumer API này) đã được thông báo?
- [ ] Log/monitoring/alert cho feature mới đã được plan?

### 7. Ready to Execute

- [ ] Plan đủ cụ thể để agent code mà không cần hỏi lại nhiều lần?
- [ ] Developer confident rằng nếu agent làm đúng plan thì output sẽ đạt yêu cầu?
- [ ] Rollback plan hoặc feature flag đã được cân nhắc (với thay đổi lớn)?

### Review Summary

```
- Critical Issues:
- Major Issues:
- Minor Issues:
- Overall Decision (OK / NOT OK): OK
- Feedback to AI Agent:
```
