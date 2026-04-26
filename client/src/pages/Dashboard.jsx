import { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import api from '../utils/api';
import { TbEye, TbEdit, TbTrash, TbShare, TbShareOff, TbShield, TbFolder, TbFolderPlus, TbUsers, TbUserPlus, TbX, TbArrowRight, TbDatabase, TbUpload, TbLayoutDashboard, TbLogout, TbUser, TbTableOptions, TbSun, TbMoon, TbDeviceLaptop, TbChevronDown, TbExternalLink } from 'react-icons/tb';
import { useTheme } from '../hooks/useTheme';
// Cloud edition contributes user-menu entries (e.g. Billing). Empty in OSS builds.
import { userMenuLinks as cloudUserMenuLinks } from '../cloud';

export default function Dashboard() {
  const { user, logout } = useAuth();
  const { mode: themeMode, resolved: themeResolved, setMode: setThemeMode, themes: availableThemes } = useTheme();
  const logoSrc = themeResolved === 'dark' ? '/logo-dark.svg' : '/logo.svg';
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef(null);
  const navigate = useNavigate();
  const [reports, setReports] = useState([]);
  const [models, setModels] = useState([]);
  const [workspaces, setWorkspaces] = useState([]);
  // Remember the last-visited workspace per user across reloads / page navigation
  const lastWsKey = user?.id ? `openreport.lastWorkspace.${user.id}` : null;
  const [selectedWs, setSelectedWs] = useState(() => {
    if (typeof window === 'undefined') return null;
    try {
      const stored = lastWsKey ? window.localStorage.getItem(lastWsKey) : null;
      return stored && stored !== 'null' ? stored : null;
    } catch { return null; }
  }); // null = My Reports
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
  const [createMode, setCreateMode] = useState(null); // null | 'model' | 'file' | 'connection'
  const [uploadingFile, setUploadingFile] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const createFileRef = useRef(null);
  const [newWsName, setNewWsName] = useState('');
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [newMemberRole, setNewMemberRole] = useState('viewer');
  const [userSuggestions, setUserSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchTimer = useRef(null);

  const searchUsers = (query) => {
    setNewMemberEmail(query);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (query.length < 2) { setUserSuggestions([]); setShowSuggestions(false); return; }
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await api.get(`/auth/users/search?q=${encodeURIComponent(query)}`);
        // Filter out existing members and owner
        const existing = new Set([...(wsMembers || []).map((m) => m.id), wsOwner?.id].filter(Boolean));
        setUserSuggestions((res.data.users || []).filter((u) => !existing.has(u.id)));
        setShowSuggestions(true);
      } catch { setUserSuggestions([]); }
    }, 200);
  };

  const selectSuggestion = (u) => {
    setNewMemberEmail(u.email);
    setShowSuggestions(false);
    setUserSuggestions([]);
  };

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
        const loadedWs = wsRes.data.workspaces || [];
        setWorkspaces(loadedWs);
        // If the persisted workspace no longer exists (deleted, access removed), reset selection.
        if (selectedWs && !loadedWs.some((w) => w.id === selectedWs)) {
          setSelectedWs(null);
        }
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close user menu on outside click / Escape
  useEffect(() => {
    if (!userMenuOpen) return;
    const onClick = (e) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) setUserMenuOpen(false);
    };
    const onEsc = (e) => { if (e.key === 'Escape') setUserMenuOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onEsc);
    return () => { document.removeEventListener('mousedown', onClick); document.removeEventListener('keydown', onEsc); };
  }, [userMenuOpen]);

  // On first render the user may not yet be loaded (AuthContext fetches async),
  // so the useState initializer runs with lastWsKey=null. Restore once the key becomes known.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || !lastWsKey || typeof window === 'undefined') return;
    restoredRef.current = true;
    try {
      const stored = window.localStorage.getItem(lastWsKey);
      if (stored && stored !== 'null') setSelectedWs(stored);
    } catch { /* ignore */ }
  }, [lastWsKey]);

  // Persist the current workspace selection so we come back to it next time
  useEffect(() => {
    if (!lastWsKey || typeof window === 'undefined' || !restoredRef.current) return;
    try {
      if (selectedWs) window.localStorage.setItem(lastWsKey, selectedWs);
      else window.localStorage.removeItem(lastWsKey);
    } catch { /* ignore quota / privacy-mode errors */ }
  }, [selectedWs, lastWsKey]);

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

  const handleFileForReport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingFile(true);
    setUploadError('');
    try {
      // 1. Upload file → creates DuckDB datasource (or reuses existing)
      const formData = new FormData();
      formData.append('file', file);
      formData.append('name', file.name.replace(/\.[^.]+$/, ''));
      const uploadRes = await api.post('/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      const ds = uploadRes.data.datasource;

      // If reused, check if a model already exists for this datasource
      let modelId;
      if (uploadRes.data.reused) {
        const existingModel = models.find((m) => m.datasource_id === ds.id);
        if (existingModel) {
          modelId = existingModel.id;
        }
      }

      if (!modelId) {
        // 2. Create a model from the datasource
        const modelRes = await api.post('/models', { name: ds.name, datasourceId: ds.id });
        modelId = modelRes.data.model.id;

        // 3. Load columns for the table and auto-add all as dimensions
        const colRes = await api.get(`/datasources/${ds.id}/tables/${ds.tableName}/columns`);
        const cols = colRes.data.columns || [];
        const numericTypes = ['integer', 'bigint', 'numeric', 'decimal', 'real', 'double', 'float', 'int', 'smallint', 'double precision'];
        const dateTypes = ['date', 'timestamp', 'timestamptz', 'timestamp with time zone', 'timestamp without time zone', 'datetime', 'time', 'smalldatetime', 'datetime2'];
        const dimensions = [];
        const measures = [];
        cols.forEach((c) => {
          const dimName = `${ds.tableName}.${c.column_name}`;
          const dt = c.data_type?.toLowerCase() || '';
          const colType = numericTypes.includes(dt) ? 'number' : dateTypes.includes(dt) ? 'date' : 'string';
          dimensions.push({ name: dimName, table: ds.tableName, column: c.column_name, type: colType, label: c.column_name });
          if (numericTypes.includes(dt)) {
            measures.push({ name: `${ds.tableName}.${c.column_name}_sum`, table: ds.tableName, column: c.column_name, aggregation: 'sum', label: c.column_name });
          }
        });
        await api.put(`/models/${modelId}`, { selected_tables: [ds.tableName], dimensions, measures });
      }

      // 4. Create report with this model
      const reportRes = await api.post('/reports', {
        title: newTitle || ds.name,
        modelId,
        ...(selectedWs ? { workspaceId: selectedWs } : {}),
        settings: { theme: availableThemes[themeResolved] ? { key: themeResolved, ...availableThemes[themeResolved] } : null },
      });
      navigate(`/edit/${reportRes.data.report.id}`);
    } catch (err) {
      setUploadError(err.response?.data?.error || err.message);
    } finally {
      setUploadingFile(false);
      if (createFileRef.current) createFileRef.current.value = '';
    }
  };

  const handleCreate = async () => {
    if (!newModelId) return;
    const res = await api.post('/reports', {
      title: newTitle || 'Untitled Report', modelId: newModelId,
      ...(selectedWs ? { workspaceId: selectedWs } : {}),
      settings: { theme: availableThemes[themeResolved] ? { key: themeResolved, ...availableThemes[themeResolved] } : null },
    });
    navigate(`/edit/${res.data.report.id}`);
  };

  const deleteReport = async (id) => {
    if (!confirm('Are you sure you want to delete this report?')) return;
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
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-app)' }}>
      {/* Header */}
      <header style={headerStyle}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: -0.5, display: 'flex', alignItems: 'center', gap: 8 }}>
          <img src={logoSrc} alt="Open Report" style={{ height: 28 }} />
        </h1>
        <nav style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {(canEdit || user?.role === 'admin') && (
            <div style={navPillGroup}>
              {canEdit && (
                <>
                  <button onClick={() => navigate('/datasources')} style={navBtnStyled}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-panel)'; e.currentTarget.style.boxShadow = 'var(--shadow-md)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'translateY(0)'; }}
                  >
                    <TbDatabase size={15} /> <span>Data Sources</span>
                  </button>
                  <button onClick={() => navigate('/models')} style={navBtnStyled}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-panel)'; e.currentTarget.style.boxShadow = 'var(--shadow-md)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'translateY(0)'; }}
                  >
                    <TbTableOptions size={15} /> <span>Models</span>
                  </button>
                </>
              )}
              {user?.role === 'admin' && (
                <button onClick={() => navigate('/admin')} style={navBtnStyled}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-panel)'; e.currentTarget.style.boxShadow = 'var(--shadow-md)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'translateY(0)'; }}
                >
                  <TbShield size={15} /> <span>Admin</span>
                </button>
              )}
            </div>
          )}
          <div ref={userMenuRef} style={{ position: 'relative' }}>
            <button
              onClick={() => setUserMenuOpen((v) => !v)}
              style={userPillStyle}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--accent-primary-border)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--accent-primary-soft)'; }}
            >
              <TbUser size={14} color="var(--accent-primary)" />
              <span>{user?.display_name || user?.email}</span>
              <TbChevronDown size={12} style={{ transition: 'transform 0.12s', transform: userMenuOpen ? 'rotate(180deg)' : 'none' }} />
            </button>
            {userMenuOpen && (
              <div style={userMenuDropdown}>
                <div style={userMenuSectionLabel}>Theme</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '4px 8px 8px' }}>
                  {/* "System" follows the OS preference */}
                  <button onClick={() => setThemeMode('system')} style={themeRowBtn(themeMode === 'system')}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <TbDeviceLaptop size={14} />
                      <span>System</span>
                    </span>
                    {themeMode === 'system' && <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>auto</span>}
                  </button>
                  {/* All themes from the JSON definition */}
                  {Object.entries(availableThemes).map(([key, theme]) => {
                    const active = themeMode === key;
                    const Icon = theme.kind === 'dark' ? TbMoon : TbSun;
                    return (
                      <button key={key} onClick={() => setThemeMode(key)} style={themeRowBtn(active)}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                          <span style={{
                            width: 14, height: 14, borderRadius: 3,
                            background: theme.vars?.['--bg-app'] || '#fff',
                            border: '1px solid ' + (theme.vars?.['--border-default'] || '#e2e8f0'),
                            display: 'inline-block',
                          }} />
                          <span>{theme.label || key}</span>
                        </span>
                        {active && <Icon size={12} style={{ color: 'var(--accent-primary)' }} />}
                      </button>
                    );
                  })}
                </div>
                {/* Cloud-only entries (Billing, Account, etc.). Empty array in OSS = nothing rendered. */}
                {cloudUserMenuLinks && cloudUserMenuLinks.length > 0 && (
                  <>
                    <div style={userMenuDivider} />
                    {cloudUserMenuLinks.map((link) => {
                      const Icon = link.icon || TbExternalLink;
                      return (
                        <Link
                          key={link.to}
                          to={link.to}
                          onClick={() => setUserMenuOpen(false)}
                          style={{ ...userMenuItem, textDecoration: 'none' }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                        >
                          <Icon size={15} />
                          <span>{link.label}</span>
                        </Link>
                      );
                    })}
                  </>
                )}
                <div style={userMenuDivider} />
                <button
                  onClick={() => { setUserMenuOpen(false); logout(); }}
                  style={userMenuItem}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <TbLogout size={15} />
                  <span>Logout</span>
                </button>
              </div>
            )}
          </div>
        </nav>
      </header>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* Sidebar — Workspaces */}
        <div style={sidebarStyle}>
          <div style={{ padding: '12px 16px', fontWeight: 600, fontSize: 11, color: 'var(--text-disabled)', textTransform: 'uppercase' }}>Workspaces</div>

          <button onClick={() => setSelectedWs(null)}
            style={{ ...wsItemStyle, fontWeight: !selectedWs ? 700 : 400, background: !selectedWs ? 'var(--bg-active)' : 'transparent', color: !selectedWs ? 'var(--accent-primary)' : 'var(--text-secondary)' }}>
            <TbFolder size={16} /> My Reports
          </button>

          {workspaces.map((ws) => (
            <button key={ws.id} onClick={() => setSelectedWs(ws.id)}
              style={{ ...wsItemStyle, fontWeight: selectedWs === ws.id ? 700 : 400, background: selectedWs === ws.id ? 'var(--bg-active)' : 'transparent', color: selectedWs === ws.id ? 'var(--accent-primary)' : 'var(--text-secondary)' }}>
              <TbFolder size={16} />
              <span style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ws.name}</span>
              <span style={{ fontSize: 10, color: 'var(--text-disabled)' }}>{ws.report_count}</span>
            </button>
          ))}

          {canEdit && (
            <div style={{ padding: '8px 12px' }}>
              {showCreateWs ? (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 2,
                  padding: 3, background: 'var(--bg-subtle)',
                  border: '1px solid var(--border-default)', borderRadius: 8,
                }}>
                  <input
                    placeholder="Workspace name" value={newWsName}
                    onChange={(e) => setNewWsName(e.target.value)}
                    style={{
                      flex: 1, padding: '4px 8px', border: 'none', background: 'transparent',
                      fontSize: 12, outline: 'none', color: 'var(--text-primary)', minWidth: 0,
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && createWorkspace()} autoFocus
                  />
                  <button onClick={createWorkspace}
                    disabled={!newWsName.trim()}
                    title="Create"
                    style={{
                      width: 22, height: 22, padding: 0, border: 'none',
                      borderRadius: 5, cursor: newWsName.trim() ? 'pointer' : 'not-allowed',
                      background: newWsName.trim() ? 'var(--accent-primary)' : 'var(--bg-hover)',
                      color: newWsName.trim() ? '#fff' : 'var(--text-disabled)',
                      fontSize: 13, fontWeight: 600, lineHeight: 1,
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      transition: 'background 0.12s',
                    }}>+</button>
                  <button onClick={() => { setShowCreateWs(false); setNewWsName(''); }}
                    title="Cancel"
                    style={{
                      width: 22, height: 22, padding: 0, border: 'none',
                      borderRadius: 5, cursor: 'pointer',
                      background: 'transparent', color: 'var(--text-muted)',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      transition: 'background 0.12s, color 0.12s',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)'; }}
                  >
                    <TbX size={13} />
                  </button>
                </div>
              ) : (
                <button onClick={() => setShowCreateWs(true)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                    padding: '8px 12px', border: '1px dashed var(--border-default)',
                    borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 500,
                    background: 'transparent', color: 'var(--text-muted)',
                    textAlign: 'left', transition: 'border-color 0.12s, color 0.12s, background 0.12s',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent-primary)'; e.currentTarget.style.color = 'var(--accent-primary)'; e.currentTarget.style.background = 'var(--bg-subtle)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-default)'; e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'transparent'; }}
                >
                  <TbFolderPlus size={14} /> New workspace
                </button>
              )}
            </div>
          )}
        </div>

        {/* Main content */}
        <main style={{ flex: 1, overflow: 'auto', padding: '24px 32px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-primary)' }}>{wsName}</h2>
              {selectedWs && (
                <>
                  <button onClick={() => setShowMembers(!showMembers)} style={{ ...iconBtn, color: 'var(--text-muted)' }} title="Members">
                    <TbUsers size={16} />
                  </button>
                  {wsUserRole === 'admin' && (
                    <button onClick={() => deleteWorkspace(selectedWs)} style={{ ...iconBtn, color: 'var(--state-danger)' }} title="Delete workspace">
                      <TbTrash size={14} />
                    </button>
                  )}
                </>
              )}
            </div>
            {canEdit && <button onClick={() => { setNewTitle(''); setNewModelId(''); setCreateMode(null); setUploadError(''); setShowCreate(true); }} style={primaryBtn}>+ New Report</button>}
          </div>

          {/* Members panel */}
          {showMembers && selectedWs && (
            <div style={membersPanel}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Members</div>
              {wsOwner && (
                <div style={memberRow}>
                  <span>{wsOwner.display_name || wsOwner.email}</span>
                  <span style={{ fontSize: 11, color: 'var(--state-danger)', fontWeight: 600 }}>Owner</span>
                </div>
              )}
              {wsMembers.map((m) => (
                <div key={m.id} style={memberRow}>
                  <span>{m.display_name || m.email}</span>
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    {wsUserRole === 'admin' ? (
                      <>
                        <select value={m.role} onChange={(e) => updateMemberRole(m.id, e.target.value)}
                          style={{ padding: '2px 4px', border: '1px solid var(--border-default)', borderRadius: 3, fontSize: 11 }}>
                          <option value="admin">Admin</option>
                          <option value="editor">Editor</option>
                          <option value="viewer">Viewer</option>
                        </select>
                        <button onClick={() => removeMember(m.id)} style={{ ...iconBtn, padding: '2px 4px' }}><TbX size={12} /></button>
                      </>
                    ) : (
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{m.role}</span>
                    )}
                  </div>
                </div>
              ))}
              {wsUserRole === 'admin' && (
                <div style={{ display: 'flex', gap: 4, marginTop: 8, position: 'relative' }}>
                  <div style={{ flex: 1, position: 'relative' }}>
                    <input placeholder="Search user..." value={newMemberEmail}
                      onChange={(e) => searchUsers(e.target.value)}
                      onFocus={() => userSuggestions.length > 0 && setShowSuggestions(true)}
                      onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                      style={{ width: '100%', padding: '4px 8px', border: '1px solid var(--border-default)', borderRadius: 4, fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />
                    {showSuggestions && userSuggestions.length > 0 && (
                      <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--bg-panel)', border: '1px solid var(--border-default)', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 20, maxHeight: 150, overflow: 'auto' }}>
                        {userSuggestions.map((u) => (
                          <div key={u.id} onClick={() => selectSuggestion(u)}
                            style={{ padding: '6px 10px', cursor: 'pointer', fontSize: 12, borderBottom: '1px solid #f8fafc', display: 'flex', justifyContent: 'space-between' }}
                            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-active)'}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'var(--bg-panel)'}>
                            <span style={{ fontWeight: 500 }}>{u.display_name || u.email.split('@')[0]}</span>
                            <span style={{ color: 'var(--text-disabled)' }}>{u.email}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <select value={newMemberRole} onChange={(e) => setNewMemberRole(e.target.value)}
                    style={{ padding: '4px 6px', border: '1px solid var(--border-default)', borderRadius: 4, fontSize: 11 }}>
                    <option value="viewer">Viewer</option>
                    <option value="editor">Editor</option>
                    <option value="admin">Admin</option>
                  </select>
                  <button onClick={addMember} style={{ padding: '4px 8px', border: 'none', borderRadius: 4, background: 'var(--accent-primary)', color: '#fff', cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center' }}>
                    <TbUserPlus size={14} />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Create report modal — wizard */}
          {showCreate && (
            <div style={modalOverlay} onClick={() => { setShowCreate(false); setCreateMode(null); setUploadError(''); }}>
              <div style={{ ...modalCard, width: 480 }} onClick={(e) => e.stopPropagation()}>
                <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>New Report{selectedWs ? ` in ${wsName}` : ''}</h3>

                {/* Title — always visible */}
                <div style={{ marginBottom: 12 }}>
                  <label style={labelStyle}>Title</label>
                  <input style={inputStyle} value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Report title" />
                </div>

                {/* Step 1: Choose source type */}
                {!createMode && (
                  <div>
                    <label style={{ ...labelStyle, marginBottom: 10 }}>Data source</label>
                    <div style={{ display: 'flex', gap: 10 }}>
                      {models.length > 0 && (
                        <button onClick={() => setCreateMode('model')} style={sourceCard}>
                          <TbLayoutDashboard size={28} color="var(--accent-primary)" />
                          <span style={{ fontWeight: 600, fontSize: 13 }}>Existing Model</span>
                          <span style={{ fontSize: 11, color: 'var(--text-disabled)' }}>Use a data model already configured</span>
                        </button>
                      )}
                      <button onClick={() => setCreateMode('file')} style={sourceCard}>
                        <TbUpload size={28} color="#16a34a" />
                        <span style={{ fontWeight: 600, fontSize: 13 }}>Import File</span>
                        <span style={{ fontSize: 11, color: 'var(--text-disabled)' }}>CSV, Excel, Parquet, JSON</span>
                      </button>
                      <button onClick={() => { setShowCreate(false); navigate('/datasources'); }} style={sourceCard}>
                        <TbDatabase size={28} color="#f59e0b" />
                        <span style={{ fontWeight: 600, fontSize: 13 }}>Database</span>
                        <span style={{ fontSize: 11, color: 'var(--text-disabled)' }}>Connect to a database</span>
                      </button>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
                      <button onClick={() => { setShowCreate(false); setCreateMode(null); }} style={secondaryBtn}>Cancel</button>
                    </div>
                  </div>
                )}

                {/* Step 2a: Choose existing model */}
                {createMode === 'model' && (
                  <div>
                    <div style={{ marginBottom: 16 }}>
                      <label style={labelStyle}>Model</label>
                      <select style={inputStyle} value={newModelId} onChange={(e) => setNewModelId(e.target.value)}>
                        <option value="">Select a model...</option>
                        {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                      </select>
                    </div>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
                      <button onClick={() => setCreateMode(null)} style={secondaryBtn}>← Back</button>
                      <button onClick={handleCreate} disabled={!newModelId} style={{ ...primaryBtn, opacity: newModelId ? 1 : 0.5 }}>Create Report</button>
                    </div>
                  </div>
                )}

                {/* Step 2b: Upload file */}
                {createMode === 'file' && (
                  <div>
                    <input ref={createFileRef} type="file" accept=".csv,.xlsx,.xls,.parquet,.json,.tsv" style={{ display: 'none' }}
                      onChange={handleFileForReport} />
                    <div
                      onClick={() => !uploadingFile && createFileRef.current?.click()}
                      style={{
                        border: '2px dashed #cbd5e1', borderRadius: 8, padding: '32px 20px', textAlign: 'center',
                        cursor: uploadingFile ? 'wait' : 'pointer', marginBottom: 12,
                        background: 'var(--bg-panel-alt)', transition: 'border-color 0.15s',
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--accent-primary)'}
                      onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--border-strong)'}
                    >
                      {uploadingFile ? (
                        <div style={{ color: 'var(--accent-primary)', fontSize: 14 }}>Importing data...</div>
                      ) : (
                        <>
                          <TbUpload size={32} color="var(--text-disabled)" />
                          <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginTop: 8 }}>Click to select a file</div>
                          <div style={{ fontSize: 12, color: 'var(--text-disabled)', marginTop: 4 }}>CSV, Excel, Parquet, JSON (max 500 Mo)</div>
                        </>
                      )}
                    </div>
                    {uploadError && <div style={{ color: 'var(--state-danger)', fontSize: 12, marginBottom: 8 }}>{uploadError}</div>}
                    <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                      <button onClick={() => { setCreateMode(null); setUploadError(''); }} style={secondaryBtn}>← Back</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Reports grid */}
          {loading ? (
            <div style={{ textAlign: 'center', color: 'var(--text-disabled)', marginTop: 60 }}>Loading...</div>
          ) : wsReports.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--text-disabled)', marginTop: 60 }}>
              No reports{selectedWs ? ' in this workspace' : ''}.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
              {wsReports.map((report) => (
                <div key={report.id} style={cardStyle}>
                  <div onClick={() => window.open(`/view/${report.id}`, '_blank')}
                    style={{ cursor: 'pointer', padding: 20, flex: 1 }}>
                    <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>{report.title}</h3>
                    {report.model_name && <p style={{ fontSize: 12, color: 'var(--accent-primary)', marginBottom: 4 }}>{report.model_name}</p>}
                    <p style={{ fontSize: 12, color: 'var(--text-disabled)' }}>Updated {new Date(report.updated_at).toLocaleDateString()}</p>
                  </div>
                  <div style={{ padding: '8px 20px 16px', display: 'flex', gap: 6, alignItems: 'center' }}>
                    <button onClick={() => window.open(`/view/${report.id}`, '_blank')} title="View" style={{ ...iconBtn, color: 'var(--accent-primary)', borderColor: 'var(--accent-primary)' }}><TbEye size={16} /></button>
                    {canEdit && <button onClick={() => navigate(`/edit/${report.id}`)} title="Edit" style={{ ...iconBtn, color: 'var(--text-secondary)', borderColor: 'var(--border-default)' }}><TbEdit size={16} /></button>}
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
                        style={{ padding: '4px 6px', border: '1px solid var(--border-default)', borderRadius: 4, fontSize: 10, color: 'var(--text-muted)', cursor: 'pointer', maxWidth: 80 }}>
                        <option value="">My Reports</option>
                        {workspaces.map((ws) => <option key={ws.id} value={ws.id}>{ws.name}</option>)}
                      </select>
                    )}
                    {canEdit && <button onClick={() => deleteReport(report.id)} title="Delete" style={{ ...iconBtn, color: 'var(--state-danger)', borderColor: 'var(--state-danger)' }}><TbTrash size={16} /></button>}
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

const headerStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 20px', backgroundColor: 'var(--bg-panel)', borderBottom: '1px solid var(--border-default)', flexShrink: 0 };
const navPillGroup = {
  display: 'flex', alignItems: 'center', gap: 2,
  padding: '3px 4px', background: 'var(--bg-subtle)',
  border: '1px solid var(--border-default)', borderRadius: 10,
};
const navBtnStyled = {
  display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px',
  background: 'transparent', border: 'none', borderRadius: 7,
  color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 13, fontWeight: 500,
  transition: 'background 0.15s, box-shadow 0.15s, transform 0.15s',
};
const userPillStyle = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '6px 10px', borderRadius: 8,
  background: 'var(--accent-primary-soft)', border: '1px solid var(--accent-primary-border)',
  fontSize: 12, color: 'var(--accent-primary-text)', fontWeight: 500,
  cursor: 'pointer', transition: 'background 0.12s',
};
const userMenuDropdown = {
  position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 200,
  minWidth: 220, background: 'var(--bg-panel)', border: '1px solid var(--border-default)',
  borderRadius: 10, boxShadow: 'var(--shadow-md)', padding: '6px 0',
};
const userMenuSectionLabel = { fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', padding: '6px 12px 4px' };
const userMenuDivider = { height: 1, background: 'var(--border-default)', margin: '4px 0' };
const userMenuItem = { display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 12px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 13, color: 'var(--text-secondary)', textAlign: 'left', transition: 'background 0.12s' };
function themeRowBtn(active) {
  return {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    width: '100%', padding: '6px 8px', fontSize: 12, fontWeight: active ? 600 : 500,
    border: '1px solid ' + (active ? 'var(--accent-primary)' : 'transparent'),
    borderRadius: 6,
    background: active ? 'var(--accent-primary-soft)' : 'transparent',
    color: active ? 'var(--accent-primary-text)' : 'var(--text-secondary)',
    cursor: 'pointer', transition: 'background 0.12s, border-color 0.12s',
    textAlign: 'left',
  };
}
const primaryBtn = { padding: '8px 16px', fontSize: 13, fontWeight: 600, border: 'none', borderRadius: 6, background: 'var(--accent-primary)', color: '#fff', cursor: 'pointer' };
const secondaryBtn = { padding: '8px 16px', fontSize: 13, background: 'var(--bg-panel)', color: 'var(--text-secondary)', border: '1px solid var(--border-default)', borderRadius: 6, cursor: 'pointer' };
const iconBtn = { background: 'transparent', border: '1px solid', borderRadius: 6, padding: '6px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center' };
const cardStyle = { backgroundColor: 'var(--bg-panel)', borderRadius: 8, border: '1px solid var(--border-default)', display: 'flex', flexDirection: 'column', transition: 'box-shadow 0.15s', overflow: 'hidden' };
const inputStyle = { width: '100%', padding: '8px 10px', border: '1px solid var(--border-default)', borderRadius: 6, fontSize: 13, outline: 'none', boxSizing: 'border-box', background: 'var(--bg-panel)', color: 'var(--text-primary)' };
const labelStyle = { display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4, fontWeight: 500 };
const modalOverlay = { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 };
const modalCard = { backgroundColor: 'var(--bg-panel)', borderRadius: 12, padding: 24, width: 400, maxWidth: '90vw', boxShadow: 'var(--shadow-lg)', color: 'var(--text-primary)' };
const sourceCard = {
  flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
  padding: '20px 12px', border: '1px solid var(--border-default)', borderRadius: 8, background: 'var(--bg-panel)',
  cursor: 'pointer', textAlign: 'center', transition: 'all 0.15s', color: 'var(--text-primary)',
};
const sidebarStyle = { width: 240, backgroundColor: 'var(--bg-panel)', borderRight: '1px solid var(--border-default)', overflow: 'auto', flexShrink: 0 };
const wsItemStyle = { display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 16px', border: 'none', cursor: 'pointer', fontSize: 13, textAlign: 'left' };
const membersPanel = { backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border-default)', borderRadius: 8, padding: 16, marginBottom: 20 };
const memberRow = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', fontSize: 13, borderBottom: '1px solid var(--bg-subtle)' };
