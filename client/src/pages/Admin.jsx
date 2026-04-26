import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import api from '../utils/api';
import { TbShield, TbEdit, TbEye, TbTrash, TbUserPlus, TbKey, TbExternalLink } from 'react-icons/tb';
import { headerShellStyle, headerTitleStyle, BackButton, PrimaryButton } from '../components/PageHeader/PageHeader';
// Cloud edition contributes extra admin links here (e.g. Billing). Empty in OSS builds.
import { adminLinks as cloudAdminLinks } from '../cloud';

const ROLES = [
  { value: 'admin', label: 'Admin', color: 'var(--state-danger)', icon: TbShield, desc: 'Full access + user management' },
  { value: 'editor', label: 'Editor', color: '#f59e0b', icon: TbEdit, desc: 'Create/edit reports, models, datasources' },
  { value: 'viewer', label: 'Viewer', color: 'var(--accent-primary)', icon: TbEye, desc: 'View reports only' },
];

export default function Admin() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ email: '', password: '', displayName: '', role: 'viewer' });
  const [resetPw, setResetPw] = useState(null); // userId
  const [newPw, setNewPw] = useState('');

  useEffect(() => {
    api.get('/admin/users')
      .then((res) => setUsers(res.data.users))
      .catch(() => navigate('/'))
      .finally(() => setLoading(false));
  }, [navigate]);

  const updateRole = async (userId, role) => {
    try {
      await api.put(`/admin/users/${userId}/role`, { role });
      setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, role } : u));
    } catch (err) {
      alert(err.response?.data?.error || 'Failed');
    }
  };

  const deleteUser = async (userId) => {
    if (!confirm('Delete this user?')) return;
    await api.delete(`/admin/users/${userId}`);
    setUsers((prev) => prev.filter((u) => u.id !== userId));
  };

  const createUser = async () => {
    try {
      const res = await api.post('/admin/users', createForm);
      setUsers((prev) => [...prev, { ...res.data.user, created_at: new Date().toISOString() }]);
      setShowCreate(false);
      setCreateForm({ email: '', password: '', displayName: '', role: 'viewer' });
    } catch (err) {
      alert(err.response?.data?.error || 'Failed');
    }
  };

  const resetPassword = async (userId) => {
    try {
      await api.put(`/admin/users/${userId}/password`, { password: newPw });
      setResetPw(null);
      setNewPw('');
      alert('Password reset');
    } catch (err) {
      alert(err.response?.data?.error || 'Failed');
    }
  };

  if (user?.role !== 'admin') {
    return <div style={{ padding: 60, textAlign: 'center', color: 'var(--state-danger)' }}>Admin access required</div>;
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--bg-app)' }}>
      <header style={headerShellStyle}>
        <BackButton to="/" />
        <h1 style={{ ...headerTitleStyle, display: 'flex', alignItems: 'center', gap: 8 }}>
          <TbShield size={18} color="var(--accent-primary)" /> Admin Console
        </h1>
        <div style={{ flex: 1 }} />
        <PrimaryButton onClick={() => setShowCreate(true)}>
          <TbUserPlus size={16} /> Add User
        </PrimaryButton>
      </header>

      <main style={{ maxWidth: 900, margin: '0 auto', padding: '32px 20px' }}>
        {/* Role legend */}
        <div style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
          {ROLES.map((r) => {
            const Icon = r.icon;
            return (
              <div key={r.value} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)' }}>
                <Icon size={14} color={r.color} /> <strong style={{ color: r.color }}>{r.label}</strong> — {r.desc}
              </div>
            );
          })}
        </div>

        {/* Cloud-only admin links (Billing, etc.). Empty list = nothing rendered in OSS. */}
        {cloudAdminLinks && cloudAdminLinks.length > 0 && (
          <div style={{
            display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap',
          }}>
            {cloudAdminLinks.map((link) => {
              const Icon = link.icon || TbExternalLink;
              return (
                <Link key={link.to} to={link.to} style={cloudLinkCard}>
                  <Icon size={18} color="var(--accent-primary)" />
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{link.label}</span>
                    {link.description && (
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{link.description}</span>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        {/* Create user modal */}
        {showCreate && (
          <div style={formCard}>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>New User</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
              <input placeholder="Email" value={createForm.email}
                onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })} style={inputStyle} />
              <input placeholder="Password" type="password" value={createForm.password}
                onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })} style={inputStyle} />
              <input placeholder="Display name" value={createForm.displayName}
                onChange={(e) => setCreateForm({ ...createForm, displayName: e.target.value })} style={inputStyle} />
              <select value={createForm.role} onChange={(e) => setCreateForm({ ...createForm, role: e.target.value })} style={inputStyle}>
                {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowCreate(false)} style={secondaryBtn}>Cancel</button>
              <button onClick={createUser} style={primaryBtn}>Create</button>
            </div>
          </div>
        )}

        {/* Users table */}
        {loading ? (
          <div style={{ textAlign: 'center', color: 'var(--text-disabled)', marginTop: 40 }}>Loading...</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', backgroundColor: 'var(--bg-panel)', borderRadius: 8, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                <th style={thStyle}>User</th>
                <th style={thStyle}>Email</th>
                <th style={thStyle}>Role</th>
                <th style={thStyle}>Created</th>
                <th style={thStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const roleDef = ROLES.find((r) => r.value === u.role) || ROLES[2];
                return (
                  <tr key={u.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={tdStyle}>{u.display_name || u.email.split('@')[0]}</td>
                    <td style={tdStyle}>{u.email}</td>
                    <td style={tdStyle}>
                      <select value={u.role} onChange={(e) => updateRole(u.id, e.target.value)}
                        style={{ ...inputStyle, padding: '4px 8px', color: roleDef.color, fontWeight: 600, width: 100 }}>
                        {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                      </select>
                    </td>
                    <td style={tdStyle}>{new Date(u.created_at).toLocaleDateString()}</td>
                    <td style={tdStyle}>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button onClick={() => { setResetPw(u.id); setNewPw(''); }} title="Reset password" style={iconBtn}>
                          <TbKey size={14} />
                        </button>
                        {u.id !== user.id && (
                          <button onClick={() => deleteUser(u.id)} title="Delete" style={{ ...iconBtn, color: 'var(--state-danger)' }}>
                            <TbTrash size={14} />
                          </button>
                        )}
                      </div>
                      {resetPw === u.id && (
                        <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                          <input type="password" placeholder="New password" value={newPw}
                            onChange={(e) => setNewPw(e.target.value)} style={{ ...inputStyle, padding: '4px 6px', fontSize: 12, width: 120 }} />
                          <button onClick={() => resetPassword(u.id)} style={{ ...primaryBtn, padding: '4px 8px', fontSize: 11 }}>Set</button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </main>
    </div>
  );
}

const primaryBtn = { padding: '8px 16px', fontSize: 13, fontWeight: 600, border: 'none', borderRadius: 6, background: 'var(--accent-primary)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center' };
const secondaryBtn = { padding: '8px 16px', fontSize: 13, background: 'var(--bg-panel)', color: 'var(--text-secondary)', border: '1px solid var(--border-default)', borderRadius: 6, cursor: 'pointer' };
const inputStyle = { padding: '8px 10px', border: '1px solid var(--border-default)', borderRadius: 6, fontSize: 13, outline: 'none', boxSizing: 'border-box' };
const formCard = { backgroundColor: 'var(--bg-panel)', padding: 20, borderRadius: 8, border: '1px solid var(--border-default)', marginBottom: 20 };
const thStyle = { padding: '10px 14px', textAlign: 'left', fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' };
const tdStyle = { padding: '10px 14px', fontSize: 13, color: 'var(--text-secondary)' };
const iconBtn = { background: 'transparent', border: '1px solid var(--border-default)', borderRadius: 4, padding: '4px 6px', cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center' };
const cloudLinkCard = {
  display: 'flex', alignItems: 'center', gap: 10,
  padding: '10px 14px', textDecoration: 'none',
  background: 'var(--bg-panel)', border: '1px solid var(--border-default)',
  borderRadius: 6, transition: 'border-color 0.12s',
};
