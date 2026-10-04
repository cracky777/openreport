import { useEffect, useState } from 'react';
import { DOCK_SLIDE_MS, DOCK_EASE, DOCK_FOLDED_WIDTH } from './dockTiming';

// A right-hand column that slides between its folded bar and its panel. One box
// whose width animates, with both faces inside it — swapping one element for
// another (the bar for the panel) cannot animate, it jumps. The panel stays
// mounted while folded: its work in progress (a conversation, a fetch loop)
// survives.
//
// `width` is the open panel's; `dragging` turns the slide off while the user
// resizes it, or every pixel of the drag would lag behind the pointer.
//
// With no `bar` (the visual's settings, open while a visual is selected) the
// room is taken at once and the panel slides into it: the canvas reaches its
// final scale right away, before the user drags the visual they just selected —
// a canvas still rescaling under the pointer would move it off the cursor.
// Closing gives the room back once the panel has slid out.
export default function SlidingDock({ open, width, dragging = false, bar, children }) {
  const fade = `opacity ${DOCK_SLIDE_MS}ms ${DOCK_EASE}`;
  const [holding, setHolding] = useState(open);
  useEffect(() => {
    if (bar) return undefined;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) { setHolding(true); return undefined; }
    const t = setTimeout(() => setHolding(false), DOCK_SLIDE_MS);
    return () => clearTimeout(t);
  }, [open, bar]);

  if (!bar) {
    return (
      <div style={{ ...shellStyle, width: open || holding ? width : 0 }}>
        <div style={{
          ...panelLayer, width, transform: open ? 'none' : 'translateX(100%)', opacity: open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none', transition: `transform ${DOCK_SLIDE_MS}ms ${DOCK_EASE}, ${fade}`,
        }} aria-hidden={!open} inert={!open}>
          {children}
        </div>
      </div>
    );
  }

  const slide = dragging ? 'none' : `width ${DOCK_SLIDE_MS}ms ${DOCK_EASE}`;
  return (
    <div style={{ ...shellStyle, width: open ? width : DOCK_FOLDED_WIDTH, transition: slide }}>
      <div style={{ ...barLayer, opacity: open ? 0 : 1, pointerEvents: open ? 'none' : 'auto', transition: fade }}
        aria-hidden={open} inert={open}>
        {bar}
      </div>
      <div style={{ ...panelLayer, width, opacity: open ? 1 : 0, pointerEvents: open ? 'auto' : 'none', transition: fade }}
        aria-hidden={!open} inert={!open}>
        {children}
      </div>
    </div>
  );
}

const shellStyle = { position: 'relative', flexShrink: 0, height: '100%', overflow: 'hidden' };
const barLayer = { position: 'absolute', top: 0, left: 0, bottom: 0, width: DOCK_FOLDED_WIDTH, display: 'flex' };
const panelLayer = { height: '100%', display: 'flex' };
