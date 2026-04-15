import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api';

const DB_TYPES = [
  { value: 'postgres', label: 'PostgreSQL', defaultPort: 5432 },
  { value: 'mysql', label: 'MySQL', defaultPort: 3306 },
];

export default function Datasources() {
  const navigate = useNavigate();
  const [datasources, setDatasources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    name: '',
    dbType: 'postgres',
    host: 'localhost',
    port: 5432,
    dbName: '',
    dbUser: '',
    dbPassword: '',
  });

  useEffect(() => {
    loadDatasources();
  }, []);

  const loadDatasources = () => {
    api.get('/datasources')
      .then((res) => setDatasources(res.data.datasources))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  const updateForm = (key, value) => {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'dbType') {
        const dbType = DB_TYPES.find((t) => t.value === value);
        next.port = dbType?.defaultPort || 5432;
      }
      return next;
    });
    setTestResult(null);
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api.post('/datasources/test', form);
      setTestResult(res.data);
    } catch (err) {
      setTestResult({ success: false, message: err.response?.data?.error || 'Connection failed' });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!form.name || !form.dbName || !form.dbUser) return;
    setSaving(true);
    try {
      await api.post('/datasources', form);
      setShowForm(false);
      setForm({ name: '', dbType: 'postgres', host: 'localhost', port: 5432, dbName: '', dbUser: '', dbPassword: '' });
      setTestResult(null);
      loadDatasources();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    await api.delete(`/datasources/${id}`);
    setDatasources((prev) => prev.filter((d) => d.id !== id));
  };

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f1f5f9' }}>
      <header style={headerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => navigate('/')} style={backStyle}>← Back</button>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#0f172a' }}>Data Sources</h1>
        </div>
        <button onClick={() => setShowForm(true)} style={primaryBtn}>+ New Connection</button>
      </header>

      <main style={{ maxWidth: 800, margin: '0 auto', padding: '32px 20px' }}>
        {showForm && (
          <div style={formCard}>
            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>New Data Source</h2>

            <Field label="Name">
              <input style={inputStyle} value={form.name} onChange={(e) => updateForm('name', e.target.value)} placeholder="My database" />
            </Field>

            <Field label="Type">
              <select style={inputStyle} value={form.dbType} onChange={(e) => updateForm('dbType', e.target.value)}>
                {DB_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </Field>

            <div style={{ display: 'flex', gap: 12 }}>
              <Field label="Host" style={{ flex: 1 }}>
                <input style={inputStyle} value={form.host} onChange={(e) => updateForm('host', e.target.value)} />
              </Field>
              <Field label="Port" style={{ width: 100 }}>
                <input style={inputStyle} type="number" value={form.port} onChange={(e) => updateForm('port', parseInt(e.target.value))} />
              </Field>
            </div>

            <Field label="Database name">
              <input style={inputStyle} value={form.dbName} onChange={(e) => updateForm('dbName', e.target.value)} />
            </Field>

            <div style={{ display: 'flex', gap: 12 }}>
              <Field label="User" style={{ flex: 1 }}>
                <input style={inputStyle} value={form.dbUser} onChange={(e) => updateForm('dbUser', e.target.value)} />
              </Field>
              <Field label="Password" style={{ flex: 1 }}>
                <input style={inputStyle} type="password" value={form.dbPassword} onChange={(e) => updateForm('dbPassword', e.target.value)} />
              </Field>
            </div>

            {testResult && (
              <div style={{
                padding: '8px 12px',
                borderRadius: 6,
                fontSize: 13,
                marginBottom: 12,
                background: testResult.success ? '#f0fdf4' : '#fef2f2',
                color: testResult.success ? '#16a34a' : '#dc2626',
                border: `1px solid ${testResult.success ? '#bbf7d0' : '#fca5a5'}`,
              }}>
                {testResult.success ? 'Connection successful!' : `Failed: ${testResult.message}`}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => { setShowForm(false); setTestResult(null); }} style={secondaryBtn}>Cancel</button>
              <button onClick={handleTest} disabled={testing} style={{ ...secondaryBtn, color: '#3b82f6', borderColor: '#bfdbfe' }}>
                {testing ? 'Testing...' : 'Test Connection'}
              </button>
              <button onClick={handleSave} disabled={saving} style={primaryBtn}>
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div style={{ color: '#94a3b8', textAlign: 'center', marginTop: 60 }}>Loading...</div>
        ) : datasources.length === 0 && !showForm ? (
          <div style={{ textAlign: 'center', marginTop: 80 }}>
            <p style={{ fontSize: 16, color: '#64748b', marginBottom: 12 }}>No data sources configured</p>
            <button onClick={() => setShowForm(true)} style={primaryBtn}>Add your first data source</button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {datasources.map((ds) => (
              <div key={ds.id} style={dsCardStyle}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, color: '#0f172a', fontSize: 15 }}>{ds.name}</div>
                  <div style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>
                    {ds.db_type.toUpperCase()} — {ds.host}:{ds.port}/{ds.db_name}
                  </div>
                </div>
                <button onClick={() => handleDelete(ds.id)} style={{ ...secondaryBtn, color: '#dc2626', borderColor: '#fca5a5', fontSize: 12 }}>
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function Field({ label, children, style }) {
  return (
    <div style={{ marginBottom: 12, ...style }}>
      <label style={{ display: 'block', fontSize: 13, color: '#475569', marginBottom: 4, fontWeight: 500 }}>{label}</label>
      {children}
    </div>
  );
}

const headerStyle = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '12px 24px', backgroundColor: '#fff', borderBottom: '1px solid #e2e8f0',
};

const backStyle = {
  background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 14,
};

const primaryBtn = {
  padding: '8px 16px', fontSize: 14, fontWeight: 600, border: 'none',
  borderRadius: 6, background: '#3b82f6', color: '#fff', cursor: 'pointer',
};

const secondaryBtn = {
  padding: '8px 16px', fontSize: 14, background: '#fff', color: '#475569',
  border: '1px solid #e2e8f0', borderRadius: 6, cursor: 'pointer',
};

const inputStyle = {
  width: '100%', padding: '8px 10px', border: '1px solid #e2e8f0',
  borderRadius: 6, fontSize: 14, outline: 'none', boxSizing: 'border-box',
};

const formCard = {
  backgroundColor: '#fff', padding: 24, borderRadius: 8,
  border: '1px solid #e2e8f0', marginBottom: 24,
};

const dsCardStyle = {
  backgroundColor: '#fff', padding: '16px 20px', borderRadius: 8,
  border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center',
};
