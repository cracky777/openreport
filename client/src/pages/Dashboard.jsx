import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import api from '../utils/api';

export default function Dashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/reports')
      .then((res) => setReports(res.data.reports))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const createReport = async () => {
    const res = await api.post('/reports', { title: 'Untitled Report' });
    navigate(`/edit/${res.data.report.id}`);
  };

  const deleteReport = async (id) => {
    await api.delete(`/reports/${id}`);
    setReports(reports.filter((r) => r.id !== id));
  };

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f1f5f9' }}>
      <header style={headerStyle}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#0f172a' }}>Open Report</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 13, color: '#64748b' }}>{user?.email}</span>
          <button onClick={logout} style={logoutStyle}>Logout</button>
        </div>
      </header>

      <main style={{ maxWidth: 960, margin: '0 auto', padding: '32px 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: '#0f172a' }}>My Reports</h2>
          <button onClick={createReport} style={createStyle}>+ New Report</button>
        </div>

        {loading ? (
          <div style={{ color: '#94a3b8', textAlign: 'center', marginTop: 60 }}>Loading...</div>
        ) : reports.length === 0 ? (
          <div style={emptyStyle}>
            <p style={{ fontSize: 16, color: '#64748b', marginBottom: 12 }}>No reports yet</p>
            <button onClick={createReport} style={createStyle}>Create your first report</button>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
            {reports.map((report) => (
              <div key={report.id} style={cardStyle}>
                <div
                  onClick={() => navigate(`/edit/${report.id}`)}
                  style={{ cursor: 'pointer', padding: 20, flex: 1 }}
                >
                  <h3 style={{ fontSize: 16, fontWeight: 600, color: '#0f172a', marginBottom: 8 }}>
                    {report.title}
                  </h3>
                  <p style={{ fontSize: 12, color: '#94a3b8' }}>
                    Updated {new Date(report.updated_at).toLocaleDateString()}
                  </p>
                </div>
                <div style={{ padding: '8px 20px 16px', display: 'flex', gap: 8 }}>
                  {report.is_public ? (
                    <button
                      onClick={() => navigate(`/view/${report.id}`)}
                      style={{ ...smallBtn, color: '#3b82f6', borderColor: '#bfdbfe' }}
                    >
                      View
                    </button>
                  ) : null}
                  <button
                    onClick={() => deleteReport(report.id)}
                    style={{ ...smallBtn, color: '#dc2626', borderColor: '#fca5a5' }}
                  >
                    Delete
                  </button>
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
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '12px 24px',
  backgroundColor: '#fff',
  borderBottom: '1px solid #e2e8f0',
};

const logoutStyle = {
  fontSize: 13,
  color: '#64748b',
  background: 'none',
  border: '1px solid #e2e8f0',
  borderRadius: 6,
  padding: '6px 12px',
  cursor: 'pointer',
};

const createStyle = {
  padding: '8px 16px',
  fontSize: 14,
  fontWeight: 600,
  border: 'none',
  borderRadius: 6,
  background: '#3b82f6',
  color: '#fff',
  cursor: 'pointer',
};

const cardStyle = {
  backgroundColor: '#fff',
  borderRadius: 8,
  border: '1px solid #e2e8f0',
  display: 'flex',
  flexDirection: 'column',
};

const emptyStyle = {
  textAlign: 'center',
  marginTop: 80,
};

const smallBtn = {
  fontSize: 12,
  background: 'none',
  border: '1px solid',
  borderRadius: 4,
  padding: '4px 10px',
  cursor: 'pointer',
};
