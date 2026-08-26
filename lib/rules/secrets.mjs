import { parseCommand, basename } from '../tokenize.mjs';
import { globToRegExp, normalizePath, matchesAny } from '../glob.mjs';
import { ALLOW, deny } from '../result.mjs';

const ENV_DUMP = new Set(['env', 'printenv', 'set']);

const MANAGER_READ = [
  /\baws\s+secretsmanager\s+get-secret-value\b/,
  /\bgcloud\s+secrets\s+versions\s+access\b/,
  /\bvault\s+read\b/,
  /\bop\s+read\b/,
  /\bkubectl\s+get\s+secret\b/,
];

const HINT = 'Nếu thật sự cần, dùng .env.example, hoặc thêm đường dẫn vào '
  + 'secrets.allowPaths trong codex-guardrail.json (file có CODEOWNERS).';

export function evaluate(ctx, policy) {
  const cfg = policy.secrets ?? {};
  const denyRes = (cfg.denyPaths ?? []).map(globToRegExp);
  const allowRes = (cfg.allowPaths ?? []).map(globToRegExp);
  if (denyRes.length === 0) return ALLOW;

  const isSensitive = (token) => {
    const p = normalizePath(token);
    if (matchesAny(p, allowRes)) return false;
    return matchesAny(p, denyRes);
  };

  if (ctx.tool === 'apply_patch') {
    for (const f of ctx.patchFiles ?? []) {
      if (isSensitive(f)) {
        return deny('secrets.write-path',
          `apply_patch định ghi vào file nhạy cảm "${f}".`, HINT);
      }
    }
    return ALLOW;
  }

  if (!ctx.command) return ALLOW;

  // Check for bare env/printenv/set that dump all environment variables
  if (/^\s*(env|printenv|set)\s*(?:;|&&|\|\||$)/.test(ctx.command)) {
    const match = ctx.command.match(/^\s*(env|printenv|set)/);
    if (match) {
      const bin = match[1];
      return deny('secrets.env-dump',
        `"${bin}" không tham số sẽ xả toàn bộ biến môi trường, trong đó có thể có secret.`,
        'Đọc đúng biến cần dùng, ví dụ: printenv PATH');
    }
  }

  for (const sub of parseCommand(ctx.command)) {
    const bin = basename(sub.argv[0]);
    for (const token of sub.argv.slice(1)) {
      if (isSensitive(token)) {
        return deny('secrets.read-path',
          `Lệnh chạm đường dẫn nhạy cảm "${token}".`, HINT);
      }
    }
  }

  for (const re of MANAGER_READ) {
    if (re.test(ctx.command)) {
      return deny('secrets.manager-read',
        'Lệnh đọc secret từ secret manager.',
        'Lấy giá trị đó bằng tay ngoài phiên Codex, hoặc dùng biến môi trường đã inject sẵn.');
    }
  }

  return ALLOW;
}
