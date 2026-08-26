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
];

export function redact(text) {
  let out = String(text ?? '');
  for (const { re, mask } of PATTERNS) out = out.replace(re, mask);
  return out;
}

export function findSecretKinds(text) {
  const s = String(text ?? '');
  return PATTERNS.filter(({ re }) => new RegExp(re.source).test(s)).map(p => p.kind);
}
