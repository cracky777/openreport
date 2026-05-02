import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import api from '../utils/api';
import { TbEye, TbEdit, TbTrash, TbShare, TbShareOff, TbShield, TbFolder, TbFolderPlus, TbUsers, TbUserPlus, TbX, TbArrowRight, TbDatabase, TbUpload, TbLayoutDashboard, TbLogout, TbUser, TbStack3, TbSun, TbMoon, TbDeviceLaptop, TbChevronDown, TbDotsVertical, TbPencil, TbCopy, TbArrowsRightLeft, TbHistory, TbArrowBackUp, TbLink, TbCalendarTime, TbPlayerPlay, TbToggleLeft, TbToggleRight } from 'react-icons/tb';
import { useTheme } from '../hooks/useTheme';
import { TopbarSwitcher, UserMenuExtras } from '../cloud';
import DatasourceForm, { createModelAndNavigate } from '../components/DatasourceForm/DatasourceForm';

export default function Dashboard() {
  const { user, logout } = useAuth();
  const { mode: themeMode, resolved: themeResolved, setMode: setThemeMode, themes: availableThemes } = useTheme();
  const logoSrc = themeResolved === 'dark' ? '/logo-dark.png' : '/logo.png';
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef(null);
  const navigate = useNavigate();
  const [reports, setReports] = useState([]);
  const [models, setModels] = useState([]);
  const [workspaces, setWorkspaces] = useState([]);
  // The user's personal workspace (auto-created at signup). Stays out of the
  // workspaces list — it backs the "My Reports" view so reports always have
  // a workspace_id set (required for custom visuals etc.).
  const [personalWorkspace, setPersonalWorkspace] = useState(null);
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
  // Cloud-only flag returned by GET /api/workspaces/:id when the workspace's
  // org is a Personal one. Lets us hide sharing controls. Undefined in OSS
  // (single-tenant) where every workspace is fair game.
  const [wsIsPersonalOrg, setWsIsPersonalOrg] = useState(false);
  // Cloud-only flag — true when the API exposed the members list (i.e. the
  // caller is ws_admin / org_admin). Hides the Members button for editors / viewers.
  const [wsCanSeeMembers, setWsCanSeeMembers] = useState(false);
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
  const [editingWsName, setEditingWsName] = useState(false);
  const [editedWsName, setEditedWsName] = useState('');
  // Import-from-JSON-bundle flow
  const importFileRef = useRef(null);
  const [importBundle, setImportBundle] = useState(null);   // parsed { format, report, ... } or null
  const [importModelId, setImportModelId] = useState('');
  const [importError, setImportError] = useState('');
  const [importing, setImporting] = useState(false);
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

  // Cloud-aware permission state. Falls back to OSS-style user.role check
  // when /api/cloud/orgs/active/current returns nothing (OSS or pre-cloud user).
  const [activeOrgRole, setActiveOrgRole] = useState(null); // 'admin' | 'editor' | 'viewer' | null
  useEffect(() => {
    api.get('/cloud/orgs/active/current')
      .then((res) => setActiveOrgRole(res.data.role || null))
      .catch(() => setActiveOrgRole(null));
  }, [selectedWs]); // refetch when org context might have shifted

  // Cloud-only — am I a platform admin? Used to surface the Platform link
  // in the top nav. The endpoint 404s in OSS so isPlatformAdmin stays false
  // and the button doesn't render.
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  useEffect(() => {
    let cancelled = false;
    api.get('/cloud/platform/me')
      .then((res) => { if (!cancelled) setIsPlatformAdmin(!!res.data.isPlatformAdmin); })
      .catch(() => { /* not cloud or not platform admin — silently no-op */ });
    return () => { cancelled = true; };
  }, []);

  // Org-level write capability: needed to create workspaces, manage datasources/models.
  // In OSS (no cloud) we fall back to the legacy user.role check.
  const canEditOrg = activeOrgRole
    ? (activeOrgRole === 'admin' || activeOrgRole === 'editor')
    : (user?.role !== 'viewer');

  // Capability inside the currently-selected context. For workspace views: ws_admin/editor
  // OR org_admin override. For "My Reports" (no workspace): same as canEditOrg.
  const canEditCurrent = selectedWs
    ? (wsUserRole === 'admin' || wsUserRole === 'editor' || activeOrgRole === 'admin')
    : canEditOrg;

  // Backwards-compat alias used by OSS code paths still expecting `canEdit`.
  // It now resolves to canEditCurrent for the workspace-card actions.
  const canEdit = canEditCurrent;

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
        setPersonalWorkspace(wsRes.data.personalWorkspace || null);
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

  // Resume the new-report wizard when bouncing back from /models/:id?then=newReport.
  // The model editor sends ?newReport=1&modelId=<id>&title=<title> on save in that
  // flow; we re-open the wizard pre-filled with the model + the title the user
  // had typed before going to the model editor, then strip the params.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('newReport') !== '1') return;
    const mid = params.get('modelId');
    if (mid) {
      setNewModelId(mid);
      setCreateMode('model');
      setShowCreate(true);
    }
    const restoredTitle = params.get('title');
    if (restoredTitle) setNewTitle(restoredTitle);
    // Strip the params so a refresh doesn't keep re-opening the wizard
    params.delete('newReport');
    params.delete('modelId');
    params.delete('title');
    const qs = params.toString();
    const newUrl = window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash;
    window.history.replaceState({}, '', newUrl);
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

  // Load workspace content. Split into two effects so a local change to
  // `reports` (e.g. delete) doesn't trigger a server re-fetch that could
  // overwrite the local optimistic update with stale data.
  useEffect(() => {
    if (selectedWs) return; // workspace view → handled by the next effect
    // "My Reports" view = reports living in the user's personal workspace.
    // Until that workspace id is loaded we fall back to the legacy NULL filter
    // so the UI stays usable on first paint and on older deployments.
    const personalId = personalWorkspace?.id;
    setWsReports(reports.filter((r) => personalId
      ? r.workspace_id === personalId
      : !r.workspace_id));
    setWsMembers([]);
    setWsOwner(null);
    setWsUserRole(null);
    setWsIsPersonalOrg(false);
    setWsCanSeeMembers(false);
  }, [selectedWs, reports, personalWorkspace]);

  useEffect(() => {
    if (!selectedWs) return;
    api.get(`/workspaces/${selectedWs}`).then((res) => {
      setWsReports(res.data.reports || []);
      setWsMembers(res.data.members || []);
      setWsOwner(res.data.owner);
      setWsUserRole(res.data.userRole);
      setWsIsPersonalOrg(!!res.data.is_personal_org);
      // Cloud responses include can_see_members (true for ws_admin / org_admin).
      // OSS responses don't — fall back to "user is workspace admin" for OSS compat.
      setWsCanSeeMembers(
        res.data.can_see_members !== undefined
          ? !!res.data.can_see_members
          : res.data.userRole === 'admin'
      );
    }).catch(() => {});
  }, [selectedWs]);

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

      // Step 2: locate or create the model for this datasource, and decide whether
      // it still needs auto-flagging. Any leftover empty model (from a previously
      // failed auto-flag) gets re-flagged in place — otherwise reuse skipped flagging
      // and the user landed in an empty editor.
      let modelId;
      let needsAutoFlag = true;
      if (uploadRes.data.reused) {
        const existingModel = models.find((m) => m.datasource_id === ds.id);
        if (existingModel) {
          modelId = existingModel.id;
          try {
            const fullRes = await api.get(`/models/${existingModel.id}`);
            const m = fullRes.data.model;
            const hasTables = (m.selected_tables || []).length > 0;
            const hasFields = (m.dimensions || []).length > 0 || (m.measures || []).length > 0;
            if (hasTables && hasFields) needsAutoFlag = false;   // already populated, leave it
          } catch { /* fetch failed, just re-flag to be safe */ }
        }
      }
      if (!modelId) {
        const modelRes = await api.post('/models', { name: ds.name, datasourceId: ds.id });
        modelId = modelRes.data.model.id;
      }

      if (needsAutoFlag) {
        const colRes = await api.get(`/datasources/${ds.id}/tables/${ds.tableName}/columns`);
        const cols = colRes.data.columns || [];
        const numericTypes = ['integer', 'bigint', 'numeric', 'decimal', 'real', 'double', 'float', 'int', 'smallint', 'double precision', 'interval'];
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

  // === Import a report bundle (.openreport.json file) ===

  const handleImportFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;
    setImportError('');
    try {
      const text = await file.text();
      const bundle = JSON.parse(text);
      if (bundle.format !== 'open-report.report.v1') {
        setImportError(`Unsupported file format: ${bundle.format || 'unknown'}`);
        return;
      }
      setImportBundle(bundle);
      // Pre-select the original model if the user happens to have access to it
      const orig = bundle.report?.model_id;
      const matchedModel = orig && models.find((m) => m.id === orig);
      setImportModelId(matchedModel?.id || '');
    } catch (err) {
      setImportError(`Cannot read file: ${err.message}`);
    }
  };

  const submitImport = async () => {
    if (!importBundle || !importModelId) return;
    setImporting(true);
    try {
      const res = await api.post('/reports/import', {
        bundle: importBundle,
        modelId: importModelId,
        workspaceId: selectedWs || undefined,
      });
      const newId = res.data.report?.id;
      setImportBundle(null);
      setImportModelId('');
      if (newId) navigate(`/edit/${newId}`);
    } catch (err) {
      setImportError(err.response?.data?.error || err.message);
    } finally {
      setImporting(false);
    }
  };

  const cancelImport = () => {
    setImportBundle(null);
    setImportModelId('');
    setImportError('');
  };

  const saveWorkspaceName = async () => {
    const name = editedWsName.trim();
    if (!name || !selectedWs) { setEditingWsName(false); return; }
    const current = workspaces.find((w) => w.id === selectedWs);
    if (current && current.name === name) { setEditingWsName(false); return; }
    try {
      await api.put(`/workspaces/${selectedWs}`, { name });
      setWorkspaces((p) => p.map((w) => w.id === selectedWs ? { ...w, name } : w));
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to rename workspace');
    }
    setEditingWsName(false);
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
    // "My Reports" → personal workspace id (everything must live in a real
    // workspace post-migration). Falls back to the legacy null path on older
    // installs that haven't been migrated yet.
    const target = wsId || personalWorkspace?.id || null;
    if (target) {
      await api.put(`/workspaces/${target}/reports/${reportId}`);
    } else {
      await api.put(`/reports/${reportId}`, { workspace_id: null });
    }
    const res = await api.get('/reports');
    setReports(res.data.reports);
  };

  // 3-dots menu state (per-card) + the modals it opens.
  const [cardMenu, setCardMenu] = useState(null);          // reportId of the open menu, or null
  const [renameModal, setRenameModal] = useState(null);    // { report, value }
  const [moveModal, setMoveModal] = useState(null);        // { report, targetWs }
  const [historyModal, setHistoryModal] = useState(null);  // { report, versions, loading }
  const [scheduleModal, setScheduleModal] = useState(null); // { report, schedules, loading, editing }
  const [scheduleToast, setScheduleToast] = useState(null); // { type: 'ok' | 'error', message }
  const cardMenuRef = useRef(null);

  // Auto-dismiss the schedule toast after a few seconds.
  useEffect(() => {
    if (!scheduleToast) return undefined;
    const t = setTimeout(() => setScheduleToast(null), 4000);
    return () => clearTimeout(t);
  }, [scheduleToast]);

  // Close the card menu on outside click / Escape
  useEffect(() => {
    if (!cardMenu) return;
    const onClick = (e) => {
      if (cardMenuRef.current && !cardMenuRef.current.contains(e.target)) setCardMenu(null);
    };
    const onEsc = (e) => { if (e.key === 'Escape') setCardMenu(null); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onEsc);
    return () => { document.removeEventListener('mousedown', onClick); document.removeEventListener('keydown', onEsc); };
  }, [cardMenu]);

  const duplicateReport = async (report) => {
    setCardMenu(null);
    await api.post(`/reports/${report.id}/duplicate`);
    // Refresh both views. The "My Reports" tab derives from `reports`, but the
    // workspace view fills `wsReports` from a separate /workspaces/:id fetch
    // that only fires when selectedWs changes — so we re-pull it here too.
    const reportsRes = await api.get('/reports');
    setReports(reportsRes.data.reports);
    if (selectedWs) {
      const wsRes = await api.get(`/workspaces/${selectedWs}`);
      setWsReports(wsRes.data.reports || []);
    }
  };

  const submitRename = async () => {
    if (!renameModal || !renameModal.value.trim()) return;
    const id = renameModal.report.id;
    const newTitle = renameModal.value.trim();
    await api.put(`/reports/${id}`, { title: newTitle });
    setReports((p) => p.map((r) => r.id === id ? { ...r, title: newTitle } : r));
    setWsReports((p) => p.map((r) => r.id === id ? { ...r, title: newTitle } : r));
    setRenameModal(null);
  };

  const submitMove = async () => {
    if (!moveModal) return;
    await moveReport(moveModal.report.id, moveModal.targetWs);
    setMoveModal(null);
  };

  const openHistory = async (report) => {
    setCardMenu(null);
    setHistoryModal({ report, versions: [], loading: true });
    try {
      const res = await api.get(`/reports/${report.id}/history`);
      setHistoryModal({ report, versions: res.data.versions || [], loading: false });
    } catch (err) {
      setHistoryModal({ report, versions: [], loading: false, error: err.response?.data?.error || err.message });
    }
  };

  const restoreVersion = async (versionId) => {
    if (!historyModal) return;
    if (!confirm('Restore this version? The current state will be saved as a new history entry.')) return;
    await api.post(`/reports/${historyModal.report.id}/history/${versionId}/restore`);
    // Refresh the history list to reflect the new "current snapshot" version
    const res = await api.get(`/reports/${historyModal.report.id}/history`);
    setHistoryModal({ ...historyModal, versions: res.data.versions || [] });
    // Refresh the report list so the title in the card reflects the restored state
    const reportsRes = await api.get('/reports');
    setReports(reportsRes.data.reports);
  };

  // Email schedules — cloud-only feature. Endpoints live under
  // /api/cloud/schedules and 404 in OSS, so we surface the menu entry only
  // when the active context is a cloud org. Phase 1 sends a deep link only;
  // PDF attachment + per-recipient personalisation come later.
  const openSchedules = async (report) => {
    setCardMenu(null);
    setScheduleModal({ report, schedules: [], loading: true });
    try {
      const res = await api.get(`/cloud/schedules/by-report/${report.id}`);
      setScheduleModal({ report, schedules: res.data.schedules || [], loading: false });
    } catch (err) {
      setScheduleModal({ report, schedules: [], loading: false, error: err.response?.data?.error || err.message });
    }
  };
  const refreshSchedules = async (reportId) => {
    const res = await api.get(`/cloud/schedules/by-report/${reportId}`);
    setScheduleModal((m) => m ? { ...m, schedules: res.data.schedules || [], editing: null } : m);
  };
  const submitSchedule = async (form) => {
    if (!scheduleModal) return;
    const reportId = scheduleModal.report.id;
    const payload = {
      name: form.name.trim(),
      cronExpression: form.cronExpression.trim(),
      timezone: form.timezone || 'UTC',
      subject: form.subject.trim(),
      body: form.body || '',
      recipients: form.recipientsRaw
        .split(/[,;\n]/)
        .map((s) => s.trim())
        .filter((s) => s.includes('@'))
        .map((email) => ({ email })),
      enabled: form.enabled !== false,
      refreshTimeoutSeconds: Math.max(30, Math.min(600, parseInt(form.refreshTimeoutSeconds, 10) || 60)),
    };
    if (form.id) {
      await api.put(`/cloud/schedules/${form.id}`, payload);
    } else {
      await api.post(`/cloud/schedules/by-report/${reportId}`, payload);
    }
    await refreshSchedules(reportId);
  };
  const toggleSchedule = async (s) => {
    await api.put(`/cloud/schedules/${s.id}`, { enabled: !s.enabled });
    await refreshSchedules(s.report_id);
  };
  const deleteSchedule = async (s) => {
    if (!confirm(`Delete schedule "${s.name}"?`)) return;
    await api.delete(`/cloud/schedules/${s.id}`);
    await refreshSchedules(s.report_id);
  };
  const runScheduleNow = async (s) => {
    try {
      const res = await api.post(`/cloud/schedules/${s.id}/run`);
      const result = res.data?.result;
      if (result?.skipped) {
        setScheduleToast({ type: 'error', message: `Skipped: ${result.reason || 'unknown'}` });
      } else if (result?.error) {
        setScheduleToast({ type: 'error', message: result.error });
      } else {
        const count = result?.recipientCount ?? '?';
        const withPdf = result?.hasPdf ? ' with PDF attachment' : '';
        setScheduleToast({ type: 'ok', message: `Email sent to ${count} recipient${count === 1 ? '' : 's'}${withPdf}.` });
      }
    } catch (err) {
      setScheduleToast({ type: 'error', message: err.response?.data?.error || err.message });
    }
    await refreshSchedules(s.report_id);
  };

  const wsName = selectedWs ? workspaces.find((w) => w.id === selectedWs)?.name || 'Workspace' : 'My Reports';
  const canEditWs = wsUserRole === 'admin' || wsUserRole === 'editor';

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-app)' }}>
      {/* Header */}
      <header style={headerStyle}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: -0.5, display: 'flex', alignItems: 'center', gap: 12 }}>
          <img src={logoSrc} alt="Open Report" style={{ height: 28 }} />
          {TopbarSwitcher && <TopbarSwitcher />}
        </h1>
        <nav style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {(canEditOrg || user?.role === 'admin') && (
            <div style={navPillGroup}>
              {canEditOrg && (
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
                    <TbStack3 size={15} /> <span>Data Models</span>
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
              {isPlatformAdmin && (
                <button onClick={() => navigate('/platform')} style={navBtnStyled}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-panel)'; e.currentTarget.style.boxShadow = 'var(--shadow-md)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'translateY(0)'; }}
                >
                  <TbShield size={15} color="var(--accent-primary)" /> <span>Platform</span>
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
                {UserMenuExtras && (
                  <>
                    <div style={userMenuDivider} />
                    <UserMenuExtras onNavigate={() => setUserMenuOpen(false)} />
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

          {canEditOrg && (
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
              {editingWsName && selectedWs && wsUserRole === 'admin' ? (
                <input
                  autoFocus
                  value={editedWsName}
                  onChange={(e) => setEditedWsName(e.target.value)}
                  onBlur={saveWorkspaceName}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveWorkspaceName();
                    else if (e.key === 'Escape') setEditingWsName(false);
                  }}
                  style={{
                    fontSize: 18, fontWeight: 600, color: 'var(--text-primary)',
                    background: 'var(--bg-subtle)', border: '1px solid var(--border-default)',
                    outline: 'none', borderRadius: 6, padding: '2px 8px', minWidth: 200,
                  }}
                />
              ) : (
                <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-primary)' }}>{wsName}</h2>
              )}
              {selectedWs && (
                <>
                  {wsUserRole === 'admin' && !editingWsName && (
                    <button
                      onClick={() => { setEditedWsName(wsName); setEditingWsName(true); }}
                      style={{ ...iconBtn, color: 'var(--text-muted)' }}
                      title="Rename workspace"
                    >
                      <TbEdit size={14} />
                    </button>
                  )}
                  {!wsIsPersonalOrg && wsCanSeeMembers && (
                    <button onClick={() => setShowMembers(!showMembers)} style={{ ...iconBtn, color: 'var(--text-muted)' }} title="Members">
                      <TbUsers size={16} />
                    </button>
                  )}
                  {wsUserRole === 'admin' && (
                    <button onClick={() => deleteWorkspace(selectedWs)} style={{ ...iconBtn, color: 'var(--state-danger)' }} title="Delete workspace">
                      <TbTrash size={14} />
                    </button>
                  )}
                </>
              )}
            </div>
            {canEdit && (
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  ref={importFileRef}
                  type="file"
                  accept=".json,application/json"
                  style={{ display: 'none' }}
                  onChange={handleImportFile}
                />
                <button
                  onClick={() => { setImportError(''); importFileRef.current?.click(); }}
                  style={{ ...primaryBtn, background: 'var(--bg-panel)', color: 'var(--accent-primary)', border: '1px solid var(--accent-primary-border)' }}
                  title="Import a report from a .openreport.json file"
                >
                  Import
                </button>
                <button onClick={() => { setNewTitle(''); setNewModelId(''); setCreateMode(null); setUploadError(''); setShowCreate(true); }} style={primaryBtn}>+ New Report</button>
              </div>
            )}
          </div>

          {/* Members panel */}
          {showMembers && selectedWs && !wsIsPersonalOrg && wsCanSeeMembers && (
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

          {/* Import-from-bundle modal */}
          {importBundle && (
            <div style={modalOverlay} onClick={cancelImport}>
              <div style={{ ...actionModalCard, width: 460 }} onClick={(e) => e.stopPropagation()}>
                <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>Import report</h3>
                <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
                  Source: <strong>{importBundle.report?.title || 'Untitled'}</strong>
                  {importBundle.report?.model_name && (
                    <> &middot; originally bound to model <code>{importBundle.report.model_name}</code></>
                  )}
                </p>
                <div style={{ marginBottom: 12 }}>
                  <label style={labelStyle}>Bind to data model</label>
                  <select
                    value={importModelId}
                    onChange={(e) => setImportModelId(e.target.value)}
                    style={inputStyle}
                  >
                    <option value="">— pick one —</option>
                    {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                    Widgets will be re-queried against the model you pick. Field references in the bundle must match this model's dimensions and measures.
                  </p>
                </div>
                {importError && (
                  <div style={{ padding: 8, marginBottom: 12, background: 'var(--state-danger-soft)', color: '#dc2626', borderRadius: 6, fontSize: 13 }}>
                    {importError}
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  <button onClick={cancelImport} style={{ ...primaryBtn, background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border-default)' }}>Cancel</button>
                  <button onClick={submitImport} disabled={!importModelId || importing} style={primaryBtn}>
                    {importing ? 'Importing…' : 'Import'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Top-level import error (when file failed to parse before opening the modal) */}
          {importError && !importBundle && (
            <div style={{ padding: 10, marginBottom: 16, background: 'var(--state-danger-soft)', color: '#dc2626', borderRadius: 6, fontSize: 13 }}>
              {importError}
            </div>
          )}

          {/* Create report modal — wizard */}
          {showCreate && (
            <div style={modalOverlay}>
              <div style={{ ...actionModalCard, width: 480 }}>
                <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>New Report{selectedWs ? ` in ${wsName}` : ''}</h3>

                {/* Title — always visible. Persisted through the database-connection
                    round trip via URL param so the user gets it back when they
                    return from the model editor. */}
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
                      <button onClick={() => setCreateMode('connection')} style={sourceCard}>
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

                {/* Step 2c: New database connection — create the datasource here, then chain into the model editor */}
                {createMode === 'connection' && (
                  <DatasourceForm
                    onSaved={async ({ datasource, isNew }) => {
                      setShowCreate(false);
                      setCreateMode(null);
                      if (isNew) {
                        await createModelAndNavigate(navigate, datasource, { then: 'newReport', title: newTitle });
                      }
                    }}
                    onCancel={() => setCreateMode(null)}
                  />
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
                  {canEdit && (
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteReport(report.id); }}
                      title="Delete"
                      style={cardCloseBtn}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'var(--state-danger-soft)';
                        e.currentTarget.style.color = 'var(--state-danger)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent';
                        e.currentTarget.style.color = 'var(--text-disabled)';
                      }}
                    >
                      <TbX size={14} />
                    </button>
                  )}
                  <div onClick={() => window.open(`/view/${report.id}`, '_blank')}
                    style={{ cursor: 'pointer', padding: 20, flex: 1, minWidth: 0 }}>
                    <h3
                      title={report.title}
                      style={{
                        fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}
                    >{report.title}</h3>
                    {report.model_name && (
                      <p style={{ fontSize: 12, color: 'var(--accent-primary)', marginBottom: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={report.model_name}>
                        {report.model_name}
                      </p>
                    )}
                    {typeof report.fileSize === 'number' && (
                      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
                        {formatFileSize(report.fileSize)}
                      </p>
                    )}
                    <p style={{ fontSize: 12, color: 'var(--text-disabled)' }}>Updated {new Date(report.updated_at).toLocaleDateString()}</p>
                  </div>
                  <div style={{ padding: '8px 20px 16px', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <button onClick={() => window.open(`/view/${report.id}`, '_blank')} title="View" {...cardActionBtn('accent')}><TbEye size={16} /></button>
                    {canEdit && <button onClick={() => navigate(`/edit/${report.id}`)} title="Edit" {...cardActionBtn()}><TbEdit size={16} /></button>}
                    {canEdit && (
                      <button onClick={() => togglePublic(report)} title={report.is_public ? 'Make private' : 'Share public link'}
                        {...cardActionBtn(report.is_public ? 'success' : 'muted')}>
                        {report.is_public ? <TbShare size={16} /> : <TbShareOff size={16} />}
                      </button>
                    )}
                    {canEdit && (
                      <div style={{ position: 'relative', marginLeft: 'auto' }}
                        ref={cardMenu === report.id ? cardMenuRef : null}>
                        <button
                          onClick={(e) => { e.stopPropagation(); setCardMenu(cardMenu === report.id ? null : report.id); }}
                          title="More actions"
                          {...cardActionBtn(cardMenu === report.id ? 'accent' : 'muted')}
                        >
                          <TbDotsVertical size={16} />
                        </button>
                        {cardMenu === report.id && (
                          <div style={cardMenuPanel}>
                            <button style={cardMenuItem}
                              onClick={() => { setCardMenu(null); setRenameModal({ report, value: report.title }); }}
                              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                              <TbPencil size={14} /> Rename
                            </button>
                            <button style={cardMenuItem}
                              onClick={() => duplicateReport(report)}
                              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                              <TbCopy size={14} /> Duplicate
                            </button>
                            <button style={cardMenuItem}
                              onClick={() => { setCardMenu(null); setMoveModal({ report, targetWs: report.workspace_id || '' }); }}
                              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                              <TbArrowsRightLeft size={14} /> Move to workspace
                            </button>
                            {report.is_public ? (
                              <button style={cardMenuItem}
                                onClick={() => {
                                  setCardMenu(null);
                                  const url = `${window.location.origin}/view/${report.id}`;
                                  navigator.clipboard?.writeText(url);
                                  alert(`Public link copied:\n${url}`);
                                }}
                                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                                <TbLink size={14} /> Copy public link
                              </button>
                            ) : null}
                            {user?.role === 'admin' && (
                              <button style={cardMenuItem}
                                onClick={() => openHistory(report)}
                                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                                <TbHistory size={14} /> History
                              </button>
                            )}
                            {/* Schedule — cloud-only. The endpoint 404s in OSS,
                                so we only show the entry when an active org is set
                                (proxy: activeOrgRole !== null means we're in cloud). */}
                            {activeOrgRole && (
                              <button style={cardMenuItem}
                                onClick={() => openSchedules(report)}
                                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                                <TbCalendarTime size={14} /> Schedule email
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>

      {/* Rename modal */}
      {renameModal && (
        <div style={actionModalBackdrop} onClick={() => setRenameModal(null)}>
          <div style={actionModalCard} onClick={(e) => e.stopPropagation()}>
            <div style={actionModalTitle}>Rename report</div>
            <input autoFocus value={renameModal.value}
              onChange={(e) => setRenameModal({ ...renameModal, value: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter') submitRename(); }}
              style={actionModalInput} placeholder="Report title" />
            <div style={actionModalActions}>
              <button style={actionModalBtnSecondary} onClick={() => setRenameModal(null)}>Cancel</button>
              <button style={actionModalBtnPrimary} onClick={submitRename} disabled={!renameModal.value.trim()}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Move modal */}
      {moveModal && (
        <div style={actionModalBackdrop} onClick={() => setMoveModal(null)}>
          <div style={actionModalCard} onClick={(e) => e.stopPropagation()}>
            <div style={actionModalTitle}>Move "{moveModal.report.title}"</div>
            <select value={moveModal.targetWs}
              onChange={(e) => setMoveModal({ ...moveModal, targetWs: e.target.value })}
              style={actionModalInput}>
              {personalWorkspace && (
                <option value={personalWorkspace.id}>My Reports</option>
              )}
              {workspaces.map((ws) => (
                <option key={ws.id} value={ws.id}>{ws.name}</option>
              ))}
            </select>
            <div style={actionModalActions}>
              <button style={actionModalBtnSecondary} onClick={() => setMoveModal(null)}>Cancel</button>
              <button style={actionModalBtnPrimary} onClick={submitMove}
                disabled={!moveModal.targetWs || moveModal.targetWs === moveModal.report.workspace_id}>
                Move
              </button>
            </div>
          </div>
        </div>
      )}

      {/* History modal — admin only. Lists snapshots; restoring one snapshots
          the current state first so the rollback is itself reversible. */}
      {historyModal && (
        <div style={actionModalBackdrop} onClick={() => setHistoryModal(null)}>
          <div style={{ ...actionModalCard, minWidth: 460, maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <div style={actionModalTitle}>History — {historyModal.report.title}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
              The 20 most recent saves. Restoring a version saves the current state as a new entry first.
            </div>
            {historyModal.loading ? (
              <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-disabled)' }}>Loading...</div>
            ) : historyModal.error ? (
              <div style={{ padding: 12, color: 'var(--state-danger)', fontSize: 13 }}>{historyModal.error}</div>
            ) : historyModal.versions.length === 0 ? (
              <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-disabled)', fontSize: 13 }}>
                No previous versions yet.
              </div>
            ) : (
              <div style={{ maxHeight: 360, overflow: 'auto', border: '1px solid var(--border-default)', borderRadius: 6 }}>
                {historyModal.versions.map((v) => (
                  <div key={v.id} style={historyRow}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {v.title}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {new Date(v.saved_at).toLocaleString()} · {v.saved_by_name || v.saved_by_email || 'unknown'}
                      </div>
                    </div>
                    <button style={historyRestoreBtn} onClick={() => restoreVersion(v.id)} title="Restore this version">
                      <TbArrowBackUp size={14} /> Restore
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div style={actionModalActions}>
              <button style={actionModalBtnSecondary} onClick={() => setHistoryModal(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Schedule emails — cloud-only. Lists the report's existing schedules
          and a small inline form to create / edit one. Phase 1: deep link in
          the email; PDF attachment + per-recipient personalisation later. */}
      {scheduleModal && (
        <ScheduleModal
          modal={scheduleModal}
          onClose={() => setScheduleModal(null)}
          onStartCreate={() => setScheduleModal({ ...scheduleModal, editing: 'new' })}
          onStartEdit={(s) => setScheduleModal({ ...scheduleModal, editing: s })}
          onCancelEdit={() => setScheduleModal({ ...scheduleModal, editing: null })}
          onSubmit={submitSchedule}
          onToggle={toggleSchedule}
          onDelete={deleteSchedule}
          onRunNow={runScheduleNow}
        />
      )}

      {/* Bottom-right transient toast for schedule "Send now" feedback. */}
      {scheduleToast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 1100,
          padding: '12px 18px', borderRadius: 8,
          background: scheduleToast.type === 'error' ? 'var(--state-danger-soft)' : 'var(--accent-primary-soft)',
          border: `1px solid ${scheduleToast.type === 'error' ? 'var(--state-danger)' : 'var(--accent-primary)'}`,
          color: scheduleToast.type === 'error' ? 'var(--state-danger)' : 'var(--accent-primary)',
          fontSize: 13, fontWeight: 500,
          boxShadow: '0 4px 16px rgba(15,23,42,0.2)',
          maxWidth: 380,
        }}>
          {scheduleToast.message}
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Schedule modal — kept inline because it's specific to the Dashboard page
// and won't be reused elsewhere.
// ----------------------------------------------------------------------------

const CRON_PRESETS = [
  { label: 'Every day at 9:00', expr: '0 9 * * *' },
  { label: 'Every Monday at 9:00', expr: '0 9 * * 1' },
  { label: 'First of the month at 9:00', expr: '0 9 1 * *' },
  { label: 'Custom…', expr: '' },
];

function ScheduleModal({ modal, onClose, onStartCreate, onStartEdit, onCancelEdit, onSubmit, onToggle, onDelete, onRunNow }) {
  const { report, schedules, loading, error, editing } = modal;
  const isEditing = editing === 'new' || (editing && typeof editing === 'object');
  return (
    <div style={actionModalBackdrop} onClick={onClose}>
      <div style={{ ...actionModalCard, minWidth: 520, maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
        <div style={actionModalTitle}>Email schedule — {report.title}</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14 }}>
          Send a link to this report by email on a recurring schedule. Recipients without a login can only open public reports.
        </div>

        {!isEditing && (
          <>
            {loading ? (
              <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-disabled)' }}>Loading...</div>
            ) : error ? (
              <div style={{ padding: 12, color: 'var(--state-danger)', fontSize: 13 }}>{error}</div>
            ) : schedules.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-disabled)', fontSize: 13, border: '1px dashed var(--border-default)', borderRadius: 6 }}>
                No schedules yet for this report.
              </div>
            ) : (
              <div style={{ maxHeight: 320, overflow: 'auto', border: '1px solid var(--border-default)', borderRadius: 6 }}>
                {schedules.map((s) => (
                  <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderBottom: '1px solid var(--border-default)' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        {s.name}
                        {!s.enabled && (
                          <span style={{ fontSize: 10, color: 'var(--text-disabled)', textTransform: 'uppercase', fontWeight: 700, background: 'var(--bg-subtle)', padding: '1px 6px', borderRadius: 3 }}>paused</span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                        <code style={{ background: 'var(--bg-subtle)', padding: '1px 5px', borderRadius: 3 }}>{s.cron_expression}</code>
                        {' · '}
                        {s.recipients.length} recipient{s.recipients.length === 1 ? '' : 's'}
                        {s.last_run_at && (
                          <span style={{ color: s.last_run_status === 'error' ? 'var(--state-danger)' : 'var(--text-muted)' }}>
                            {' · last run '}{new Date(s.last_run_at).toLocaleString()}{s.last_run_status === 'error' ? ' (error)' : ''}
                          </span>
                        )}
                      </div>
                      {s.last_run_status === 'error' && s.last_error && (
                        <div style={{ fontSize: 11, color: 'var(--state-danger)', marginTop: 3 }}>
                          {s.last_error}
                        </div>
                      )}
                    </div>
                    <button title="Send now" onClick={() => onRunNow(s)} {...cardActionBtn('accent')}>
                      <TbPlayerPlay size={14} />
                    </button>
                    <button title={s.enabled ? 'Pause' : 'Resume'} onClick={() => onToggle(s)} {...cardActionBtn(s.enabled ? 'accent' : 'muted')}>
                      {s.enabled ? <TbToggleRight size={16} /> : <TbToggleLeft size={16} />}
                    </button>
                    <button title="Edit" onClick={() => onStartEdit(s)} {...cardActionBtn()}>
                      <TbPencil size={14} />
                    </button>
                    <button title="Delete" onClick={() => onDelete(s)} {...cardActionBtn('danger')}>
                      <TbTrash size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div style={{ ...actionModalActions, justifyContent: 'space-between' }}>
              <button style={actionModalBtnPrimary} onClick={onStartCreate}>+ New schedule</button>
              <button style={actionModalBtnSecondary} onClick={onClose}>Close</button>
            </div>
          </>
        )}

        {isEditing && (
          <ScheduleEditor
            initial={editing === 'new' ? null : editing}
            onCancel={onCancelEdit}
            onSubmit={onSubmit}
          />
        )}
      </div>
    </div>
  );
}

function ScheduleEditor({ initial, onCancel, onSubmit }) {
  const isEdit = !!initial;
  const [form, setForm] = useState(() => ({
    id: initial?.id || null,
    name: initial?.name || '',
    cronExpression: initial?.cron_expression || '0 9 * * 1',
    timezone: initial?.timezone || (Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'),
    subject: initial?.subject || '',
    body: initial?.body || '',
    recipientsRaw: (initial?.recipients || []).map((r) => r.email).join(', '),
    enabled: initial?.enabled !== false,
    refreshTimeoutSeconds: initial?.refresh_timeout_seconds ?? 60,
  }));
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState(null);
  const [presetIdx, setPresetIdx] = useState(() => {
    const idx = CRON_PRESETS.findIndex((p) => p.expr === (initial?.cron_expression || '0 9 * * 1'));
    return idx >= 0 ? idx : CRON_PRESETS.length - 1; // default to "Custom"
  });

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const handleSubmit = async () => {
    if (!form.name.trim() || !form.cronExpression.trim() || !form.subject.trim()) {
      setErr('Name, cron expression and subject are required');
      return;
    }
    setSubmitting(true);
    setErr(null);
    try {
      await onSubmit(form);
    } catch (e) {
      setErr(e.response?.data?.error || e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>
        {isEdit ? 'Edit schedule' : 'New schedule'}
      </div>

      <label style={scheduleFieldLabel}>Name</label>
      <input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Weekly sales digest" style={actionModalInput} />

      <label style={scheduleFieldLabel}>When</label>
      <select value={presetIdx} onChange={(e) => {
        const idx = parseInt(e.target.value, 10);
        setPresetIdx(idx);
        const preset = CRON_PRESETS[idx];
        if (preset.expr) set('cronExpression', preset.expr);
      }} style={{ ...actionModalInput, marginBottom: 6 }}>
        {CRON_PRESETS.map((p, i) => <option key={i} value={i}>{p.label}</option>)}
      </select>
      <input
        value={form.cronExpression}
        onChange={(e) => { set('cronExpression', e.target.value); setPresetIdx(CRON_PRESETS.length - 1); }}
        placeholder="0 9 * * 1"
        style={{ ...actionModalInput, fontFamily: 'monospace', fontSize: 12 }}
      />
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: -10, marginBottom: 12 }}>
        Cron expression — minute hour day-of-month month day-of-week. Timezone: <code>{form.timezone}</code>
      </div>

      <label style={scheduleFieldLabel}>Recipients (comma- or newline-separated)</label>
      <textarea
        value={form.recipientsRaw}
        onChange={(e) => set('recipientsRaw', e.target.value)}
        placeholder="alice@example.com, bob@example.com"
        rows={3}
        style={{ ...actionModalInput, resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }}
      />

      <label style={scheduleFieldLabel}>Subject</label>
      <input value={form.subject} onChange={(e) => set('subject', e.target.value)} placeholder="Weekly sales report" style={actionModalInput} />

      <label style={scheduleFieldLabel}>Message (optional)</label>
      <textarea
        value={form.body}
        onChange={(e) => set('body', e.target.value)}
        placeholder="Here's the sales report for the week."
        rows={3}
        style={{ ...actionModalInput, resize: 'vertical' }}
      />

      <label style={scheduleFieldLabel}>Refresh timeout (seconds)</label>
      <input
        type="number"
        min={30}
        max={600}
        value={form.refreshTimeoutSeconds}
        onChange={(e) => set('refreshTimeoutSeconds', e.target.value)}
        style={actionModalInput}
      />
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: -10, marginBottom: 12 }}>
        Maximum time the renderer waits for the report to refresh before generating the PDF. Bump this if you have slow queries (default 60s, range 30–600s). The renderer also forces an explicit refresh on top of the initial load.
      </div>

      <label style={{ ...scheduleFieldLabel, display: 'flex', alignItems: 'center', gap: 6 }}>
        <input type="checkbox" checked={form.enabled} onChange={(e) => set('enabled', e.target.checked)} />
        <span>Enabled</span>
      </label>

      {err && <div style={{ color: 'var(--state-danger)', fontSize: 12, marginBottom: 10 }}>{err}</div>}

      <div style={actionModalActions}>
        <button style={actionModalBtnSecondary} onClick={onCancel} disabled={submitting}>Cancel</button>
        <button style={actionModalBtnPrimary} onClick={handleSubmit} disabled={submitting}>
          {submitting ? 'Saving…' : (isEdit ? 'Save' : 'Create')}
        </button>
      </div>
    </div>
  );
}

const scheduleFieldLabel = {
  display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)',
  marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em',
};

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
const cardStyle = { position: 'relative', backgroundColor: 'var(--bg-panel)', borderRadius: 8, border: '1px solid var(--border-default)', display: 'flex', flexDirection: 'column', transition: 'box-shadow 0.15s' };
const cardCloseBtn = {
  position: 'absolute', top: 6, right: 6, zIndex: 2,
  width: 22, height: 22, padding: 0,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  border: 'none', background: 'transparent', borderRadius: 4,
  color: 'var(--text-disabled)', cursor: 'pointer',
  transition: 'background 0.12s, color 0.12s',
};

// 3-dots dropdown shown next to the action row of each report card.
const cardMenuPanel = {
  position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 20,
  minWidth: 200, padding: 4,
  background: 'var(--bg-panel)', border: '1px solid var(--border-default)',
  borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
  display: 'flex', flexDirection: 'column',
};
const cardMenuItem = {
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '8px 12px', fontSize: 13,
  background: 'transparent', border: 'none', borderRadius: 4,
  color: 'var(--text-secondary)', cursor: 'pointer', textAlign: 'left',
  whiteSpace: 'nowrap', transition: 'background 0.12s',
};

// Lightweight modal styles for the report card actions (rename / move /
// history). Prefixed `actionModal*` to avoid colliding with the older
// `modalOverlay` / `modalCard` further down (used by the create-report wizard).
const actionModalBackdrop = {
  position: 'fixed', inset: 0, zIndex: 1000,
  background: 'rgba(15,23,42,0.35)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};
const actionModalCard = {
  background: 'var(--bg-panel)', borderRadius: 10, padding: 20,
  minWidth: 360, maxWidth: 480,
  boxShadow: '0 10px 30px rgba(15,23,42,0.25)',
};
const actionModalTitle = {
  fontSize: 15, fontWeight: 600, color: 'var(--text-primary)',
  marginBottom: 14,
};
const actionModalInput = {
  width: '100%', padding: '8px 10px', fontSize: 13,
  background: 'var(--bg-app)', border: '1px solid var(--border-default)',
  borderRadius: 6, color: 'var(--text-primary)', outline: 'none',
  marginBottom: 14, boxSizing: 'border-box',
};
const actionModalActions = {
  display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4,
};
const actionModalBtnSecondary = {
  padding: '6px 14px', fontSize: 13,
  background: 'var(--bg-subtle)', border: '1px solid var(--border-default)',
  borderRadius: 8, color: 'var(--text-secondary)', cursor: 'pointer',
};
const actionModalBtnPrimary = {
  padding: '6px 14px', fontSize: 13, fontWeight: 600,
  background: 'var(--accent-primary)', border: 'none',
  borderRadius: 8, color: '#fff', cursor: 'pointer',
  boxShadow: '0 1px 3px rgba(124,58,237,0.2)',
};
const historyRow = {
  display: 'flex', alignItems: 'center', gap: 10,
  padding: '10px 12px', borderBottom: '1px solid var(--border-default)',
};
const historyRestoreBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  padding: '5px 10px', fontSize: 12, fontWeight: 500,
  background: 'var(--bg-subtle)', border: '1px solid var(--border-default)',
  borderRadius: 6, color: 'var(--text-secondary)', cursor: 'pointer',
  flexShrink: 0,
};

// Workspace card buttons share the visual language of the editor toolbar / page header.
const CARD_BTN_VARIANTS = {
  accent:  { color: 'var(--accent-primary)',  hoverBg: 'var(--accent-primary-soft)', hoverBorder: 'var(--accent-primary)' },
  success: { color: '#16a34a',                hoverBg: '#dcfce7',                    hoverBorder: '#16a34a' },
  danger:  { color: 'var(--state-danger)',    hoverBg: 'var(--state-danger-soft)',   hoverBorder: 'var(--state-danger)' },
  muted:   { color: 'var(--text-muted)',      hoverBg: 'var(--bg-hover)',            hoverBorder: 'var(--border-strong)' },
  default: { color: 'var(--text-secondary)',  hoverBg: 'var(--bg-hover)',            hoverBorder: 'var(--border-strong)' },
};
function cardActionBtn(variant) {
  const c = CARD_BTN_VARIANTS[variant] || CARD_BTN_VARIANTS.default;
  const base = {
    padding: '6px 10px', borderRadius: 8,
    background: 'var(--bg-subtle)', border: '1px solid var(--border-default)',
    color: c.color, cursor: 'pointer',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    transition: 'background 0.12s, border-color 0.12s, color 0.12s, transform 0.12s',
  };
  return {
    style: base,
    onMouseEnter: (e) => {
      e.currentTarget.style.background = c.hoverBg;
      e.currentTarget.style.borderColor = c.hoverBorder;
    },
    onMouseLeave: (e) => {
      e.currentTarget.style.background = base.background;
      e.currentTarget.style.borderColor = 'var(--border-default)';
    },
  };
}

function formatFileSize(bytes) {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
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
