/**
 * Font-family picker with per-row typeface preview.
 *
 * A native <select> can't render each <option> in its own face on most
 * browsers, so this is a small custom dropdown: trigger button + popover
 * list. Each row paints in its own face thanks to Fontsource — selecting
 * a family triggers a Vite dynamic import for that package's CSS.
 *
 * The popover is portal'd to document.body so it survives the
 * `overflow: hidden` scroll containers in the surrounding PropertyPanel.
 * Position is computed from the trigger's bounding rect on each open.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  GOOGLE_FONTS,
  fontCategoryLabel,
  fontStack,
  loadGoogleFont,
  loadAllCuratedFonts,
} from '../../utils/googleFonts';

const _hs0 = { flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const _hs1 = { fontSize: 10, color: 'var(--text-muted)' };

const DEFAULT_VALUE = 'System default';

function buildGroups() {
  const groups = new Map();
  for (const f of GOOGLE_FONTS) {
    if (!groups.has(f.category)) groups.set(f.category, []);
    groups.get(f.category).push(f);
  }
  return [...groups.entries()];
}
const GROUPS = buildGroups();

export default function FontPicker({ value, onChange, style }) {
  const current = value || DEFAULT_VALUE;
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null); // { top, left, width }
  const triggerRef = useRef(null);
  const popRef = useRef(null);

  // Always load the current selection so the trigger button paints in face.
  useEffect(() => { loadGoogleFont(current); }, [current]);

  // Bulk-load every curated family the first time the popover opens.
  useEffect(() => { if (open) loadAllCuratedFonts(); }, [open]);

  // Compute popover position on open (and on scroll/resize while open).
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return undefined;
    const update = () => {
      const r = triggerRef.current.getBoundingClientRect();
      const POPOVER_HEIGHT = 320;
      // Min width: keeps long font names ("Cormorant Garamond", "Shadows
      // Into Light") on one line even when the trigger sits in a narrow
      // PropertyPanel column. Falls back to trigger width when wider so
      // the popover never looks puny next to its anchor.
      const POPOVER_MIN_WIDTH = 220;
      const margin = 4;
      // Flip above the trigger if the bottom would clip the viewport.
      const spaceBelow = window.innerHeight - r.bottom;
      const flip = spaceBelow < POPOVER_HEIGHT + 16 && r.top > POPOVER_HEIGHT + 16;
      const top = flip ? r.top - POPOVER_HEIGHT - margin : r.bottom + margin;
      const width = Math.max(POPOVER_MIN_WIDTH, r.width);
      // Keep the right edge inside the viewport when the popover is wider
      // than the trigger and anchored on a panel pinned to the right.
      const maxLeft = window.innerWidth - width - 8;
      const left = Math.max(8, Math.min(r.left, maxLeft));
      setPos({ top, left, width, maxHeight: POPOVER_HEIGHT });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open]);

  // Close on outside click. Both trigger and (portal'd) popover need to
  // count as "inside" so clicking a row doesn't immediately re-close.
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (triggerRef.current && triggerRef.current.contains(e.target)) return;
      if (popRef.current && popRef.current.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const choose = (family) => {
    onChange(family === DEFAULT_VALUE ? null : family);
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        onClick={() => setOpen((o) => !o)}
        style={{ ...triggerStyle, fontFamily: fontStack(current), ...style }}
      >
        <span style={_hs0}>
          {current}
        </span>
        <span style={_hs1}>▾</span>
      </button>
      {open && pos && createPortal(
        <div
          ref={popRef}
          style={{
            ...popoverStyle,
            top: pos.top,
            left: pos.left,
            width: pos.width,
            maxHeight: pos.maxHeight,
          }}
        >
          {GROUPS.map(([cat, fonts]) => (
            <div key={cat}>
              <div style={groupHeaderStyle}>{fontCategoryLabel(cat)}</div>
              {fonts.map((f) => {
                const isSelected = f.family === current;
                return (
                  <button
                    key={f.family}
                    type="button"
                    onClick={() => choose(f.family)}
                    style={{
                      ...rowStyle,
                      fontFamily: fontStack(f.family),
                      background: isSelected ? 'var(--accent-primary-soft)' : 'transparent',
                      color: isSelected ? 'var(--accent-primary)' : 'var(--text-primary)',
                      fontWeight: isSelected ? 600 : 400,
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected) e.currentTarget.style.background = 'var(--bg-hover)';
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected) e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    {f.family}
                  </button>
                );
              })}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}

const triggerStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  width: '100%',
  padding: '6px 8px',
  fontSize: 12,
  border: '1px solid var(--border-default)',
  borderRadius: 4,
  background: 'var(--bg-panel)',
  color: 'var(--text-primary)',
  cursor: 'pointer',
};

const popoverStyle = {
  position: 'fixed',
  overflowY: 'auto',
  background: 'var(--bg-panel)',
  border: '1px solid var(--border-default)',
  borderRadius: 6,
  boxShadow: '0 6px 16px rgba(0,0,0,0.12)',
  zIndex: 9999,
};

const groupHeaderStyle = {
  position: 'sticky',
  top: 0,
  background: 'var(--bg-subtle)',
  padding: '4px 10px',
  fontSize: 10,
  fontWeight: 700,
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  borderBottom: '1px solid var(--border-default)',
};

const rowStyle = {
  display: 'block',
  width: '100%',
  padding: '6px 12px',
  fontSize: 13,
  border: 'none',
  textAlign: 'left',
  cursor: 'pointer',
  transition: 'background 0.12s',
  // Keep names on one line; truncate with ellipsis if the row is still
  // too narrow for the chosen face (display fonts can be quite wide).
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};
