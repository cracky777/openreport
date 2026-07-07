// Shared modal chrome styles + card-action button factory, used by Dashboard
// and its extracted modal components. Relocated verbatim (LOT 6.3 Phase 1).

export const scheduleFieldLabel = {
  display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)',
  marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em',
};

export const actionModalBackdrop = {
  position: 'fixed', inset: 0, zIndex: 1000,
  background: 'rgba(15,23,42,0.35)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};

export const actionModalCard = {
  background: 'var(--bg-panel)', borderRadius: 10, padding: 20,
  minWidth: 360, maxWidth: 480,
  // Cap the height so tall forms (schedule editor with all its fields) don't
  // run past the viewport. The inner content scrolls when it overflows.
  maxHeight: '85vh',
  overflowY: 'auto',
  boxShadow: '0 10px 30px rgba(15,23,42,0.25)',
};

export const actionModalTitle = {
  fontSize: 15, fontWeight: 600, color: 'var(--text-primary)',
  marginBottom: 14,
};

export const actionModalInput = {
  width: '100%', padding: '8px 10px', fontSize: 13,
  background: 'var(--bg-app)', border: '1px solid var(--border-default)',
  borderRadius: 6, color: 'var(--text-primary)', outline: 'none',
  marginBottom: 14, boxSizing: 'border-box',
};

export const actionModalActions = {
  display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4,
};

export const actionModalBtnSecondary = {
  padding: '6px 14px', fontSize: 13,
  background: 'var(--bg-subtle)', border: '1px solid var(--border-default)',
  borderRadius: 8, color: 'var(--text-secondary)', cursor: 'pointer',
};

export const actionModalBtnPrimary = {
  padding: '6px 14px', fontSize: 13, fontWeight: 600,
  background: 'var(--accent-primary)', border: 'none',
  borderRadius: 8, color: '#fff', cursor: 'pointer',
  boxShadow: '0 1px 3px rgba(124,58,237,0.2)',
};

export const CARD_BTN_VARIANTS = {
  accent:  { color: 'var(--accent-primary)',  hoverBg: 'var(--accent-primary-soft)', hoverBorder: 'var(--accent-primary)' },
  success: { color: '#16a34a',                hoverBg: '#dcfce7',                    hoverBorder: '#16a34a' },
  danger:  { color: 'var(--state-danger)',    hoverBg: 'var(--state-danger-soft)',   hoverBorder: 'var(--state-danger)' },
  muted:   { color: 'var(--text-muted)',      hoverBg: 'var(--bg-hover)',            hoverBorder: 'var(--border-strong)' },
  default: { color: 'var(--text-secondary)',  hoverBg: 'var(--bg-hover)',            hoverBorder: 'var(--border-strong)' },
};

export function cardActionBtn(variant) {
  const c = CARD_BTN_VARIANTS[variant] || CARD_BTN_VARIANTS.default;
  const base = {
    // Bumped from 6px → 9px vertical so the icons have a bit more room
    // to breathe. The horizontal stays at 10px to keep the row compact.
    padding: '9px 10px', borderRadius: 8,
    background: 'var(--bg-subtle)', border: '1px solid var(--border-default)',
    color: c.color, cursor: 'pointer',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    transition: 'background 0.12s, border-color 0.12s, color 0.12s, transform 0.12s',
  };
  return {
    style: base,
    onMouseEnter: (e) => {
      e.currentTarget.style.background = c.hoverBg;
      e.currentTarget.style.borderColor = c.hoverBorder;
    },
    onMouseLeave: (e) => {
      e.currentTarget.style.background = base.background;
      e.currentTarget.style.borderColor = 'var(--border-default)';
    },
  };
}
