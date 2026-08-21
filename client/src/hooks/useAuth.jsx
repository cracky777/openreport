import { useState, useEffect, createContext, useContext } from 'react';
import api from '../utils/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  // Non-sensitive instance-wide policies (from /auth/me) the UI adapts to,
  // e.g. hiding "Share public link" when the admin restricted it. The server
  // enforces regardless; this only avoids dead-end menu items.
  const [instance, setInstance] = useState({ publicSharingPolicy: 'everyone' });

  useEffect(() => {
    api.get('/auth/me')
      .then((res) => {
        setUser(res.data.user);
        if (res.data.instance) setInstance(res.data.instance);
      })
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
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

  return (
    <AuthContext.Provider value={{ user, loading, instance, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
