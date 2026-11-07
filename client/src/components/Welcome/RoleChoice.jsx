import { useState } from 'react';
import { useTheme } from '../../hooks/useTheme';
import { DataAnalyst, BusinessAnalyst } from './People';

// The first arrival on the app (an account that has never picked a side,
// `users.ui_mode` null): Build or Chat, asked once with the two ways people
// work (Jonathan: "I want to construct my report" → Build, "I want to talk to
// my data" → the assistant). The side picked is kept on the account like any
// later slide (hooks/useModeSlide); the bars on the edge of each side still
// switch at any time.
//
// The people carry the choice (Jonathan: the picture takes the whole card, no
// text under it, the title over the picture only on hover). A screen without
// hover — a phone — shows the titles all the time.
const NO_HOVER = typeof window !== 'undefined' && window.matchMedia?.('(hover: none)').matches;

const backdropStyle = {
  position: 'fixed', inset: 0, zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: 16, overflowY: 'auto', background: 'rgba(15, 12, 30, 0.45)', backdropFilter: 'blur(6px)',
};
const panelStyle = {
  width: '100%', maxWidth: 900, margin: 'auto', padding: '36px 28px 28px', borderRadius: 20,
  background: 'var(--bg-panel)', border: '1px solid var(--border-default)', boxShadow: 'var(--shadow-lg)',
  display: 'flex', flexDirection: 'column', gap: 28,
};
const titleStyle = { margin: 0, textAlign: 'center', fontSize: 34, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em', lineHeight: 1.15 };
const rowStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 };
// The figures stand on DataKhi's pastel ground, a darker one in the dark theme.
const cardStyle = (hover, dark) => ({
  position: 'relative', display: 'flex', justifyContent: 'center', alignItems: 'center',
  height: 550, padding: 0, overflow: 'hidden', cursor: 'pointer', font: 'inherit', color: 'inherit',
  borderRadius: 16, border: `1.5px solid ${hover ? 'var(--accent-primary)' : 'var(--border-default)'}`,
  background: dark ? 'linear-gradient(160deg, #2B2342 0%, #3A2633 100%)' : 'linear-gradient(160deg, #F3ECFC 0%, #FDEBE1 100%)',
  boxShadow: hover ? 'var(--shadow-purple-lg)' : 'none',
  transform: hover ? 'translateY(-3px)' : 'none', transition: 'transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease',
});
// Centred in the card; on hover the person steps down to make room for the title.
const figureStyle = (lowered) => ({ display: 'flex', transform: lowered ? 'translateY(44px)' : 'none', transition: 'transform 240ms ease' });
const labelStyle = (shown) => ({
  position: 'absolute', top: 20, left: 0, right: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
  opacity: shown ? 1 : 0, transform: shown ? 'none' : 'translateY(-6px)', transition: 'opacity 180ms ease, transform 180ms ease',
  pointerEvents: 'none',
});
const roleStyle = {
  fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
  color: 'var(--accent-primary-text)', background: 'var(--accent-primary-soft)', padding: '3px 10px', borderRadius: 999,
};
const cardTitleStyle = { fontSize: 22, fontWeight: 800, color: 'var(--text-primary)' };

const CHOICES = [
  { mode: 'build', Figure: DataAnalyst, role: 'Data analyst', title: 'I want to build my report manually' },
  { mode: 'chat', Figure: BusinessAnalyst, role: 'Business analyst', title: 'I want to talk to my data' },
];

/** @param {{ onChoose: (mode: 'build' | 'chat') => void }} props */
export default function RoleChoice({ onChoose }) {
  const { resolved } = useTheme();
  const [hover, setHover] = useState(null);
  return (
    <div style={backdropStyle} role="dialog" aria-modal="true" aria-labelledby="role-choice-title">
      <div style={panelStyle}>
        <h1 id="role-choice-title" style={titleStyle}>How would you like to work ?</h1>
        <div style={rowStyle}>
          {CHOICES.map(({ mode, Figure, role, title }) => (
            <button key={mode} type="button" aria-label={`${title} (${role})`} style={cardStyle(hover === mode, resolved === 'dark')}
              onClick={() => onChoose(mode)}
              onMouseEnter={() => setHover(mode)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(mode)} onBlur={() => setHover(null)}>
              <div style={labelStyle(NO_HOVER || hover === mode)}>
                <span style={roleStyle}>{role}</span>
                <span style={cardTitleStyle}>{title}</span>
              </div>
              <div style={figureStyle(NO_HOVER || hover === mode)}><Figure height={380} /></div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
