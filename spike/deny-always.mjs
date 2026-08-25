// spike/deny-always.mjs — Task 0 Step 5: kiểm câu hỏi sống còn của cả thiết kế.
//
// Hook này LUÔN chặn. Mục đích duy nhất: xem Codex có coi exit code non-zero của
// PreToolUse là một deny thật hay không, và có đưa stderr cho model đọc hay không.
//
// Ba kết quả có thể (ghi vào docs/superpowers/spikes/):
//   A — Codex không chạy lệnh VÀ thấy dòng stderr dưới đây  → thiết kế đúng
//   B — Codex không chạy lệnh, KHÔNG thấy stderr            → phải đổi kênh truyền lý do
//   C — Codex vẫn chạy lệnh                                 → DỪNG PLAN
process.stderr.write(
  'SPIKE: guardrail chặn lệnh này (deny-always). '
  + 'Nếu bạn đọc được dòng này thì stderr tới được model.\n'
);
process.exit(2);
