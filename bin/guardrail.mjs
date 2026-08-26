#!/usr/bin/env node
// bin/guardrail.mjs
import { runHook } from '../lib/dispatch.mjs';

const USAGE = 'Cách dùng: guardrail <hook|install|uninstall|doctor|stats>\n'
  + '  hook       đọc payload Codex từ stdin và quyết định chặn hay cho qua\n'
  + '  install    wire hook vào ~/.codex/hooks.json (merge, có backup)\n'
  + '  uninstall  gỡ đúng entry của guardrail\n'
  + '  doctor     kiểm tra wiring và in rule đang hiệu lực\n'
  + '  stats      tổng hợp audit log theo rule\n';

async function readStdin() {
  let raw = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) raw += chunk;
  return raw;
}

const sub = process.argv[2];

if (sub === 'hook') {
  const raw = await readStdin();
  const { stdout, stderr } = runHook(raw, process.env);
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
  // LUÔN kết thúc mã 0: quyết định nằm trong JSON ở stdout, không nằm ở exit code.
  //
  // KHÔNG dùng process.exit(0) như bản nháp trong plan. Trên macOS, stdout khi
  // là pipe được ghi KHÔNG ĐỒNG BỘ, và process.exit() phá handle trước khi
  // libuv đẩy xong. Đã đo trên máy này: reader háo hức chỉ nhận 8192/300000
  // byte, reader chậm 250ms nhận 0 byte. Mất stdout là mất CHÍNH CÁI DENY, và
  // Codex thấy JSON hỏng thì CHO LỆNH CHẠY — đúng lỗ mà guardrail sinh ra để bịt.
  // Gán exitCode rồi để Node kết thúc tự nhiên thì stdout flush xong mới thoát;
  // stdin đã EOF và mọi việc còn lại đều đồng bộ nên không handle nào giữ event loop.
  process.exitCode = 0;
} else {
  process.stderr.write(USAGE);
  process.exitCode = 1;
}
