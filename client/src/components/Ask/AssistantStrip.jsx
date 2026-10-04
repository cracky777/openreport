import { TbChevronsLeft, TbSparkles } from 'react-icons/tb';

// The closed assistant: a narrow bar docked on the right edge, the same on
// every screen that has an assistant (the journey, the report editor, the model
// editor). A click opens the panel it stands for.
export default function AssistantStrip({ onOpen, style, tour }) {
  return (
    <button type="button" onClick={onOpen} style={{ ...stripStyle, ...style }} aria-label="Assistant" aria-expanded={false}
      title="Open the assistant" data-tour={tour}>
      <span style={stripChevronStyle}><TbChevronsLeft size={14} /></span>
      <TbSparkles size={14} color="var(--accent-primary)" />
      <span style={stripLabelStyle}>Assistant</span>
    </button>
  );
}

const stripStyle = {
  flexShrink: 0, width: 34, height: '100%', boxSizing: 'border-box', padding: '10px 8px',
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', gap: 10,
  border: 'none', borderLeft: '1px solid var(--border-default)', borderRadius: 0, overflow: 'hidden', cursor: 'pointer',
  background: 'var(--bg-panel-alt)', fontFamily: 'inherit',
};
const stripChevronStyle = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 22, height: 22, background: 'var(--bg-panel)', border: '1px solid var(--border-default)',
  borderRadius: 6, color: 'var(--text-muted)',
};
const stripLabelStyle = {
  fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.08em',
  textTransform: 'uppercase', writingMode: 'vertical-rl', textOrientation: 'mixed',
};
