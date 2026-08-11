import { JoinRule, JoinArrow } from './JoinLine';

// The relations leaving a card towards the next stage — one drawn line per
// target block, so a datasource feeding three models shows three joins rather
// than a single line labelled "3".
//
// The lines fan out across the full height of the row and reach the column's
// right edge: mid-slide that edge meets the next column's left edge, so each
// line continues into the block it feeds.
export default function JoinOut({ count, noun, targets, onClick }) {
  const label = `${count} ${noun}${count > 1 ? 's' : ''}`;

  if (!count) {
    return (
      <div style={emptyWrap} title={`No ${noun} builds on this yet`}>
        <JoinRule grow muted animate={false} />
      </div>
    );
  }

  // Following the link *is* the join: clicking it walks to the next stage with
  // only these children listed.
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      onClick={onClick}
      style={{ ...wrap, cursor: onClick ? 'pointer' : 'default' }}
      title={onClick ? `Show the ${label} built on this` : label}
      onMouseEnter={(e) => { if (onClick) e.currentTarget.style.color = 'var(--accent-primary)'; }}
      onMouseLeave={(e) => { if (onClick) e.currentTarget.style.color = 'var(--accent-primary-text)'; }}
    >
      <JoinRule />
      <JoinArrow />
      <span style={labelStyle}>{label}</span>
      <Fan count={count} targets={targets} />
    </Tag>
  );
}

// One curve per target. Drawn in a stretched viewBox so the fan fills whatever
// width the gutter has; `vectorEffect` keeps the stroke an even 2px despite the
// non-uniform scaling.
//
// `targets` carries where each child sits in the next column (0 = top, 1 =
// bottom). The curves leave at those heights, so a link towards a row near the
// top of the next stage visibly heads upwards. Without it they just fan evenly.
function Fan({ count, targets }) {
  const ends = fanEnds(count, targets);
  return (
    <div style={fanBox}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={fanSvg} aria-hidden="true">
        {ends.map((end, i) => (
          <path
            key={i}
            className="join-rule-path"
            d={`M 0 50 C 45 50, 55 ${end}, 100 ${end}`}
            fill="none"
            stroke="var(--accent-primary)"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
    </div>
  );
}

// Exit heights inside the 0–100 viewBox, kept within [8, 92] so the strokes
// don't clip against the row's edges.
function fanEnds(count, targets) {
  if (Array.isArray(targets) && targets.length) {
    return targets.slice(0, MAX_LINES).map((t) => 8 + t * 84);
  }
  const n = Math.min(count, MAX_LINES);
  if (n === 1) return [50];
  return Array.from({ length: n }, (_, i) => 12 + (i * 76) / (n - 1));
}

// Past this the fan turns into a smear; the label still carries the exact count.
const MAX_LINES = 6;

const baseRow = {
  display: 'flex', alignItems: 'center', gap: 8,
  flex: 1, minWidth: 0, alignSelf: 'stretch',
  fontSize: 13, whiteSpace: 'nowrap',
};
const wrap = {
  ...baseRow,
  padding: 0, border: 'none', background: 'transparent', textAlign: 'left',
  color: 'var(--accent-primary-text)', fontWeight: 500, transition: 'color 0.12s',
};
const emptyWrap = { ...baseRow, alignItems: 'center' };
const labelStyle = { flexShrink: 0, alignSelf: 'center' };
const fanBox = { flex: 1, minWidth: 24, alignSelf: 'stretch', position: 'relative' };
const fanSvg = { position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' };
