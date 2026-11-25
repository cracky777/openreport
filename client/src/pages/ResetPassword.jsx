import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api from '../utils/api';

// Landing page of the "Forgot password" mail (server routes/auth.js
// /reset-password). The token is only spent when the new password is sent.
export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [status, setStatus] = useState('idle'); // idle | saving | done
  const [error, setError] = useState(token ? '' : 'No token in the URL. Open the link from the email again.');

  const submit = async (e) => {
    e.preventDefault();
    if (password !== confirm) { setError('The two passwords differ.'); return; }
    setError('');
    setStatus('saving');
    try {
      await api.post('/auth/reset-password', { token, password });
      setStatus('done');
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong');
      setStatus('idle');
    }
  };

  return (
    <div style={shell}>
      <div style={card}>
        <div style={titleStyle}>Set a new password</div>
        {status === 'done' ? (
          <div style={doneStyle}>Your password is changed. Sign in with it.</div>
        ) : (
          <form onSubmit={submit}>
            {error && <div style={errorStyle}>{error}</div>}
            <input
              type="password" placeholder="New password (12 characters or more)" value={password}
              onChange={(e) => setPassword(e.target.value)} required autoFocus autoComplete="new-password"
              disabled={!token} style={inputStyle}
            />
            <input
              type="password" placeholder="Repeat the new password" value={confirm}
              onChange={(e) => setConfirm(e.target.value)} required autoComplete="new-password"
              disabled={!token} style={inputStyle}
            />
            <button type="submit" className="btn-hover btn-hover-primary" disabled={!token || status === 'saving'} style={buttonStyle}>
              {status === 'saving' ? 'Saving…' : 'Change my password'}
            </button>
          </form>
        )}
        <div style={footStyle}>
          <Link to="/login" style={linkStyle}>Go to sign in →</Link>
        </div>
      </div>
    </div>
  );
}

const shell = {
  minHeight: '100vh',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: 20, background: 'var(--bg-app)',
};
const card = {
  width: '100%', maxWidth: 420,
  padding: 32, borderRadius: 12,
  background: 'var(--bg-panel)', border: '1px solid var(--border-default)',
  boxShadow: 'var(--shadow-md)',
  color: 'var(--text-primary)',
};
const titleStyle = { fontSize: 22, fontWeight: 700, marginBottom: 16 };
const doneStyle = { color: 'var(--state-success)', fontWeight: 500 };
const errorStyle = { background: '#fef2f2', color: 'var(--state-danger)', padding: '8px 12px', borderRadius: 6, fontSize: 13, marginBottom: 16 };
const footStyle = { marginTop: 24, fontSize: 13 };
const linkStyle = { color: 'var(--accent-primary)', textDecoration: 'none' };
const inputStyle = {
  width: '100%', padding: '10px 12px', border: '1px solid var(--border-default)', borderRadius: 6,
  fontSize: 14, marginBottom: 12, outline: 'none', boxSizing: 'border-box',
};
const buttonStyle = {
  width: '100%', padding: '10px 0', backgroundColor: 'var(--accent-primary)', color: '#fff',
  border: 'none', borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: 'pointer',
};
