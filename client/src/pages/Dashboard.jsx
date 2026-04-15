import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import api from '../utils/api';

export default function Dashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [reports, setReports] = useState([]);
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newModelId, setNewModelId] = useState('');

  useEffect(() => {
    Promise.all([
      api.get('/reports'),
      api.get('/models'),
    ]).then(([reportsRes, modelsRes]) => {
      setReports(reportsRes.data.reports);
      setModels(modelsRes.data.models);
    }).catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handleCreate = async () => {
    if (!newModelId) return;
    const res = await api.post('/reports', { title: newTitle || 'Untitled Report', modelId: newModelId });
    navigate(`/edit/${res.data.report.id}`);
  };

  const deleteReport = async (id) => {
    await api.delete(`/reports/${id}`);
    setReports(reports.filter((r) => r.id !== id));
  };

  const openCreate = () => {
    setNewTitle('');
    setNewModelId(models.length > 0 ? models[0].id : '');
    setShowCreate(true);
  };

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f1f5f9' }}>
      <header style={headerStyle}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#0f172a' }}>Open Report</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => navigate('/datasources')} style={navBtn}>Data Sources</button>
          <button onClick={() => navigate('/models')} style={navBtn}>Models</button>
          <span style={{ fontSize: 13, color: '#64748b' }}>{user?.email}</span>
          <button onClick={logout} style={navBtn}>Logout</button>
        </div>
      </header>

      <main style={{ maxWidth: 960, margin: '0 auto', padding: '32px 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: '#0f172a' }}>My Reports</h2>
          <button onClick={openCreate} style={primaryBtn}>+ New Report</button>
        </div>

        {/* Create modal */}
        {showCreate && (
          <div style={modalOverlay} onClick={() => setShowCreate(false)}>
            <div style={modalCard} onClick={(e) => e.stopPropagation()}>
              <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>New Report</h3>

              <div style={{ marginBottom: 12 }}>
                <label style={labelStyle}>Title</label>
                <input
                  style={inputStyle}
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="Untitled Report"
                  autoFocus
                />
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Data Model *</label>
                <select
                  style={inputStyle}
                  value={newModelId}
                  onChange={(e) => setNewModelId(e.target.value)}
                >
                  <option value="">Select a model...</option>
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>{m.name} — {m.datasource_name}</option>
                  ))}
                </select>
                {models.length === 0 && (
                  <p style={{ fontSize: 12, color: '#dc2626', marginTop: 4 }}>
                    No models available.{' '}
                    <button onClick={() => navigate('/models')} style={{ color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12 }}>
                      Create one first
                    </button>
                  </p>
                )}
              </div>

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button onClick={() => setShowCreate(false)} style={secondaryBtn}>Cancel</button>
                <button onClick={handleCreate} disabled={!newModelId} style={{ ...primaryBtn, opacity: newModelId ? 1 : 0.5 }}>
                  Create Report
                </button>
              </div>
            </div>
          </div>
        )}

        {loading ? (
          <div style={{ color: '#94a3b8', textAlign: 'center', marginTop: 60 }}>Loading...</div>
        ) : reports.length === 0 && !showCreate ? (
          <div style={{ textAlign: 'center', marginTop: 80 }}>
            <p style={{ fontSize: 16, color: '#64748b', marginBottom: 12 }}>No reports yet</p>
            <button onClick={openCreate} style={primaryBtn}>Create your first report</button>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
            {reports.map((report) => (
              <div key={report.id} style={cardStyle}>
                <div
                  onClick={() => navigate(`/edit/${report.id}`)}
                  style={{ cursor: 'pointer', padding: 20, flex: 1 }}
                >
                  <h3 style={{ fontSize: 16, fontWeight: 600, color: '#0f172a', marginBottom: 4 }}>
                    {report.title}
                  </h3>
                  {report.model_name && (
                    <p style={{ fontSize: 12, color: '#3b82f6', marginBottom: 4 }}>{report.model_name}</p>
                  )}
                  <p style={{ fontSize: 12, color: '#94a3b8' }}>
                    Updated {new Date(report.updated_at).toLocaleDateString()}
                  </p>
                </div>
                <div style={{ padding: '8px 20px 16px', display: 'flex', gap: 8 }}>
                  {report.is_public ? (
                    <button onClick={() => navigate(`/view/${report.id}`)}
                      style={{ ...smallBtn, color: '#3b82f6', borderColor: '#bfdbfe' }}>View</button>
                  ) : null}
                  <button onClick={() => deleteReport(report.id)}
                    style={{ ...smallBtn, color: '#dc2626', borderColor: '#fca5a5' }}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

const headerStyle = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '12px 24px', backgroundColor: '#fff', borderBottom: '1px solid #e2e8f0',
};
const navBtn = {
  fontSize: 13, color: '#64748b', background: 'none', border: '1px solid #e2e8f0',
  borderRadius: 6, padding: '6px 12px', cursor: 'pointer',
};
const primaryBtn = {
  padding: '8px 16px', fontSize: 14, fontWeight: 600, border: 'none',
  borderRadius: 6, background: '#3b82f6', color: '#fff', cursor: 'pointer',
};
const secondaryBtn = {
  padding: '8px 16px', fontSize: 14, background: '#fff', color: '#475569',
  border: '1px solid #e2e8f0', borderRadius: 6, cursor: 'pointer',
};
const cardStyle = {
  backgroundColor: '#fff', borderRadius: 8, border: '1px solid #e2e8f0',
  display: 'flex', flexDirection: 'column',
};
const smallBtn = {
  fontSize: 12, background: 'none', border: '1px solid', borderRadius: 4,
  padding: '4px 10px', cursor: 'pointer',
};
const modalOverlay = {
  position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
  backgroundColor: 'rgba(0,0,0,0.3)', display: 'flex',
  alignItems: 'center', justifyContent: 'center', zIndex: 100,
};
const modalCard = {
  backgroundColor: '#fff', padding: 28, borderRadius: 12,
  boxShadow: '0 8px 30px rgba(0,0,0,0.12)', width: 440,
};
const labelStyle = {
  display: 'block', fontSize: 13, color: '#475569', marginBottom: 4, fontWeight: 500,
};
const inputStyle = {
  width: '100%', padding: '8px 10px', border: '1px solid #e2e8f0',
  borderRadius: 6, fontSize: 14, outline: 'none', boxSizing: 'border-box',
};
