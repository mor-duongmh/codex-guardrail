import { homedir } from 'node:os';

function expandHome(p) {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return homedir() + '/' + p.slice(2);
  return p;
}

export function normalizePath(token) {
  const t = String(token ?? '').replace(/^["']+|["']+$/g, '').replace(/\\/g, '/');
  return expandHome(t);
}

const SPECIAL = '.+^${}()|[]';

export function globToRegExp(pattern) {
  const p = normalizePath(pattern);
  let re = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*') {
      if (p[i + 1] === '*') {
        if (p[i + 2] === '/') { re += '(?:.*/)?'; i += 2; }
        else { re += '.*'; i += 1; }
      } else {
        re += '[^/]*';
      }
      continue;
    }
    if (c === '?') { re += '[^/]'; continue; }
    if (SPECIAL.includes(c)) { re += '\\' + c; continue; }
    re += c;
  }
  return new RegExp('^' + re + '$');
}

export function matchesAny(normalized, regexes) {
  return regexes.some(r => r.test(normalized));
}
