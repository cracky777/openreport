// Small-screen counterpart of PagesColumn: the same pages as a horizontal,
// scrollable row of tabs above the report. Read-only by design (the editor
// never renders it) and it honours the nav's block-level styling (title,
// logo, background, font) — per-page icons/colours stay a desktop refinement.

const navStyle = {
  display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0,
  padding: '6px 8px', overflowX: 'auto', overflowY: 'hidden',
  borderBottom: '1px solid var(--border-default)',
  scrollbarWidth: 'none',
};
const headerStyle = {
  display: 'flex', alignItems: 'center', gap: 6, paddingRight: 8, marginRight: 4,
  borderRight: '1px solid var(--border-default)', flexShrink: 0,
  fontSize: 11, fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap',
};
const logoStyle = { width: 18, height: 18, objectFit: 'contain' };

export default function PagesTabs({ pages, currentPageIdx, onSwitch, config }) {
  const c = config || {};
  const showHeader = !!(c.title || c.logo);
  return (
    <nav
      className="no-print"
      aria-label="Report pages"
      style={{ ...navStyle, backgroundColor: c.bgColor || 'var(--bg-panel)', fontFamily: c.fontFamily || 'inherit' }}
    >
      {showHeader && (
        <div style={headerStyle}>
          {c.logo && <img src={c.logo} alt="" style={logoStyle} />}
          {c.title && <span>{c.title}</span>}
        </div>
      )}
      {pages.map((p, idx) => {
        const active = idx === currentPageIdx;
        return (
          <button
            key={p.id || idx}
            onClick={() => onSwitch(idx)}
            aria-current={active ? 'page' : undefined}
            style={{
              flexShrink: 0, padding: '6px 12px', borderRadius: 6, border: 'none', cursor: 'pointer',
              fontSize: c.fontSize || 12, fontWeight: active ? 600 : 500, whiteSpace: 'nowrap',
              background: active ? 'var(--bg-active)' : 'transparent',
              color: active ? 'var(--accent-primary)' : 'var(--text-muted)',
            }}
          >
            {p.name || `Page ${idx + 1}`}
          </button>
        );
      })}
    </nav>
  );
}
