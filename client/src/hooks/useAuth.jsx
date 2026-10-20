import { useState, useEffect, createContext, useContext } from 'react';
import api from '../utils/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  // Non-sensitive instance-wide policies (from /auth/me) the UI adapts to,
  // e.g. hiding "Share public link" when the admin restricted it. The server
  // enforces regardless; this only avoids dead-end menu items.
  const [instance, setInstance] = useState({ publicSharingPolicy: 'everyone', apiEnabled: false, apiAllowed: false });

  useEffect(() => {
    let cancelled = false;
    // Only a 401 means "not signed in". Anything else (the dev server
    // restarting behind the Vite proxy, a dropped connection) is retried a
    // few times before giving up, so a page reload at the wrong second does
    // not throw a signed-in user onto the login page.
    const check = async (attempt = 0) => {
      try {
        const res = await api.get('/auth/me');
        if (cancelled) return;
        setUser(res.data.user);
        if (res.data.instance) setInstance(res.data.instance);
      } catch (err) {
        if (cancelled) return;
        if (err.response?.status !== 401 && attempt < 5) {
          await new Promise((r) => setTimeout(r, 1500));
          return check(attempt + 1);
        }
        setUser(null);
      }
      setLoading(false);
    };
    check();
    return () => { cancelled = true; };
  }, []);

  const login = async (email, password) => {
    const res = await api.post('/auth/login', { email, password });
    setUser(res.data.user);
    return res.data.user;
  };

  const register = async (email, password, displayName) => {
    const res = await api.post('/auth/register', { email, password, displayName });
    // In cloud mode the server returns verificationRequired:true and does
    // NOT auto-log-in. Return the full response so the Login page can
    // branch on it instead of jumping into the app.
    if (res.data?.verificationRequired) return { verificationRequired: true, user: res.data.user };
    setUser(res.data.user);
    return res.data.user;
  };

  const logout = async () => {
    await api.post('/auth/logout');
    setUser(null);
  };

  // A change the user just made to their account (their Build / Chat mode),
  // reflected at once instead of after the next /auth/me.
  const updateUser = (patch) => setUser((u) => (u ? { ...u, ...patch } : u));

  return (
    <AuthContext.Provider value={{ user, loading, instance, login, register, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
