import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserIcon } from './StageIcons';
import { TbShield, TbBell, TbChevronDown, TbLogout, TbSun, TbMoon, TbDeviceLaptop, TbBug, TbPlugConnected, TbHelp } from 'react-icons/tb';
import { useAuth } from '../../hooks/useAuth';
import { useTheme } from '../../hooks/useTheme';
import { UserMenuExtras } from '../../cloud';
import { useBugReport } from '../BugReport/BugReportProvider';

// The account menu of every header: alerts and admin for who has them, the
// theme, the cloud's extras, API tokens, a bug report, logout. One menu for
// the journey (AppShell) and the chat mode (the studio, pages/AiStudio): whichever face
// of the app is open, the account reads the same.

/**
 * @param {boolean} compact          phone layout: the pill is the icon alone
 * @param {string} where             the screen, for the bug report's context
 * @param {function} [onShowAround]  the tour, where there is one
 */
export default function UserMenu({ compact = false, where = '', onShowAround = null }) {
  const navigate = useNavigate();
  const { user, logout, instance } = useAuth();
  const { mode: themeMode, setMode: setThemeMode, themes: availableThemes } = useTheme();
  const openBugReport = useBugReport();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onEsc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onEsc); };
  }, [open]);

  const item = (label, Icon, onClick) => (
    <button
      onClick={() => { setOpen(false); onClick(); }}
      style={userMenuItem}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      <Icon size={15} />
      <span>{label}</span>
    </button>
  );
  const builder = user?.role === 'admin' || user?.role === 'editor';

  return (
    <div ref={ref} style={relStyle}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={compact ? { ...userPillStyle, ...userPillCompact } : userPillStyle}
        aria-label="Account" aria-haspopup="menu" aria-expanded={open}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--accent-primary-border)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--accent-primary-soft)'; }}
      >
        <UserIcon size={16} />
        {!compact && <span>{user?.display_name || user?.email}</span>}
        <TbChevronDown size={12} style={{ transition: 'transform 0.12s', transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>
      {open && (
        <div style={userMenuDropdown}>
          {/* Alerts need write role — the API refuses viewers, so don't show them a dead door. */}
          {builder && item('Alerts', TbBell, () => navigate('/alerts'))}
          {user?.role === 'admin' && item('Admin', TbShield, () => navigate('/admin'))}
          {builder && <div style={userMenuDivider} />}
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
              <UserMenuExtras onNavigate={() => setOpen(false)} />
            </>
          )}
          <div style={userMenuDivider} />
          {/* Only shown when the instance has the API on AND this account
              passes the role floor — no point offering a door it cannot
              open. Both flags come from /auth/me. */}
          {instance?.apiEnabled && instance?.apiAllowed && item('API tokens', TbPlugConnected, () => navigate('/api-tokens'))}
          {onShowAround && item('Show me around', TbHelp, onShowAround)}
          {/* The general bug report lives here rather than in the header: it
              is looked for when needed, and has no business taking room in a
              bar that is looked at all the time. The report that really
              matters starts from the error itself, where it carries its
              context (see Canvas/WidgetItem). */}
          {item('Report a bug', TbBug, () => openBugReport({ Step: where }))}
          <div style={userMenuDivider} />
          {item('Logout', TbLogout, logout)}
        </div>
      )}
    </div>
  );
}

const relStyle = { position: 'relative' };
const accentStyle = { color: 'var(--accent-primary)' };
const userPillCompact = { padding: 0, width: 40, height: 40, justifyContent: 'center', gap: 2, flexShrink: 0 };
export const userPillStyle = {
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
const themeListStyle = { display: 'flex', flexDirection: 'column', gap: 2, padding: '4px 8px 8px' };
const themeRowLabel = { display: 'inline-flex', alignItems: 'center', gap: 8 };
const autoTagStyle = { fontSize: 9, color: 'var(--text-muted)' };
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
