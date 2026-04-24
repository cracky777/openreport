import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api';
import { TbUpload } from 'react-icons/tb';
import { headerShellStyle, headerTitleStyle, BackButton, PrimaryButton, SecondaryButton } from '../components/PageHeader/PageHeader';

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
  const [editingId, setEditingId] = useState(null);

  const blankForm = {
    name: '',
    dbType: 'postgres',
    host: 'localhost',
    port: 5432,
    dbName: '',
    dbUser: '',
    dbPassword: '',
    extraConfig: {},
  };
  const [form, setForm] = useState(blankForm);

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
      if (editingId) {
        await api.put(`/datasources/${editingId}`, form);
      } else {
        await api.post('/datasources', form);
      }
      setShowForm(false);
      setEditingId(null);
      setForm(blankForm);
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

  const handleEdit = async (ds) => {
    try {
      // Fetch full datasource (includes db_user, not password)
      const res = await api.get(`/datasources/${ds.id}`);
      const full = res.data.datasource;
      let extraConfig = {};
      if (ds.extra_config) {
        try { extraConfig = typeof ds.extra_config === 'string' ? JSON.parse(ds.extra_config) : ds.extra_config; } catch { extraConfig = {}; }
      }
      setEditingId(ds.id);
      setForm({
        name: full.name || '',
        dbType: full.db_type || 'postgres',
        host: full.host || '',
        port: full.port || 5432,
        dbName: full.db_name || '',
        dbUser: full.db_user || '',
        dbPassword: '',
        extraConfig,
      });
      setTestResult(null);
      setShowForm(true);
    } catch (err) {
      alert(err.response?.data?.error || 'Could not load datasource');
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

  const handleCancel = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(blankForm);
    setTestResult(null);
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
      <header style={headerShellStyle}>
        <BackButton to="/" />
        <h1 style={headerTitleStyle}>Data Sources</h1>
        <div style={{ flex: 1 }} />
        <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls,.parquet,.json,.tsv"
          style={{ display: 'none' }} onChange={handleFileUpload} />
        <SecondaryButton onClick={() => fileInputRef.current?.click()} disabled={uploading}
          style={{ color: '#7c3aed', borderColor: '#ddd6fe', background: '#faf8ff' }}>
          <TbUpload size={16} />{uploading ? 'Uploading...' : 'Upload File'}
        </SecondaryButton>
        <PrimaryButton onClick={() => setShowForm(true)}>+ New Connection</PrimaryButton>
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
            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>{editingId ? 'Edit Data Source' : 'New Data Source'}</h2>

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
                    <input style={inputStyle} type="password" value={form.dbPassword}
                      onChange={(e) => updateForm('dbPassword', e.target.value)}
                      placeholder={editingId ? 'Leave blank to keep existing' : ''} />
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
              <button onClick={handleCancel} style={secondaryBtn}>Cancel</button>
              <button onClick={handleTest} disabled={testing} style={{ ...secondaryBtn, color: '#7c3aed', borderColor: '#c4b5fd' }}>
                {testing ? 'Testing...' : 'Test Connection'}
              </button>
              <button onClick={handleSave} disabled={saving} style={primaryBtn}>
                {saving ? 'Saving...' : (editingId ? 'Update' : 'Save')}
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
            {datasources.map((ds) => {
              const extra = ds.extra_config ? (typeof ds.extra_config === 'string' ? JSON.parse(ds.extra_config) : ds.extra_config) : {};
              const isUploadedFile = !!extra.sourceFile;
              return (
                <div key={ds.id} style={dsCardStyle}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, color: '#0f172a', fontSize: 15 }}>{ds.name}</div>
                    <div style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>
                      {(() => {
                        const dbLabel = DB_TYPES.find((t) => t.value === ds.db_type)?.label || ds.db_type.toUpperCase();
                        if (extra.sourceFile) return `${dbLabel} — 📄 ${extra.sourceFile} (${extra.rowCount?.toLocaleString() || '?'} rows)`;
                        if (ds.db_type === 'bigquery') return `${dbLabel} — ${ds.db_name}`;
                        if (ds.db_type === 'duckdb') return `${dbLabel} — ${ds.db_name}`;
                        return `${dbLabel} — ${ds.host}:${ds.port}/${ds.db_name}`;
                      })()}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {!isUploadedFile && (
                      <button onClick={() => handleEdit(ds)} style={{ ...secondaryBtn, fontSize: 12, padding: '4px 10px' }}>
                        Edit
                      </button>
                    )}
                    <button onClick={() => handleDelete(ds.id)} style={{ ...secondaryBtn, color: '#dc2626', borderColor: '#fca5a5', fontSize: 12, padding: '4px 10px' }}>
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
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


const primaryBtn = {
  padding: '8px 16px', fontSize: 14, fontWeight: 600, border: 'none',
  borderRadius: 6, background: '#7c3aed', color: '#fff', cursor: 'pointer',
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
