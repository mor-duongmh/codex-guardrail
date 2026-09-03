import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand } from '../lib/tokenize.mjs';
import { effectiveArgv } from '../lib/argv.mjs';

const eff = (command) =>
  parseCommand(command).map(s => effectiveArgv(s.argv)).filter(a => a.length > 0);

test('bóc trình thông dịch shell để lộ script thật', () => {
  const cases = [
    ['bash scripts/deploy.sh prod', ['scripts/deploy.sh', 'prod']],
    ['sh ./scripts/deploy.sh prod', ['./scripts/deploy.sh', 'prod']],
    ['zsh scripts/deploy.sh', ['scripts/deploy.sh']],
    ['source ./scripts/deploy.sh prod', ['./scripts/deploy.sh', 'prod']],
    ['. ./scripts/deploy.sh', ['./scripts/deploy.sh']],
    ['sudo bash scripts/deploy.sh prod', ['scripts/deploy.sh', 'prod']],
    ['bash -x scripts/deploy.sh prod', ['scripts/deploy.sh', 'prod']],
    ['npx bash scripts/deploy.sh prod', ['scripts/deploy.sh', 'prod']],
    ['pwsh ./deploy.ps1', ['./deploy.ps1']],
  ];
  for (const [command, expected] of cases) {
    assert.deepEqual(eff(command)[0], expected, command);
  }
});

test('không bóc khi shell không chạy script', () => {
  // `bash` trần: bóc xong argv rỗng, mọi rule đã chặn nhánh argv rỗng
  assert.deepEqual(eff('bash'), []);
  // `./script.sh` có basename là script.sh, không phải `.` — không được coi là sourcer
  assert.deepEqual(eff('./deploy.sh prod')[0], ['./deploy.sh', 'prod']);
});

// --- A4: wrapper chạy-lệnh không phải shell -------------------------------
// Đo trước khi sửa: `env`/`sudo`/`nice`/`time`/`npx` bóc được, còn cả sáu dạng
// dưới đây ĐI VÒNG toàn bộ deny-list với `aws s3 ls`. Mỗi entry ở đây là thứ
// KHÔNG bao giờ là lệnh thật cần chạy — nó chỉ bọc một lệnh khác.
test('bóc wrapper chạy-lệnh không phải shell', () => {
  const cases = [
    ['xargs aws s3 ls', ['aws', 's3', 'ls']],
    ['xargs -n 1 aws s3 ls', ['aws', 's3', 'ls']],
    ['xargs -0 aws s3 ls', ['aws', 's3', 'ls']],
    ['timeout 5 aws s3 ls', ['aws', 's3', 'ls']],
    ['timeout 30s aws s3 ls', ['aws', 's3', 'ls']],
    ['timeout -k 5 10 aws s3 ls', ['aws', 's3', 'ls']],
    ['nohup aws s3 ls', ['aws', 's3', 'ls']],
    ['exec aws s3 ls', ['aws', 's3', 'ls']],
    ['stdbuf -o0 aws s3 ls', ['aws', 's3', 'ls']],
    ['stdbuf -o 0 aws s3 ls', ['aws', 's3', 'ls']],
    ['watch -n 5 aws s3 ls', ['aws', 's3', 'ls']],
  ];
  for (const [command, expected] of cases) {
    assert.deepEqual(eff(command)[0], expected, command);
  }
});

// `timeout` ăn một POSITIONAL, không phải cờ — nên nó cần cơ chế riêng. Nhưng
// bóc theo SỐ LƯỢNG positional thì `timeout aws s3 ls` (gọi sai, thiếu duration)
// bị ăn mất `aws` và cả denylist trượt. Chỉ ăn token trông đúng là thời lượng.
test('timeout chỉ ăn token thời lượng, không ăn tên binary', () => {
  assert.deepEqual(eff('timeout aws s3 ls')[0], ['aws', 's3', 'ls']);
});

// `command` cố ý KHÔNG phải wrapper: `command -v psql` là lệnh dò công cụ vô
// hại và rất phổ biến, bóc nó ra là chặn oan. Ghim lại để lần sau không ai
// "thêm cho đủ bộ".
test('command KHÔNG phải wrapper', () => {
  assert.deepEqual(eff('command -v psql')[0], ['command', '-v', 'psql']);
});
