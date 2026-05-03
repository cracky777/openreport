import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api';
import { TbUpload, TbStack3, TbDatabase } from 'react-icons/tb';
import { headerShellStyle, headerTitleStyle, BackButton, PrimaryButton, SecondaryButton } from '../components/PageHeader/PageHeader';
import { DatasourcesHeader } from '../cloud';
import DatasourceForm, { createModelAndNavigate } from '../components/DatasourceForm/DatasourceForm';

const DB_TYPE_LABELS = {
  postgres: 'PostgreSQL',
  azure_postgres: 'Azure PostgreSQL',
  mysql: 'MySQL',
  azure_sql: 'Azure SQL Database',
  bigquery: 'Google BigQuery',
  duckdb: 'DuckDB',
};

export default function Datasources() {
  const navigate = useNavigate();
  const [datasources, setDatasources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const fileInputRef = useRef(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editingValues, setEditingValues] = useState(null);
  const [saveMsg, setSaveMsg] = useState(null);

  useEffect(() => {
    loadDatasources();
  }, []);

  const loadDatasources = () => {
    api.get('/datasources')
      .then((res) => setDatasources(res.data.datasources))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  const handleSaved = async ({ datasource, isNew }) => {
    setShowForm(false);
    setEditingId(null);
    setEditingValues(null);
    if (isNew) {
      // Brand-new connection — chain into the model editor on the table selection step.
      const ok = await createModelAndNavigate(navigate, datasource);
      if (ok) return;
    }
    loadDatasources();
    setSaveMsg('Saved');
    setTimeout(() => setSaveMsg(null), 2000);
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingId(null);
    setEditingValues(null);
  };

  const handleEdit = async (ds) => {
    try {
      const res = await api.get(`/datasources/${ds.id}`);
      const full = res.data.datasource;
      let extraConfig = {};
      if (ds.extra_config) {
        try { extraConfig = typeof ds.extra_config === 'string' ? JSON.parse(ds.extra_config) : ds.extra_config; } catch { extraConfig = {}; }
      }
      setEditingId(ds.id);
      setEditingValues({
        name: full.name || '',
        dbType: full.db_type || 'postgres',
        host: full.host || '',
        port: full.port || 5432,
        dbName: full.db_name || '',
        dbUser: full.db_user || '',
        dbPassword: '',
        extraConfig,
      });
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
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--bg-app)' }}>
      <header style={headerShellStyle}>
        <BackButton to="/" />
        <h1 style={{ ...headerTitleStyle, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <TbDatabase size={20} color="var(--accent-primary)" />
          Data Sources
        </h1>
        <div style={{ flex: 1 }} />
        <SecondaryButton onClick={() => navigate('/models')} title="Go to Data Models">
          <TbStack3 size={16} />Data Models
        </SecondaryButton>
        <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls,.parquet,.json,.tsv"
          style={{ display: 'none' }} onChange={handleFileUpload} />
        <SecondaryButton onClick={() => fileInputRef.current?.click()} disabled={uploading}
          style={{ color: 'var(--accent-primary)', borderColor: '#ddd6fe', background: 'var(--accent-primary-soft)' }}>
          <TbUpload size={16} />{uploading ? 'Uploading...' : 'Upload File'}
        </SecondaryButton>
        <PrimaryButton onClick={() => { setEditingId(null); setEditingValues(null); setShowForm(true); }}>+ New Connection</PrimaryButton>
      </header>

      <main style={{ maxWidth: 800, margin: '0 auto', padding: '32px 20px' }}>
        {DatasourcesHeader && <DatasourcesHeader />}
        {uploadProgress && (
          <div style={{
            padding: '10px 16px', marginBottom: 16, borderRadius: 6, fontSize: 13,
            background: uploadProgress.startsWith('Error') ? 'var(--state-danger-soft)' : '#f0fdf4',
            color: uploadProgress.startsWith('Error') ? '#dc2626' : '#16a34a',
            border: `1px solid ${uploadProgress.startsWith('Error') ? '#fca5a5' : '#bbf7d0'}`,
          }}>
            {uploadProgress}
          </div>
        )}
        {showForm && (
          <div style={formCard}>
            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>{editingId ? 'Edit Data Source' : 'New Data Source'}</h2>
            <DatasourceForm
              editingId={editingId}
              initialValues={editingValues}
              onSaved={handleSaved}
              onCancel={handleCancel}
            />
          </div>
        )}

        {loading ? (
          <div style={{ color: 'var(--text-disabled)', textAlign: 'center', marginTop: 60 }}>Loading...</div>
        ) : datasources.length === 0 && !showForm ? (
          <div style={{ textAlign: 'center', marginTop: 80 }}>
            <p style={{ fontSize: 16, color: 'var(--text-muted)', marginBottom: 12 }}>No data sources configured</p>
            <button className="btn-hover btn-hover-primary" onClick={() => setShowForm(true)} style={primaryBtn}>Add your first data source</button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {datasources.map((ds) => {
              const extra = ds.extra_config ? (typeof ds.extra_config === 'string' ? JSON.parse(ds.extra_config) : ds.extra_config) : {};
              const isUploadedFile = !!extra.sourceFile;
              return (
                <div key={ds.id} style={dsCardStyle}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 15 }}>{ds.name}</div>
                    <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
                      {(() => {
                        const dbLabel = DB_TYPE_LABELS[ds.db_type] || ds.db_type.toUpperCase();
                        if (extra.sourceFile) return `${dbLabel} — 📄 ${extra.sourceFile} (${extra.rowCount?.toLocaleString() || '?'} rows)`;
                        if (ds.db_type === 'bigquery') return `${dbLabel} — ${ds.db_name}`;
                        if (ds.db_type === 'duckdb') return `${dbLabel} — ${ds.db_name}`;
                        return `${dbLabel} — ${ds.host}:${ds.port}/${ds.db_name}`;
                      })()}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {!isUploadedFile && (
                      <button className="btn-hover" onClick={() => handleEdit(ds)} style={{ ...secondaryBtn, fontSize: 12, padding: '4px 10px' }}>
                        Edit
                      </button>
                    )}
                    <button className="btn-hover btn-hover-danger" onClick={() => handleDelete(ds.id)} style={{ ...secondaryBtn, color: 'var(--state-danger)', borderColor: 'var(--state-danger)', fontSize: 12, padding: '4px 10px' }}>
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
          backgroundColor: saveMsg === 'Saved' ? 'var(--state-success)' : 'var(--state-danger)', color: '#fff',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        }}>{saveMsg === 'Saved' ? '✓ Datasource saved' : '✗ Save failed'}</div>
      )}
    </div>
  );
}


const primaryBtn = {
  padding: '8px 16px', fontSize: 14, fontWeight: 600, border: 'none',
  borderRadius: 6, background: 'var(--accent-primary)', color: '#fff', cursor: 'pointer',
};

const secondaryBtn = {
  padding: '8px 16px', fontSize: 14, background: 'var(--bg-panel)', color: 'var(--text-secondary)',
  border: '1px solid var(--border-default)', borderRadius: 6, cursor: 'pointer',
};

const formCard = {
  backgroundColor: 'var(--bg-panel)', padding: 24, borderRadius: 8,
  border: '1px solid var(--border-default)', marginBottom: 24,
};

const dsCardStyle = {
  backgroundColor: 'var(--bg-panel)', padding: '16px 20px', borderRadius: 8,
  border: '1px solid var(--border-default)', display: 'flex', alignItems: 'center',
};
