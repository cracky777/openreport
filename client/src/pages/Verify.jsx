import { useEffect, useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import api from '../utils/api';

// Email-verification landing page. Reads the token from the URL, POSTs it
// to the cloud-only endpoint, then bounces the user to /login. The
// endpoint 404s in OSS — but OSS users never get a verification email, so
// they never land here organically.

export default function Verify() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token');
  const [state, setState] = useState({ status: 'pending', message: '' });

  useEffect(() => {
    if (!token) {
      setState({ status: 'error', message: 'No token in the URL.' });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await api.post('/auth/verify', { token });
        if (cancelled) return;
        if (res.data?.alreadyVerified) {
          setState({ status: 'already', message: 'Your email was already verified.' });
        } else {
          setState({ status: 'ok', message: 'Email verified — you can now sign in.' });
        }
        // Auto-bounce to login after 2s on success.
        setTimeout(() => { if (!cancelled) navigate('/login'); }, 2000);
      } catch (err) {
        if (cancelled) return;
        const code = err.response?.data?.code;
        const msg = err.response?.data?.error || err.message;
        setState({ status: 'error', message: msg, code });
      }
    })();
    return () => { cancelled = true; };
  }, [token, navigate]);

  return (
    <div style={shell}>
      <div style={card}>
        <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 16 }}>Email verification</div>
        {state.status === 'pending' && <div style={{ color: 'var(--text-muted)' }}>Verifying your email…</div>}
        {state.status === 'ok' && <div style={{ color: 'var(--state-success)', fontWeight: 500 }}>{state.message}</div>}
        {state.status === 'already' && <div style={{ color: 'var(--text-secondary)' }}>{state.message}</div>}
        {state.status === 'error' && (
          <div>
            <div style={{ color: 'var(--state-danger)', marginBottom: 12 }}>{state.message}</div>
            {state.code === 'EXPIRED_TOKEN' && (
              <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
                The link is older than 24&nbsp;hours. Sign in again to receive a fresh verification email.
              </p>
            )}
          </div>
        )}
        <div style={{ marginTop: 24, fontSize: 13 }}>
          <Link to="/login" style={{ color: 'var(--accent-primary)', textDecoration: 'none' }}>Go to sign in →</Link>
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
