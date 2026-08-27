import { parseCommand, basename, splitSegments } from '../tokenize.mjs';
import { effectiveArgv } from '../argv.mjs';
import { globToRegExp, normalizePath, matchesAny } from '../glob.mjs';
import { ALLOW, deny } from '../result.mjs';

const SENSITIVE_ENV_VARS = /(^|_)(PASSWORD|PASSWD|SECRET|TOKEN|APIKEY|CREDENTIALS)(_|$)/i;
const AWS_PREFIX = /^AWS_/;

const MANAGER_READ = [
  /\baws\s+secretsmanager\s+get-secret-value\b/,
  /\bgcloud\s+secrets\s+versions\s+access\b/,
  /\bvault\s+read\b/,
  /\bop\s+read\b/,
  /\bkubectl\s+get\s+secret\b/,
];

const HINT = 'Nếu thật sự cần, dùng .env.example, hoặc thêm đường dẫn vào '
  + 'secrets.allowPaths trong codex-guardrail.json (file có CODEOWNERS).';

function extractSubstitutions(segment) {
  const subs = [];
  let m = /\$\(([^()]*)\)/.exec(segment);
  if (m) subs.push(m[1]);
  m = /`([^`]*)`/.exec(segment);
  if (m) subs.push(m[1]);
  if (/^\s*\([^()]*\)/.test(segment)) {
    m = /\(([^()]*)\)/.exec(segment);
    if (m) subs.push(m[1]);
  }
  return subs;
}

function checkEnvDump(command) {
  // Check parsed commands
  const parsed = parseCommand(command);
  
  for (const sub of parsed) {
    // Các nhánh dưới đây soi argv theo VỊ TRÍ (`argv[0]` là binary, `argv[1]` là
    // tham số đầu), nên một tiền tố wrapper đẩy mọi vị trí đi một bước và rule
    // không được cưỡng chế: `sudo printenv PASSWORD` và `npx env` từng LỌT hẳn.
    // `secrets` là rule duy nhất còn sót vì nó viết TRƯỚC khi lib/argv.mjs được
    // tách ra — ba rule kia đã đi qua đây từ Task 7/8.
    const argv = effectiveArgv(sub.argv);
    if (argv.length === 0) continue;
    const bin = basename(argv[0]);

    if (bin === 'env') {
      if (argv.length === 1) {
        return deny('secrets.env-dump',
          `"env" không tham số sẽ xả toàn bộ biến môi trường, trong đó có thể có secret.`,
          'Đọc đúng biến cần dùng, ví dụ: env PATH=/new/path command');
      }
      if (/^(>>?|<|2>>?|&>|1>)$/.test(argv[1])) {
        return deny('secrets.env-dump',
          `"env" với redirection sẽ xả toàn bộ biến môi trường, trong đó có thể có secret.`,
          'Đọc đúng biến cần dùng hoặc dùng bộ lọc cụ thể, ví dụ: env PATH=/new/path command');
      }
    }
    
    if (bin === 'printenv') {
      if (argv.length === 1) {
        return deny('secrets.env-dump',
          `"printenv" không tham số sẽ xả toàn bộ biến môi trường, trong đó có thể có secret.`,
          'Đọc biến cần dùng thay vì dùng printenv, ví dụ: echo $PATH');
      }
      const varName = argv[1];
      if (SENSITIVE_ENV_VARS.test(varName) || AWS_PREFIX.test(varName)) {
        return deny('secrets.env-dump',
          `"printenv ${varName}" đọc biến môi trường nhạy cảm.`,
          'Lấy giá trị bằng tay hoặc dùng biến đã inject sẵn, không dùng printenv.');
      }
    }
    
    if (bin === 'set' && argv.length === 1) {
      return deny('secrets.env-dump',
        `Bare "set" xả shell options, có thể chứa sensitive information.`,
        'Dùng "set -e", "set -x", "set -u" nếu cần, với các tham số cụ thể.');
    }
  }
  
  // Check segments for bare commands and extracted substitutions
  for (const segment of splitSegments(command)) {
    const trimmed = segment.trim();
    if (!trimmed) continue;
    
    // Check for env with redirections
    if (/^env(>>?|&>|[12]?>)/.test(trimmed)) {
      return deny('secrets.env-dump',
        `"env" với redirection sẽ xả toàn bộ biến môi trường, trong đó có thể có secret.`,
        'Đọc đúng biến cần dùng hoặc dùng bộ lọc cụ thể, ví dụ: env PATH=/new/path command');
    }
    if (/^env\s+(>>?|&>|[12]?>)/.test(trimmed)) {
      return deny('secrets.env-dump',
        `"env" với redirection sẽ xả toàn bộ biến môi trường, trong đó có thể có secret.`,
        'Đọc đúng biến cần dùng hoặc dùng bộ lọc cụ thể, ví dụ: env PATH=/new/path command');
    }
    
    // Check for printenv with redirections
    if (/^printenv(>>?|&>|[12]?>)/.test(trimmed)) {
      return deny('secrets.env-dump',
        `"printenv" với redirection sẽ xả toàn bộ biến môi trường, trong đó có thể có secret.`,
        'Đọc biến cần dùng thay vì dùng printenv, ví dụ: echo $PATH');
    }
    if (/^printenv\s+(>>?|&>|[12]?>)/.test(trimmed)) {
      return deny('secrets.env-dump',
        `"printenv" với redirection sẽ xả toàn bộ biến môi trường, trong đó có thể có secret.`,
        'Đọc biến cần dùng thay vì dùng printenv, ví dụ: echo $PATH');
    }
    
    // Check for bare env/printenv/set at segment level
    if (trimmed === 'env' || trimmed === 'printenv' || trimmed === 'set') {
      const msg = trimmed === 'env' ? '"env" không tham số sẽ xả toàn bộ biến môi trường, trong đó có thể có secret.' :
                  trimmed === 'printenv' ? '"printenv" không tham số sẽ xả toàn bộ biến môi trường, trong đó có thể có secret.' :
                  'Bare "set" xả shell options, có thể chứa sensitive information.';
      return deny('secrets.env-dump', msg, 
        trimmed === 'set' ? 'Dùng "set -e", "set -x", "set -u" nếu cần.' : 'Đọc biến cần dùng thay vì dùng ' + trimmed);
    }
    
    // Check printenv with sensitive variable at segment level
    if (trimmed.startsWith('printenv ')) {
      const varName = trimmed.substring(9).trim().split(/\s+/)[0];
      if (SENSITIVE_ENV_VARS.test(varName) || AWS_PREFIX.test(varName)) {
        return deny('secrets.env-dump',
          `"printenv ${varName}" đọc biến môi trường nhạy cảm.`,
          'Lấy giá trị bằng tay hoặc dùng biến đã inject sẵn, không dùng printenv.');
      }
    }
    
    // Check extracted substitutions
    for (const subContent of extractSubstitutions(segment)) {
      const subTrimmed = subContent.trim();
      
      // Check for bare env/printenv/set in extracted content
      if (subTrimmed === 'env' || subTrimmed === 'printenv' || subTrimmed === 'set') {
        const msg = subTrimmed === 'env' ? '"env" không tham số sẽ xả toàn bộ biến môi trường, trong đó có thể có secret.' :
                    subTrimmed === 'printenv' ? '"printenv" không tham số sẽ xả toàn bộ biến môi trường, trong đó có thể có secret.' :
                    'Bare "set" xả shell options, có thể chứa sensitive information.';
        return deny('secrets.env-dump', msg, 
          subTrimmed === 'set' ? 'Dùng "set -e", "set -x", "set -u" nếu cần.' : 'Đọc biến cần dùng thay vì dùng ' + subTrimmed);
      }
      
      // Check printenv with sensitive var in extracted content
      if (subTrimmed.startsWith('printenv ')) {
        const varName = subTrimmed.substring(9).trim().split(/\s+/)[0];
        if (SENSITIVE_ENV_VARS.test(varName) || AWS_PREFIX.test(varName)) {
          return deny('secrets.env-dump',
            `"printenv ${varName}" đọc biến môi trường nhạy cảm.`,
            'Lấy giá trị bằng tay hoặc dùng biến đã inject sẵn, không dùng printenv.');
        }
      }
      
      // Recursively check nested substitutions
      const subResult = checkEnvDump(subContent);
      if (subResult) return subResult;
    }
  }
  
  return null;
}

export function evaluate(ctx, policy) {
  const cfg = policy.secrets ?? {};
  // Gọi qua lambda: `.map(globToRegExp)` truyền INDEX của Array.map vào tham số
  // thứ hai `home` của globToRegExp, nên mọi pattern `~/...` nở ra thành thư mục
  // tên đúng bằng chỉ số đó. Đã đo trên policy mặc định: `~/.aws/**` thành
  // `^1\/\.aws\/.*$`, và `cat ~/.kube/config`, `cat ~/.config/gcloud/x.json`,
  // `cat ~/.docker/config.json` LỌT. `~/.aws/credentials` và `~/.ssh/id_rsa`
  // vẫn chặn, nhưng nhờ pattern basename (`**/credentials`, `**/id_rsa`) trùng
  // khớp tình cờ — chính sự trùng khớp đó đã che lỗi này.
  const denyRes = (cfg.denyPaths ?? []).map((p) => globToRegExp(p));
  const allowRes = (cfg.allowPaths ?? []).map((p) => globToRegExp(p));
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

  const envDumpResult = checkEnvDump(ctx.command);
  if (envDumpResult) return envDumpResult;

  for (const sub of parseCommand(ctx.command)) {
    for (const token of sub.argv.slice(1)) {
      if (isSensitive(token)) {
        return deny('secrets.read-path',
          `Lệnh chạm đường dẫn nhạy cảm "${token}".`, HINT);
      }
    }
  }

  for (const sub of parseCommand(ctx.command)) {
    // Cùng lý do như checkEnvDump: soi theo vị trí thì wrapper đẩy vị trí đi.
    // `vault` và `op` không nằm trong infra.denyBinaries nên KHÔNG có rule nào
    // đỡ nếu ở đây lọt; còn aws/gcloud/kubectl thì infra đỡ được nhưng báo
    // `infra.deny-binary`, tức nới rule đó để dùng `aws s3 ls` sẽ mở lại cả
    // đường đọc secret.
    const argv = effectiveArgv(sub.argv);
    if (argv.length === 0) continue;
    const bin = basename(argv[0]);

    if (bin === 'aws' && sub.raw.includes('secretsmanager')) {
      return deny('secrets.manager-read',
        'Lệnh đọc secret từ AWS Secrets Manager.',
        'Lấy giá trị đó bằng tay ngoài phiên Codex, hoặc dùng biến môi trường đã inject sẵn.');
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
