// spike/dump-hook.mjs — Task 0: thu payload thật mà Codex đẩy vào stdin của hook.
//
// CẢNH BÁO: file ghi ra chứa NGUYÊN VĂN stdin, có thể có đường dẫn thật và command
// thật. Phải thay bằng giá trị vô hại trước khi đưa vào tests/fixtures/ (Step 7),
// và xoá cả thư mục sau khi xong (Step 8).
//
// Luôn exit 0 — script này chỉ quan sát, không chặn gì.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.env.GUARDRAIL_SPIKE_OUT
  ?? join(process.env.HOME ?? process.env.USERPROFILE ?? '.', 'guardrail-spike');

let raw = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) raw += chunk;

mkdirSync(OUT, { recursive: true });

let name = 'unparseable';
try {
  const j = JSON.parse(raw);
  name = `${j.hook_event_name ?? 'noevent'}-${j.tool_name ?? 'notool'}`;
} catch {
  // giữ 'unparseable' — chính nó là dữ kiện: Codex đẩy thứ không phải JSON
}

writeFileSync(join(OUT, `${name}-${Date.now()}.json`), raw || '(stdin rỗng)');
process.exit(0);
