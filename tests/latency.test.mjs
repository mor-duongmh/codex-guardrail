import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Ngân sách §13: hook PreToolUse chạy trên MỌI tool call, nên p95 < 150ms.
//
// ---------------------------------------------------------------------------
// Vì sao SPAWN THẬT, không gọi runHook trong tiến trình
// ---------------------------------------------------------------------------
// Mỗi lần Codex gọi hook là một process Node MỚI, nên cold start LÀ phần lớn
// ngân sách. Đo trong tiến trình cho ~0.1ms (allow) / ~5ms (deny) — số đúng
// nhưng vô nghĩa: nó xanh vĩnh viễn kể cả khi cold start đội lên gấp mấy lần.
//
// ---------------------------------------------------------------------------
// Vì sao có phép đo BASELINE, và vì sao baseline là một FILE .mjs rỗng
// ---------------------------------------------------------------------------
// Test này chạy trên 3 OS x 3 phiên bản Node, trên runner chậm và bị chia sẻ
// CPU. Một ngưỡng tuyệt đối đơn độc thì hoặc lỏng tới mức vô dụng, hoặc flaky.
// Nên mỗi vòng đo thêm một lần `node <file rỗng>` để biết SÀN của chính máy đó
// lúc đó; phần dôi ra là chi phí thật của guardrail, và nó không phụ thuộc máy
// nhanh hay chậm.
//
// Baseline là file .mjs rỗng chứ KHÔNG phải `node -e 0`, vì `-e` có đường khởi
// động khác. Đo được trên máy này (p95, macOS arm64):
//
//     phiên bản   node -e 0    node noop.mjs
//     v20.19.2      15.3           17.1
//     v22.22.2      19.1           20.1
//     v24.10.0      20.7           21.6
//
// `-e` nhanh hơn một chút ở mọi phiên bản, tức nó KHÔNG phải sàn của cách hook
// thật được gọi (Codex chạy `node <path> hook`). Dùng `-e` làm baseline là trừ
// đi một con số nhỏ hơn thực tế, tức báo phần dôi to hơn thực tế.
//
// ---------------------------------------------------------------------------
// Vì sao có một spawn "MỒI" bị BỎ ở đầu mỗi vòng
// ---------------------------------------------------------------------------
// Đây là thứ tốn nhiều phép đo nhất để tìm ra, và bỏ nó đi thì test này SAI
// trên Node 24. Khi luân phiên nhiều loại spawn trong một vòng, loại đứng ĐẦU
// vòng bị phạt ~+27ms trên Node 24 (macOS) — phạt theo VỊ TRÍ, không theo loại.
// Đo được (p95, v24.10.0, đổi loại đứng đầu qua 4 lượt):
//
//     đứng đầu vòng      chính nó   khi không đứng đầu
//     node -e 0            47.1            20.8
//     node noop.mjs        47.4            21.6
//     hook allow           54.9            29.1
//
// Node 20 không có hiện tượng này (mọi thứ tự đều cho cùng số). Hệ quả nếu
// không xử lý: bản đầu của test này đo baseline ở vị trí đầu vòng, nên trên
// Node 24 baseline = 46.4ms trong khi hook = 29.0ms → phần dôi RA SỐ ÂM, và
// assert phần dôi trở thành no-op ÂM THẦM đúng trên phiên bản Node mới nhất.
// Một spawn mồi bị bỏ ở đầu vòng hút hết hình phạt đó; sau khi thêm, ba phép đo
// khớp nhau trên cả ba phiên bản (bảng ở dưới).
//
// ---------------------------------------------------------------------------
// Số đo và ngưỡng
// ---------------------------------------------------------------------------
// Máy dev rảnh (macOS arm64, 10 core), p95, có spawn mồi:
//
//     phiên bản   baseline   allow   deny   dôi allow   dôi deny
//     v20.19.2      17.4     26.0   34.6      8.6        17.2
//     v22.22.2      19.5     28.7   36.3      9.2        16.8
//     v24.10.0      21.6     29.2   37.4      7.6        15.8
//
// Phần dôi ổn định 7.1–10.0ms (allow) và 15.6–17.5ms (deny) qua cả ba phiên bản
// — đó là lý do tin được nó khi so ngưỡng. Chênh allow↔deny là một spawn `git`
// (lấy branch cho audit, đo riêng: ~6ms) cộng một lần ghi audit.
//
// Ba chế độ máy đã đo, và ngưỡng phải sống được ở cả ba:
//
//     chế độ máy                          dôi allow    dôi deny
//     rảnh                                 7.1–10.0    15.6–17.5
//     CPU chia đôi (20 proc / 10 core)       18.3         35.9
//     vừa ra khỏi bão hoà kéo dài          13.5–17.4    74.8–80.7
//
// Hàng thứ ba là hàng đắt nhất và dễ bỏ sót nhất: đo NGAY SAU khi máy chạy 40
// tiến trình quay CPU trong nhiều phút, load average 1 phút đã về 3 nhưng 5/15
// phút vẫn 15+. Ở chế độ đó đường DENY dôi tới 80.7ms trong khi đường allow gần
// như không đổi — tức ngưỡng deny 80ms (giá trị chọn ban đầu) ĐỎ OAN, và đã đỏ
// thật một lần trong lúc làm task này. Runner CI dùng chung máy vật lý thì đúng
// ở chế độ đó. Bài học: đừng chốt ngưỡng từ phép đo trên máy vừa bị vắt.
//
// Khi CPU bị chia bốn thì `node` rỗng đã mất 92ms và cả ngân sách 150ms là bất
// khả — lúc đó test đỏ là thông tin đúng, không phải nhiễu.
//
// Ngưỡng chọn: tuyệt đối lấy nguyên 150ms của spec; phần dôi 60ms (allow) và
// 150ms (deny) — khoảng 2x giá trị tệ nhất từng đo, và 6–9x mức rảnh. Đủ rộng
// để không đỏ oan ở cả ba chế độ, đủ chặt để bắt hồi quy hạng "đường allow tự
// nhiên spawn thêm process" hoặc "đường deny gọi thêm một lệnh git nữa".
//
// Thẳng thắn về giới hạn của ngưỡng này: nó KHÔNG bắt được hồi quy nhỏ. Đã đo
// bằng mutation test — thêm `import '../lib/doctor.mjs'` vào top-level của
// bin/guardrail.mjs (đúng cái plan dặn phải tránh) chỉ tốn +0.9ms và test vẫn
// xanh. Muốn chặt hơn thì phải hiệu chuẩn riêng từng runner; đánh đổi đó không
// đáng trên ma trận 9 ô, và một test độ trễ flaky thì tệ hơn một test lỏng.

const BIN = fileURLToPath(new URL('../bin/guardrail.mjs', import.meta.url));

// Nới được bằng env để CI (runner chậm hơn máy dev nhiều, Windows spawn đắt hơn
// Linux nhiều) không phải xoá test — xem .github/workflows/test.yml.
const BUDGET_MS = Number(process.env.GUARDRAIL_LATENCY_BUDGET_MS ?? 150);
const ALLOW_OVERHEAD_MS = Number(process.env.GUARDRAIL_LATENCY_ALLOW_OVERHEAD_MS ?? 60);
const DENY_OVERHEAD_MS = Number(process.env.GUARDRAIL_LATENCY_DENY_OVERHEAD_MS ?? 150);

// 40 vòng: p95 nearest-rank rơi vào mẫu 38/40, còn 2 mẫu nằm trên. Bản nháp
// trong plan dùng 20 vòng, cho p95 = mẫu 19/20 — chỉ MỘT mẫu nằm trên, nên
// "p95" đó thực chất là "gần max" và một lần scheduler hụt là đỏ. Đó đúng là
// kiểu test độ trễ làm cả team mất niềm tin vào CI.
// 40 vòng x 4 spawn = 160 process, ~5s. Đây là test chậm nhất của suite; giữ
// trong `npm test` là có ý (xem ghi chú cuối file).
const RUNS = 40;
const WARMUP = 4;

const payload = (cwd, command) => JSON.stringify({
  hook_event_name: 'PreToolUse', tool_name: 'Bash', cwd, tool_input: { command },
});

// nearest-rank, không nội suy — nội suy trên 40 mẫu chỉ tạo cảm giác chính xác giả.
function p95(times) {
  const s = [...times].sort((a, b) => a - b);
  return s[Math.ceil(0.95 * s.length) - 1];
}

test(`p95 một lần gọi hook dưới ${BUDGET_MS}ms, và phần dôi so với Node cold start trong ngân sách`, (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'guardrail-lat-'));
  // findProjectRoot dừng ở .git đầu tiên, nên hook đọc policy của repo TẠM này
  // chứ không phải của repo guardrail — phép đo không đổi khi ai đó thêm
  // codex-guardrail.json vào gốc repo.
  mkdirSync(join(dir, '.git'));
  const noop = join(dir, 'noop.mjs');
  writeFileSync(noop, 'process.exitCode = 0;\n');

  const env = {
    ...process.env,
    // KHÔNG ghi vào ~/.codex: đường deny có record() nên test này SẼ ghi audit.
    GUARDRAIL_AUDIT_PATH: join(dir, 'audit.jsonl'),
    // Escape đang bật trong shell của dev sẽ biến đường deny thành đường
    // escaped — mất luôn ca đắt nhất mà test vẫn xanh.
    CODEX_GUARDRAIL_ALLOW: '',
  };

  function timed(args, input) {
    const t0 = process.hrtime.bigint();
    const r = spawnSync(process.execPath, args, {
      input, encoding: 'utf8', env, timeout: 30000,
    });
    return { ms: Number(process.hrtime.bigint() - t0) / 1e6, r };
  }

  const allowIn = payload(dir, 'npm test');
  const denyIn = payload(dir, 'terraform apply');

  // Vài vòng đầu trả tiền cho cache filesystem và dyld — không phải độ trễ dev
  // gặp, vì hook chạy hàng trăm lần mỗi phiên.
  for (let i = 0; i < WARMUP; i++) {
    timed([noop], '');
    timed([BIN, 'hook'], allowIn);
    timed([BIN, 'hook'], denyIn);
  }

  const base = [];
  const allow = [];
  const deny = [];
  for (let i = 0; i < RUNS; i++) {
    timed([noop], '');       // MỒI — bỏ, hút hình phạt vị trí đầu vòng
    base.push(timed([noop], '').ms);

    const a = timed([BIN, 'hook'], allowIn);
    allow.push(a.ms);
    // Đo mà không kiểm nội dung là đo một no-op: biến `hook` thành lệnh không
    // làm gì thì mọi ngưỡng ở đây xanh rực trong khi guardrail chặn 0 thứ.
    // Literal dán cứng, không import hằng số — sửa lời văn phải làm đỏ.
    assert.equal(a.r.status, 0);
    assert.equal(a.r.stdout, '', 'lệnh vô hại phải KHÔNG sinh output nào');

    const d = timed([BIN, 'hook'], denyIn);
    deny.push(d.ms);
    assert.equal(d.r.status, 0, 'exit code không phải kênh chặn — phải luôn 0');
    // Kiểm rỗng TRƯỚC khi parse: nếu không, một hook đã ngừng chặn sẽ đỏ bằng
    // `SyntaxError: Unexpected end of JSON input`, thông điệp không nói được
    // rằng guardrail vừa CHO QUA một lệnh đáng chặn.
    assert.ok(d.r.stdout.length > 0,
      'đường deny KHÔNG sinh JSON nào ra stdout — guardrail vừa cho qua `terraform apply`');
    const out = JSON.parse(d.r.stdout).hookSpecificOutput;
    assert.equal(out.permissionDecision, 'deny');
    assert.ok(
      out.permissionDecisionReason.includes('infra.deny-binary'),
      'đường deny phải chạy hết chuỗi rule, không được short-circuit thành no-op',
    );
  }

  const b = p95(base);
  const a = p95(allow);
  const d = p95(deny);
  const report = `p95: allow=${a.toFixed(1)}ms deny=${d.toFixed(1)}ms `
    + `node-cold-start=${b.toFixed(1)}ms (n=${RUNS})\n`
    + `  phần dôi của guardrail: allow=${(a - b).toFixed(1)}ms deny=${(d - b).toFixed(1)}ms\n`
    + '  Đọc hai dòng trên trước khi sửa gì: baseline cao (máy/runner đang tải) thì hai\n'
    + '  cột p95 phình theo mà phần dôi vẫn nhỏ — đó là nhiễu, không phải hồi quy.';

  // In cả khi XANH: một ngân sách chỉ được biết tới lúc nó đỏ thì không ai thấy
  // được đà trượt. TAP giữ dòng này trong log mọi lần CI chạy, nên lần CI đầu
  // tiên là chỗ đọc số thật của từng runner để siết ngưỡng lại.
  t.diagnostic(report.split('\n')[0]);
  t.diagnostic(report.split('\n')[1].trim());

  assert.ok(a < BUDGET_MS,
    `allow ${report}\n  allow p95 vượt ngân sách ${BUDGET_MS}ms. Hook chạy trên MỌI tool call `
    + 'nên đây là lỗi thật, không phải test khó tính.');
  assert.ok(d < BUDGET_MS,
    `deny ${report}\n  deny p95 vượt ngân sách ${BUDGET_MS}ms.`);

  assert.ok(a - b < ALLOW_OVERHEAD_MS,
    `${report}\n  Phần dôi của đường ALLOW vượt ${ALLOW_OVERHEAD_MS}ms. Baseline đo cùng lúc `
    + 'nên đây KHÔNG phải máy chậm — có gì đó mới nạp trên đường allow. Nghi phạm số một: '
    + 'import top-level trong bin/guardrail.mjs hoặc lib/dispatch.mjs mà chỉ subcommand '
    + 'khác cần (install/doctor/stats đang dùng await import() động chính vì lý do này).');
  assert.ok(d - b < DENY_OVERHEAD_MS,
    `${report}\n  Phần dôi của đường DENY vượt ${DENY_OVERHEAD_MS}ms. Đường deny trả thêm `
    + 'một spawn `git` (lấy branch cho audit) và một lần ghi audit; nếu số này nhảy, '
    + 'kiểm xem có rule nào mới spawn process hoặc đọc file trên đường đó.');
});

// Vì sao test này NẰM TRONG `npm test` chứ không tách riêng: đã đo, không suy
// diễn. Chạy một mình cho allow p95 = 26.2 / deny 34.8; chạy chung cả suite
// (node --test chạy song song các file test) cho 26.3 / 35.2 — chênh trong sai
// số. Lý do: file này chạy ~5s còn 13 file kia xong trong ~0.5s, nên 90% mẫu
// được lấy lúc máy đã rảnh và p95 không bị kéo. `--test-concurrency=1` cũng đã
// thử: cùng số, mà suite chậm thêm 1.4s — không mua được gì.
// Cái giá thật là `npm test` đi từ 0.5s lên ~5s. Đổi lại: một ngân sách chỉ
// được kiểm khi có người nhớ chạy `npm run test:latency` là một ngân sách sẽ
// trượt. Ai cần vòng lặp nhanh thì vẫn chạy được từng file.
