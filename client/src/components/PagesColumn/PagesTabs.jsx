import { useState } from 'react';
import { navFont, navStateColors, pageIconOf } from '../../utils/pageNav';

// The pages as a horizontal row of tabs above the report: the small-screen
// counterpart of PagesColumn, and the menu itself when the report puts it on
// top (`pageNav.position`, set by the author or the designer assistant).
// Read-only by design (the editor never renders it); it honours the menu's
// look — title, logo, colors by state, font, an icon per page by name. An
// uploaded per-page image stays a column refinement.

const navBase = {
  display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0,
  padding: '6px 8px', overflowX: 'auto', overflowY: 'hidden',
  scrollbarWidth: 'none',
};
const headerBase = {
  display: 'flex', alignItems: 'center', gap: 6, paddingRight: 10, marginRight: 6,
  flexShrink: 0, fontWeight: 700, whiteSpace: 'nowrap',
};
// The bar's logo at the menu's height (logoSize), as wide as it is.
const logoStyle = (size, plate) => ({
  height: (size || 22) + (plate ? 8 : 0), width: 'auto', maxWidth: 240, objectFit: 'contain', boxSizing: 'border-box',
  ...(plate ? { background: plate, padding: '4px 8px', borderRadius: 6 } : {}),
});

export default function PagesTabs({ pages, currentPageIdx, onSwitch, config }) {
  const c = config || {};
  const [hoverIdx, setHoverIdx] = useState(null);
  const showHeader = !!(c.title || c.logo);
  const fontSize = c.fontSize || 12;
  const edgeColor = c.borderColor || 'var(--border-default)';
  const justify = { center: 'center', right: 'flex-end' }[c.headerAlign] || 'flex-start';
  return (
    <nav
      className="no-print"
      aria-label="Report pages"
      style={{
        ...navBase,
        justifyContent: justify,
        borderBottom: `1px solid ${edgeColor}`,
        backgroundColor: c.bgColor || 'var(--bg-panel)',
        fontFamily: navFont(c.fontFamily),
      }}
    >
      {showHeader && (
        <div style={{ ...headerBase, fontSize: fontSize + 1, color: c.titleColor || 'var(--text-primary)', borderRight: `1px solid ${edgeColor}` }}>
          {c.logo && <img src={c.logo} alt="" style={logoStyle(c.logoSize, c.logoBgColor)} />}
          {c.title && <span>{c.title}</span>}
        </div>
      )}
      {pages.map((p, idx) => {
        const active = idx === currentPageIdx;
        const state = active ? 'active' : hoverIdx === idx ? 'hover' : 'default';
        const { bg, text } = navStateColors(c, state);
        const Glyph = pageIconOf(c, p.id);
        return (
          <button
            key={p.id || idx}
            onClick={() => onSwitch(idx)}
            onMouseEnter={() => setHoverIdx(idx)}
            onMouseLeave={() => setHoverIdx(null)}
            aria-current={active ? 'page' : undefined}
            style={{
              flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 6,
              height: c.buttonSize || 30, padding: '0 12px', borderRadius: c.itemRadius ?? 6, border: 'none', cursor: 'pointer',
              fontFamily: 'inherit', fontSize, whiteSpace: 'nowrap',
              fontWeight: active ? Math.max(600, c.fontWeight || 0) : (c.fontWeight || 500),
              background: bg, color: text,
            }}
          >
            {Glyph && <Glyph size={Math.round(fontSize * 1.3)} aria-hidden="true" />}
            {p.name || `Page ${idx + 1}`}
          </button>
        );
      })}
    </nav>
  );
}
