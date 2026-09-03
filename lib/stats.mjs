// lib/stats.mjs
// Gộp audit log theo rule. Không đọc file, không in — bin/ và audit.mjs làm việc
// đó; ở đây chỉ có phép đếm thuần để test được mà không cần thư mục tạm.
export function summarize(entries) {
  const byRule = new Map();
  for (const e of entries) {
    // Dòng không có ruleId vẫn phải được đếm: đánh rơi nó là báo tổng thấp hơn
    // thực tế, mà tổng là con số người ta dùng để tin hay không tin bảng này.
    const id = e.ruleId ?? '(không rõ)';
    const row = byRule.get(id) ?? { ruleId: id, denied: 0, asked: 0, escaped: 0 };
    // `asked` là decision THỨ BA mà dispatch ghi ra, thêm cùng nhóm deploy. Dồn
    // nó vào `denied` không chỉ đếm sai: chú thích dưới bảng khuyên "rule chặn
    // oan nhiều thì nới policy", nên một rule chỉ HỎI (dev bấm OK, lệnh chạy
    // bình thường) sẽ đẩy lead đi nới đúng cái rule đang làm việc đúng.
    //
    // Decision LẠ vẫn rơi vào `denied`, cùng lý do như dòng thiếu ruleId: bảng
    // lệch còn chấp nhận được, đánh rơi thì tổng thấp hơn thực tế.
    if (e.decision === 'escaped') row.escaped += 1;
    else if (e.decision === 'asked') row.asked += 1;
    else row.denied += 1;
    byRule.set(id, row);
  }
  // Sắp theo TỔNG số lần bắn, không theo riêng số lần chặn: rule bị escape suốt
  // cũng là rule cần xem lại, và nó phải nổi lên đầu bảng chứ không trôi xuống.
  const rows = [...byRule.values()]
    .sort((a, b) => (b.denied + b.asked + b.escaped) - (a.denied + a.asked + a.escaped));
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
  // `hỏi` là 3 ký tự nên phải đệm thành 4 để thẳng cột với padStart(4) bên dưới.
  const head = `${'rule'.padEnd(width)}  chặn   hỏi  escape\n`;
  const body = rows
    .map(r => `${r.ruleId.padEnd(width)}  ${String(r.denied).padStart(4)}`
      + `  ${String(r.asked).padStart(4)}  ${String(r.escaped).padStart(6)}`)
    .join('\n');
  // Nói rõ cột `hỏi` KHÔNG phải chặn oan: cả câu khuyên bên cạnh là "nới
  // policy", và nới vì một con số ở cột hỏi là nới đúng cái rule đang chạy đúng.
  return `${head}${body}\n\nTổng ${total} lần ghi. Rule chặn oan nhiều thì nới trong `
    + 'codex-guardrail.json; rule chưa bắn lần nào thì cân nhắc bỏ cho gọn.\n'
    + 'Cột `hỏi` là số lần guardrail xin xác nhận — dev bấm OK là lệnh chạy, '
    + 'nên nó KHÔNG phải chặn oan.\n';
}
