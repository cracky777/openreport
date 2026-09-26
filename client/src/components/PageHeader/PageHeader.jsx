import { useNavigate } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { TbArrowLeft, TbUpload, TbChevronDown } from 'react-icons/tb';

// Shared page header styles matching the editor toolbar design language.

export const headerShellStyle = {
  // Wraps rather than overflows: on a phone this row carries a title, a step
  // switcher and Save, and Save was landing several hundred pixels off the
  // right edge — the model could not be saved at all. Wide screens never
  // reach the wrap, so their single row is unchanged.
  display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12,
  padding: '10px 20px', backgroundColor: 'var(--bg-panel)',
  borderBottom: '1px solid var(--border-default)', flexShrink: 0,
};

export const headerTitleStyle = {
  fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', margin: 0,
};

const backGroupStyle = {
  display: 'inline-flex', alignItems: 'center', gap: 2,
  padding: '3px 6px', background: 'var(--bg-subtle)',
  border: '1px solid var(--border-default)', borderRadius: 10,
};

const backBtnBase = {
  padding: '6px 8px', border: 'none', borderRadius: 6, background: 'transparent',
  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
  transition: 'background 0.15s, box-shadow 0.15s, transform 0.15s',
  lineHeight: 1,
};

export function BackButton({ to = '/', onClick, label = 'Back' }) {
  const navigate = useNavigate();
  const handle = onClick || (() => navigate(to));
  return (
    <div style={backGroupStyle}>
      <button
        onClick={handle}
        title={label}
        aria-label={label}
        style={backBtnBase}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--bg-panel)';
          e.currentTarget.style.boxShadow = 'var(--shadow-md)';
          e.currentTarget.style.transform = 'translateY(-1px)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
          e.currentTarget.style.boxShadow = 'none';
          e.currentTarget.style.transform = 'translateY(0)';
        }}
      >
        <TbArrowLeft size={18} color="var(--text-secondary)" />
      </button>
    </div>
  );
}

const primaryBtnBase = {
  padding: '7px 18px', fontSize: 13, fontWeight: 600, border: 'none',
  borderRadius: 8, background: 'var(--accent-primary)', color: '#fff',
  cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
  boxShadow: '0 1px 3px rgba(124,58,237,0.2)',
  transition: 'background 0.15s, transform 0.15s, box-shadow 0.15s',
};

export function PrimaryButton({ children, onClick, disabled, style, title }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{ ...primaryBtnBase, opacity: disabled ? 0.7 : 1, cursor: disabled ? 'not-allowed' : 'pointer', ...style }}
      onMouseEnter={(e) => {
        if (disabled) return;
        e.currentTarget.style.background = 'var(--accent-primary-hover)';
        e.currentTarget.style.transform = 'translateY(-1px)';
        e.currentTarget.style.boxShadow = '0 4px 12px rgba(124,58,237,0.3)';
      }}
      onMouseLeave={(e) => {
        if (disabled) return;
        e.currentTarget.style.background = 'var(--accent-primary)';
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = '0 1px 3px rgba(124,58,237,0.2)';
      }}
    >
      {children}
    </button>
  );
}

const secondaryBtnBase = {
  padding: '6px 12px', fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)',
  background: 'var(--bg-subtle)', border: '1px solid var(--border-default)', borderRadius: 8,
  cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
  transition: 'background 0.12s, border-color 0.12s, color 0.12s',
};

export function SecondaryButton({ children, onClick, disabled, style, title, danger }) {
  const base = danger
    ? { ...secondaryBtnBase, color: 'var(--state-danger)', background: 'var(--bg-panel)', borderColor: 'var(--state-danger-border)' }
    : secondaryBtnBase;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{ ...base, opacity: disabled ? 0.5 : 1, cursor: disabled ? 'not-allowed' : 'pointer', ...style }}
      onMouseEnter={(e) => {
        if (disabled) return;
        e.currentTarget.style.background = danger ? 'var(--state-danger-soft)' : 'var(--bg-hover)';
        e.currentTarget.style.borderColor = danger ? 'var(--state-danger)' : 'var(--border-strong)';
      }}
      onMouseLeave={(e) => {
        if (disabled) return;
        // Restore what the caller asked for (e.g. the accent-tinted
        // ImportButton), not the plain base — otherwise one hover strips
        // the tint for good.
        e.currentTarget.style.background = style?.background ?? base.background;
        if (style?.border) e.currentTarget.style.border = style.border;
        else e.currentTarget.style.borderColor = danger ? 'var(--state-danger-border)' : 'var(--border-default)';
      }}
    >
      {children}
    </button>
  );
}

// The one "import a file" affordance for every list page (datasources,
// models, reports): the upload glyph on an accent-tinted secondary button,
// sitting left of the page's primary "+ New …" action.
// `border` (not borderColor): the base style sets the shorthand, and React
// warns when a shorthand and its longhand meet in one style object.
const importBtnAccent = { color: 'var(--accent-primary)', border: '1px solid #ddd6fe', background: 'var(--accent-primary-soft)' };

export function ImportButton({ children, onClick, disabled, title, style }) {
  return (
    <SecondaryButton onClick={onClick} disabled={disabled} title={title} style={{ ...importBtnAccent, ...style }}>
      <TbUpload size={16} />
      {children}
    </SecondaryButton>
  );
}

// The product mark alone (the "O" of the wordmark, the same file the shell
// shows in compact mode): it reads on both themes at icon size.
export function OpenReportMark({ size = 16 }) {
  return <img src="/favicon.png" alt="" aria-hidden="true" style={{ height: size, width: 'auto', display: 'block' }} />;
}

// Simple Icons no longer ships Microsoft marks, so the Power BI glyph is drawn
// here: three rising bars in the product's yellow (a theme variable, the
// brand yellow washes out on a light background — see the connector marks).
export function PowerBiMark({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" fill="var(--brand-powerbi)">
      <rect x="1" y="9" width="3.6" height="6" rx="1" />
      <rect x="6.2" y="5" width="3.6" height="10" rx="1" />
      <rect x="11.4" y="1" width="3.6" height="14" rx="1" />
    </svg>
  );
}

// One Import button that opens the list of sources a page can import from
// (an Open Report file, a Power BI template, later Looker Studio…): the
// sources multiply, the header keeps a single affordance. `items` =
// [{ key, icon, label, hint, onClick, disabled }]; a disabled item announces a
// source that is not there yet.
const importMenuPanel = {
  position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 20,
  minWidth: 240, padding: 4,
  background: 'var(--bg-panel)', border: '1px solid var(--border-default)',
  borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
  display: 'flex', flexDirection: 'column',
};
const importMenuItem = {
  display: 'flex', alignItems: 'center', gap: 10,
  padding: '8px 12px', fontSize: 13,
  background: 'transparent', border: 'none', borderRadius: 4,
  color: 'var(--text-secondary)', cursor: 'pointer', textAlign: 'left', whiteSpace: 'nowrap',
};
const importMenuHint = { fontSize: 11, color: 'var(--text-disabled)', marginLeft: 'auto', paddingLeft: 12 };

export function ImportMenuButton({ children, items, title, disabled }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onEsc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onEsc); };
  }, [open]);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <ImportButton onClick={() => setOpen((o) => !o)} disabled={disabled} title={title}>
        {children}
        <TbChevronDown size={14} style={{ marginLeft: 2 }} />
      </ImportButton>
      {open && (
        <div style={importMenuPanel} role="menu">
          {items.map((it) => (
            <button key={it.key} type="button" role="menuitem" style={{ ...importMenuItem, ...(it.disabled ? { cursor: 'default', opacity: 0.55 } : null) }}
              disabled={it.disabled} title={it.title}
              onClick={() => { setOpen(false); it.onClick && it.onClick(); }}
              onMouseEnter={(e) => { if (!it.disabled) e.currentTarget.style.background = 'var(--bg-hover)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
              {it.icon}
              <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{it.label}</span>
              {it.hint && <span style={importMenuHint}>{it.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export const headerBadgeStyle = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '5px 10px', borderRadius: 8,
  background: 'var(--accent-primary-soft)', border: '1px solid var(--accent-primary-border)',
  fontSize: 12, color: 'var(--accent-primary-text)', fontWeight: 500,
  maxWidth: 240, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
};
