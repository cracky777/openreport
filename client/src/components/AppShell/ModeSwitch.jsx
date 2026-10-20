import { useNavigate } from 'react-router-dom';
import { TbLayoutGrid, TbMessageCircle } from 'react-icons/tb';
import { useAuth } from '../../hooks/useAuth';
import { saveUiMode, homeOf } from '../../utils/uiMode';

// Build or Chat: the two faces of the app. Build is the journey — sources,
// models, the report editor. Chat is the assistant with the result beside it,
// files dropped straight into the conversation. The choice is the user's and
// their account remembers it: the next sign-in opens on it.

/** @param {'build'|'chat'} mode  the face this header belongs to */
export default function ModeSwitch({ mode, compact = false }) {
  const navigate = useNavigate();
  const { updateUser } = useAuth();
  const go = (next) => {
    if (next === mode) return;
    updateUser({ ui_mode: next });
    saveUiMode(next);
    navigate(homeOf({ ui_mode: next }));
  };
  return (
    <div role="radiogroup" aria-label="Mode" style={groupStyle} data-tour="home-mode">
      <button type="button" role="radio" aria-checked={mode === 'build'} style={segStyle(mode === 'build', compact)}
        onClick={() => go('build')} title="Build: data sources, models and the report editor">
        <TbLayoutGrid size={14} />{!compact && <span>Build</span>}
      </button>
      <button type="button" role="radio" aria-checked={mode === 'chat'} style={segStyle(mode === 'chat', compact)}
        onClick={() => go('chat')} title="Chat: ask the assistant, drop your files, see the report take shape">
        <TbMessageCircle size={14} />{!compact && <span>Chat</span>}
      </button>
    </div>
  );
}

const groupStyle = {
  display: 'inline-flex', alignItems: 'center', padding: 2, borderRadius: 8, flexShrink: 0,
  background: 'var(--bg-panel-alt)', border: '1px solid var(--border-default)',
};
const segStyle = (active, compact) => ({
  display: 'inline-flex', alignItems: 'center', gap: 5, padding: compact ? 6 : '4px 10px', fontSize: 12, fontWeight: 600,
  border: 'none', borderRadius: 6, cursor: 'pointer', transition: 'background 0.12s, color 0.12s',
  background: active ? 'var(--bg-panel)' : 'transparent',
  color: active ? 'var(--accent-primary)' : 'var(--text-muted)',
  boxShadow: active ? '0 1px 2px rgba(15, 23, 42, 0.08)' : 'none',
});
