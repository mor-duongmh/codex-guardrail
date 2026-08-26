// lib/policy.mjs
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export class PolicyError extends Error {}

const DEFAULT_URL = new URL('../policy/default.json', import.meta.url);

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function mergeValue(cur, val) {
  if (Array.isArray(cur) && Array.isArray(val)) return [...new Set([...cur, ...val])];
  if (isPlainObject(cur) && isPlainObject(val)) {
    const out = { ...cur };
    for (const [k, v] of Object.entries(val)) out[k] = k in cur ? mergeValue(cur[k], v) : v;
    return out;
  }
  return val;
}

export function mergePolicy(base, override) {
  return mergeValue(base, override ?? {});
}

export function loadDefaultPolicy() {
  return JSON.parse(readFileSync(DEFAULT_URL, 'utf8'));
}

export function findProjectRoot(startDir) {
  let dir = resolve(startDir ?? '.');
  for (;;) {
    if (existsSync(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function loadPolicy(projectRoot) {
  const base = loadDefaultPolicy();
  if (!projectRoot) {
    return {
      policy: base,
      source: null,
      warnings: ['Không tìm được thư mục .git từ cwd — đang dùng policy mặc định.'],
    };
  }
  const file = join(projectRoot, 'codex-guardrail.json');
  if (!existsSync(file)) {
    return {
      policy: base,
      source: null,
      warnings: [`Không có ${file} — đang dùng policy mặc định. Chạy "guardrail init" để sinh.`],
    };
  }
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new PolicyError(`${file} sai cú pháp JSON: ${err.message}`);
  }
  return { policy: mergePolicy(base, raw), source: file, warnings: [] };
}
