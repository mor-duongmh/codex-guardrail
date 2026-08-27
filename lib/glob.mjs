import { homedir } from 'node:os';

function expandHome(p, home) {
  if (p === '~') return home;
  if (p.startsWith('~/')) return home + '/' + p.slice(2);
  return p;
}

export function normalizePath(token, home = homedir()) {
  const t = String(token ?? '').replace(/^["']+|["']+$/g, '');
  const expanded = expandHome(t, home);
  return expanded.replace(/\\/g, '/');
}

const SPECIAL = '.+^${}()|[]';

export function globToRegExp(pattern, home = homedir()) {
  const p = normalizePath(pattern, home);
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
