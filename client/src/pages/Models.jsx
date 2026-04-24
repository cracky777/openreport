import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api';
import { headerShellStyle, headerTitleStyle, BackButton, PrimaryButton } from '../components/PageHeader/PageHeader';

export default function Models() {
  const navigate = useNavigate();
  const [models, setModels] = useState([]);
  const [datasources, setDatasources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', datasourceId: '', description: '' });

  useEffect(() => {
    Promise.all([
      api.get('/models'),
      api.get('/datasources'),
    ]).then(([modelsRes, dsRes]) => {
      setModels(modelsRes.data.models);
      setDatasources(dsRes.data.datasources);
    }).finally(() => setLoading(false));
  }, []);

  const handleCreate = async () => {
    if (!form.name || !form.datasourceId) return;
    const res = await api.post('/models', form);
    navigate(`/models/${res.data.model.id}`);
  };

  const handleDelete = async (id) => {
    if (!confirm('Are you sure you want to delete this model?')) return;
    try {
      await api.delete(`/models/${id}`);
      setModels((prev) => prev.filter((m) => m.id !== id));
    } catch (err) {
      alert(err.response?.data?.error || 'Delete failed');
    }
  };

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f1f5f9' }}>
      <header style={headerShellStyle}>
        <BackButton to="/" />
        <h1 style={headerTitleStyle}>Data Models</h1>
        <div style={{ flex: 1 }} />
        <PrimaryButton onClick={() => setShowForm(true)}>+ New Model</PrimaryButton>
      </header>

      <main style={{ maxWidth: 800, margin: '0 auto', padding: '32px 20px' }}>
        {showForm && (
          <div style={formCard}>
            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>New Data Model</h2>
            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle}>Name</label>
              <input
                style={inputStyle}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Sales Analysis"
              />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle}>Data Source</label>
              <select
                style={inputStyle}
                value={form.datasourceId}
                onChange={(e) => setForm({ ...form, datasourceId: e.target.value })}
              >
                <option value="">Select a data source...</option>
                {datasources.map((ds) => (
                  <option key={ds.id} value={ds.id}>{ds.name} ({ds.db_type})</option>
                ))}
              </select>
              {datasources.length === 0 && (
                <p style={{ fontSize: 12, color: '#dc2626', marginTop: 4 }}>
                  No data sources configured.{' '}
                  <button onClick={() => navigate('/datasources')} style={{ color: '#7c3aed', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12 }}>
                    Add one first
                  </button>
                </p>
              )}
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Description (optional)</label>
              <input
                style={inputStyle}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="What does this model represent?"
              />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowForm(false)} style={secondaryBtn}>Cancel</button>
              <button onClick={handleCreate} style={primaryBtn}>Create & Configure</button>
            </div>
          </div>
        )}

        {loading ? (
          <div style={{ color: '#94a3b8', textAlign: 'center', marginTop: 60 }}>Loading...</div>
        ) : models.length === 0 && !showForm ? (
          <div style={{ textAlign: 'center', marginTop: 80 }}>
            <p style={{ fontSize: 16, color: '#64748b', marginBottom: 4 }}>No data models yet</p>
            <p style={{ fontSize: 13, color: '#94a3b8', marginBottom: 16 }}>
              Models define which tables, dimensions, and measures are available in your reports.
            </p>
            <button onClick={() => setShowForm(true)} style={primaryBtn}>Create your first model</button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {models.map((m) => (
              <div key={m.id} style={cardStyle}>
                <div onClick={() => navigate(`/models/${m.id}`)} style={{ cursor: 'pointer', flex: 1 }}>
                  <div style={{ fontWeight: 600, color: '#0f172a', fontSize: 15 }}>{m.name}</div>
                  <div style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>
                    Source: {m.datasource_name} — Updated {new Date(m.updated_at).toLocaleDateString()}
                  </div>
                  {m.description && <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{m.description}</div>}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => navigate(`/models/${m.id}`)} style={{ ...secondaryBtn, fontSize: 12, padding: '4px 10px' }}>Edit</button>
                  <button onClick={() => handleDelete(m.id)} style={{ ...secondaryBtn, fontSize: 12, padding: '4px 10px', color: '#dc2626', borderColor: '#fca5a5' }}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
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
const labelStyle = { display: 'block', fontSize: 13, color: '#475569', marginBottom: 4, fontWeight: 500 };
const formCard = {
  backgroundColor: '#fff', padding: 24, borderRadius: 8,
  border: '1px solid #e2e8f0', marginBottom: 24,
};
const cardStyle = {
  backgroundColor: '#fff', padding: '16px 20px', borderRadius: 8,
  border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center',
};
