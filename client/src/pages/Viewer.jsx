import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import ReportCanvas from '../components/Canvas/ReportCanvas';
import api from '../utils/api';

export default function Viewer() {
  const { id } = useParams();
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get(`/reports/${id}`)
      .then((res) => setReport(res.data.report))
      .catch((err) => setError(err.response?.data?.error || 'Report not found'));
  }, [id]);

  if (error) {
    return (
      <div style={{ padding: 60, textAlign: 'center', color: '#dc2626' }}>
        {error}
      </div>
    );
  }

  if (!report) {
    return <div style={{ padding: 40, color: '#94a3b8' }}>Loading...</div>;
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f1f5f9' }}>
      <header
        style={{
          padding: '12px 24px',
          backgroundColor: '#fff',
          borderBottom: '1px solid #e2e8f0',
        }}
      >
        <h1 style={{ fontSize: 18, fontWeight: 600, color: '#0f172a' }}>
          {report.title}
        </h1>
      </header>
      <ReportCanvas
        layout={report.layout}
        widgets={report.widgets}
        readOnly
      />
    </div>
  );
}
