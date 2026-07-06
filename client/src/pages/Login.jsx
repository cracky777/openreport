import { useState } from 'react';
import api from '../utils/api';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../hooks/useTheme';

const _hs0 = { marginBottom: 4 };
const _hs1 = { height: 36 };
const _hs2 = { color: 'var(--text-primary)', marginBottom: 8, fontSize: 16, fontWeight: 600 };
const _hs3 = { color: 'var(--text-muted)', marginBottom: 20, fontSize: 14, lineHeight: 1.5 };
const _hs4 = { color: 'var(--text-primary)' };
const _hs5 = { fontSize: 12, color: 'var(--text-muted)', marginTop: 12, lineHeight: 1.5 };
const _hs6 = { textAlign: 'center', marginTop: 16, fontSize: 13 };
const _hs7 = { color: 'var(--accent-primary)', border: '1px solid transparent', background: 'transparent', cursor: 'pointer', fontWeight: 500, padding: '4px 8px', borderRadius: 4 };
const _hs8 = { marginBottom: 4 };
const _hs9 = { height: 36 };
const _hs10 = { color: 'var(--text-muted)', marginBottom: 24, fontSize: 14 };
const _hs11 = { background: '#fef2f2', color: 'var(--state-danger)', padding: '8px 12px', borderRadius: 6, fontSize: 13, marginBottom: 16 };
const _hs12 = { textAlign: 'center', marginTop: 16, fontSize: 13, color: 'var(--text-muted)' };
const _hs13 = { color: 'var(--accent-primary)', border: '1px solid transparent', background: 'transparent', cursor: 'pointer', fontWeight: 500, padding: '4px 8px', borderRadius: 4 };

export default function Login() {
  const { login, register } = useAuth();
  const { resolved: themeResolved } = useTheme();
  const logoSrc = themeResolved === 'dark' ? '/logo-dark.png' : '/logo.png';
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  // Email-verification flow state (cloud only):
  //   pendingEmail = the email that needs to confirm — set after register,
  //                  or after a login attempt that returned EMAIL_UNVERIFIED.
  //   resendStatus = 'idle' | 'sending' | 'sent' | 'error'
  const [pendingEmail, setPendingEmail] = useState(null);
  const [resendStatus, setResendStatus] = useState('idle');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      if (isRegister) {
        const result = await register(email, password, displayName);
        if (result && result.verificationRequired) {
          setPendingEmail(email);
        }
      } else {
        await login(email, password);
      }
    } catch (err) {
      const data = err.response?.data;
      if (data?.code === 'EMAIL_UNVERIFIED') {
        setPendingEmail(data.email || email);
        setError('');
      } else {
        setError(data?.error || 'An error occurred');
      }
    }
  };

  const handleResend = async () => {
    if (!pendingEmail) return;
    setResendStatus('sending');
    try {
      await api.post('/auth/resend-verification', { email: pendingEmail });
      setResendStatus('sent');
    } catch {
      setResendStatus('error');
    }
  };

  const resetFlow = () => {
    setPendingEmail(null);
    setResendStatus('idle');
    setError('');
  };

  // Verification-pending screen — shown after register or after a login
  // attempt that hit EMAIL_UNVERIFIED.
  if (pendingEmail) {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <div style={_hs0}>
            <img src={logoSrc} alt="Open Report" style={_hs1} />
          </div>
          <p style={_hs2}>Check your email</p>
          <p style={_hs3}>
            We sent a verification link to <strong style={_hs4}>{pendingEmail}</strong>.
            Click the link to confirm your address, then sign in.
          </p>
          <button className="btn-hover btn-hover-primary" onClick={handleResend} disabled={resendStatus === 'sending' || resendStatus === 'sent'} style={{ ...buttonStyle, opacity: resendStatus === 'sent' ? 0.6 : 1 }}>
            {resendStatus === 'sending' ? 'Sending…' :
              resendStatus === 'sent' ? 'Email sent — check your inbox' :
              resendStatus === 'error' ? 'Retry — something went wrong' :
              'Resend verification email'}
          </button>
          <p style={_hs5}>
            Didn't receive anything? Check your spam folder. The resend button is rate-limited to once per minute.
          </p>
          <div style={_hs6}>
            <button className="btn-hover btn-hover-accent" onClick={resetFlow} style={_hs7}>
              ← Back to sign in
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        <div style={_hs8}>
          <img src={logoSrc} alt="Open Report" style={_hs9} />
        </div>
        <p style={_hs10}>
          {isRegister ? 'Create your account' : 'Sign in to your account'}
        </p>

        {error && (
          <div style={_hs11}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {isRegister && (
            <input
              type="text"
              placeholder="Display name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              style={inputStyle}
            />
          )}
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={inputStyle}
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={inputStyle}
          />
          <button type="submit" className="btn-hover btn-hover-primary" style={buttonStyle}>
            {isRegister ? 'Register' : 'Sign in'}
          </button>
        </form>

        <div style={_hs12}>
          {isRegister ? 'Already have an account?' : "Don't have an account?"}{' '}
          <button
            className="btn-hover btn-hover-accent"
            onClick={() => { setIsRegister(!isRegister); setError(''); }}
            style={_hs13}
          >
            {isRegister ? 'Sign in' : 'Register'}
          </button>
        </div>
      </div>
    </div>
  );
}

const containerStyle = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: 'var(--bg-app)',
};

const cardStyle = {
  backgroundColor: 'var(--bg-panel)',
  padding: 40,
  borderRadius: 12,
  boxShadow: '0 4px 6px rgba(0,0,0,0.07)',
  width: 380,
};

const inputStyle = {
  width: '100%',
  padding: '10px 12px',
  border: '1px solid var(--border-default)',
  borderRadius: 6,
  fontSize: 14,
  marginBottom: 12,
  outline: 'none',
  boxSizing: 'border-box',
};

const buttonStyle = {
  width: '100%',
  padding: '10px 0',
  backgroundColor: 'var(--accent-primary)',
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
};
