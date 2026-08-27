#!/usr/bin/env node
// bin/guardrail.mjs
import { fileURLToPath } from 'node:url';
import { runHook } from '../lib/dispatch.mjs';

const USAGE = 'Cách dùng: guardrail <hook|install|uninstall|init|doctor|stats>\n'
  + '  hook       đọc payload Codex từ stdin và quyết định chặn hay cho qua\n'
  + '  install    wire hook vào ~/.codex/hooks.json (merge, có backup)\n'
  + '  uninstall  gỡ đúng entry của guardrail\n'
  + '  init       sinh codex-guardrail.json bằng cách suy ra từ repo\n'
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
} else if (sub === 'install' || sub === 'uninstall') {
  const { install, uninstall } = await import('../lib/install.mjs');
  const sourceDir = fileURLToPath(new URL('../', import.meta.url));
  const res = sub === 'install' ? install({ sourceDir }) : uninstall();
  // Nhánh lỗi ra stderr, đúng nếp nhánh USAGE bên dưới: `guardrail install > log`
  // vẫn phải thấy lý do từ chối.
  const sink = res.ok ? process.stdout : process.stderr;
  for (const m of res.messages) sink.write(`${res.ok ? '✓' : '✗'} ${m}\n`);
  // Khối trust in NGUYÊN VĂN, không gắn tiền tố `✓` từng dòng: nó là hướng dẫn
  // nhiều dòng, và nó là việc CÒN LẠI, không phải việc đã xong.
  if (res.trustNotice) process.stdout.write(`\n${res.trustNotice}\n`);
  // Vẫn là process.exitCode, không process.exit(). Đo lại trên máy này với stdout
  // là pipe: exit() nhận 8192/300000 byte, exitCode nhận đủ 300000. Ở cỡ output
  // của install (~1KB) thì exit() cũng qua được, nên đây chưa phải bug — nhưng
  // exitCode không có ngưỡng nào để vượt, và giữ một nếp cho cả file thì không ai
  // phải nhớ "nhánh nào thì được dùng exit()".
  process.exitCode = res.ok ? 0 : 1;
} else if (sub === 'init') {
  // import() ĐỘNG, không import top-level: hook chạy trên mọi tool call và
  // tests/latency.test.mjs ghim ngân sách đó, nên module chỉ subcommand này cần
  // không được nạp trên đường hook.
  const { initProject } = await import('../lib/init.mjs');
  const { findProjectRoot } = await import('../lib/policy.mjs');
  // Ghi ở GỐC REPO, không ở cwd: policy áp cho cả dự án, và `guardrail init`
  // gõ từ một thư mục con mà sinh file ở đó thì file đó không bao giờ được
  // loadPolicy đọc — findProjectRoot chỉ tìm lên tới `.git`.
  const root = findProjectRoot(process.cwd());
  if (!root) {
    process.stderr.write('✗ Không tìm được thư mục .git từ cwd — '
      + 'chạy guardrail init trong một repo git.\n');
    process.exitCode = 1;
  } else {
    const res = initProject({ cwd: root });
    const sink = res.ok ? process.stdout : process.stderr;
    sink.write(`${res.lines.join('\n')}\n`);
    process.exitCode = res.ok ? 0 : 1;
  }
} else if (sub === 'doctor') {
  const { diagnose } = await import('../lib/doctor.mjs');
  const res = diagnose(process.cwd());
  process.stdout.write(`${res.lines.join('\n')}\n`);
  // Vẫn là process.exitCode, không process.exit(). Output của doctor dài hơn
  // install nhiều vì có cả khối trust, và trên macOS stdout khi là pipe ghi
  // không đồng bộ — exit() cắt cụt (đã đo: 8192/300000 byte). `guardrail doctor
  // | tee log` mất chẩn đoán là mất đúng thứ duy nhất subcommand này sinh ra.
  process.exitCode = res.ok ? 0 : 1;
} else if (sub === 'stats') {
  const { readEntries } = await import('../lib/audit.mjs');
  const { summarize, formatStats } = await import('../lib/stats.mjs');
  process.stdout.write(formatStats(summarize(readEntries())));
  // Bảng rỗng không phải lỗi: `stats` chỉ báo cáo, việc phán "có vấn đề" là của
  // doctor. Trả mã khác 0 ở đây sẽ làm mọi `guardrail stats` trong CI đỏ oan.
  process.exitCode = 0;
} else {
  process.stderr.write(USAGE);
  process.exitCode = 1;
}
