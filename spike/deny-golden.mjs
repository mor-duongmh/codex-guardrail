// spike/deny-golden.mjs — Task 0: kiểm Codex render thông điệp chặn NHIỀU DÒNG thế nào.
// Dùng đúng khuôn golden của denyMessage() trong Task 10.
const reason = `✗ guardrail chặn: infra.deny-binary

  Vì sao: psql thao tác trực tiếp lên database, guardrail không cho agent tự chạy.
  Làm gì tiếp: nhờ người có quyền chạy, hoặc dùng migration đã review.

  Escape một lần (người gõ, không phải agent):
    export CODEX_GUARDRAIL_ALLOW=infra.deny-binary
  Nới vĩnh viễn: thêm vào codex-guardrail.json rồi mở PR (file có CODEOWNERS).
`;
process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason: reason,
  },
}));
process.exit(0);
