// lib/policy.mjs
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export class PolicyError extends Error {}

const DEFAULT_URL = new URL('../policy/default.json', import.meta.url);

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function mergeValue(cur, val) {
  // Type-guard: if cur has a type, val must match
  const curIsArray = Array.isArray(cur);
  const curIsPlainObj = isPlainObject(cur);
  const valIsArray = Array.isArray(val);
  const valIsPlainObj = isPlainObject(val);

  if (curIsArray && !valIsArray) {
    throw new PolicyError(`Kiểu không khớp trong policy: mong mảng, nhận ${typeof val}`);
  }
  if (curIsPlainObj && !valIsPlainObj) {
    const valType = typeof val === 'object' && val === null ? 'null' : typeof val;
    throw new PolicyError(`Kiểu không khớp trong policy: mong object, nhận ${valType}`);
  }
  if (!curIsArray && !curIsPlainObj && (valIsArray || valIsPlainObj)) {
    throw new PolicyError(`Kiểu không khớp trong policy: mong ${typeof cur}, nhận ${valIsArray ? 'array' : 'object'}`);
  }

  // Merge logic
  if (curIsArray && valIsArray) return [...new Set([...cur, ...val])];
  if (curIsPlainObj && valIsPlainObj) {
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
      // KHÔNG hướng người dùng tới `guardrail init`: subcommand đó thuộc Plan 3,
      // chưa tồn tại, nên làm theo sẽ nhận usage rồi exit 1. Chỉ đường bằng thứ
      // đang có thật.
      warnings: [`Không có ${file} — đang dùng policy mặc định. Tự tạo file đó ở gốc dự án để siết thêm rule.`],
    };
  }
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new PolicyError(`${file} sai cú pháp JSON: ${err.message}`);
  }
  if (!isPlainObject(raw)) {
    const type = Array.isArray(raw) ? 'array' : typeof raw;
    throw new PolicyError(`${file} phải là object ở root, nhận ${type}`);
  }
  return { policy: mergePolicy(base, raw), source: file, warnings: [] };
}
