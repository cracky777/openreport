import { TbChevronRight } from 'react-icons/tb';
import { STEPS } from './steps';

const groupStyle = {
  display: 'flex', alignItems: 'center', gap: 2,
  padding: '3px 4px', background: 'var(--bg-subtle)',
  border: '1px solid var(--border-default)', borderRadius: 10,
};

const stepBtn = (active) => ({
  display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px',
  background: active ? 'var(--bg-panel)' : 'transparent',
  border: '1px solid ' + (active ? 'var(--accent-primary-border)' : 'transparent'),
  borderRadius: 7,
  color: active ? 'var(--accent-primary-text)' : 'var(--text-secondary)',
  cursor: 'pointer', fontSize: 13, fontWeight: active ? 600 : 500,
  boxShadow: active ? 'var(--shadow-md)' : 'none',
  transition: 'background 0.15s, box-shadow 0.15s, color 0.15s, border-color 0.15s',
});

const sepStyle = { color: 'var(--text-disabled)', flexShrink: 0 };

// Given the full width of its own row, the switcher stops being a compact pill
// and becomes the primary navigation — so it takes the room and stays legible.
const compactGroupStyle = { ...groupStyle, flex: 1, justifyContent: 'center', whiteSpace: 'nowrap' };

// The stage switcher. `allowed` gates Sources/Models the same way the old
// Dashboard nav did (canEditOrg) — a viewer only ever sees Reports, and with a
// single stage left the switcher is noise, so it hides itself entirely.
export default function StepNav({ current, onGo, allowed, compact = false }) {
  const visible = STEPS.filter((s) => allowed(s.key));
  if (visible.length < 2) return null;

  return (
    <nav style={compact ? compactGroupStyle : groupStyle} aria-label="Data journey">
      {visible.map((s, i) => {
        const active = s.key === current;
        const Icon = s.icon;
        return (
          <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            {i > 0 && <TbChevronRight size={13} style={sepStyle} />}
            <button
              onClick={() => onGo(s.key)}
              style={stepBtn(active)}
              aria-current={active ? 'page' : undefined}
              onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--bg-hover)'; }}
              onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
            >
              <Icon size={15} />
              <span>{s.label}</span>
            </button>
          </div>
        );
      })}
    </nav>
  );
}
