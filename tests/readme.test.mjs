import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TRUST_NOTICE } from '../lib/install.mjs';

// Vì sao có file này: bốn yêu cầu của README là yêu cầu về HÀNH VI của tài liệu,
// không phải về lời văn — và một tài liệu đúng hôm nay không có gì giữ cho nó
// đúng ngày mai. `tests/install.test.mjs` đã quét `bypass|dangerous`, nhưng nó
// chỉ quét `lib/install.mjs` và `bin/guardrail.mjs`; README KHÔNG nằm trong danh
// sách đó, nên trước file này không có gì chặn một lần sửa README thêm hướng dẫn
// tắt cơ chế tin cậy.

const README = readFileSync(
  fileURLToPath(new URL('../README.md', import.meta.url)), 'utf8');

test('README dạy cấp tin cậy /hooks NGAY CẠNH lệnh cài, không đẩy xuống mục troubleshooting', () => {
  // Cùng MỘT nguồn văn bản với `install` và `doctor`: ba chỗ nói khác nhau về
  // cùng một bước là ba chỗ để dev nghi ngờ mình đọc sai chỗ nào.
  assert.ok(README.includes(TRUST_NOTICE),
    'README phải trích nguyên văn TRUST_NOTICE của lib/install.mjs');

  const lines = README.split('\n');
  const install = lines.findIndex(l => l.includes('bin/guardrail.mjs install'));
  // Mốc là DÒNG ĐẦU của khối trust, không phải chuỗi '/hooks' bất kỳ: '/hooks'
  // còn là hậu tố của '~/.codex/hooks.json' ở ngay đoạn mô tả `install`, nên đo
  // theo nó thì việc đẩy cả khối trust xuống mục troubleshooting cuối trang vẫn
  // xanh — đã kiểm bằng mutation test và đúng là nó sống sót.
  const notice = lines.findIndex(l => l.includes(TRUST_NOTICE.split('\n')[0]));
  assert.ok(install >= 0, 'README phải có lệnh cài');
  assert.ok(lines.some(l => l.includes('Gõ: /hooks')), 'README phải nói bước /hooks');
  // Codex bỏ qua IM LẶNG mọi hook chưa được cấp tin cậy. Dev đọc README, cài,
  // rồi bỏ qua phần còn lại là chuyện thường — nên bước này phải ở trong tầm
  // mắt của lệnh cài, không phải ở cuối trang.
  assert.ok(Math.abs(notice - install) < 30,
    `khối trust cách lệnh cài ${Math.abs(notice - install)} dòng — quá xa để dev đọc thấy`);
});

test('README không dạy dev tắt cơ chế tin cậy hook', () => {
  // Cờ tắt tin cậy chỉ dành cho spike/CI của chính guardrail. Dạy dev tắt nó là
  // dạy họ vô hiệu hoá đúng cơ chế bảo vệ họ khỏi hook lạ của tool khác.
  assert.ok(!/bypass/i.test(README), 'README nhắc tới cách tắt cơ chế tin cậy');
  assert.ok(!/dangerous/i.test(README), 'README nhắc tới cách tắt cơ chế tin cậy');
});

test('README gọi đúng tên tool thật của Codex', () => {
  // Đã đo ở Task 0: matcher là `Bash` và `apply_patch`. Không phải `shell` —
  // matcher sai thì hook không bao giờ khớp và Codex không báo gì cả.
  assert.match(README, /`Bash`/);
  assert.match(README, /`apply_patch`/);
});

test('README ghi mục giới hạn đã biết, gồm bốn mục đụng tới dev nhiều nhất', () => {
  assert.match(README, /## Giới hạn đã biết/);
  const section = README.slice(README.indexOf('## Giới hạn đã biết'));
  // Bốn mục này spec §15 nói rõ là ghi vào README, không che. Kiểm bằng dấu vết
  // KHÔNG THỂ viết đúng mà thiếu nội dung — không phải bằng tiêu đề mục.
  assert.match(section, /cố tình lách/, 'thiếu: không chống người cố tình lách');
  assert.match(section, /python -c/, 'thiếu: interpreter -c/-e đọc được file');
  assert.match(section, /\.zshrc|\.bashrc/, 'thiếu: escape cài bền vững qua file rc của shell');
  assert.match(section, /VỊ TRÍ/,
    'thiếu: bản ghi trust gắn với vị trí entry nên tool khác cài sau có thể vô hiệu hoá guardrail');
});

test('README ghi đủ giới hạn của nhóm deploy', () => {
  const section = README.slice(README.indexOf('## Giới hạn đã biết'));
  // Ba mục này là ba chỗ nhóm deploy KHÔNG bảo vệ được, và cả ba đều dễ bị hiểu
  // ngược thành "đã bảo vệ". Kiểm bằng dấu vết không thể viết đúng mà thiếu nội
  // dung, không bằng tiêu đề.
  assert.match(section, /NGOÀI thư mục dự án/,
    'thiếu: mở Codex ngoài thư mục dự án thì đường script không được bảo vệ');
  assert.match(section, /trình thông dịch/,
    'thiếu: danh sách trình thông dịch không thể đầy đủ');
  assert.match(section, /SUBCOMMAND|subcommand/,
    'thiếu: netlify/firebase/railway chặn theo subcommand nên subcommand mới sẽ lọt');
});

test('README nói rõ nhóm deploy là allow-list nên chưa khai thì không cưỡng chế', () => {
  // Đây là chỗ dễ đọc ngược nhất: bốn nhóm kia bảo vệ ngay từ bản mặc định, nên
  // dev sẽ mặc định cho rằng deploy cũng vậy.
  assert.match(README, /allow-list/);
  assert.match(README, /không cưỡng chế gì tới khi dự án khai/);
});

test('README KHÔNG hứa rằng confirm nhóm B chắc chắn hiện ra', () => {
  // `ask` chưa từng được quan sát đi hết một vòng trong Codex. Tới khi đó, README
  // được nói "thiết kế để hỏi", không được nói "sẽ hỏi".
  const claims = README.match(/[^.\n]*confirm[^.\n]*/gi) ?? [];
  for (const c of claims) {
    assert.ok(!/\bsẽ (luôn )?hỏi\b/.test(c), `README hứa quá mức: "${c.trim()}"`);
  }
});
