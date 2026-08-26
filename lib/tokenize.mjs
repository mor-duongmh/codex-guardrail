// lib/tokenize.mjs
// Tách command string của shell thành các lệnh con để rule soi được.
// Cố ý KHÔNG phải shell parser đầy đủ: đủ để bắt tai nạn và agent hớ hênh,
// không đủ để chống người cố tình lách (spec mục 15, giới hạn 1).

const SHELL_WRAPPERS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh']);
const MAX_DEPTH = 3;

export function basename(token) {
  const t = String(token ?? '').replace(/^["']+|["']+$/g, '');
  const parts = t.split(/[/\\]/);
  return parts[parts.length - 1];
}

export function tokenize(segment) {
  const out = [];
  let cur = '';
  let has = false;
  let quote = null;
  for (let i = 0; i < segment.length; i++) {
    const c = segment[i];
    if (quote) {
      if (c === quote) { quote = null; continue; }
      cur += c; has = true; continue;
    }
    if (c === '"' || c === "'") { quote = c; has = true; continue; }
    if (c === '\\' && i + 1 < segment.length) { cur += segment[++i]; has = true; continue; }
    if (/\s/.test(c)) { if (has) { out.push(cur); cur = ''; has = false; } continue; }
    cur += c; has = true;
  }
  if (has) out.push(cur);
  return out;
}

export function splitSegments(command) {
  const segs = [];
  let cur = '';
  let quote = null;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote) { cur += c; if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") { quote = c; cur += c; continue; }
    if (c === '\\' && i + 1 < command.length) { cur += c + command[++i]; continue; }
    const two = command.slice(i, i + 2);
    if (two === '&&' || two === '||') { segs.push(cur); cur = ''; i++; continue; }
    if (c === ';' || c === '|' || c === '\n' || c === '&') { segs.push(cur); cur = ''; continue; }
    cur += c;
  }
  segs.push(cur);
  return segs.map(s => s.trim()).filter(Boolean);
}

function stripAssignments(argv) {
  let i = 0;
  if (argv[i] === 'env') i++;
  while (i < argv.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(argv[i])) i++;
  return argv.slice(i);
}

function substitutions(segment) {
  const found = [];
  const re = /\$\(([^()]*)\)|`([^`]*)`/g;
  let m;
  while ((m = re.exec(segment)) !== null) found.push(m[1] ?? m[2]);
  return found.filter(s => s && s.trim());
}

export function parseCommand(command, depth = 0) {
  if (typeof command !== 'string' || depth > MAX_DEPTH) return [];
  const subs = [];
  for (const seg of splitSegments(command)) {
    const argv = stripAssignments(tokenize(seg));
    if (argv.length > 0) subs.push({ argv, raw: seg });

    for (const inner of substitutions(seg)) {
      subs.push(...parseCommand(inner, depth + 1));
    }

    if (argv.length === 0) continue;
    const bin = basename(argv[0]);
    let inner = null;
    if (SHELL_WRAPPERS.has(bin)) {
      const idx = argv.indexOf('-c');
      if (idx >= 0 && argv[idx + 1]) inner = argv[idx + 1];
    } else if (bin === 'eval') {
      inner = argv.slice(1).join(' ');
    }
    if (inner) subs.push(...parseCommand(inner, depth + 1));
  }
  return subs;
}
