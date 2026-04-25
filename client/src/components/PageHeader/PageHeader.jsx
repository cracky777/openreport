import { useNavigate } from 'react-router-dom';
import { TbArrowLeft } from 'react-icons/tb';

// Shared page header styles matching the editor toolbar design language.

export const headerShellStyle = {
  display: 'flex', alignItems: 'center', gap: 12,
  padding: '10px 20px', backgroundColor: 'var(--bg-panel)',
  borderBottom: '1px solid var(--border-default)', flexShrink: 0,
};

export const headerTitleStyle = {
  fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', margin: 0,
};

const backBtnBase = {
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px',
  background: 'var(--bg-subtle)', border: '1px solid var(--border-default)', borderRadius: 8,
  color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 13, fontWeight: 500,
  transition: 'background 0.12s, border-color 0.12s, color 0.12s',
};

export function BackButton({ to = '/', onClick, label = 'Back' }) {
  const navigate = useNavigate();
  const handle = onClick || (() => navigate(to));
  return (
    <button
      onClick={handle}
      style={backBtnBase}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--bg-hover)';
        e.currentTarget.style.borderColor = 'var(--border-strong)';
        e.currentTarget.style.color = 'var(--text-primary)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'var(--bg-subtle)';
        e.currentTarget.style.borderColor = 'var(--border-default)';
        e.currentTarget.style.color = 'var(--text-secondary)';
      }}
    >
      <TbArrowLeft size={16} />
      <span>{label}</span>
    </button>
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
        e.currentTarget.style.background = base.background;
        e.currentTarget.style.borderColor = danger ? 'var(--state-danger-border)' : 'var(--border-default)';
      }}
    >
      {children}
    </button>
  );
}

export const headerBadgeStyle = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '5px 10px', borderRadius: 8,
  background: 'var(--accent-primary-soft)', border: '1px solid var(--accent-primary-border)',
  fontSize: 12, color: 'var(--accent-primary-text)', fontWeight: 500,
  maxWidth: 240, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
};
