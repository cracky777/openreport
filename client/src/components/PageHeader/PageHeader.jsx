import { useNavigate } from 'react-router-dom';
import { TbArrowLeft } from 'react-icons/tb';

// Shared page header styles matching the editor toolbar design language.

export const headerShellStyle = {
  display: 'flex', alignItems: 'center', gap: 12,
  padding: '10px 20px', backgroundColor: '#fff',
  borderBottom: '1px solid #e2e8f0', flexShrink: 0,
};

export const headerTitleStyle = {
  fontSize: 16, fontWeight: 700, color: '#0f172a', margin: 0,
};

const backBtnBase = {
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px',
  background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8,
  color: '#475569', cursor: 'pointer', fontSize: 13, fontWeight: 500,
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
        e.currentTarget.style.background = '#f1f5f9';
        e.currentTarget.style.borderColor = '#cbd5e1';
        e.currentTarget.style.color = '#0f172a';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = '#f8fafc';
        e.currentTarget.style.borderColor = '#e2e8f0';
        e.currentTarget.style.color = '#475569';
      }}
    >
      <TbArrowLeft size={16} />
      <span>{label}</span>
    </button>
  );
}

const primaryBtnBase = {
  padding: '7px 18px', fontSize: 13, fontWeight: 600, border: 'none',
  borderRadius: 8, background: '#7c3aed', color: '#fff',
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
        e.currentTarget.style.background = '#6d28d9';
        e.currentTarget.style.transform = 'translateY(-1px)';
        e.currentTarget.style.boxShadow = '0 4px 12px rgba(124,58,237,0.3)';
      }}
      onMouseLeave={(e) => {
        if (disabled) return;
        e.currentTarget.style.background = '#7c3aed';
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = '0 1px 3px rgba(124,58,237,0.2)';
      }}
    >
      {children}
    </button>
  );
}

const secondaryBtnBase = {
  padding: '6px 12px', fontSize: 13, fontWeight: 500, color: '#475569',
  background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8,
  cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
  transition: 'background 0.12s, border-color 0.12s, color 0.12s',
};

export function SecondaryButton({ children, onClick, disabled, style, title, danger }) {
  const base = danger
    ? { ...secondaryBtnBase, color: '#dc2626', background: '#fff', borderColor: '#fecaca' }
    : secondaryBtnBase;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{ ...base, opacity: disabled ? 0.5 : 1, cursor: disabled ? 'not-allowed' : 'pointer', ...style }}
      onMouseEnter={(e) => {
        if (disabled) return;
        e.currentTarget.style.background = danger ? '#fef2f2' : '#f1f5f9';
        e.currentTarget.style.borderColor = danger ? '#fca5a5' : '#cbd5e1';
      }}
      onMouseLeave={(e) => {
        if (disabled) return;
        e.currentTarget.style.background = base.background;
        e.currentTarget.style.borderColor = base.border?.split(' ')[2] || (danger ? '#fecaca' : '#e2e8f0');
      }}
    >
      {children}
    </button>
  );
}

export const headerBadgeStyle = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '5px 10px', borderRadius: 8,
  background: '#faf8ff', border: '1px solid #ede9fe',
  fontSize: 12, color: '#4c1d95', fontWeight: 500,
  maxWidth: 240, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
};
