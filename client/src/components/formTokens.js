// Shared form primitives for the editor's side panels (widget config panel,
// data panel, SQL editor chrome). One voice for inputs/selects/buttons so
// the panels read as one design — and every color goes through the theme
// tokens, so dark mode holds. Variants compose from the base at the call
// site (e.g. `{ ...inputBase, borderColor: 'var(--accent-primary-border)' }`)
// instead of re-declaring their own metrics.

export const inputBase = {
  width: '100%', boxSizing: 'border-box',
  fontSize: 12, padding: '4px 8px',
  border: '1px solid var(--border-default)', borderRadius: 4,
  background: 'var(--bg-panel)', color: 'var(--text-primary)',
  outline: 'none',
};

// Dense variant for inline edit panels and narrow rows.
export const inputCompact = { ...inputBase, fontSize: 11, padding: '3px 6px' };

// Panel buttons — one size (10px / 2×8) so action rows line up everywhere.
export const btnPrimary = {
  fontSize: 10, fontWeight: 600, padding: '2px 8px',
  border: 'none', borderRadius: 4,
  background: 'var(--accent-primary)', color: 'var(--text-inverse)', cursor: 'pointer',
};

export const btnGhost = {
  fontSize: 10, padding: '2px 8px',
  border: '1px solid var(--border-default)', borderRadius: 4,
  background: 'var(--bg-panel)', color: 'var(--text-muted)', cursor: 'pointer',
};

// Soft accent button (secondary actions that still belong to the accent
// family: "+ Measure", "Test", …).
export const btnAccentSoft = {
  fontSize: 10, fontWeight: 600, padding: '2px 7px',
  border: '1px solid var(--accent-primary-border)', borderRadius: 4,
  background: 'var(--bg-active)', color: 'var(--accent-primary)', cursor: 'pointer',
};
