import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { TbShield, TbUser, TbChevronDown, TbLogout, TbSun, TbMoon, TbDeviceLaptop } from 'react-icons/tb';
import { useAuth } from '../../hooks/useAuth';
import { useTheme } from '../../hooks/useTheme';
import { usePermissions } from '../../hooks/usePermissions';
import { TopbarSwitcher, UserMenuExtras } from '../../cloud';
import StepNav from './StepNav';
import { STEPS, stepIndexOf } from './steps';

// Shared chrome for the three journey stages (Sources → Models → Reports).
// It owns what used to be the Dashboard header — logo, cloud org switcher,
// stage switcher, Admin/Platform links and the user menu — so the three
// stages read as one screen instead of three unrelated pages.
//
// `step` is the stage key; the page below is passed as children and is the
// only part that swaps. Admin and the user menu stay pinned top-right.
export default function AppShell({ step, children }) {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { mode: themeMode, resolved: themeResolved, setMode: setThemeMode, themes: availableThemes } = useTheme();
  const logoSrc = themeResolved === 'dark' ? '/logo-dark.png' : '/logo.png';

  // Nav-level gates only. Stages that care about a specific workspace keep
  // their own usePermissions call — that one needs the selected workspace,
  // which the shell has no business knowing.
  const { isPlatformAdmin, canEditOrg } = usePermissions(null, user, null);

  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef(null);
  useEffect(() => {
    if (!userMenuOpen) return;
    const onDown = (e) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) setUserMenuOpen(false);
    };
    const onEsc = (e) => { if (e.key === 'Escape') setUserMenuOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onEsc); };
  }, [userMenuOpen]);

  // Sources and Models are org-editor territory, same rule the old nav used.
  const stepAllowed = (key) => (key === 'reports' ? true : canEditOrg);

  // Direction of travel, so the incoming stage slides in from the side it came
  // from. Derived during render (React's "adjust state when a prop changes"
  // pattern) rather than in an effect — an effect would paint the first frame
  // with the previous direction and the animation would briefly run backwards.
  const [prevStep, setPrevStep] = useState(step);
  const [forward, setForward] = useState(true);
  if (prevStep !== step) {
    setForward(stepIndexOf(step) >= stepIndexOf(prevStep));
    setPrevStep(step);
  }

  const go = (key) => {
    const target = STEPS.find((s) => s.key === key);
    if (target) navigate(target.path);
  };

  return (
    <div style={shellStyle}>
      <header style={headerStyle}>
        <div style={leftGroup}>
          <img src={logoSrc} alt="Open Report" style={logoStyle} />
          {TopbarSwitcher && <TopbarSwitcher />}
        </div>

        <StepNav current={step} onGo={go} allowed={stepAllowed} />

        <nav style={rightGroup}>
          {user?.role === 'admin' && (
            <button onClick={() => navigate('/admin')} style={navBtnStyled}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <TbShield size={15} /> <span>Admin</span>
            </button>
          )}
          {isPlatformAdmin && (
            <button onClick={() => navigate('/platform')} style={navBtnStyled}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <TbShield size={15} color="var(--accent-primary)" /> <span>Platform</span>
            </button>
          )}

          <div ref={userMenuRef} style={relStyle}>
            <button
              onClick={() => setUserMenuOpen((v) => !v)}
              style={userPillStyle}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--accent-primary-border)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--accent-primary-soft)'; }}
            >
              <TbUser size={14} color="var(--accent-primary)" />
              <span>{user?.display_name || user?.email}</span>
              <TbChevronDown size={12} style={{ transition: 'transform 0.12s', transform: userMenuOpen ? 'rotate(180deg)' : 'none' }} />
            </button>
            {userMenuOpen && (
              <div style={userMenuDropdown}>
                <div style={userMenuSectionLabel}>Theme</div>
                <div style={themeListStyle}>
                  {/* "System" follows the OS preference */}
                  <button className="btn-hover" onClick={() => setThemeMode('system')} style={themeRowBtn(themeMode === 'system')}>
                    <span style={themeRowLabel}>
                      <TbDeviceLaptop size={14} />
                      <span>System</span>
                    </span>
                    {themeMode === 'system' && <span style={autoTagStyle}>auto</span>}
                  </button>
                  {Object.entries(availableThemes).map(([key, theme]) => {
                    const active = themeMode === key;
                    const Icon = theme.kind === 'dark' ? TbMoon : TbSun;
                    return (
                      <button key={key} className="btn-hover" onClick={() => setThemeMode(key)} style={themeRowBtn(active)}>
                        <span style={themeRowLabel}>
                          <span style={{
                            width: 14, height: 14, borderRadius: 3,
                            background: theme.vars?.['--bg-app'] || '#fff',
                            border: '1px solid ' + (theme.vars?.['--border-default'] || '#e2e8f0'),
                            display: 'inline-block',
                          }} />
                          <span>{theme.label || key}</span>
                        </span>
                        {active && <Icon size={12} style={accentStyle} />}
                      </button>
                    );
                  })}
                </div>
                {UserMenuExtras && (
                  <>
                    <div style={userMenuDivider} />
                    <UserMenuExtras onNavigate={() => setUserMenuOpen(false)} />
                  </>
                )}
                <div style={userMenuDivider} />
                <button
                  onClick={() => { setUserMenuOpen(false); logout(); }}
                  style={userMenuItem}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <TbLogout size={15} />
                  <span>Logout</span>
                </button>
              </div>
            )}
          </div>
        </nav>
      </header>

      {/* `key` restarts the animation on every stage change */}
      <div key={step} className={forward ? 'stage-enter-forward' : 'stage-enter-back'} style={stageStyle}>
        {children}
      </div>
    </div>
  );
}

const shellStyle = { height: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-app)' };
const headerStyle = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16,
  padding: '10px 20px', backgroundColor: 'var(--bg-panel)',
  borderBottom: '1px solid var(--border-default)', flexShrink: 0,
};
const leftGroup = { display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 };
const rightGroup = { display: 'flex', alignItems: 'center', gap: 6, flex: 1, justifyContent: 'flex-end' };
const logoStyle = { height: 28 };
const relStyle = { position: 'relative' };
const stageStyle = { flex: 1, display: 'flex', minHeight: 0 };
const themeListStyle = { display: 'flex', flexDirection: 'column', gap: 2, padding: '4px 8px 8px' };
const themeRowLabel = { display: 'inline-flex', alignItems: 'center', gap: 8 };
const autoTagStyle = { fontSize: 9, color: 'var(--text-muted)' };
const accentStyle = { color: 'var(--accent-primary)' };
const navBtnStyled = {
  display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px',
  background: 'transparent', border: 'none', borderRadius: 7,
  color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 13, fontWeight: 500,
  transition: 'background 0.15s',
};
const userPillStyle = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '6px 10px', borderRadius: 8,
  background: 'var(--accent-primary-soft)', border: '1px solid var(--accent-primary-border)',
  fontSize: 12, color: 'var(--accent-primary-text)', fontWeight: 500,
  cursor: 'pointer', transition: 'background 0.12s',
};
const userMenuDropdown = {
  position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 200,
  minWidth: 220, background: 'var(--bg-panel)', border: '1px solid var(--border-default)',
  borderRadius: 10, boxShadow: 'var(--shadow-md)', padding: '6px 0',
};
const userMenuSectionLabel = { fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', padding: '6px 12px 4px' };
const userMenuDivider = { height: 1, background: 'var(--border-default)', margin: '4px 0' };
const userMenuItem = { display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 12px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 13, color: 'var(--text-secondary)', textAlign: 'left', transition: 'background 0.12s' };
function themeRowBtn(active) {
  return {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    width: '100%', padding: '6px 8px', fontSize: 12, fontWeight: active ? 600 : 500,
    border: '1px solid ' + (active ? 'var(--accent-primary)' : 'transparent'),
    borderRadius: 6,
    background: active ? 'var(--accent-primary-soft)' : 'transparent',
    color: active ? 'var(--accent-primary-text)' : 'var(--text-secondary)',
    cursor: 'pointer', transition: 'background 0.12s, border-color 0.12s',
    textAlign: 'left',
  };
}
