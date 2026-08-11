import { JoinRule, JoinArrow } from './JoinLine';

// The incoming half of a relation: where this card comes from. Mirror of
// JoinOut — same rule, same head — and it likewise reaches the edge of its
// column, so mid-slide the two halves meet and read as one continuous join
// between the block on the left and the block on the right.
export default function JoinIn({ from, onClick, compact = false }) {
  if (!from) return null;

  // Compact form for anywhere there is no gutter to live in — a stub drawn
  // just before the parent's name, inside the card.
  if (compact) {
    return (
      <span style={compactWrap} aria-hidden="true">
        <span style={compactRule} />
        <JoinArrow />
      </span>
    );
  }

  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      onClick={onClick}
      style={{ ...wrap, cursor: onClick ? 'pointer' : 'default' }}
      title={onClick ? `Back to ${from}` : `Comes from ${from}`}
      onMouseEnter={(e) => { if (onClick) e.currentTarget.style.color = 'var(--accent-primary)'; }}
      onMouseLeave={(e) => { if (onClick) e.currentTarget.style.color = 'var(--text-muted)'; }}
    >
      <JoinRule grow />
      <span style={labelStyle}>{from}</span>
      <JoinRule />
      <JoinArrow />
    </Tag>
  );
}

const wrap = {
  display: 'flex', alignItems: 'center', gap: 8,
  flex: 1, minWidth: 0, fontSize: 13, whiteSpace: 'nowrap',
  padding: 0, border: 'none', background: 'transparent',
  color: 'var(--text-muted)', fontWeight: 500,
  transition: 'color 0.12s',
};
const labelStyle = { overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 };
const compactWrap = { display: 'inline-flex', alignItems: 'center', flexShrink: 0, opacity: 0.75 };
const compactRule = { width: 12, height: 1.5, background: 'var(--accent-primary)' };
