export const ALLOW = Object.freeze({ decision: 'allow' });

export function deny(ruleId, reason, hint) {
  return { decision: 'deny', ruleId, reason, hint };
}
