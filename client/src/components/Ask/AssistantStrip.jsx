import { TbChevronsLeft, TbChevronsRight } from 'react-icons/tb';
import RobotHead from '../RobotHead';

// The closed assistant: a narrow bar docked on the right edge, the same on
// every screen that has an assistant (the journey, the report editor, the model
// editor). A click opens the panel it stands for — on the journey, Chat
// itself. Docked on the left (`side`), the same bar brings Build back from Chat.
export default function AssistantStrip({ onOpen, style, tour, label = 'Assistant', title = 'Open the assistant', icon, side = 'right' }) {
  const left = side === 'left';
  return (
    <button type="button" onClick={onOpen} style={{ ...stripStyle, ...(left ? leftEdge : null), ...style }} aria-label={label}
      aria-expanded={false} title={title} data-tour={tour}>
      <span style={stripChevronStyle}>{left ? <TbChevronsRight size={14} /> : <TbChevronsLeft size={14} />}</span>
      {icon || <RobotHead size={16} />}
      <span style={stripLabelStyle}>{label}</span>
    </button>
  );
}

const leftEdge = { borderLeft: 'none', borderRight: '1px solid var(--border-default)' };

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
