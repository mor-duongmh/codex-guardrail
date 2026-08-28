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
