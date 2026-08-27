// Giá trị sau flag/key dùng chung nguyên tắc trong toàn bộ file này: nếu bọc
// trong quote, bắt tới quote đóng tương ứng (chấp nhận khoảng trắng bên
// trong); nếu quote mở nhưng KHÔNG đóng (lệnh méo), che tới hết chuỗi — ưu
// tiên che thừa hơn để lộ phần giá trị dở dang; nếu không có quote, dừng ở
// khoảng trắng (hoặc thêm `=` vào exclude cho -p, giữ hành vi base64-padding
// cũ).
function valueSrc(exclude = '') {
  return `(?:'[^']*'|"[^"]*"|'[^']*$|"[^"]*$|[^\\s${exclude}]+)`;
}

const PATTERNS = [
  { kind: 'aws-access-key-id', re: /AKIA[0-9A-Z]{16}/g, mask: 'AKIA***' },
  { kind: 'openai-key', re: /\bsk-[A-Za-z0-9_-]{20,}/g, mask: 'sk-***' },
  { kind: 'github-token', re: /\b(?:ghp|gho|ghu|ghs)_[A-Za-z0-9]{20,}/g, mask: 'gh_***' },
  { kind: 'github-pat', re: /\bgithub_pat_[A-Za-z0-9_]{20,}/g, mask: 'github_pat_***' },
  { kind: 'slack-token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g, mask: 'xox_***' },
  {
    kind: 'jwt',
    re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/g,
    mask: 'jwt.***',
  },
  {
    kind: 'private-key',
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    mask: '***private-key***',
  },
  {
    kind: 'url-userinfo',
    re: /([a-z][a-z0-9+.-]*):\/\/([^:\/]+):([^@]+)@/gi,
    mask: '$1://$2:***@',
  },
  {
    kind: 'password-flag-long',
    re: new RegExp(`--password=${valueSrc()}`, 'g'),
    mask: '--password=***',
  },
  {
    kind: 'password-flag-space',
    re: new RegExp(`--password\\s+${valueSrc()}`, 'g'),
    mask: '--password ***',
  },
  {
    kind: 'password-flag-p',
    re: new RegExp(`(?<![a-z-])-p${valueSrc('=')}`, 'g'),
    mask: '-p***',
  },
  {
    kind: 'env-sensitive',
    re: new RegExp(`\\b(.*?_(SECRET|TOKEN|PASSWORD|KEY|CREDENTIALS|PASS))=${valueSrc()}`, 'gi'),
    mask: '$1=***',
  },
  {
    // Header nằm trọn trong MỘT cặp quote (thường gặp khi truyền qua
    // curl -H '...'): quote không nằm sát giá trị (sau Bearer/Basic) mà bọc
    // cả "Authorization: Scheme value", nên phải bắt bằng backreference tới
    // đúng loại quote mở đầu, không dùng valueSrc() (vốn chỉ xử lý quote sát
    // giá trị).
    kind: 'auth-header-quoted',
    re: /(['"])Authorization:\s*(Bearer|Basic)\s+(?:[^'"]*\1|[^'"]*$)/gi,
    mask: 'Authorization: $2 ***',
  },
  {
    kind: 'auth-header',
    re: new RegExp(`Authorization:\\s*(Bearer|Basic)\\s+${valueSrc()}`, 'gi'),
    mask: 'Authorization: $1 ***',
  },
];

export function redact(text) {
  let out = String(text ?? '');
  for (const { re, mask } of PATTERNS) out = out.replace(re, mask);
  return out;
}

export function findSecretKinds(text) {
  const s = String(text ?? '');
  return PATTERNS.filter(({ re }) => new RegExp(re.source, re.flags).test(s)).map(p => p.kind);
}
