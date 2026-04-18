import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import api from '../utils/api';
import { TbShield, TbEdit, TbEye, TbTrash, TbUserPlus, TbKey, TbArrowLeft } from 'react-icons/tb';

const ROLES = [
  { value: 'admin', label: 'Admin', color: '#dc2626', icon: TbShield, desc: 'Full access + user management' },
  { value: 'editor', label: 'Editor', color: '#f59e0b', icon: TbEdit, desc: 'Create/edit reports, models, datasources' },
  { value: 'viewer', label: 'Viewer', color: '#3b82f6', icon: TbEye, desc: 'View reports only' },
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
    return <div style={{ padding: 60, textAlign: 'center', color: '#dc2626' }}>Admin access required</div>;
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f1f5f9' }}>
      <header style={headerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => navigate('/')} style={backBtn}><TbArrowLeft size={16} /> Back</button>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 8 }}>
            <TbShield size={22} /> Admin Console
          </h1>
        </div>
        <button onClick={() => setShowCreate(true)} style={primaryBtn}>
          <TbUserPlus size={16} style={{ marginRight: 4 }} /> Add User
        </button>
      </header>

      <main style={{ maxWidth: 900, margin: '0 auto', padding: '32px 20px' }}>
        {/* Role legend */}
        <div style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
          {ROLES.map((r) => {
            const Icon = r.icon;
            return (
              <div key={r.value} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#64748b' }}>
                <Icon size={14} color={r.color} /> <strong style={{ color: r.color }}>{r.label}</strong> — {r.desc}
              </div>
            );
          })}
        </div>

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
          <div style={{ textAlign: 'center', color: '#94a3b8', marginTop: 40 }}>Loading...</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', backgroundColor: '#fff', borderRadius: 8, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
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
                          <button onClick={() => deleteUser(u.id)} title="Delete" style={{ ...iconBtn, color: '#dc2626' }}>
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

const headerStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 24px', backgroundColor: '#fff', borderBottom: '1px solid #e2e8f0' };
const backBtn = { display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', background: 'none', border: '1px solid #e2e8f0', borderRadius: 6, color: '#64748b', cursor: 'pointer', fontSize: 13, fontWeight: 500 };
const primaryBtn = { padding: '8px 16px', fontSize: 13, fontWeight: 600, border: 'none', borderRadius: 6, background: '#3b82f6', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center' };
const secondaryBtn = { padding: '8px 16px', fontSize: 13, background: '#fff', color: '#475569', border: '1px solid #e2e8f0', borderRadius: 6, cursor: 'pointer' };
const inputStyle = { padding: '8px 10px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13, outline: 'none', boxSizing: 'border-box' };
const formCard = { backgroundColor: '#fff', padding: 20, borderRadius: 8, border: '1px solid #e2e8f0', marginBottom: 20 };
const thStyle = { padding: '10px 14px', textAlign: 'left', fontSize: 12, color: '#64748b', fontWeight: 600, textTransform: 'uppercase' };
const tdStyle = { padding: '10px 14px', fontSize: 13, color: '#334155' };
const iconBtn = { background: 'none', border: '1px solid #e2e8f0', borderRadius: 4, padding: '4px 6px', cursor: 'pointer', color: '#475569', display: 'flex', alignItems: 'center' };
