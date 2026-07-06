import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { TbDatabase, TbStack3 } from 'react-icons/tb';
import api from '../utils/api';
import { headerShellStyle, headerTitleStyle, BackButton, PrimaryButton, SecondaryButton } from '../components/PageHeader/PageHeader';

const _hs0 = { minHeight: '100vh', backgroundColor: 'var(--bg-app)' };
const _hs1 = { flex: 1 };
const _hs2 = { maxWidth: 800, margin: '0 auto', padding: '32px 20px' };
const _hs3 = { fontSize: 16, fontWeight: 600, marginBottom: 16 };
const _hs4 = { marginBottom: 12 };
const _hs5 = { marginBottom: 12 };
const _hs6 = { fontSize: 12, color: 'var(--state-danger)', marginTop: 4 };
const _hs7 = { color: 'var(--accent-primary)', background: 'transparent', border: '1px solid transparent', cursor: 'pointer', fontSize: 12, padding: '2px 6px', borderRadius: 4 };
const _hs8 = { marginBottom: 16 };
const _hs9 = { display: 'flex', gap: 8, justifyContent: 'flex-end' };
const _hs10 = { color: 'var(--text-disabled)', textAlign: 'center', marginTop: 60 };
const _hs11 = { textAlign: 'center', marginTop: 80 };
const _hs12 = { fontSize: 16, color: 'var(--text-muted)', marginBottom: 4 };
const _hs13 = { fontSize: 13, color: 'var(--text-disabled)', marginBottom: 16 };
const _hs14 = { display: 'flex', flexDirection: 'column', gap: 8 };
const _hs15 = { cursor: 'pointer', flex: 1 };
const _hs16 = { fontWeight: 600, color: 'var(--text-primary)', fontSize: 15 };
const _hs17 = { fontSize: 13, color: 'var(--text-muted)', marginTop: 2 };
const _hs18 = { fontSize: 12, color: 'var(--text-disabled)', marginTop: 2 };
const _hs19 = { display: 'flex', gap: 8 };

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
    <div style={_hs0}>
      <header style={headerShellStyle}>
        <BackButton to="/" />
        <h1 style={{ ...headerTitleStyle, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <TbStack3 size={20} color="var(--accent-primary)" />
          Data Models
        </h1>
        <div style={_hs1} />
        <SecondaryButton onClick={() => navigate('/datasources')} title="Go to Data Sources">
          <TbDatabase size={16} />Data Sources
        </SecondaryButton>
        <PrimaryButton onClick={() => setShowForm(true)}>+ New Model</PrimaryButton>
      </header>

      <main style={_hs2}>
        {showForm && (
          <div style={formCard}>
            <h2 style={_hs3}>New Data Model</h2>
            <div style={_hs4}>
              <label style={labelStyle}>Name</label>
              <input
                style={inputStyle}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Sales Analysis"
              />
            </div>
            <div style={_hs5}>
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
                <p style={_hs6}>
                  No data sources configured.{' '}
                  <button className="btn-hover btn-hover-accent" onClick={() => navigate('/datasources')} style={_hs7}>
                    Add one first
                  </button>
                </p>
              )}
            </div>
            <div style={_hs8}>
              <label style={labelStyle}>Description (optional)</label>
              <input
                style={inputStyle}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="What does this model represent?"
              />
            </div>
            <div style={_hs9}>
              <button className="btn-hover" onClick={() => setShowForm(false)} style={secondaryBtn}>Cancel</button>
              <button className="btn-hover btn-hover-primary" onClick={handleCreate} style={primaryBtn}>Create & Configure</button>
            </div>
          </div>
        )}

        {loading ? (
          <div style={_hs10}>Loading...</div>
        ) : models.length === 0 && !showForm ? (
          <div style={_hs11}>
            <p style={_hs12}>No data models yet</p>
            <p style={_hs13}>
              Models define which tables, dimensions, and measures are available in your reports.
            </p>
            <button className="btn-hover btn-hover-primary" onClick={() => setShowForm(true)} style={primaryBtn}>Create your first model</button>
          </div>
        ) : (
          <div style={_hs14}>
            {models.map((m) => (
              <div key={m.id} style={cardStyle}>
                <div onClick={() => navigate(`/models/${m.id}`)} style={_hs15}>
                  <div style={_hs16}>{m.name}</div>
                  <div style={_hs17}>
                    Source: {m.datasource_name} — Updated {new Date(m.updated_at).toLocaleDateString()}
                  </div>
                  {m.description && <div style={_hs18}>{m.description}</div>}
                </div>
                <div style={_hs19}>
                  <button className="btn-hover" onClick={() => navigate(`/models/${m.id}`)} style={{ ...secondaryBtn, fontSize: 12, padding: '4px 10px' }}>Edit</button>
                  <button className="btn-hover btn-hover-danger" onClick={() => handleDelete(m.id)} style={{ ...secondaryBtn, fontSize: 12, padding: '4px 10px', color: 'var(--state-danger)', borderColor: 'var(--state-danger)' }}>Delete</button>
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
  borderRadius: 6, background: 'var(--accent-primary)', color: '#fff', cursor: 'pointer',
};
const secondaryBtn = {
  padding: '8px 16px', fontSize: 14, background: 'var(--bg-panel)', color: 'var(--text-secondary)',
  border: '1px solid var(--border-default)', borderRadius: 6, cursor: 'pointer',
};
const inputStyle = {
  width: '100%', padding: '8px 10px', border: '1px solid var(--border-default)',
  borderRadius: 6, fontSize: 14, outline: 'none', boxSizing: 'border-box',
};
const labelStyle = { display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4, fontWeight: 500 };
const formCard = {
  backgroundColor: 'var(--bg-panel)', padding: 24, borderRadius: 8,
  border: '1px solid var(--border-default)', marginBottom: 24,
};
const cardStyle = {
  backgroundColor: 'var(--bg-panel)', padding: '16px 20px', borderRadius: 8,
  border: '1px solid var(--border-default)', display: 'flex', alignItems: 'center',
};
