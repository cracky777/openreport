import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api';
import { TbUpload, TbArrowLeft } from 'react-icons/tb';

const DB_TYPES = [
  { value: 'postgres', label: 'PostgreSQL', defaultPort: 5432 },
  { value: 'azure_postgres', label: 'Azure PostgreSQL', defaultPort: 5432 },
  { value: 'mysql', label: 'MySQL', defaultPort: 3306 },
  { value: 'azure_sql', label: 'Azure SQL Database', defaultPort: 1433 },
  { value: 'bigquery', label: 'Google BigQuery', defaultPort: 0, noHost: true },
  { value: 'duckdb', label: 'DuckDB', defaultPort: 0, noHost: true },
];

export default function Datasources() {
  const navigate = useNavigate();
  const [datasources, setDatasources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const fileInputRef = useRef(null);
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
    extraConfig: {},
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

  const [saveMsg, setSaveMsg] = useState(null);
  const handleSave = async () => {
    if (!form.name || !form.dbName) return;
    setSaving(true);
    try {
      await api.post('/datasources', form);
      setShowForm(false);
      setForm({ name: '', dbType: 'postgres', host: 'localhost', port: 5432, dbName: '', dbUser: '', dbPassword: '', extraConfig: {} });
      setTestResult(null);
      loadDatasources();
      setSaveMsg('Saved');
      setTimeout(() => setSaveMsg(null), 2000);
    } catch (err) {
      console.error(err);
      setSaveMsg('Save failed');
      setTimeout(() => setSaveMsg(null), 3000);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Are you sure you want to delete this datasource?')) return;
    try {
      await api.delete(`/datasources/${id}`);
      setDatasources((prev) => prev.filter((d) => d.id !== id));
    } catch (err) {
      alert(err.response?.data?.error || 'Delete failed');
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadProgress(`Uploading ${file.name}...`);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('name', file.name.replace(/\.[^.]+$/, ''));
      const res = await api.post('/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setUploadProgress(`Imported ${res.data.datasource.rowCount?.toLocaleString() || '?'} rows from ${file.name}`);
      loadDatasources();
      setTimeout(() => setUploadProgress(''), 5000);
    } catch (err) {
      setUploadProgress(`Error: ${err.response?.data?.error || err.message}`);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f1f5f9' }}>
      <header style={headerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => navigate('/')} style={backStyle}><TbArrowLeft size={16} /> Back</button>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#0f172a' }}>Data Sources</h1>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls,.parquet,.json,.tsv"
            style={{ display: 'none' }} onChange={handleFileUpload} />
          <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
            style={{ ...secondaryBtn, display: 'flex', alignItems: 'center', gap: 4, color: '#3b82f6', borderColor: '#bfdbfe' }}>
            <TbUpload size={16} /> {uploading ? 'Uploading...' : 'Upload File'}
          </button>
          <button onClick={() => setShowForm(true)} style={primaryBtn}>+ New Connection</button>
        </div>
      </header>

      <main style={{ maxWidth: 800, margin: '0 auto', padding: '32px 20px' }}>
        {uploadProgress && (
          <div style={{
            padding: '10px 16px', marginBottom: 16, borderRadius: 6, fontSize: 13,
            background: uploadProgress.startsWith('Error') ? '#fef2f2' : '#f0fdf4',
            color: uploadProgress.startsWith('Error') ? '#dc2626' : '#16a34a',
            border: `1px solid ${uploadProgress.startsWith('Error') ? '#fca5a5' : '#bbf7d0'}`,
          }}>
            {uploadProgress}
          </div>
        )}
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

            {/* Standard DB fields */}
            {!DB_TYPES.find((t) => t.value === form.dbType)?.noHost && (
              <>
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
              </>
            )}

            {/* BigQuery fields */}
            {form.dbType === 'bigquery' && (
              <>
                <Field label="Project ID">
                  <input style={inputStyle} value={form.dbName} onChange={(e) => updateForm('dbName', e.target.value)} placeholder="my-gcp-project" />
                </Field>
                <Field label="Dataset">
                  <input style={inputStyle} value={form.extraConfig?.dataset || ''} onChange={(e) => updateForm('extraConfig', { ...form.extraConfig, dataset: e.target.value })} placeholder="my_dataset" />
                </Field>
                <Field label="Service Account Key (JSON)">
                  <textarea style={{ ...inputStyle, minHeight: 80, fontFamily: 'monospace', fontSize: 11 }}
                    value={form.extraConfig?.credentials || ''}
                    onChange={(e) => updateForm('extraConfig', { ...form.extraConfig, credentials: e.target.value })}
                    placeholder='{"type":"service_account","project_id":"..."}' />
                </Field>
              </>
            )}

            {/* DuckDB fields */}
            {form.dbType === 'duckdb' && (
              <Field label="Database file path">
                <input style={inputStyle} value={form.dbName} onChange={(e) => updateForm('dbName', e.target.value)} placeholder="/path/to/data.duckdb or :memory:" />
              </Field>
            )}

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
                    {(() => {
                      const dbLabel = DB_TYPES.find((t) => t.value === ds.db_type)?.label || ds.db_type.toUpperCase();
                      const extra = ds.extra_config ? (typeof ds.extra_config === 'string' ? JSON.parse(ds.extra_config) : ds.extra_config) : {};
                      if (extra.sourceFile) return `${dbLabel} — 📄 ${extra.sourceFile} (${extra.rowCount?.toLocaleString() || '?'} rows)`;
                      if (ds.db_type === 'bigquery') return `${dbLabel} — ${ds.db_name}`;
                      if (ds.db_type === 'duckdb') return `${dbLabel} — ${ds.db_name}`;
                      return `${dbLabel} — ${ds.host}:${ds.port}/${ds.db_name}`;
                    })()}
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
      {saveMsg && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          padding: '8px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600, zIndex: 9999,
          backgroundColor: saveMsg === 'Saved' ? '#22c55e' : '#ef4444', color: '#fff',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        }}>{saveMsg === 'Saved' ? '✓ Datasource saved' : '✗ Save failed'}</div>
      )}
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
  display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px',
  background: 'none', border: '1px solid #e2e8f0', borderRadius: 6,
  color: '#64748b', cursor: 'pointer', fontSize: 13, fontWeight: 500,
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
