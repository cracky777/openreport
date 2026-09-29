import { useState, useLayoutEffect, useRef, useCallback } from 'react';

// Every relation of the journey, drawn by one component.
//
// There used to be two: per-row stubs when a single column was on screen, and a
// separate overlay that linked card to card while two columns crossed. Two
// renderings of one idea meant they could both show at once (they did), and the
// fix was to hide one — a sign the model was wrong.
//
// A join is one curve between two cards, drawn only when both are on screen.
// Every stage stays mounted, so a card that isn't there was filtered out, and
// a relation to something the user chose to hide must not be drawn.
//
// Cards announce themselves with `data-join-anchor="<stage>:<id>"`, and the
// card they hang from with `data-join-parent` (+ `data-join-parent-name`);
// the layer reads the DOM rather than a ref registry, because the cards live in
// three separate page components and the question — "what is on screen right
// now" — is precisely what a DOM query answers. The relations come from the
// cards too: the Reports stage lists what the workspace shows (a teammate's
// report, one shared into it), which no list held by the graph matches.
// `overview`: the whole journey zoomed out — the curves and their tallies,
// without the origin names at every target, which crowd a shrunk screen.
export default function JoinLayer({ onFollow, overview = false }) {
  const [links, setLinks] = useState([]);
  const hostRef = useRef(null);

  const measure = useCallback(() => {
    // The host is the stage viewport; parentElement rather than a prop because
    // React attaches a parent's ref after running its children's layout effects.
    const host = hostRef.current?.parentElement;
    if (!host) return;
    const box = host.getBoundingClientRect();
    // Rects are read on screen, curves drawn in the host's own units: the
    // overview shrinks the ribbon (a CSS scale), and a curve measured on screen
    // would be shrunk a second time.
    const scale = host.offsetWidth ? box.width / host.offsetWidth : 1;

    const at = (key) => {
      const el = host.querySelector(`[data-join-anchor="${key.replace(/["\\]/g, '\\$&')}"]`);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      // A peeking column is clipped to one screen, and a card past that clip is
      // not on screen however truthful its rect is. Aiming at one would draw a
      // join to a card nobody can see.
      const panel = el.closest('[data-stage-panel]');
      if (panel) {
        const p = panel.getBoundingClientRect();
        if (r.bottom <= p.top || r.top >= p.bottom) return null;
      }
      return {
        left: (r.left - box.left) / scale,
        right: (r.right - box.left) / scale,
        mid: (r.top - box.top + r.height / 2) / scale,
      };
    };

    // Every card on screen that hangs from another one.
    const edges = [...host.querySelectorAll('[data-join-anchor][data-join-parent]')].map((el) => {
      const from = el.dataset.joinParent;
      const to = el.dataset.joinAnchor;
      return {
        from,
        to,
        parentId: from.slice(from.indexOf(':') + 1),
        parentName: el.dataset.joinParentName,
        noun: to.startsWith('reports:') ? 'report' : 'model',
        // A curve to or from a card outside the highlighted branch fades with it.
        dim: el.hasAttribute('data-journey-dim')
          || !!host.querySelector(`[data-join-anchor="${from.replace(/["\\]/g, '\\$&')}"][data-journey-dim]`),
      };
    });

    // Both ends must be on screen. Every stage is mounted, so a missing card
    // means it was filtered out — and a relation to something the user chose to
    // hide has no business being drawn.
    const drawable = [];
    for (const edge of edges) {
      const a = at(edge.from);
      const b = at(edge.to);
      if (!a || !b || b.left <= a.right) continue;
      drawable.push({ edge, a, b });
    }

    // The count is how many lines leave the card, counted from the lines
    // themselves. Taken from the graph instead, it could claim "3 models" over
    // a card with one line under it — the tally and the drawing answering the
    // same question from two different places.
    const children = new Map();
    const live = new Set();
    for (const { edge } of drawable) {
      children.set(edge.from, (children.get(edge.from) || 0) + 1);
      if (!edge.dim) live.add(edge.from);
    }

    const next = [];
    const counted = new Set();
    const origins = new Set();
    for (const { edge, a, b } of drawable) {
      const bend = Math.max(40, (b.left - a.right) * 0.4);
      next.push({
        key: `${edge.from}->${edge.to}`,
        d: `M ${a.right} ${a.mid} C ${a.right + bend} ${a.mid}, ${b.left - bend} ${b.mid}, ${b.left} ${b.mid}`,
        dim: edge.dim,
      });

      // One count per source card, parked just past it, and one origin name per
      // target card. Both stay clickable: the curve shows the relation, these
      // walk it.
      const count = children.get(edge.from) || 0;
      if (!counted.has(edge.from) && count) {
        counted.add(edge.from);
        next.push({
          key: `count:${edge.from}`,
          label: `${count} ${edge.noun}${count > 1 ? 's' : ''}`,
          x: a.right + 34, y: a.mid, align: 'left',
          follow: { dir: 'down', noun: edge.noun, id: edge.parentId },
          // A tally standing for nothing the workspace uses fades with what it
          // counts; one that covers even a single live relation stays lit.
          dim: !live.has(edge.from),
        });
      }
      if (!overview && edge.parentName && !origins.has(edge.to)) {
        origins.add(edge.to);
        next.push({
          key: `origin:${edge.to}`,
          label: edge.parentName,
          x: b.left - 34, y: b.mid, align: 'right',
          follow: { dir: 'up', noun: edge.noun, id: edge.parentId },
          dim: edge.dim,
        });
      }
    }
    setLinks(next);
  }, [overview]);

  useLayoutEffect(() => {
    measure();
    const host = hostRef.current?.parentElement;
    if (!host) return undefined;

    // Cards move, appear and vanish for reasons the graph knows nothing about:
    // a scroll, a window resize, a form opening above the list — and above all
    // the Reports stage, whose rows arrive from their own async fetch well
    // after this layer first mounts. Measuring only once left that column
    // without any joins at all.
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    const mo = new MutationObserver((records) => {
      // Ignore our own paths and labels, or drawing would re-trigger drawing.
      const own = hostRef.current;
      if (records.every((r) => own && own.contains(r.target))) return;
      measure();
    });
    // A card whose parent changes keeps its node: watch the join attributes too.
    mo.observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-join-anchor', 'data-join-parent', 'data-join-parent-name', 'data-journey-dim'] });
    host.addEventListener('scroll', measure, true);
    return () => {
      ro.disconnect();
      mo.disconnect();
      host.removeEventListener('scroll', measure, true);
    };
  }, [measure]);

  const curves = links.filter((l) => l.d);
  const labels = links.filter((l) => l.label);

  return (
    <div ref={hostRef} data-join-layer="" style={layerStyle}>
      <svg style={svgStyle} aria-hidden="true">
        <defs>
          <marker id="join-head" viewBox="0 0 10 10" refX="9" refY="5"
            markerWidth={7} markerHeight={7} orient="auto-start-reverse">
            <path d="M 0 1 L 9 5 L 0 9 z" fill="var(--accent-primary)" />
          </marker>
        </defs>
        {curves.map((c) => (
          <path
            key={c.key}
            d={c.d}
            fill="none"
            stroke="var(--accent-primary)"
            strokeWidth={2}
            opacity={c.dim ? DIM_OPACITY : 0.9}
            markerEnd="url(#join-head)"
          />
        ))}
      </svg>
      {labels.map((l) => (
        <button
          key={l.key}
          onClick={() => onFollow?.(l.follow)}
          style={{
            ...labelStyle,
            left: l.x,
            top: l.y,
            // Right-aligned labels are anchored by their right edge so they sit
            // beside the card rather than overlapping it.
            transform: l.align === 'right' ? 'translate(-100%, -50%)' : 'translateY(-50%)',
            color: l.follow.dir === 'up' ? 'var(--text-muted)' : 'var(--accent-primary-text)',
            opacity: l.dim ? DIM_OPACITY : 1,
          }}
          title={l.follow.dir === 'up' ? `Back to ${l.label}` : `Show the ${l.label} built on this`}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}

// The cards fade to 0.4; a curve sits at 0.9, so the same fade applied to it
// lands here. Kept as one constant so the two never drift apart.
const DIM_OPACITY = 0.36;

const layerStyle = {
  position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 3,
};
const svgStyle = {
  position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible',
};
const labelStyle = {
  position: 'absolute', transform: 'translateY(-50%)',
  pointerEvents: 'auto', cursor: 'pointer',
  border: 'none', background: 'var(--bg-app)', padding: '0 6px',
  fontSize: 13, fontWeight: 500, color: 'var(--accent-primary-text)',
  whiteSpace: 'nowrap',
};
