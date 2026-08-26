// lib/stats.mjs
// Gộp audit log theo rule. Không đọc file, không in — bin/ và audit.mjs làm việc
// đó; ở đây chỉ có phép đếm thuần để test được mà không cần thư mục tạm.
export function summarize(entries) {
  const byRule = new Map();
  for (const e of entries) {
    // Dòng không có ruleId vẫn phải được đếm: đánh rơi nó là báo tổng thấp hơn
    // thực tế, mà tổng là con số người ta dùng để tin hay không tin bảng này.
    const id = e.ruleId ?? '(không rõ)';
    const row = byRule.get(id) ?? { ruleId: id, denied: 0, escaped: 0 };
    if (e.decision === 'escaped') row.escaped += 1; else row.denied += 1;
    byRule.set(id, row);
  }
  // Sắp theo TỔNG số lần bắn, không theo riêng số lần chặn: rule bị escape suốt
  // cũng là rule cần xem lại, và nó phải nổi lên đầu bảng chứ không trôi xuống.
  const rows = [...byRule.values()]
    .sort((a, b) => (b.denied + b.escaped) - (a.denied + a.escaped));
  return { rows, total: entries.length };
}

export function formatStats({ rows, total }) {
  if (total === 0) {
    // Log rỗng có HAI nghĩa trái ngược — chưa chặn lần nào, hoặc hook không chạy
    // vì chưa được tin cậy. Không được để người đọc tự suy ra nghĩa dễ chịu hơn.
    return 'Audit log chưa có dữ liệu — guardrail chưa chặn lần nào, '
      + 'hoặc chưa được cài đúng (chạy: guardrail doctor).\n';
  }
  const width = Math.max(...rows.map(r => r.ruleId.length), 8);
  const head = `${'rule'.padEnd(width)}  chặn  escape\n`;
  const body = rows
    .map(r => `${r.ruleId.padEnd(width)}  ${String(r.denied).padStart(4)}  ${String(r.escaped).padStart(6)}`)
    .join('\n');
  return `${head}${body}\n\nTổng ${total} lần ghi. Rule chặn oan nhiều thì nới trong `
    + 'codex-guardrail.json; rule chưa bắn lần nào thì cân nhắc bỏ cho gọn.\n';
}
