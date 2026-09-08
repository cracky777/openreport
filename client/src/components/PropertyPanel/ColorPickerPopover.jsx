import { useEffect, useRef, useState } from 'react';
import { TbColorPicker } from 'react-icons/tb';
import { createPortal } from 'react-dom';
import { hexToHsv, hsvToHex, normalizeHex } from '../../utils/colorConvert';
import { getRecentColors, pushRecentColor, subscribeRecentColors } from '../../utils/recentColors';

/**
 * The colour picker that opens on a swatch — ours, not the operating system's.
 *
 * The native `<input type="color">` dialog opens on whichever tab the browser
 * last remembered (RGB, more often than not) and a page cannot tell it to do
 * otherwise. Owning the panel is the only way to put hex first, which is the
 * form a report's colours are written down and shared in.
 *
 * Layout, top to bottom: the hex field and the eyedropper, the saturation
 * square, the hue slider, then the colours picked recently.
 *
 * Rendered into <body>, not next to its swatch: the property panel scrolls, and
 * an absolutely-positioned child of a scroll box is clipped by it — the panel
 * showed the hex field and swallowed everything under it.
 */

// The eyedropper the browser's own colour dialog used to provide. Exposed
// separately as window.EyeDropper (Chromium only), so the button is offered
// when the API is there and simply absent when it is not — Firefox and Safari
// would otherwise show a control that does nothing.
const HAS_EYEDROPPER = typeof window !== 'undefined' && typeof window.EyeDropper === 'function';

const PRESETS = [
  '#0f172a', '#64748b', '#e2e8f0', '#ffffff',
  '#7c3aed', '#2563eb', '#0891b2', '#059669',
  '#65a30d', '#ca8a04', '#ea580c', '#dc2626',
];

export default function ColorPickerPopover({ value, onChange, onClose, allowTransparent, anchorRect, onAnchorHit }) {
  const isTransparent = value === 'transparent' || value === '';
  const initial = hexToHsv(isTransparent ? '#ffffff' : value) || { h: 0, s: 0, v: 0 };
  const [hsv, setHsv] = useState(initial);
  // The hex field holds a draft while it is being typed: "#7c3" is on the way
  // to a colour, not a colour, so it must not be pushed to the widget yet.
  const [draft, setDraft] = useState(null);
  const [recents, setRecents] = useState(getRecentColors);
  useEffect(() => subscribeRecentColors(setRecents), []);

  const ref = useRef(null);
  const hex = hsvToHex(hsv);

  // Placed against the swatch, flipped above it when the window's bottom edge
  // is nearer than the panel is tall. MAX_HEIGHT is an upper bound rather than
  // a measurement: measuring would mean rendering, reading, then moving, and
  // the panel would visibly jump on every open.
  const a = anchorRect || { top: 0, bottom: 0, left: 0 };
  const openBelow = a.bottom + 4 + MAX_HEIGHT <= window.innerHeight - 8;
  const pos = {
    top: openBelow ? a.bottom + 4 : Math.max(8, a.top - MAX_HEIGHT - 4),
    left: Math.min(Math.max(8, a.left), window.innerWidth - WIDTH - 8),
  };

  // Close on an outside click or Escape — a popover that traps the panel would
  // be worse than the dialog it replaces. The swatch is excluded so its own
  // click toggles rather than closing and reopening.
  useEffect(() => {
    const onDown = (e) => {
      if (ref.current && ref.current.contains(e.target)) return;
      // The swatch itself toggles; letting the outside-click handler fire
      // there would close and immediately reopen the panel.
      if (onAnchorHit && onAnchorHit(e.target)) return;
      onClose();
    };
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose, onAnchorHit]);

  const apply = (nextHsv) => {
    const nextHex = hsvToHex(nextHsv);
    setHsv(nextHsv);
    setDraft(null);
    onChange(nextHex);
    return nextHex;
  };

  // Both the square and the slider are dragged, so they share one gesture:
  // read the pointer against the element's box, clamp, and report 0-1. The
  // element comes from the event rather than a ref, so nothing is read during
  // render; the last colour is remembered locally to commit it on release.
  const startDrag = (handler) => (e) => {
    const el = e.currentTarget;
    let last = null;
    const move = (ev) => {
      const r = el.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
      const y = Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height));
      last = handler(x, y);
    };
    move(e);
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      // Only a finished gesture counts as a choice; every intermediate pixel
      // would otherwise flood the recents with near-identical shades.
      if (last) pushRecentColor(last);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  };

  const onHexInput = (raw) => {
    setDraft(raw);
    const normalized = normalizeHex(raw);
    if (normalized) {
      const next = hexToHsv(normalized);
      if (next) setHsv(next);
      onChange(normalized);
    }
  };

  const sampleScreen = async () => {
    try {
      const { sRGBHex } = await new window.EyeDropper().open();
      const normalized = normalizeHex(sRGBHex);
      if (normalized) pick(normalized);
    } catch {
      // Cancelled with Escape, or refused by the browser — nothing to report,
      // the colour simply stays as it was.
    }
  };

  const pick = (color) => {
    const next = hexToHsv(color);
    if (next) setHsv(next);
    setDraft(null);
    onChange(color);
    pushRecentColor(color);
  };

  return createPortal(
    <div
      ref={ref}
      style={{ ...popover, top: pos.top, left: pos.left }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Hex first: it is the value people copy, paste and put in a brand doc. */}
      <div style={row}>
        <span style={tag}>HEX</span>
        <input
          autoFocus
          type="text"
          spellCheck={false}
          value={draft ?? (isTransparent ? '' : hex)}
          placeholder={isTransparent ? 'transparent' : '#000000'}
          onChange={(e) => onHexInput(e.target.value)}
          onBlur={() => { const n = normalizeHex(draft ?? hex); if (n) pushRecentColor(n); setDraft(null); }}
          style={hexInput}
        />
        {HAS_EYEDROPPER && (
          <button
            onClick={sampleScreen}
            title="Pick a colour from the screen"
            aria-label="Pick a colour from the screen"
            style={eyedropperBtn}
          >
            <TbColorPicker size={14} />
          </button>
        )}
        <span style={{ ...preview, background: isTransparent ? 'transparent' : hex }} />
      </div>

      <div
        onMouseDown={startDrag((x, y) => apply({ h: hsv.h, s: x, v: 1 - y }))}
        style={{ ...square, background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsv.h} 100% 50%))` }}
      >
        <span style={{ ...squareDot, left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }} />
      </div>

      <div
        onMouseDown={startDrag((x) => apply({ ...hsv, h: x * 360 }))}
        style={hueBar}
      >
        <span style={{ ...hueDot, left: `${(hsv.h / 360) * 100}%` }} />
      </div>

      <div style={swatchGrid}>
        {PRESETS.map((c) => (
          <button key={c} onClick={() => pick(c)} title={c} aria-label={`Use ${c}`}
            style={{ ...swatch, background: c }} />
        ))}
      </div>

      {recents.length > 0 && (
        <>
          <div style={sectionLabel}>Recent</div>
          <div style={swatchGrid}>
            {recents.map((c) => (
              <button key={c} onClick={() => pick(c)} title={c} aria-label={`Use ${c}`}
                style={{ ...swatch, background: c, outline: c === String(value || '').toLowerCase() ? '1px solid var(--accent-primary)' : 'none' }} />
            ))}
          </div>
        </>
      )}

      {allowTransparent && (
        <button onClick={() => { onChange(isTransparent ? '#ffffff' : 'transparent'); onClose(); }}
          style={transparentBtn}>
          {isTransparent ? 'Set a color' : 'Set transparent'}
        </button>
      )}
    </div>,
    document.body,
  );
}

// Kept in sync with `popover` below: the placement maths needs both before
// the element exists.
const WIDTH = 208;
const MAX_HEIGHT = 330;

const popover = {
  position: 'fixed', zIndex: 3000, width: WIDTH,
  background: 'var(--bg-panel)', border: '1px solid var(--border-default)',
  borderRadius: 8, padding: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.16)',
  display: 'flex', flexDirection: 'column', gap: 8,
};
const row = { display: 'flex', alignItems: 'center', gap: 6 };
const tag = { fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text-muted)' };
const hexInput = {
  flex: 1, width: 0, minWidth: 0, padding: '4px 6px', fontSize: 12,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  border: '1px solid var(--border-default)', borderRadius: 4,
  background: 'var(--bg-app)', color: 'var(--text-primary)', outline: 'none',
};
const eyedropperBtn = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 24, height: 24, padding: 0, borderRadius: 4, cursor: 'pointer', flexShrink: 0,
  border: '1px solid var(--border-default)', background: 'var(--bg-subtle)', color: 'var(--text-secondary)',
};
const preview = { width: 22, height: 22, borderRadius: 4, border: '1px solid var(--border-default)', flexShrink: 0 };
const square = { position: 'relative', height: 110, borderRadius: 4, cursor: 'crosshair' };
const squareDot = {
  position: 'absolute', width: 10, height: 10, borderRadius: '50%',
  border: '2px solid #fff', boxShadow: '0 0 0 1px rgba(0,0,0,0.35)',
  transform: 'translate(-50%, -50%)', pointerEvents: 'none',
};
const hueBar = {
  position: 'relative', height: 12, borderRadius: 6, cursor: 'pointer',
  background: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)',
};
const hueDot = {
  position: 'absolute', top: '50%', width: 12, height: 12, borderRadius: '50%',
  background: '#fff', boxShadow: '0 0 0 1px rgba(0,0,0,0.35)',
  transform: 'translate(-50%, -50%)', pointerEvents: 'none',
};
const swatchGrid = { display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 3 };
const swatch = {
  width: '100%', aspectRatio: '1', borderRadius: 3, cursor: 'pointer', padding: 0,
  border: '1px solid var(--border-default)',
};
const sectionLabel = { fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text-muted)' };
const transparentBtn = {
  padding: '5px 8px', fontSize: 11, borderRadius: 4, cursor: 'pointer',
  border: '1px solid var(--border-default)', background: 'var(--bg-subtle)', color: 'var(--text-secondary)',
};
