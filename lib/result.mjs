export const ALLOW = Object.freeze({ decision: 'allow' });

export function deny(ruleId, reason, hint) {
  return { decision: 'deny', ruleId, reason, hint };
}

// `ask` chỉ an toàn khi hành động HIẾM. Hỏi ở một lệnh dev dùng hằng ngày sinh
// prompt fatigue, và prompt fatigue huấn luyện dev bấm qua cả confirm deploy —
// tức nó phá luôn cơ chế mà nó phục vụ. Rule nào dùng `ask` phải chứng minh được
// điều kiện hỏi là hẹp.
//
// Ở chế độ không có ai bấm, dispatch HẠ quyết định này về `deny`
// (MODES_WITH_HUMAN). Nên rule không được coi `ask` là "chắc chắn sẽ được hỏi".
export function ask(ruleId, reason, hint) {
  return { decision: 'ask', ruleId, reason, hint };
}
