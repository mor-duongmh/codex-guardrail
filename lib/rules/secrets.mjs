import { parseCommand, basename, splitSegments } from '../tokenize.mjs';
import { globToRegExp, normalizePath, matchesAny } from '../glob.mjs';
import { ALLOW, deny } from '../result.mjs';

// Sensitive environment variable patterns (reused from redact.mjs philosophy)
const SENSITIVE_ENV_VARS = /^AWS_|_SECRET|_TOKEN|_PASSWORD|_KEY|_CREDENTIALS/i;

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

    // Extract first word, handling cases with operators but no spaces (env>/tmp/dump.txt)
    const firstWord = trimmed.split(/[\s>&|;]+/)[0];

    // printenv with sensitive variable name
    if (firstWord === 'printenv') {
      const parts = trimmed.split(/\s+/);
      if (parts.length > 1) {
        // printenv with variable argument - only block if variable name is sensitive
        const varName = parts[1];
        if (SENSITIVE_ENV_VARS.test(varName)) {
          return deny('secrets.env-dump',
            `"printenv ${varName}" đọc biến môi trường nhạy cảm.`,
            'Lấy giá trị bằng tay hoặc dùng biến đã inject sẵn, không dùng printenv.');
        }
      } else {
        // Bare printenv - dumps all environment variables
        return deny('secrets.env-dump',
          `"printenv" không tham số sẽ xả toàn bộ biến môi trường, trong đó có thể có secret.`,
          'Đọc biến cần dùng thay vì dùng printenv, ví dụ: echo $PATH');
      }
    }

    // env with redirection or bare (including no-space variants like env>file, env>>file)
    if (firstWord === 'env') {
      // Check for redirection patterns without space (env>file, env>>file, env&>file, etc.)
      if (/^env(>>?|&>|[12]?>)/.test(trimmed)) {
        return deny('secrets.env-dump',
          `"env" với redirection sẽ xả toàn bộ biến môi trường, trong đó có thể có secret.`,
          'Đọc đúng biến cần dùng hoặc dùng bộ lọc cụ thể, ví dụ: env PATH=/new/path command');
      }

      // Check for bare env or env with only assignments (no actual command)
      const parsed = parseCommand(segment);
      if (parsed.length === 0) {
        return deny('secrets.env-dump',
          `"env" không tham số sẽ xả toàn bộ biến môi trường, trong đó có thể có secret.`,
          'Đọc đúng biến cần dùng, ví dụ: env PATH=/new/path command');
      }
      
      // Check for redirection operators with space (env > file, env >> file, etc.)
      if (/^env\s+(>>?|&>|[12]?>)/.test(trimmed)) {
        return deny('secrets.env-dump',
          `"env" với redirection sẽ xả toàn bộ biến môi trường, trong đó có thể có secret.`,
          'Đọc đúng biến cần dùng hoặc dùng bộ lọc cụ thể, ví dụ: env PATH=/new/path command');
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
    for (const token of sub.argv.slice(1)) {
      if (isSensitive(token)) {
        return deny('secrets.read-path',
          `Lệnh chạm đường dẫn nhạy cảm "${token}".`, HINT);
      }
    }
  }

  // Check manager-read patterns on parsed commands (not raw string)
  for (const sub of parseCommand(ctx.command)) {
    const bin = basename(sub.argv[0]);

    // Check for secret manager operations
    if (bin === 'aws' && sub.raw.includes('secretsmanager')) {
      return deny('secrets.manager-read',
        'Lệnh đọc secret từ AWS Secrets Manager.',
        'Lấy giá trị đó bằy tay ngoài phiên Codex, hoặc dùng biến môi trường đã inject sẵn.');
    }
    if (bin === 'gcloud' && sub.raw.includes('secrets')) {
      return deny('secrets.manager-read',
        'Lệnh đọc secret từ Google Cloud Secrets.',
        'Lấy giá trị đó bằng tay ngoài phiên Codex, hoặc dùng biến môi trường đã inject sẵn.');
    }
    if (bin === 'vault' && /\bread\b/.test(sub.raw)) {
      return deny('secrets.manager-read',
        'Lệnh đọc secret từ HashiCorp Vault.',
        'Lấy giá trị đó bằng tay ngoài phiên Codex, hoặc dùng biến môi trường đã inject sẵn.');
    }
    if (bin === 'op' && /\bread\b/.test(sub.raw)) {
      return deny('secrets.manager-read',
        'Lệnh đọc secret từ 1Password.',
        'Lấy giá trị đó bằng tay ngoài phiên Codex, hoặc dùng biến môi trường đã inject sẵn.');
    }
    if (bin === 'kubectl' && sub.raw.includes('secret')) {
      return deny('secrets.manager-read',
        'Lệnh đọc secret từ Kubernetes.',
        'Lấy giá trị đó bằng tay ngoài phiên Codex, hoặc dùng biến môi trường đã inject sẵn.');
    }
  }

  return ALLOW;
}
