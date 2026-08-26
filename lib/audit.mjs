import { appendFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { redact } from './redact.mjs';

export function auditPath() {
  return process.env.GUARDRAIL_AUDIT_PATH
    ?? join(homedir(), '.codex', 'guardrail-audit.jsonl');
}

export function record(entry) {
  try {
    const payload = { ts: new Date().toISOString(), ...entry };
    if (payload.command) payload.command = redact(payload.command);
    const p = auditPath();
    mkdirSync(dirname(p), { recursive: true });
    appendFileSync(p, JSON.stringify(payload) + '\n');
  } catch {
    // Ghi log thất bại không được chặn công việc của dev.
  }
}

export function readEntries() {
  const p = auditPath();
  if (!existsSync(p)) return [];
  const out = [];
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* bỏ dòng hỏng */ }
  }
  return out;
}
