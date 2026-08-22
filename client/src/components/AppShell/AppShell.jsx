import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { TbShield, TbBell, TbTelescope, TbUser, TbChevronDown, TbLogout, TbSun, TbMoon, TbDeviceLaptop } from 'react-icons/tb';
import { useAuth } from '../../hooks/useAuth';
import { useTheme } from '../../hooks/useTheme';
import { usePermissions } from '../../hooks/usePermissions';
import { TopbarSwitcher, UserMenuExtras } from '../../cloud';
import Datasources from '../../pages/Datasources';
import Models from '../../pages/Models';
import Dashboard from '../../pages/Dashboard';
import StepNav from './StepNav';
import JoinLayer from './JoinLayer';
import WorkspacePicker from './WorkspacePicker';
import { STEPS } from './steps';

// Shared chrome for the three journey stages (Sources → Models → Reports).
// It owns what used to be the Dashboard header — logo, cloud org switcher,
// stage switcher, Admin/Platform links and the user menu — so the three
// stages read as one screen instead of three unrelated pages.
//
// `step` is the stage key and the only part that swaps. Admin and the user
// menu stay pinned top-right.
export default function AppShell({ step }) {
  const navigate = useNavigate();
  const { search } = useLocation();
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

  // Every stage stays mounted side by side on one ribbon; changing step slides
  // the ribbon rather than swapping what is rendered. Its neighbours therefore
  // peek in from the edges, which is what lets a join end on a real card in the
  // next column instead of running off into nothing.
  const visibleSteps = STEPS.filter((s) => stepAllowed(s.key));
  const index = Math.max(0, visibleSteps.findIndex((s) => s.key === step));

  const viewportRef = useRef(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return undefined;
    const read = () => setViewport({ width: el.clientWidth, height: el.clientHeight });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const { width: viewportWidth, height: viewportHeight } = viewport;

  // One scroll for the whole ribbon means a stage inherits wherever the last
  // one was left — you arrive on Reports already scrolled past its first card.
  // Each stage starts at its top, the way it did when each owned its scroll.
  useLayoutEffect(() => { if (viewportRef.current) viewportRef.current.scrollTop = 0; }, [step]);

  // The active column is inset by PEEK on both sides, and that inset is exactly
  // what its neighbours show through.
  const columnWidth = Math.max(MIN_COLUMN, viewportWidth - 2 * PEEK);
  const offset = PEEK - index * columnWidth;

  // Following a join focuses the relation's parent and moves to the stage the
  // click points at. Both directions focus the same node — walking back up a
  // join is the same branch seen from the other end, not a different filter.
  const follow = ({ dir, noun, id }) => {
    const stage = noun === 'model' ? 'sources' : 'models';
    const down = noun === 'model' ? '/models' : '/';
    const up = noun === 'model' ? '/datasources' : '/models';
    navigate(`${dir === 'down' ? down : up}?focus=${stage}:${id}`);
  };

  // The focus spans the journey, so it survives the stage switcher — otherwise
  // stepping one stage over would silently drop it. The crumb, shown on every
  // stage while it is set, is the way out.
  const go = (key) => {
    const target = STEPS.find((s) => s.key === key);
    if (target) navigate(target.path + search);
  };

  // Alt+← / Alt+→ walk the journey. Plain arrows are left alone — they belong
  // to whatever the user is typing in or scrolling.
  useEffect(() => {
    const onKey = (e) => {
      if (!e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
      const visible = STEPS.filter((s) => stepAllowed(s.key));
      const at = visible.findIndex((s) => s.key === step);
      if (at === -1) return;
      const next = visible[at + (e.key === 'ArrowRight' ? 1 : -1)];
      if (!next) return;
      e.preventDefault();
      navigate(next.path + search);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  return (
    <div style={shellStyle}>
      <header style={headerStyle}>
        <div style={leftGroup}>
          <img src={logoSrc} alt="Open Report" style={logoStyle} />
          <WorkspacePicker canCreate={canEditOrg} />
        </div>

        <StepNav current={step} onGo={go} allowed={stepAllowed} />

        <nav style={rightGroup}>
          {/* Exploration is read-only: every authenticated user may ask
              ad-hoc questions of the models they can access. */}
          <button onClick={() => navigate('/explore')} style={navBtnStyled}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            <TbTelescope size={15} /> <span>Explore</span>
          </button>
          {/* Alerts need write role — the API refuses viewers, so don't
              show them a dead door. */}
          {(user?.role === 'admin' || user?.role === 'editor') && (
            <button onClick={() => navigate('/alerts')} style={navBtnStyled}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <TbBell size={15} /> <span>Alerts</span>
            </button>
          )}
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

          {/* CLOUD-HOOK: the org switcher sits with the account controls, left
              of the user pill — which org you are in is a question about who
              you are, not about where you are in the journey. Null in OSS. */}
          {TopbarSwitcher && <TopbarSwitcher />}

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

      {/* While a move is in flight both stages ride one ribbon and slide as a
          single block, so their relative positions hold still and JoinLayer can
          run a curve from a card in one column to its target in the other. */}
      <div ref={viewportRef} style={viewportStyle} aria-live="polite">
        {/* JoinLayer lives on the ribbon, alongside the columns it links. It
            measures against its own parent, and that parent has to be the
            element the cards move with — measured against the still viewport,
            a sliding card would drift away from its curve on every frame. */}
        <div
          data-journey-ribbon=""
          style={{
            ...ribbonStyle,
            width: columnWidth * visibleSteps.length,
            // A short stage still has to fill the screen; a tall one grows the
            // ribbon and, with it, the viewport's scrollbar.
            minHeight: viewportHeight || undefined,
            transform: `translateX(${offset}px)`,
            // Before the first measurement the column width is a placeholder,
            // so the ribbon would animate from a position that never made
            // sense. Snap into place instead, then animate on later moves.
            transition: viewportWidth ? ribbonStyle.transition : 'none',
          }}
        >
          {visibleSteps.map((s) => (
            <div
              key={s.key}
              style={{
                ...panelStyle,
                width: columnWidth,
                // Only the column in focus sets the scroll length. A peeking
                // neighbour is clipped to the screen, otherwise a long list one
                // stage over would leave the active column scrolling past its
                // own end.
                ...(s.key === step ? null : { maxHeight: viewportHeight || undefined, overflow: 'hidden' }),
                // Neighbours are legible enough to show where a join lands,
                // quiet enough not to compete with the column in focus.
                opacity: s.key === step ? 1 : 0.45,
              }}
              data-stage-panel=""
              data-peek={s.key === step ? undefined : ''}
              aria-label={s.label}
              aria-current={s.key === step ? 'page' : undefined}
            >
              <Stage step={s.key} />
            </div>
          ))}
          <JoinLayer onFollow={follow} />
        </div>
      </div>
    </div>
  );
}

// The shell renders the stages itself rather than taking them as children:
// during a move it must re-render the stage being left, and it can do that
// from its name alone.
const STAGE_COMPONENTS = { sources: Datasources, models: Models, reports: Dashboard };

function Stage({ step }) {
  const Component = STAGE_COMPONENTS[step];
  return Component ? <Component /> : null;
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
// The viewport clips the stages sideways while they slide, and owns the vertical
// scroll. Scrolling used to belong to each column, which put the scrollbar at
// the column's edge — a good 100px short of the window, floating in the middle
// of the screen. Here it sits against the right edge, where a scrollbar belongs.
// `scrollbar-gutter` reserves its strip up front so a list crossing the
// one-screen mark doesn't narrow the columns as it appears.
const viewportStyle = {
  flex: 1, position: 'relative', minHeight: 0,
  overflowX: 'hidden', overflowY: 'auto', scrollbarGutter: 'stable',
};
// Twice the viewport, two equal panels: sliding it by -50% swaps one column
// for the next in a single motion.
// How much of each neighbour shows past the active column.
const PEEK = 96;
const MIN_COLUMN = 360;
// Relative, not absolute: the ribbon has to take the height of its tallest
// column so the viewport has something to scroll. It stays the positioning
// context for JoinLayer, which is why the curves scroll with the cards instead
// of being re-measured on every frame.
const ribbonStyle = {
  position: 'relative', display: 'flex',
  transition: 'transform var(--stage-ms) cubic-bezier(0.4, 0, 0.2, 1)',
};
// Default stretch: every column is as tall as the ribbon, and the ribbon is as
// tall as the tallest column — the clamped neighbours contributing only up to
// one screen, so the active column alone decides how far the page scrolls.
const panelStyle = {
  display: 'flex', flexShrink: 0, minWidth: 0,
  transition: 'opacity var(--stage-ms) ease-out',
};
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
