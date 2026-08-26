// spike/deny-json.mjs — Task 0: kiểm kênh deny có cấu trúc (ưu tiên hơn exit code 2).
// Luôn chặn, exit 0 — nếu Codex tôn trọng permissionDecision thì lệnh không chạy
// và permissionDecisionReason phải hiện ra cho model đọc.
process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason:
      'SPIKE_JSON_REASON_MARKER: guardrail chan lenh nay qua kenh JSON.'
  }
}));
process.exit(0);
