import { useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { TbX } from 'react-icons/tb';

// A short guided tour: one bubble at a time, pointing at a part of the page
// (`[data-tour="…"]`), with Back / Next and a way out. Nothing is blocked
// behind it — the page stays usable — and a step whose element is not on
// screen (no AI assistant, say) is left out. "Don't show this tutorial again"
// is the user's to tick: until then the tour comes back (hooks/useFirstVisitTour).

const GAP = 12;
const WIDTH = 300;

function rectOf(target) {
  const el = document.querySelector(`[data-tour="${target}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width && r.height ? r : null;
}

// Below the element when there is room, otherwise above, else to its left —
// and inside it, near its top, when it fills the screen (the page itself).
function place(r) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const left = Math.min(Math.max(12, r.left + r.width / 2 - WIDTH / 2), vw - WIDTH - 12);
  if (r.bottom + GAP + 170 < vh) return { top: r.bottom + GAP, left };
  if (r.top - GAP - 170 > 0) return { bottom: vh - r.top + GAP, left };
  if (r.left - WIDTH - GAP >= 12) return { top: Math.min(Math.max(12, r.top), vh - 200), left: r.left - WIDTH - GAP };
  return { top: Math.max(12, r.top) + 40, left };
}

/**
 * @param {{target: string, title: string, text: string}[]} steps
 * @param {function} onClose  ({ dontShowAgain }) => void — the tour is over (finished or skipped)
 */
export default function Tour({ steps, onClose }) {
  // Measured once, when the tour starts: the steps whose element is here.
  const [shown] = useState(() => steps.filter((s) => rectOf(s.target)));
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState(null);
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const step = shown[index];
  const finish = () => onClose({ dontShowAgain });

  useLayoutEffect(() => {
    if (!step) return undefined;
    const measure = () => setRect(rectOf(step.target));
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [step]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose({ dontShowAgain }); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, dontShowAgain]);

  useEffect(() => { if (!shown.length) onClose({ dontShowAgain: false }); }, [shown, onClose]);
  if (!step || !rect) return null;
  const last = index === shown.length - 1;

  return createPortal(
    <>
      <div style={{ ...ringStyle, top: rect.top - 4, left: rect.left - 4, width: rect.width + 8, height: rect.height + 8 }} />
      <div role="dialog" aria-label={step.title} style={{ ...bubbleStyle, ...place(rect) }}>
        <div style={headStyle}>
          <span style={titleStyle}>{step.title}</span>
          <button style={closeStyle} onClick={finish} aria-label="Skip the tour" title="Skip the tour"><TbX size={14} /></button>
        </div>
        <div style={textStyle}>{step.text}</div>
        <div style={footStyle}>
          <span style={countStyle}>{index + 1} of {shown.length}</span>
          {index > 0 && <button style={backStyle} onClick={() => setIndex(index - 1)}>Back</button>}
          <button style={nextStyle} onClick={() => (last ? finish() : setIndex(index + 1))}>{last ? 'Got it' : 'Next'}</button>
        </div>
        <label style={flagStyle}>
          <input type="checkbox" checked={dontShowAgain} onChange={(e) => setDontShowAgain(e.target.checked)} style={flagBoxStyle} />
          Don't show this tutorial again
        </label>
      </div>
    </>,
    document.body,
  );
}

const ringStyle = {
  position: 'fixed', zIndex: 1000, pointerEvents: 'none', borderRadius: 10,
  boxShadow: '0 0 0 3px var(--accent-primary), 0 0 0 9px var(--accent-primary-soft)', transition: 'all 0.2s',
};
const bubbleStyle = {
  position: 'fixed', zIndex: 1001, width: WIDTH, boxSizing: 'border-box', padding: '12px 14px',
  display: 'flex', flexDirection: 'column', gap: 8, borderRadius: 12,
  background: 'var(--bg-panel)', border: '1px solid var(--accent-primary)', boxShadow: '0 10px 30px rgba(15, 23, 42, 0.2)',
};
const headStyle = { display: 'flex', alignItems: 'center', gap: 8 };
const titleStyle = { fontSize: 14, fontWeight: 650, color: 'var(--text-primary)' };
const closeStyle = {
  display: 'inline-flex', padding: 3, marginLeft: 'auto', border: 'none', borderRadius: 6,
  background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer',
};
const textStyle = { fontSize: 13, lineHeight: 1.5, color: 'var(--text-secondary)' };
const footStyle = { display: 'flex', alignItems: 'center', gap: 6 };
const flagStyle = {
  display: 'flex', alignItems: 'center', gap: 6, paddingTop: 8, borderTop: '1px solid var(--border-default)',
  fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer',
};
const flagBoxStyle = { margin: 0, accentColor: 'var(--accent-primary)', cursor: 'pointer' };
const countStyle = { fontSize: 12, color: 'var(--text-muted)', marginRight: 'auto' };
const backStyle = {
  padding: '5px 10px', fontSize: 12, borderRadius: 6, cursor: 'pointer',
  border: '1px solid var(--border-default)', background: 'transparent', color: 'var(--text-secondary)',
};
const nextStyle = {
  padding: '5px 12px', fontSize: 12, fontWeight: 600, borderRadius: 6, cursor: 'pointer',
  border: 'none', background: 'var(--accent-primary)', color: '#fff',
};
