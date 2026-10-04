// The look every action card shares (ActionCard, StartCards).
export const cardStyle = {
  display: 'flex', flexDirection: 'column', gap: 10, padding: 12, borderRadius: 12,
  background: 'var(--bg-app)', border: '1px solid var(--border-default)',
};
export const rowStyle = { display: 'flex', gap: 10, alignItems: 'flex-start' };
export const iconStyle = { flexShrink: 0, marginTop: 1, color: 'var(--accent-primary)' };
export const titleStyle = { fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.35 };
export const subStyle = { fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.4, marginTop: 2 };
export const selectStyle = {
  width: '100%', boxSizing: 'border-box', padding: '6px 8px', fontSize: 12, borderRadius: 7,
  border: '1px solid var(--border-default)', background: 'var(--bg-panel)', color: 'var(--text-primary)',
};
export const actionsStyle = { display: 'flex', justifyContent: 'flex-end', gap: 6 };
export const quietBtn = {
  padding: '6px 11px', fontSize: 12, borderRadius: 8, cursor: 'pointer',
  border: '1px solid var(--border-default)', background: 'transparent', color: 'var(--text-muted)',
};
export const applyBtn = (active) => ({
  display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 11px', fontSize: 12, fontWeight: 600,
  border: 'none', borderRadius: 8, color: '#fff', background: 'var(--accent-primary)',
  cursor: active ? 'pointer' : 'default', opacity: active ? 1 : 0.5,
});
export const doneStyle = { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: 'var(--state-success)' };
