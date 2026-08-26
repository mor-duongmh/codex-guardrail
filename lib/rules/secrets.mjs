import { parseCommand, basename, splitSegments } from '../tokenize.mjs';
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

  // Check each segment for env-dump patterns
  for (const segment of splitSegments(ctx.command)) {
    const trimmed = segment.trim();
    if (!trimmed) continue;

    const firstWord = trimmed.split(/\s+/)[0];

    // Any use of printenv (reads environment variables)
    if (firstWord === 'printenv') {
      return deny('secrets.env-dump',
        `"printenv" sẽ đọc biến môi trường, trong đó có thể có secret.`,
        'Đọc biến cần dùng thay vì dùng printenv, ví dụ: echo $PATH');
    }

    // Bare env (no command after env and assignments)
    if (firstWord === 'env') {
      const parsed = parseCommand(segment);
      if (parsed.length === 0) {
        return deny('secrets.env-dump',
          `"env" không tham số sẽ xả toàn bộ biến môi trường, trong đó có thể có secret.`,
          'Đọc đúng biến cần dùng, ví dụ: env PATH=/new/path command');
      }
      // Check if the first token is a redirection operator (not a real command)
      if (parsed.length > 0 && /^(>>?|<|2>>?|&>|1>)$/.test(parsed[0].argv[0])) {
        return deny('secrets.env-dump',
          `"env" với redirection sẽ xả toàn bộ biến môi trường, trong đó có thể có secret.`,
          'Đọc đúng biến cần dùng hoặc dùng bộ lọc cụ thể, ví dụ: printenv PATH');
      }
    }

    // Bare set (no arguments)
    if (firstWord === 'set') {
      const parts = trimmed.split(/\s+/);
      if (parts.length === 1) {
        return deny('secrets.env-dump',
          `Bare "set" xả shell options, có thể chứa sensitive information.`,
          'Dùng "set -e", "set -x", "set -u" nếu cần, với các tham số cụ thể.');
      }
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
