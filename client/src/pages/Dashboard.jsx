import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import api from '../utils/api';
import { TbEye, TbEdit, TbTrash, TbShare, TbShareOff, TbShield, TbFolder, TbFolderPlus, TbUsers, TbUserPlus, TbX, TbArrowRight } from 'react-icons/tb';

export default function Dashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [reports, setReports] = useState([]);
  const [models, setModels] = useState([]);
  const [workspaces, setWorkspaces] = useState([]);
  const [selectedWs, setSelectedWs] = useState(null); // null = My Reports
  const [wsReports, setWsReports] = useState([]);
  const [wsMembers, setWsMembers] = useState([]);
  const [wsOwner, setWsOwner] = useState(null);
  const [wsUserRole, setWsUserRole] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showCreateWs, setShowCreateWs] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newModelId, setNewModelId] = useState('');
  const [newWsName, setNewWsName] = useState('');
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [newMemberRole, setNewMemberRole] = useState('viewer');

  const canEdit = user?.role !== 'viewer';

  // Load data
  useEffect(() => {
    const load = async () => {
      try {
        const [reportsRes, modelsRes, wsRes] = await Promise.all([
          api.get('/reports'),
          api.get('/models').catch(() => ({ data: { models: [] } })),
          api.get('/workspaces').catch(() => ({ data: { workspaces: [] } })),
        ]);
        setReports(reportsRes.data.reports);
        setModels(modelsRes.data.models || []);
        setWorkspaces(wsRes.data.workspaces || []);
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    };
    load();
  }, []);

  // Load workspace content
  useEffect(() => {
    if (!selectedWs) {
      setWsReports(reports.filter((r) => !r.workspace_id));
      setWsMembers([]);
      setWsOwner(null);
      setWsUserRole(null);
      return;
    }
    api.get(`/workspaces/${selectedWs}`).then((res) => {
      setWsReports(res.data.reports || []);
      setWsMembers(res.data.members || []);
      setWsOwner(res.data.owner);
      setWsUserRole(res.data.userRole);
    }).catch(() => {});
  }, [selectedWs, reports]);

  const handleCreate = async () => {
    if (!newModelId) return;
    const res = await api.post('/reports', {
      title: newTitle || 'Untitled Report', modelId: newModelId,
      ...(selectedWs ? { workspaceId: selectedWs } : {}),
    });
    navigate(`/edit/${res.data.report.id}`);
  };

  const deleteReport = async (id) => {
    await api.delete(`/reports/${id}`);
    setReports((p) => p.filter((r) => r.id !== id));
    setWsReports((p) => p.filter((r) => r.id !== id));
  };

  const togglePublic = async (report) => {
    const newVal = report.is_public ? 0 : 1;
    await api.put(`/reports/${report.id}`, { is_public: newVal });
    setReports((p) => p.map((r) => r.id === report.id ? { ...r, is_public: newVal } : r));
    setWsReports((p) => p.map((r) => r.id === report.id ? { ...r, is_public: newVal } : r));
    if (newVal) {
      const url = `${window.location.origin}/view/${report.id}`;
      navigator.clipboard?.writeText(url);
      alert(`Public link copied:\n${url}`);
    }
  };

  const createWorkspace = async () => {
    if (!newWsName) return;
    const res = await api.post('/workspaces', { name: newWsName });
    setWorkspaces((p) => [...p, { ...res.data.workspace, member_role: 'admin', report_count: 0, member_count: 1 }]);
    setShowCreateWs(false);
    setNewWsName('');
    setSelectedWs(res.data.workspace.id);
  };

  const deleteWorkspace = async (wsId) => {
    if (!confirm('Delete this workspace? Reports will be moved to My Reports.')) return;
    await api.delete(`/workspaces/${wsId}`);
    setWorkspaces((p) => p.filter((w) => w.id !== wsId));
    if (selectedWs === wsId) setSelectedWs(null);
  };

  const addMember = async () => {
    if (!newMemberEmail || !selectedWs) return;
    try {
      const res = await api.post(`/workspaces/${selectedWs}/members`, { email: newMemberEmail, role: newMemberRole });
      setWsMembers((p) => [...p, res.data.member]);
      setNewMemberEmail('');
    } catch (err) { alert(err.response?.data?.error || 'Failed'); }
  };

  const updateMemberRole = async (userId, role) => {
    await api.put(`/workspaces/${selectedWs}/members/${userId}`, { role });
    setWsMembers((p) => p.map((m) => m.id === userId ? { ...m, role } : m));
  };

  const removeMember = async (userId) => {
    await api.delete(`/workspaces/${selectedWs}/members/${userId}`);
    setWsMembers((p) => p.filter((m) => m.id !== userId));
  };

  const moveReport = async (reportId, wsId) => {
    if (wsId) {
      await api.put(`/workspaces/${wsId}/reports/${reportId}`);
    } else {
      await api.put(`/reports/${reportId}`, { workspace_id: null });
    }
    // Refresh
    const res = await api.get('/reports');
    setReports(res.data.reports);
  };

  const wsName = selectedWs ? workspaces.find((w) => w.id === selectedWs)?.name || 'Workspace' : 'My Reports';
  const canEditWs = wsUserRole === 'admin' || wsUserRole === 'editor';

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: '#f1f5f9' }}>
      {/* Header */}
      <header style={headerStyle}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#0f172a' }}>Open Report</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {canEdit && (
            <>
              <button onClick={() => navigate('/datasources')} style={navBtn}>Data Sources</button>
              <button onClick={() => navigate('/models')} style={navBtn}>Models</button>
            </>
          )}
          {user?.role === 'admin' && (
            <button onClick={() => navigate('/admin')} style={{ ...navBtn, display: 'flex', alignItems: 'center', gap: 4 }}>
              <TbShield size={14} /> Admin
            </button>
          )}
          <span style={{ fontSize: 13, color: '#64748b' }}>{user?.email}</span>
          <button onClick={logout} style={navBtn}>Logout</button>
        </div>
      </header>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* Sidebar — Workspaces */}
        <div style={sidebarStyle}>
          <div style={{ padding: '12px 16px', fontWeight: 600, fontSize: 11, color: '#94a3b8', textTransform: 'uppercase' }}>Workspaces</div>

          <button onClick={() => setSelectedWs(null)}
            style={{ ...wsItemStyle, fontWeight: !selectedWs ? 700 : 400, background: !selectedWs ? '#eff6ff' : 'transparent', color: !selectedWs ? '#3b82f6' : '#334155' }}>
            <TbFolder size={16} /> My Reports
          </button>

          {workspaces.map((ws) => (
            <button key={ws.id} onClick={() => setSelectedWs(ws.id)}
              style={{ ...wsItemStyle, fontWeight: selectedWs === ws.id ? 700 : 400, background: selectedWs === ws.id ? '#eff6ff' : 'transparent', color: selectedWs === ws.id ? '#3b82f6' : '#334155' }}>
              <TbFolder size={16} />
              <span style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ws.name}</span>
              <span style={{ fontSize: 10, color: '#94a3b8' }}>{ws.report_count}</span>
            </button>
          ))}

          {canEdit && (
            <div style={{ padding: '8px 12px' }}>
              {showCreateWs ? (
                <div style={{ display: 'flex', gap: 4 }}>
                  <input placeholder="Name" value={newWsName} onChange={(e) => setNewWsName(e.target.value)}
                    style={{ flex: 1, padding: '4px 6px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 12, outline: 'none' }}
                    onKeyDown={(e) => e.key === 'Enter' && createWorkspace()} autoFocus />
                  <button onClick={createWorkspace} style={{ fontSize: 11, padding: '4px 8px', border: 'none', borderRadius: 4, background: '#3b82f6', color: '#fff', cursor: 'pointer' }}>+</button>
                  <button onClick={() => setShowCreateWs(false)} style={{ fontSize: 11, padding: '4px 6px', border: '1px solid #e2e8f0', borderRadius: 4, background: '#fff', cursor: 'pointer' }}>
                    <TbX size={12} />
                  </button>
                </div>
              ) : (
                <button onClick={() => setShowCreateWs(true)} style={{ ...wsItemStyle, color: '#3b82f6', fontSize: 12 }}>
                  <TbFolderPlus size={16} /> New workspace
                </button>
              )}
            </div>
          )}
        </div>

        {/* Main content */}
        <main style={{ flex: 1, overflow: 'auto', padding: '24px 32px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <h2 style={{ fontSize: 18, fontWeight: 600, color: '#0f172a' }}>{wsName}</h2>
              {selectedWs && (
                <>
                  <button onClick={() => setShowMembers(!showMembers)} style={{ ...iconBtn, color: '#64748b' }} title="Members">
                    <TbUsers size={16} />
                  </button>
                  {wsUserRole === 'admin' && (
                    <button onClick={() => deleteWorkspace(selectedWs)} style={{ ...iconBtn, color: '#dc2626' }} title="Delete workspace">
                      <TbTrash size={14} />
                    </button>
                  )}
                </>
              )}
            </div>
            {canEdit && <button onClick={() => { setNewTitle(''); setNewModelId(models[0]?.id || ''); setShowCreate(true); }} style={primaryBtn}>+ New Report</button>}
          </div>

          {/* Members panel */}
          {showMembers && selectedWs && (
            <div style={membersPanel}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Members</div>
              {wsOwner && (
                <div style={memberRow}>
                  <span>{wsOwner.display_name || wsOwner.email}</span>
                  <span style={{ fontSize: 11, color: '#dc2626', fontWeight: 600 }}>Owner</span>
                </div>
              )}
              {wsMembers.map((m) => (
                <div key={m.id} style={memberRow}>
                  <span>{m.display_name || m.email}</span>
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    {wsUserRole === 'admin' ? (
                      <>
                        <select value={m.role} onChange={(e) => updateMemberRole(m.id, e.target.value)}
                          style={{ padding: '2px 4px', border: '1px solid #e2e8f0', borderRadius: 3, fontSize: 11 }}>
                          <option value="admin">Admin</option>
                          <option value="editor">Editor</option>
                          <option value="viewer">Viewer</option>
                        </select>
                        <button onClick={() => removeMember(m.id)} style={{ ...iconBtn, padding: '2px 4px' }}><TbX size={12} /></button>
                      </>
                    ) : (
                      <span style={{ fontSize: 11, color: '#64748b' }}>{m.role}</span>
                    )}
                  </div>
                </div>
              ))}
              {wsUserRole === 'admin' && (
                <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
                  <input placeholder="Email" value={newMemberEmail} onChange={(e) => setNewMemberEmail(e.target.value)}
                    style={{ flex: 1, padding: '4px 8px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 12, outline: 'none' }} />
                  <select value={newMemberRole} onChange={(e) => setNewMemberRole(e.target.value)}
                    style={{ padding: '4px 6px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 11 }}>
                    <option value="viewer">Viewer</option>
                    <option value="editor">Editor</option>
                    <option value="admin">Admin</option>
                  </select>
                  <button onClick={addMember} style={{ padding: '4px 8px', border: 'none', borderRadius: 4, background: '#3b82f6', color: '#fff', cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center' }}>
                    <TbUserPlus size={14} />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Create report modal */}
          {showCreate && (
            <div style={modalOverlay} onClick={() => setShowCreate(false)}>
              <div style={modalCard} onClick={(e) => e.stopPropagation()}>
                <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>New Report{selectedWs ? ` in ${wsName}` : ''}</h3>
                <div style={{ marginBottom: 12 }}>
                  <label style={labelStyle}>Title</label>
                  <input style={inputStyle} value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Report title" />
                </div>
                <div style={{ marginBottom: 16 }}>
                  <label style={labelStyle}>Model</label>
                  <select style={inputStyle} value={newModelId} onChange={(e) => setNewModelId(e.target.value)}>
                    <option value="">Select a model...</option>
                    {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button onClick={() => setShowCreate(false)} style={secondaryBtn}>Cancel</button>
                  <button onClick={handleCreate} disabled={!newModelId} style={{ ...primaryBtn, opacity: newModelId ? 1 : 0.5 }}>Create</button>
                </div>
              </div>
            </div>
          )}

          {/* Reports grid */}
          {loading ? (
            <div style={{ textAlign: 'center', color: '#94a3b8', marginTop: 60 }}>Loading...</div>
          ) : wsReports.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#94a3b8', marginTop: 60 }}>
              No reports{selectedWs ? ' in this workspace' : ''}.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
              {wsReports.map((report) => (
                <div key={report.id} style={cardStyle}>
                  <div onClick={() => window.open(`/view/${report.id}`, '_blank')}
                    style={{ cursor: 'pointer', padding: 20, flex: 1 }}>
                    <h3 style={{ fontSize: 16, fontWeight: 600, color: '#0f172a', marginBottom: 4 }}>{report.title}</h3>
                    {report.model_name && <p style={{ fontSize: 12, color: '#3b82f6', marginBottom: 4 }}>{report.model_name}</p>}
                    <p style={{ fontSize: 12, color: '#94a3b8' }}>Updated {new Date(report.updated_at).toLocaleDateString()}</p>
                  </div>
                  <div style={{ padding: '8px 20px 16px', display: 'flex', gap: 6, alignItems: 'center' }}>
                    <button onClick={() => window.open(`/view/${report.id}`, '_blank')} title="View" style={{ ...iconBtn, color: '#3b82f6', borderColor: '#bfdbfe' }}><TbEye size={16} /></button>
                    {canEdit && <button onClick={() => navigate(`/edit/${report.id}`)} title="Edit" style={{ ...iconBtn, color: '#475569', borderColor: '#e2e8f0' }}><TbEdit size={16} /></button>}
                    {canEdit && (
                      <button onClick={() => togglePublic(report)} title={report.is_public ? 'Make private' : 'Share public link'}
                        style={{ ...iconBtn, color: report.is_public ? '#16a34a' : '#94a3b8', borderColor: report.is_public ? '#bbf7d0' : '#e2e8f0' }}>
                        {report.is_public ? <TbShare size={16} /> : <TbShareOff size={16} />}
                      </button>
                    )}
                    {/* Move to workspace */}
                    {canEdit && workspaces.length > 0 && (
                      <select value={report.workspace_id || ''} onChange={(e) => moveReport(report.id, e.target.value || null)}
                        title="Move to workspace"
                        style={{ padding: '4px 6px', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 10, color: '#64748b', cursor: 'pointer', maxWidth: 80 }}>
                        <option value="">My Reports</option>
                        {workspaces.map((ws) => <option key={ws.id} value={ws.id}>{ws.name}</option>)}
                      </select>
                    )}
                    {canEdit && <button onClick={() => deleteReport(report.id)} title="Delete" style={{ ...iconBtn, color: '#dc2626', borderColor: '#fca5a5' }}><TbTrash size={16} /></button>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

const headerStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 24px', backgroundColor: '#fff', borderBottom: '1px solid #e2e8f0', flexShrink: 0 };
const navBtn = { background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: 13 };
const primaryBtn = { padding: '8px 16px', fontSize: 13, fontWeight: 600, border: 'none', borderRadius: 6, background: '#3b82f6', color: '#fff', cursor: 'pointer' };
const secondaryBtn = { padding: '8px 16px', fontSize: 13, background: '#fff', color: '#475569', border: '1px solid #e2e8f0', borderRadius: 6, cursor: 'pointer' };
const iconBtn = { background: 'none', border: '1px solid', borderRadius: 6, padding: '6px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center' };
const cardStyle = { backgroundColor: '#fff', borderRadius: 8, border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', transition: 'box-shadow 0.15s', overflow: 'hidden' };
const inputStyle = { width: '100%', padding: '8px 10px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13, outline: 'none', boxSizing: 'border-box' };
const labelStyle = { display: 'block', fontSize: 13, color: '#475569', marginBottom: 4, fontWeight: 500 };
const modalOverlay = { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 };
const modalCard = { backgroundColor: '#fff', borderRadius: 12, padding: 24, width: 400, maxWidth: '90vw', boxShadow: '0 8px 30px rgba(0,0,0,0.12)' };
const sidebarStyle = { width: 240, backgroundColor: '#fff', borderRight: '1px solid #e2e8f0', overflow: 'auto', flexShrink: 0 };
const wsItemStyle = { display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 16px', border: 'none', cursor: 'pointer', fontSize: 13, textAlign: 'left' };
const membersPanel = { backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 16, marginBottom: 20 };
const memberRow = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', fontSize: 13, borderBottom: '1px solid #f8fafc' };
