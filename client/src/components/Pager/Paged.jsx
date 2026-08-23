import { useState } from 'react';
import { TbChevronLeft, TbChevronRight } from 'react-icons/tb';

// Client-side pagination for an already-loaded list. Render-prop: the child
// receives the current page's slice; the pager row renders only when the
// list is longer than one page, so short lists look exactly as before.
// `resetKey` jumps back to page 1 when the underlying dataset changes
// (e.g. the Usage window selector), not on every re-render.
export default function Paged({ items, pageSize = 20, resetKey, children }) {
  // The page is remembered together with the key it was chosen under: a
  // different key means a different dataset → page 1, without an effect.
  const [state, setState] = useState({ key: resetKey, page: 0 });
  const setPage = (p) => setState({ key: resetKey, page: p });
  const page = state.key === resetKey ? state.page : 0;
  const total = items?.length || 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const cur = Math.min(page, pages - 1);
  const slice = (items || []).slice(cur * pageSize, (cur + 1) * pageSize);
  return (
    <>
      {children(slice)}
      {total > pageSize && (
        <div style={pagerRow}>
          <span style={pagerInfo}>{cur * pageSize + 1}–{Math.min(total, (cur + 1) * pageSize)} of {total}</span>
          <button onClick={() => setPage(cur - 1)} disabled={cur === 0} style={pagerBtn(cur === 0)} aria-label="Previous page">
            <TbChevronLeft size={14} />
          </button>
          {pageNumbers(cur, pages).map((p, i) => (p === '…'
            ? <span key={`e${i}`} style={pagerEllipsis}>…</span>
            : (
              <button key={p} onClick={() => setPage(p)} style={pagerNum(p === cur)} aria-current={p === cur ? 'page' : undefined}>
                {p + 1}
              </button>
            )))}
          <button onClick={() => setPage(cur + 1)} disabled={cur >= pages - 1} style={pagerBtn(cur >= pages - 1)} aria-label="Next page">
            <TbChevronRight size={14} />
          </button>
        </div>
      )}
    </>
  );
}

// 1 … 4 5 [6] 7 8 … 20 — always the ends, a window around the current page.
function pageNumbers(cur, pages) {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i);
  const out = [0];
  const from = Math.max(1, cur - 1);
  const to = Math.min(pages - 2, cur + 1);
  if (from > 1) out.push('…');
  for (let p = from; p <= to; p++) out.push(p);
  if (to < pages - 2) out.push('…');
  out.push(pages - 1);
  return out;
}

const pagerRow = { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4, marginTop: 10 };
const pagerInfo = { fontSize: 11, color: 'var(--text-muted)', marginRight: 6 };
const pagerEllipsis = { fontSize: 12, color: 'var(--text-disabled)', padding: '0 2px' };
const pagerBtn = (disabled) => ({
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26,
  border: '1px solid var(--border-default)', borderRadius: 6, background: 'var(--bg-panel)',
  color: disabled ? 'var(--text-disabled)' : 'var(--text-secondary)', cursor: disabled ? 'default' : 'pointer',
});
const pagerNum = (active) => ({
  minWidth: 26, height: 26, padding: '0 6px', fontSize: 12, borderRadius: 6, cursor: 'pointer',
  border: '1px solid ' + (active ? 'var(--accent-primary)' : 'var(--border-default)'),
  background: active ? 'var(--bg-active)' : 'var(--bg-panel)',
  color: active ? 'var(--accent-primary)' : 'var(--text-secondary)', fontWeight: active ? 600 : 400,
});
