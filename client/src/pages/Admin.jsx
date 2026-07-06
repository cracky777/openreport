import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import api from '../utils/api';
import { TbShield, TbEdit, TbEye, TbTrash, TbUserPlus, TbKey, TbExternalLink, TbClock } from 'react-icons/tb';
import { formatDuration, formatBytes } from '../utils/formatHuman';
import { headerShellStyle, headerTitleStyle, BackButton, PrimaryButton } from '../components/PageHeader/PageHeader';
// Cloud edition contributes extra admin links here (e.g. Billing). Empty in OSS builds.
import { adminLinks as cloudAdminLinks } from '../cloud';

const _hs0 = { padding: 60, textAlign: 'center', color: 'var(--state-danger)' };
const _hs1 = { minHeight: '100vh', backgroundColor: 'var(--bg-app)' };
const _hs2 = { flex: 1 };
const _hs3 = { maxWidth: 900, margin: '0 auto', padding: '32px 20px' };
const _hs4 = { fontSize: 14, fontWeight: 600, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 };
const _hs5 = { height: 1, background: 'var(--border-default)', margin: '14px 0' };
const _hs6 = { display: 'flex', gap: 16, marginBottom: 24 };
const _hs7 = { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)' };
const _hs8 = { fontSize: 14, fontWeight: 600, marginBottom: 12 };
const _hs9 = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 };
const _hs10 = { display: 'flex', gap: 8, justifyContent: 'flex-end' };
const _hs11 = { textAlign: 'center', color: 'var(--text-disabled)', marginTop: 40 };
const _hs12 = { width: '100%', borderCollapse: 'collapse', backgroundColor: 'var(--bg-panel)', borderRadius: 8, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' };
const _hs13 = { borderBottom: '2px solid #e2e8f0' };
const _hs14 = { borderBottom: '1px solid #f1f5f9' };
const _hs15 = { display: 'flex', gap: 4 };
const _hs16 = { display: 'flex', gap: 4, marginTop: 4 };
const _hs17 = { display: 'flex', flexDirection: 'column', gap: 8 };
const _hs18 = { display: 'flex', justifyContent: 'space-between', alignItems: 'center' };
const _hs19 = { fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' };
const _hs20 = { fontSize: 11, color: 'var(--text-disabled)' };
const _hs21 = { display: 'flex', alignItems: 'center', gap: 12 };
const _hs22 = { flex: 1 };
const _hs23 = { fontSize: 12, color: 'var(--text-muted)' };
const _hs24 = { fontSize: 11, color: 'var(--text-muted)', margin: 0 };
const _hs25 = { display: 'flex', gap: 10, marginBottom: 14 };
const _hs26 = { display: 'flex', flexDirection: 'column', gap: 8 };
const _hs27 = { display: 'flex', justifyContent: 'space-between', alignItems: 'center' };
const _hs28 = { fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' };
const _hs29 = { fontSize: 11, color: 'var(--text-disabled)' };
const _hs30 = { display: 'flex', alignItems: 'center', gap: 10 };
const _hs31 = { fontSize: 12, color: 'var(--text-secondary)' };
const _hs32 = { display: 'flex', alignItems: 'center', gap: 12 };
const _hs33 = { fontSize: 12, color: 'var(--text-secondary)', minWidth: 30 };
const _hs34 = { flex: 1 };
const _hs35 = { fontSize: 12, color: 'var(--text-primary)', fontWeight: 500, minWidth: 56, textAlign: 'right' };
const _hs36 = { display: 'flex', alignItems: 'center', gap: 10 };
const _hs37 = { fontSize: 11, color: 'var(--state-success)' };
const _hs38 = { fontSize: 11, color: 'var(--text-muted)', margin: 0 };

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
  const [settings, setSettings] = useState(null);
  const [savingTimeout, setSavingTimeout] = useState(false);
  const [savingCache, setSavingCache] = useState(false);
  const [flushingCache, setFlushingCache] = useState(false);

  useEffect(() => {
    api.get('/admin/users')
      .then((res) => setUsers(res.data.users))
      .catch(() => navigate('/'))
      .finally(() => setLoading(false));
    api.get('/admin/settings')
      .then((res) => setSettings(res.data))
      .catch(() => { /* admin gate handled by users fetch */ });
  }, [navigate]);

  const saveQueryTimeout = async (seconds) => {
    if (!settings) return;
    setSavingTimeout(true);
    try {
      const res = await api.put('/admin/settings/query-timeout', { queryTimeoutMs: seconds * 1000 });
      setSettings({ ...settings, queryTimeoutMs: res.data.queryTimeoutMs });
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to save');
    } finally {
      setSavingTimeout(false);
    }
  };

  const saveQueryCache = async ({ enabled, ttlSeconds }) => {
    if (!settings) return;
    setSavingCache(true);
    try {
      const body = {};
      if (enabled !== undefined) body.enabled = enabled;
      if (ttlSeconds !== undefined) body.ttlMs = ttlSeconds * 1000;
      const res = await api.put('/admin/settings/query-cache', body);
      setSettings({ ...settings, ...res.data });
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to save');
    } finally {
      setSavingCache(false);
    }
  };

  const flushQueryCache = async () => {
    if (!settings) return;
    if (!confirm('Drop every cached query result on this instance? Next refresh on every report will re-hit the source DB.')) return;
    setFlushingCache(true);
    try {
      const res = await api.post('/admin/settings/query-cache/flush');
      setSettings({
        ...settings,
        queryCacheStats: { ...(settings.queryCacheStats || {}), size: 0 },
        preAggCacheStats: { ...(settings.preAggCacheStats || {}), size: 0 },
        // Surface the count inline instead of through a blocking
        // `alert(...)` that left the button stuck in "Flushing…" until
        // the user dismissed the popup.
        _lastFlushed: { evicted: res.data.evicted, evictedPreAgg: res.data.evictedPreAgg, at: Date.now() },
      });
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete cache');
    } finally {
      setFlushingCache(false);
    }
  };

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
    return <div style={_hs0}>Admin access required</div>;
  }

  return (
    <div style={_hs1}>
      <header style={headerShellStyle}>
        <BackButton to="/" />
        <h1 style={{ ...headerTitleStyle, display: 'flex', alignItems: 'center', gap: 8 }}>
          <TbShield size={18} color="var(--accent-primary)" /> Admin Console
        </h1>
        <div style={_hs2} />
        {/* Cloud-only links (Billing, etc.) sit in the header next to Add User. Empty in OSS. */}
        {(cloudAdminLinks || []).map((link) => {
          const Icon = link.icon || TbExternalLink;
          return (
            <Link key={link.to} to={link.to} style={cloudHeaderLink}>
              <Icon size={16} />
              <span>{link.label}</span>
            </Link>
          );
        })}
        <PrimaryButton onClick={() => setShowCreate(true)}>
          <TbUserPlus size={16} /> Add User
        </PrimaryButton>
      </header>

      <main style={_hs3}>
        {/* System settings — currently just the query timeout. Bounds and
            default come from the server (clamp lives in settingsHelper). */}
        {settings && (
          <div style={{ ...formCard, marginBottom: 24 }}>
            <h3 style={_hs4}>
              <TbClock size={16} color="var(--accent-primary)" /> System Settings
            </h3>
            {/* Storage usage summary — uploaded source files (disk) +
                in-memory caches (RAM). Mirrors what the cloud edition's
                StorageBar shows on the Datasources page, scoped down to
                "this instance" since OSS has no per-tenant breakdown. */}
            <StorageUsageRow
              uploadedFileCount={settings.storage?.uploadedFileCount ?? 0}
              uploadedBytes={settings.storage?.uploadedBytes ?? 0}
              ramBytes={settings.queryCacheStats?.bytes ?? 0}
              rollupBytes={settings.rollupStorage?.bytes ?? 0}
              rollupCount={settings.rollupStorage?.rollups ?? 0}
            />
            <QueryTimeoutControl
              valueMs={settings.queryTimeoutMs}
              minMs={settings.queryTimeoutMinMs}
              maxMs={settings.queryTimeoutMaxMs}
              defaultMs={settings.queryTimeoutDefaultMs}
              onSave={saveQueryTimeout}
              saving={savingTimeout}
            />
            <div style={_hs5} />
            <QueryCacheControl
              enabled={settings.queryCacheEnabled}
              ttlMs={settings.queryCacheTtlMs}
              minMs={settings.queryCacheTtlMinMs}
              maxMs={settings.queryCacheTtlMaxMs}
              stats={settings.queryCacheStats}
              preAggStats={settings.preAggCacheStats}
              lastFlushed={settings._lastFlushed}
              onSave={saveQueryCache}
              onFlush={flushQueryCache}
              saving={savingCache}
              flushing={flushingCache}
            />
          </div>
        )}

        {/* Role legend */}
        <div style={_hs6}>
          {ROLES.map((r) => {
            const Icon = r.icon;
            return (
              <div key={r.value} style={_hs7}>
                <Icon size={14} color={r.color} /> <strong style={{ color: r.color }}>{r.label}</strong> — {r.desc}
              </div>
            );
          })}
        </div>

        {/* Create user modal */}
        {showCreate && (
          <div style={formCard}>
            <h3 style={_hs8}>New User</h3>
            <div style={_hs9}>
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
            <div style={_hs10}>
              <button className="btn-hover" onClick={() => setShowCreate(false)} style={secondaryBtn}>Cancel</button>
              <button className="btn-hover btn-hover-primary" onClick={createUser} style={primaryBtn}>Create</button>
            </div>
          </div>
        )}

        {/* Users table */}
        {loading ? (
          <div style={_hs11}>Loading...</div>
        ) : (
          <table style={_hs12}>
            <thead>
              <tr style={_hs13}>
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
                  <tr key={u.id} style={_hs14}>
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
                      <div style={_hs15}>
                        <button className="btn-hover btn-hover-accent" onClick={() => { setResetPw(u.id); setNewPw(''); }} title="Reset password" style={iconBtn}>
                          <TbKey size={14} />
                        </button>
                        {u.id !== user.id && (
                          <button className="btn-hover btn-hover-danger" onClick={() => deleteUser(u.id)} title="Delete" style={{ ...iconBtn, color: 'var(--state-danger)' }}>
                            <TbTrash size={14} />
                          </button>
                        )}
                      </div>
                      {resetPw === u.id && (
                        <div style={_hs16}>
                          <input type="password" placeholder="New password" value={newPw}
                            onChange={(e) => setNewPw(e.target.value)} style={{ ...inputStyle, padding: '4px 6px', fontSize: 12, width: 120 }} />
                          <button className="btn-hover btn-hover-primary" onClick={() => resetPassword(u.id)} style={{ ...primaryBtn, padding: '4px 8px', fontSize: 11 }}>Set</button>
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
// Query timeout slider — value is held locally so the user can scrub the
// slider freely; we only POST when they click Save (or when they nudge the
// number input and blur). Server clamps to [minMs, maxMs] regardless.
function QueryTimeoutControl({ valueMs, minMs, maxMs, defaultMs, onSave, saving }) {
  const minS = Math.round(minMs / 1000);
  const maxS = Math.round(maxMs / 1000);
  const defaultS = Math.round(defaultMs / 1000);
  const [seconds, setSeconds] = useState(Math.round(valueMs / 1000));
  useEffect(() => { setSeconds(Math.round(valueMs / 1000)); }, [valueMs]);
  const dirty = seconds !== Math.round(valueMs / 1000);
  return (
    <div style={_hs17}>
      <div style={_hs18}>
        <label style={_hs19}>
          Query timeout
        </label>
        <span style={_hs20}>
          min {minS}s · default {defaultS}s · max {maxS}s
        </span>
      </div>
      <div style={_hs21}>
        <input
          type="range" min={minS} max={maxS} step={5}
          value={seconds}
          onChange={(e) => setSeconds(parseInt(e.target.value, 10))}
          style={_hs22}
        />
        <input
          type="number" min={minS} max={maxS}
          value={seconds}
          onChange={(e) => {
            const n = parseInt(e.target.value, 10);
            if (Number.isFinite(n)) setSeconds(Math.max(minS, Math.min(maxS, n)));
          }}
          style={{ ...inputStyle, width: 80, padding: '6px 8px', textAlign: 'center' }}
        />
        <span style={_hs23}>seconds</span>
        <button
          className="btn-hover btn-hover-primary"
          onClick={() => onSave(seconds)}
          disabled={!dirty || saving}
          style={{ ...primaryBtn, padding: '6px 14px', fontSize: 12, opacity: (!dirty || saving) ? 0.5 : 1, cursor: (!dirty || saving) ? 'default' : 'pointer' }}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
      <p style={_hs24}>
        Visual queries are cancelled when they exceed this limit. Lower values protect the database under load; higher values allow heavier reports to finish.
      </p>
    </div>
  );
}

// Compact 3-stat row: uploaded source files (disk) + query cache (RAM)
// + rollup storage (local disk). Instance-wide totals so the admin sees
// at a glance how heavy the install is. No quota — OSS has no billing.
function StorageUsageRow({ uploadedFileCount, uploadedBytes, ramBytes, rollupBytes, rollupCount }) {
  const cell = {
    flex: 1, padding: '10px 12px',
    background: 'var(--bg-subtle)', borderRadius: 6,
    border: '1px solid var(--border-default)',
  };
  const label = { fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 };
  const value = { fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', marginTop: 4 };
  const sub = { fontSize: 11, color: 'var(--text-disabled)', marginTop: 2 };
  return (
    <div style={_hs25}>
      <div style={cell}>
        <div style={label}>Uploaded files</div>
        <div style={value}>{formatBytes(uploadedBytes)}</div>
        <div style={sub}>{uploadedFileCount} file{uploadedFileCount === 1 ? '' : 's'} on disk</div>
      </div>
      <div style={cell}>
        <div style={label}>Rollup storage</div>
        <div style={value}>{formatBytes(rollupBytes)}</div>
        <div style={sub}>{rollupCount} rollup{rollupCount === 1 ? '' : 's'} on local disk</div>
      </div>
      <div style={cell}>
        <div style={label}>Query cache</div>
        <div style={value}>{formatBytes(ramBytes)}</div>
        <div style={sub}>SQL result cache in RAM</div>
      </div>
    </div>
  );
}

// Query cache control — toggle + TTL slider + Flush button. Same shape
// as QueryTimeoutControl: local state for the slider so the user can
// scrub freely; explicit Save commits. Toggle saves immediately because
// it has no intermediate state to validate.
function QueryCacheControl({ enabled, ttlMs, minMs, maxMs, stats, preAggStats, lastFlushed, onSave, onFlush, saving, flushing }) {
  const minS = Math.round(minMs / 1000);
  const maxS = Math.round(maxMs / 1000);
  const [seconds, setSeconds] = useState(Math.round(ttlMs / 1000));
  useEffect(() => { setSeconds(Math.round(ttlMs / 1000)); }, [ttlMs]);
  const dirty = seconds !== Math.round(ttlMs / 1000);
  const sqlEntries = stats?.size ?? 0;
  const rollupCount = preAggStats?.size ?? 0;
  return (
    <div style={_hs26}>
      <div style={_hs27}>
        <label style={_hs28}>
          Query result cache
        </label>
        <span style={_hs29}>
          {sqlEntries} entries · {formatBytes(stats?.bytes ?? 0)} in RAM
          {rollupCount > 0 ? ` · ${rollupCount} rollup${rollupCount === 1 ? '' : 's'} on local disk` : ''}
        </span>
      </div>
      <div style={_hs30}>
        <input
          type="checkbox"
          id="query-cache-enabled"
          checked={!!enabled}
          onChange={(e) => onSave({ enabled: e.target.checked })}
          disabled={saving}
        />
        <label htmlFor="query-cache-enabled" style={_hs31}>
          Cache visual query results across the whole instance — when off, every refresh re-hits the source DB
        </label>
      </div>
      {enabled && (
        <div style={_hs32}>
          <span style={_hs33}>TTL</span>
          <input
            type="range" min={minS} max={maxS} step={5}
            value={seconds}
            onChange={(e) => setSeconds(parseInt(e.target.value, 10))}
            style={_hs34}
          />
          <span style={_hs35}>
            {formatDuration(seconds)}
          </span>
          <button
            className="btn-hover btn-hover-primary"
            onClick={() => onSave({ ttlSeconds: seconds })}
            disabled={!dirty || saving}
            style={{ ...primaryBtn, padding: '6px 14px', fontSize: 12, opacity: (!dirty || saving) ? 0.5 : 1, cursor: (!dirty || saving) ? 'default' : 'pointer' }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
      <div style={_hs36}>
        <button
          className="btn-hover"
          onClick={onFlush}
          disabled={flushing}
          style={{ ...secondaryBtn, padding: '6px 12px', fontSize: 12, opacity: flushing ? 0.5 : 1 }}
        >
          {flushing ? 'Deleting…' : 'Delete Cache'}
        </button>
        {lastFlushed && (
          <span style={_hs37}>
            Deleted {(lastFlushed.evicted || 0) + (lastFlushed.evictedPreAgg || 0)} entries
          </span>
        )}
      </div>
      <p style={_hs38}>
        Saved a model? Updated a datasource? Those automatically drop the relevant entries. Use Flush only after an out-of-band schema change you couldn't capture through the UI.
      </p>
    </div>
  );
}

const cloudHeaderLink = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '8px 14px', fontSize: 13, fontWeight: 600,
  textDecoration: 'none',
  color: 'var(--text-secondary)',
  background: 'var(--bg-panel)', border: '1px solid var(--border-default)',
  borderRadius: 6, marginRight: 8,
};
