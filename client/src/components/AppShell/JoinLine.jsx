// Shared pieces for the join gutters.
//
// The rule is a plain div rather than an SVG line: the gutters stretch to the
// column edge, and an SVG needs an explicit width to lay a line out reliably —
// a flex-sized one collapses. A div with a background stretches natively, and
// scaleX gives the same "drawing itself" effect as a dash offset would.
export function JoinRule({ grow = false, muted = false, animate = true }) {
  return (
    <span
      className={animate ? 'join-rule' : undefined}
      style={{
        height: 2,
        flex: grow ? 1 : '0 0 28px',
        minWidth: grow ? 16 : undefined,
        background: muted ? 'var(--border-default)' : 'var(--accent-primary)',
        ...(muted ? dottedRule : null),
      }}
    />
  );
}

// The head sits at the end of a rule, pointing into the block it feeds.
export function JoinArrow() {
  return (
    <svg width={9} height={10} viewBox="0 0 9 10" aria-hidden="true" style={arrowStyle}>
      <path d="M 0 0 L 9 5 L 0 10 z" fill="var(--accent-primary)" />
    </svg>
  );
}

// Dashes drawn with a repeating gradient — a plain div can't use stroke-dasharray.
const dottedRule = {
  background: 'repeating-linear-gradient(to right, var(--border-default) 0 4px, transparent 4px 8px)',
};

const arrowStyle = { flexShrink: 0, display: 'block', marginLeft: -1 };
