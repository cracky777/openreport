// The assistant's thread and composer, drawn the same before a report exists
// (StartConversation) and once the conversation is on it (AiPanel).
export const threadStyle = { flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, paddingRight: 2 };
export const composerStyle = { display: 'flex', gap: 6, alignItems: 'flex-end', marginTop: 10 };
export const inputStyle = {
  flex: 1, minHeight: 36, maxHeight: 120, resize: 'none', padding: '8px 10px', fontSize: 12, lineHeight: 1.4,
  fontFamily: 'inherit', color: 'var(--text-primary)', background: 'var(--bg-panel)',
  border: '1px solid var(--border-default)', borderRadius: 8, outline: 'none',
};
export const userBubble = {
  alignSelf: 'flex-end', maxWidth: '90%', padding: '6px 10px', borderRadius: 10, fontSize: 12, lineHeight: 1.45,
  background: 'var(--accent-primary)', color: '#fff', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
};
export const assistantBlock = { display: 'flex', flexDirection: 'column', gap: 8 };
export const assistantText = { fontSize: 12, lineHeight: 1.5, color: 'var(--text-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' };
export const thinkingStyle = { fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' };
export const sendBtn = (enabled) => ({
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, flexShrink: 0,
  border: 'none', borderRadius: 8, color: '#fff', cursor: enabled ? 'pointer' : 'default',
  background: enabled ? 'var(--accent-primary)' : 'var(--border-strong)',
});
