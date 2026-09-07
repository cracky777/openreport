import { useNavigate } from 'react-router-dom';
import { TbArrowLeft, TbPlugConnected } from 'react-icons/tb';
import ApiTokensPanel from '../components/ApiTokens/ApiTokensPanel';

// A user's own API tokens, reachable from the account menu. Admins get the same
// panel inside Admin › API, under the instance switch that governs it.
export default function ApiTokens() {
  const navigate = useNavigate();

  return (
    <div style={pageStyle}>
      <header style={headerStyle}>
        <button className="btn-hover" onClick={() => navigate('/')} style={backBtn}>
          <TbArrowLeft size={16} /> Back
        </button>
        <div style={titleStyle}><TbPlugConnected size={18} /> API tokens</div>
      </header>

      <main style={mainStyle}>
        <ApiTokensPanel />
      </main>
    </div>
  );
}

const pageStyle = { minHeight: '100vh', backgroundColor: 'var(--bg-app)' };
const headerStyle = {
  display: 'flex', alignItems: 'center', gap: 14, padding: '14px 20px',
  background: 'var(--bg-panel)', borderBottom: '1px solid var(--border-default)',
};
const backBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px',
  fontSize: 13, borderRadius: 6, cursor: 'pointer',
  background: 'transparent', border: '1px solid var(--border-default)', color: 'var(--text-secondary)',
};
const titleStyle = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 16, fontWeight: 600 };
const mainStyle = { maxWidth: 900, margin: '0 auto', padding: '32px 20px' };
