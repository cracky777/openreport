import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import api from '../utils/api';
import { TbEye, TbEdit, TbTrash, TbShare, TbShareOff, TbShield, TbFolder, TbFolderPlus, TbUsers, TbUserPlus, TbX, TbArrowRight, TbDatabase, TbBolt, TbUpload, TbLayoutDashboard, TbLogout, TbUser, TbStack3, TbSun, TbMoon, TbDeviceLaptop, TbChevronDown, TbDotsVertical, TbPencil, TbCopy, TbArrowsRightLeft, TbHistory, TbArrowBackUp, TbLink, TbCalendarTime, TbPlayerPlay, TbToggleLeft, TbToggleRight, TbLoader2, TbRefresh } from 'react-icons/tb';
import { formatBytes } from '../utils/formatHuman';
import { useTheme } from '../hooks/useTheme';
import { TopbarSwitcher, UserMenuExtras } from '../cloud';
import DatasourceForm, { createModelAndNavigate } from '../components/DatasourceForm/DatasourceForm';
import CacheInspectorModal from '../components/CacheInspectorModal/CacheInspectorModal';
import CacheScheduleModal from '../components/CacheScheduleModal/CacheScheduleModal';
import ScheduleModal from '../components/ScheduleModal/ScheduleModal';
import { actionModalBackdrop, actionModalCard, actionModalTitle, actionModalInput, actionModalActions, actionModalBtnSecondary, actionModalBtnPrimary, cardActionBtn } from '../components/dashboardModalStyles';

const _hs0 = { height: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-app)' };
const _hs1 = { fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: -0.5, display: 'flex', alignItems: 'center', gap: 12 };
const _hs2 = { height: 28 };
const _hs3 = { display: 'flex', alignItems: 'center', gap: 6 };
const _hs4 = { position: 'relative' };
const _hs5 = { display: 'flex', flexDirection: 'column', gap: 2, padding: '4px 8px 8px' };
const _hs6 = { display: 'inline-flex', alignItems: 'center', gap: 8 };
const _hs7 = { fontSize: 9, color: 'var(--text-muted)' };
const _hs8 = { display: 'inline-flex', alignItems: 'center', gap: 8 };
const _hs9 = { color: 'var(--accent-primary)' };
const _hs10 = { flex: 1, display: 'flex', minHeight: 0 };
const _hs11 = { padding: '12px 16px', fontWeight: 600, fontSize: 11, color: 'var(--text-disabled)', textTransform: 'uppercase' };
const _hs12 = { flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const _hs13 = { fontSize: 10, color: 'var(--text-disabled)' };
const _hs14 = { padding: '8px 12px' };
const _hs15 = {
                  display: 'flex', alignItems: 'center', gap: 2,
                  padding: 3, background: 'var(--bg-subtle)',
                  border: '1px solid var(--border-default)', borderRadius: 8,
                };
const _hs16 = {
                      flex: 1, padding: '4px 8px', border: 'none', background: 'transparent',
                      fontSize: 12, outline: 'none', color: 'var(--text-primary)', minWidth: 0,
                    };
const _hs17 = {
                      width: 22, height: 22, padding: 0, border: 'none',
                      borderRadius: 5, cursor: 'pointer',
                      background: 'transparent', color: 'var(--text-muted)',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      transition: 'background 0.12s, color 0.12s',
                    };
const _hs18 = {
                    display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                    padding: '8px 12px', border: '1px dashed var(--border-default)',
                    borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 500,
                    background: 'transparent', color: 'var(--text-muted)',
                    textAlign: 'left', transition: 'border-color 0.12s, color 0.12s, background 0.12s',
                  };
const _hs19 = { flex: 1, overflow: 'auto', padding: '24px 32px' };
const _hs20 = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 };
const _hs21 = { display: 'flex', alignItems: 'center', gap: 12 };
const _hs22 = {
                    fontSize: 18, fontWeight: 600, color: 'var(--text-primary)',
                    background: 'var(--bg-subtle)', border: '1px solid var(--border-default)',
                    outline: 'none', borderRadius: 6, padding: '2px 8px', minWidth: 200,
                  };
const _hs23 = { fontSize: 18, fontWeight: 600, color: 'var(--text-primary)' };
const _hs24 = { display: 'flex', gap: 8 };
const _hs25 = { display: 'none' };
const _hs26 = { fontSize: 13, fontWeight: 600, marginBottom: 8 };
const _hs27 = { fontSize: 11, color: 'var(--state-danger)', fontWeight: 600 };
const _hs28 = { display: 'flex', gap: 4, alignItems: 'center' };
const _hs29 = { padding: '2px 4px', border: '1px solid var(--border-default)', borderRadius: 3, fontSize: 11 };
const _hs30 = { fontSize: 11, color: 'var(--text-muted)' };
const _hs31 = { display: 'flex', gap: 4, marginTop: 8, position: 'relative' };
const _hs32 = { flex: 1, position: 'relative' };
const _hs33 = { width: '100%', padding: '4px 8px', border: '1px solid var(--border-default)', borderRadius: 4, fontSize: 12, outline: 'none', boxSizing: 'border-box' };
const _hs34 = { position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--bg-panel)', border: '1px solid var(--border-default)', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 20, maxHeight: 150, overflow: 'auto' };
const _hs35 = { padding: '6px 10px', cursor: 'pointer', fontSize: 12, borderBottom: '1px solid #f8fafc', display: 'flex', justifyContent: 'space-between' };
const _hs36 = { fontWeight: 500 };
const _hs37 = { color: 'var(--text-disabled)' };
const _hs38 = { padding: '4px 6px', border: '1px solid var(--border-default)', borderRadius: 4, fontSize: 11 };
const _hs39 = { padding: '4px 8px', border: 'none', borderRadius: 4, background: 'var(--accent-primary)', color: '#fff', cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center' };
const _hs40 = { fontSize: 16, fontWeight: 600, marginBottom: 6 };
const _hs41 = { fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 };
const _hs42 = { marginBottom: 12 };
const _hs43 = { fontSize: 11, color: 'var(--text-muted)', marginTop: 4 };
const _hs44 = { padding: 8, marginBottom: 12, background: 'var(--state-danger-soft)', color: '#dc2626', borderRadius: 6, fontSize: 13 };
const _hs45 = { display: 'flex', justifyContent: 'flex-end', gap: 8 };
const _hs46 = { padding: 10, marginBottom: 16, background: 'var(--state-danger-soft)', color: '#dc2626', borderRadius: 6, fontSize: 13 };
const _hs47 = { fontSize: 16, fontWeight: 600, marginBottom: 6 };
const _hs48 = { marginBottom: 12 };
const _hs49 = { display: 'flex', gap: 10 };
const _hs50 = { fontWeight: 600, fontSize: 13 };
const _hs51 = { fontSize: 11, color: 'var(--text-disabled)' };
const _hs52 = { fontWeight: 600, fontSize: 13 };
const _hs53 = { fontSize: 11, color: 'var(--text-disabled)' };
const _hs54 = { fontWeight: 600, fontSize: 13 };
const _hs55 = { fontSize: 11, color: 'var(--text-disabled)' };
const _hs56 = { display: 'flex', justifyContent: 'flex-end', marginTop: 16 };
const _hs57 = { marginBottom: 16 };
const _hs58 = { display: 'flex', gap: 8, justifyContent: 'space-between' };
const _hs59 = { display: 'none' };
const _hs60 = { color: 'var(--accent-primary)', fontSize: 14 };
const _hs61 = { fontSize: 14, color: 'var(--text-secondary)', marginTop: 8 };
const _hs62 = { fontSize: 12, color: 'var(--text-disabled)', marginTop: 4 };
const _hs63 = { color: 'var(--state-danger)', fontSize: 12, marginBottom: 8 };
const _hs64 = { display: 'flex', justifyContent: 'flex-start' };
const _hs65 = { textAlign: 'center', color: 'var(--text-disabled)', marginTop: 60 };
const _hs66 = { textAlign: 'center', color: 'var(--text-disabled)', marginTop: 60 };
const _hs67 = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 };
const _hs68 = { cursor: 'pointer', padding: 20, flex: 1, minWidth: 0 };
const _hs69 = {
                        fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      };
const _hs70 = { display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4, minWidth: 0 };
const _hs71 = {
                            fontSize: 12, color: 'var(--accent-primary)',
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                            minWidth: 0, flex: '0 1 auto',
                          };
const _hs72 = {
                              background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
                              color: 'var(--accent-primary)', opacity: 0.55, transition: 'opacity 0.12s',
                              display: 'inline-flex', alignItems: 'center', flexShrink: 0,
                            };
const _hs73 = { fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 };
const _hs74 = { fontSize: 12, color: 'var(--text-disabled)' };
const _hs75 = { fontSize: 12, color: 'var(--text-disabled)' };
const _hs76 = { padding: '8px 20px 14px', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' };
const _hs77 = { position: 'relative', marginLeft: 'auto' };
const _hs78 = { padding: '0 20px 12px' };
const _hs79 = { fontSize: 11, color: 'var(--accent-primary)', marginBottom: 5 };
const _hs80 = {
                          padding: '0 20px 12px', fontSize: 11,
                          color: 'var(--text-disabled)',
                          cursor: 'pointer', textDecoration: 'underline',
                          textDecorationColor: 'var(--border-default)',
                          textDecorationStyle: 'dotted',
                        };
const _hs81 = { fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 };
const _hs82 = { padding: 20, textAlign: 'center', color: 'var(--text-disabled)' };
const _hs83 = { padding: 12, color: 'var(--state-danger)', fontSize: 13 };
const _hs84 = { padding: 20, textAlign: 'center', color: 'var(--text-disabled)', fontSize: 13 };
const _hs85 = { maxHeight: 360, overflow: 'auto', border: '1px solid var(--border-default)', borderRadius: 6 };
const _hs86 = { flex: 1, minWidth: 0 };
const _hs87 = { fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
const _hs88 = { fontSize: 11, color: 'var(--text-muted)' };

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
  // Per-report cache breakdown modal — fetched lazily on click. Keyed by
  // reportId so it survives navigations and the cache stays warm if the
  // user re-opens.
  const [cacheInspect, setCacheInspect] = useState({ reportId: null, workspaceId: null, data: null, loading: false, error: null });
  const openCacheInspect = useCallback(async (reportId, reportTitle, workspaceId) => {
    setCacheInspect({ reportId, reportTitle, workspaceId: workspaceId || null, data: null, loading: true, error: null });
    try {
      const res = await api.get(`/cache-schedules/inspect/${reportId}`);
      setCacheInspect({ reportId, reportTitle, workspaceId: workspaceId || null, data: res.data, loading: false, error: null });
    } catch (err) {
      setCacheInspect({ reportId, reportTitle, workspaceId: workspaceId || null, data: null, loading: false, error: err.response?.data?.error || err.message });
    }
  }, []);
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

  // Per-report data-source mode. 0 = cache (default, fast: served from
  // the rollup when available); 1 = live (Viewer sends bypassCache:true
  // on every widget query → source DB each time). Only surfaced to ws/
  // org admins in the card menu — the field IS managed server-side too
  // (PUT /reports/:id accepts `live_mode`).
  const toggleLiveMode = async (report) => {
    const newVal = report.live_mode ? 0 : 1;
    await api.put(`/reports/${report.id}`, { live_mode: newVal });
    setReports((p) => p.map((r) => r.id === report.id ? { ...r, live_mode: newVal } : r));
    setWsReports((p) => p.map((r) => r.id === report.id ? { ...r, live_mode: newVal } : r));
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
      // The Editor auto-detects empty slicers on first mount and fires
      // refreshSlicer for them, so no cross-page signal is needed —
      // see `slicersNeverFetched` in Editor.jsx's main fetch effect.
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
  // Cache-warm schedules — separate from the email scheduleModal because
  // they hit /api/cache-schedules (works in OSS too) instead of the
  // cloud-only /api/cloud/schedules.
  const [cacheScheduleModal, setCacheScheduleModal] = useState(null);
  const [cacheScheduleRunning, setCacheScheduleRunning] = useState(() => new Set());
  const [scheduleToast, setScheduleToast] = useState(null); // { type: 'ok' | 'error', message }
  // Set of schedule IDs currently being run via the manual "Send now" button.
  // Drives the inline spinner + disables the trigger so a user can't kick off
  // duplicate sends while a render/email is still in flight.
  const [runningScheduleIds, setRunningScheduleIds] = useState(() => new Set());
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

  // Cache-warm schedules — works in OSS and cloud. Each tick fires the
  // report's queries to populate queryCache + preAggCache so users see
  // instant loads in the cache TTL window after a warm pass.
  const openCacheSchedules = async (report) => {
    setCardMenu(null);
    setCacheScheduleModal({ report, schedules: [], loading: true });
    try {
      const res = await api.get(`/cache-schedules/by-report/${report.id}`);
      setCacheScheduleModal({ report, schedules: res.data.schedules || [], loading: false });
    } catch (err) {
      setCacheScheduleModal({ report, schedules: [], loading: false, error: err.response?.data?.error || err.message });
    }
  };
  const refreshCacheSchedules = async (reportId) => {
    if (!cacheScheduleModal || cacheScheduleModal.report.id !== reportId) return;
    const res = await api.get(`/cache-schedules/by-report/${reportId}`);
    setCacheScheduleModal((prev) => prev ? { ...prev, schedules: res.data.schedules || [] } : prev);
  };
  const createCacheSchedule = async ({ cronExpression, timezone }) => {
    if (!cacheScheduleModal) return;
    await api.post(`/cache-schedules/by-report/${cacheScheduleModal.report.id}`, {
      cronExpression, timezone: timezone || 'UTC', enabled: true,
    });
    await refreshCacheSchedules(cacheScheduleModal.report.id);
  };
  const toggleCacheSchedule = async (s) => {
    await api.put(`/cache-schedules/${s.id}`, { enabled: !s.enabled });
    await refreshCacheSchedules(s.report_id);
  };
  const deleteCacheSchedule = async (s) => {
    if (!confirm('Delete this cache schedule?')) return;
    await api.delete(`/cache-schedules/${s.id}`);
    await refreshCacheSchedules(s.report_id);
  };
  // Per-report-card warm state. `cardWarmingIds` is the set of reports
  // whose Refresh button is currently spinning; `cardCacheStats` is the
  // last known size for each report (entries + bytes), shown under the
  // button. We hydrate stats lazily — only for reports the user has
  // refreshed at least once, to avoid flooding the API on report list
  // load.
  const [cardWarmingIds, setCardWarmingIds] = useState(() => new Set());
  // reportId → { done, total } while a refresh is building, so the card
  // shows a real "N of M rollups" bar (indeterminate until the first
  // poll returns counts).
  const [cardWarmingProgress, setCardWarmingProgress] = useState({});
  // reportIds of refreshes started from THIS tab whose run-now POST
  // hasn't resolved yet. Keeps the /warming poll loop (and the progress
  // bar) alive across the brief window between the POST and the server
  // registering the model in its building set, so the bar doesn't flicker
  // off then never come back.
  const pendingWarmIdsRef = useRef(new Set());
  // The /warming poll loop is a ref-guarded singleton: at most one is
  // ever scheduled, and it can be (re)started on demand.
  const warmingPollActiveRef = useRef(false);
  const warmingPollCancelledRef = useRef(false);
  const warmingPollTimerRef = useRef(null);
  // Smoothly-animated bar percentage (reportId → %). The server only
  // reports progress in coarse steps (done/total, e.g. 1 of 4), so a
  // raw width would sit frozen for seconds between rollups. We trickle
  // the displayed % toward the next milestone with an ease-out creep
  // (NProgress-style) so the bar is always visibly moving, and snap it
  // up when a real rollup actually completes. Mirrors of the poll state
  // are kept in refs so the trickle interval reads the latest without
  // restarting every poll tick.
  const [cardWarmingDisplayPct, setCardWarmingDisplayPct] = useState({});
  const displayPctRef = useRef({});
  const warmingProgressRef = useRef({});
  const warmingIdsRef = useRef(new Set());
  const [cardCacheStats, setCardCacheStats] = useState({});
  const fetchCardCacheStats = useCallback(async (reportId) => {
    try {
      const res = await api.get(`/cache-schedules/size/${reportId}`);
      setCardCacheStats((p) => ({ ...p, [reportId]: res.data }));
    } catch { /* size fetch is best-effort */ }
  }, []);
  // Poll /warming, reconcile the spinner set + progress bar, and re-arm
  // itself every 2 s while the server is building OR a local refresh is
  // still pending. The pending guard covers the POST→build startup race
  // (the model isn't in the server's building set for the first tick or
  // two after the POST). Self-stops when both are idle. Idempotent: a
  // second caller while a loop is live is a no-op (the running loop
  // already picks up new ids on its next tick).
  const startWarmingPoll = useCallback(() => {
    if (warmingPollActiveRef.current) return;
    warmingPollActiveRef.current = true;
    const poll = async () => {
      try {
        const res = await api.get('/cache-schedules/warming');
        if (warmingPollCancelledRef.current) { warmingPollActiveRef.current = false; return; }
        const serverIds = new Set(res.data?.reportIds || []);
        setCardWarmingProgress(res.data?.progress || {});
        const pending = pendingWarmIdsRef.current;
        // Effective spinner set = server's building set ∪ locally-pending
        // refreshes. For any report we WERE showing that is now neither
        // building nor pending, the warm finished → refresh its size line
        // without the user clicking Refresh again.
        setCardWarmingIds((prev) => {
          for (const id of prev) {
            if (!serverIds.has(id) && !pending.has(id)) {
              fetchCardCacheStats(id).catch(() => {});
            }
          }
          return new Set([...serverIds, ...pending]);
        });
        if (serverIds.size > 0 || pending.size > 0) {
          warmingPollTimerRef.current = setTimeout(poll, 2000);
        } else {
          warmingPollActiveRef.current = false;
        }
      } catch {
        // Don't loop on error — the user might just be logged out.
        warmingPollActiveRef.current = false;
      }
    };
    poll();
  }, [fetchCardCacheStats]);
  const refreshReportCacheFromCard = useCallback(async (report) => {
    if (cardWarmingIds.has(report.id)) return;
    setCardWarmingIds((p) => { const n = new Set(p); n.add(report.id); return n; });
    // Hold the report in the local pending set and (re)start the poll
    // loop so the determinate "done / total" bar actually updates as the
    // server builds each rollup. Without this, a card-initiated refresh
    // never restarts the loop that stopped at mount → the bar stays in
    // its non-growing indeterminate sweep for the whole build.
    pendingWarmIdsRef.current.add(report.id);
    startWarmingPoll();
    try {
      // The server tracks the in-flight warm in its own Set, so even if
      // this tab navigates / reloads mid-warm the next mount picks it up
      // via /warming and the spinner stays on. We still await to refresh
      // the size line on success; a navigation interruption is non-fatal.
      await api.post(`/cache-schedules/run-now/${report.id}`);
      await fetchCardCacheStats(report.id);
      setCardWarmingIds((p) => { const n = new Set(p); n.delete(report.id); return n; });
    } catch (err) {
      setCardWarmingIds((p) => { const n = new Set(p); n.delete(report.id); return n; });
      alert(err.response?.data?.error || 'Failed to refresh');
    } finally {
      // POST resolved = build finished server-side (the route awaits the
      // whole build). Drop the local guard; the next poll tick sees the
      // server's now-cleared building set and reconciles.
      pendingWarmIdsRef.current.delete(report.id);
    }
  }, [cardWarmingIds, fetchCardCacheStats, startWarmingPoll]);

  // Auto-fetch cache size for every visible report when the workspace's
  // report list changes. This is what makes the "Cache: X entries · Y MB"
  // line persist across F5 / workspace switches — the data lives on the
  // server, we just re-pull it on mount. Skipped for reports we already
  // have stats for, so a click-Refresh-then-this-effect doesn't double-
  // fetch.
  useEffect(() => {
    if (!Array.isArray(wsReports) || wsReports.length === 0) return;
    const missing = wsReports.filter((r) => !cardCacheStats[r.id]);
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      // Parallel one-shot — small payloads, the server already has them
      // in memory so each call is sub-millisecond. With ~30 cards on a
      // big workspace this is still well under the visual threshold.
      const results = await Promise.all(missing.map(async (r) => {
        try {
          const res = await api.get(`/cache-schedules/size/${r.id}`);
          return [r.id, res.data];
        } catch { return null; }
      }));
      if (cancelled) return;
      setCardCacheStats((prev) => {
        const next = { ...prev };
        for (const entry of results) {
          if (entry) next[entry[0]] = entry[1];
        }
        return next;
      });
    })();
    return () => { cancelled = true; };
    // We intentionally depend on the array IDENTITY (not contents) so a
    // simple state update (setReports([...same])) doesn't re-fetch every
    // card; the workspace selector already replaces wsReports with a
    // fresh array when it actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsReports]);

  // Kick the /warming poll loop on every Dashboard mount so an in-flight
  // warm (started in another tab or before an F5) keeps its spinner +
  // progress bar. The loop self-stops when idle; refreshReportCacheFromCard
  // restarts it for a card-initiated refresh. Cancel on unmount.
  useEffect(() => {
    warmingPollCancelledRef.current = false;
    startWarmingPoll();
    return () => {
      warmingPollCancelledRef.current = true;
      if (warmingPollTimerRef.current) clearTimeout(warmingPollTimerRef.current);
      warmingPollActiveRef.current = false;
    };
    // Intentional: run once on each Dashboard mount, including after F5.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Mirror the poll state into refs so the trickle interval below reads
  // the latest values without being torn down/recreated every 2 s poll.
  useEffect(() => { warmingProgressRef.current = cardWarmingProgress; }, [cardWarmingProgress]);
  useEffect(() => { warmingIdsRef.current = cardWarmingIds; }, [cardWarmingIds]);
  // Trickle driver: while anything is warming, ease the displayed bar %
  // toward the next milestone every 450 ms (the CSS `width 0.4s` on
  // .rollup-progress > span interpolates between ticks, so the bar
  // glides continuously instead of sitting frozen between rollups). The
  // % snaps up the instant a real rollup completes (floor jumps), so it
  // tracks reality while always being visibly in motion.
  const anyWarming = cardWarmingIds.size > 0;
  useEffect(() => {
    if (!anyWarming) {
      if (Object.keys(displayPctRef.current).length) {
        displayPctRef.current = {};
        setCardWarmingDisplayPct({});
      }
      return;
    }
    const tick = () => {
      const ids = warmingIdsRef.current;
      const prog = warmingProgressRef.current;
      const cur = displayPctRef.current;
      const next = {};
      let changed = false;
      for (const id of ids) {
        const p = prog[id];
        const total = p && p.total > 0 ? p.total : 0;
        const done = p && p.done > 0 ? p.done : 0;
        let floor, ceil;
        if (total > 0) {
          floor = Math.min(100, (done / total) * 100);
          ceil = Math.min(100, ((done + 1) / total) * 100);
        } else {
          floor = 0; ceil = 12; // unknown total (first ≤2 s): gentle early creep
        }
        let v = cur[id] ?? 0;
        if (v < floor) v = floor;                 // snap up when a rollup really finishes
        const cap = floor + (ceil - floor) * 0.9; // never quite reach the next step
        if (v < cap) v += Math.max(0.5, (cap - v) * 0.12); // ease-out creep, min step
        if (v > cap) v = cap;
        if (v > 100) v = 100;
        next[id] = v;
        if (v !== cur[id]) changed = true;
      }
      displayPctRef.current = next; // rebuilt from live ids → finished reports drop out
      if (changed) setCardWarmingDisplayPct(next);
    };
    tick();
    const h = setInterval(tick, 450);
    return () => clearInterval(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anyWarming]);
  const runCacheScheduleNow = async (s) => {
    if (cacheScheduleRunning.has(s.id)) return;
    setCacheScheduleRunning((prev) => { const n = new Set(prev); n.add(s.id); return n; });
    try {
      const res = await api.post(`/cache-schedules/${s.id}/run`);
      const r = res.data?.result;
      if (r?.error) alert(`Run failed: ${r.error}`);
      await refreshCacheSchedules(s.report_id);
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    } finally {
      setCacheScheduleRunning((prev) => { const n = new Set(prev); n.delete(s.id); return n; });
    }
  };

  // Email schedules — cloud-only feature. Endpoints live under
  // /api/cloud/schedules and 404 in OSS, so we surface the menu entry only
  // when the active context is a cloud org. Phase 1 sends a deep link only;
  // PDF attachment + per-recipient personalisation come later.
  const openSchedules = async (report) => {
    setCardMenu(null);
    setScheduleModal({ report, schedules: [], loading: true });
    try {
      // Fetch list + plan limits + the report's model in parallel. The
      // model gives us the dimension list which the rule editor uses for
      // filter-column autocomplete; failure here is non-fatal (the input
      // still accepts free typing).
      const [listRes, limitsRes, dimsRes] = await Promise.all([
        api.get(`/cloud/schedules/by-report/${report.id}`),
        api.get('/cloud/schedules/limits').catch(() => ({ data: null })),
        loadReportDimensions(report.id).catch(() => []),
      ]);
      setScheduleModal({
        report,
        schedules: listRes.data.schedules || [],
        limits: limitsRes.data || null,
        dimensions: dimsRes,
        loading: false,
      });
    } catch (err) {
      setScheduleModal({ report, schedules: [], limits: null, dimensions: [], loading: false, error: err.response?.data?.error || err.message });
    }
  };
  // Resolve a report's dimension names so the rule editor can offer
  // autocomplete. The dashboard cards don't carry model_id so we round-trip
  // via /reports/:id then /models/:id. Returns an array of full dimension
  // names (e.g. "orders.country") or [] on failure.
  const loadReportDimensions = async (reportId) => {
    const r = await api.get(`/reports/${reportId}`);
    const modelId = r.data?.report?.model_id;
    if (!modelId) return [];
    const m = await api.get(`/models/${modelId}`);
    const dims = m.data?.model?.dimensions;
    return Array.isArray(dims) ? dims.map((d) => d.name).filter(Boolean) : [];
  };
  const refreshSchedules = async (reportId) => {
    const [listRes, limitsRes] = await Promise.all([
      api.get(`/cloud/schedules/by-report/${reportId}`),
      api.get('/cloud/schedules/limits').catch(() => ({ data: null })),
    ]);
    setScheduleModal((m) => m ? {
      ...m,
      schedules: listRes.data.schedules || [],
      limits: limitsRes.data || m.limits || null,
      // dimensions are stable across saves — preserve from previous state
      editing: null,
    } : m);
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
      perRecipientRender: !!form.perRecipientRender,
      recipientRules: (form.recipientRules || [])
        .map((r) => ({
          pattern: (r.pattern || '').trim(),
          filters: Object.fromEntries(
            Object.entries(r.filters || {})
              .map(([k, v]) => [k.trim(), Array.isArray(v) ? v : String(v || '').split(',').map((s) => s.trim()).filter((s) => s)])
              .filter(([k, v]) => k && v.length > 0),
          ),
        }))
        .filter((r) => r.pattern),
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
    // Guard: if this schedule is already mid-send we ignore the click.
    if (runningScheduleIds.has(s.id)) return;
    setRunningScheduleIds((prev) => {
      const next = new Set(prev);
      next.add(s.id);
      return next;
    });
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
    } finally {
      setRunningScheduleIds((prev) => {
        const next = new Set(prev);
        next.delete(s.id);
        return next;
      });
      await refreshSchedules(s.report_id);
    }
  };

  const wsName = selectedWs ? workspaces.find((w) => w.id === selectedWs)?.name || 'Workspace' : 'My Reports';

  return (
    <div style={_hs0}>
      {/* Header */}
      <header style={headerStyle}>
        <h1 style={_hs1}>
          <img src={logoSrc} alt="Open Report" style={_hs2} />
          {TopbarSwitcher && <TopbarSwitcher />}
        </h1>
        <nav style={_hs3}>
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
          <div ref={userMenuRef} style={_hs4}>
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
                <div style={_hs5}>
                  {/* "System" follows the OS preference */}
                  <button className="btn-hover" onClick={() => setThemeMode('system')} style={themeRowBtn(themeMode === 'system')}>
                    <span style={_hs6}>
                      <TbDeviceLaptop size={14} />
                      <span>System</span>
                    </span>
                    {themeMode === 'system' && <span style={_hs7}>auto</span>}
                  </button>
                  {/* All themes from the JSON definition */}
                  {Object.entries(availableThemes).map(([key, theme]) => {
                    const active = themeMode === key;
                    const Icon = theme.kind === 'dark' ? TbMoon : TbSun;
                    return (
                      <button key={key} className="btn-hover" onClick={() => setThemeMode(key)} style={themeRowBtn(active)}>
                        <span style={_hs8}>
                          <span style={{
                            width: 14, height: 14, borderRadius: 3,
                            background: theme.vars?.['--bg-app'] || '#fff',
                            border: '1px solid ' + (theme.vars?.['--border-default'] || '#e2e8f0'),
                            display: 'inline-block',
                          }} />
                          <span>{theme.label || key}</span>
                        </span>
                        {active && <Icon size={12} style={_hs9} />}
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

      <div style={_hs10}>
        {/* Sidebar — Workspaces */}
        <div style={sidebarStyle}>
          <div style={_hs11}>Workspaces</div>

          <button onClick={() => setSelectedWs(null)}
            style={{ ...wsItemStyle, fontWeight: !selectedWs ? 700 : 400, background: !selectedWs ? 'var(--bg-active)' : 'transparent', color: !selectedWs ? 'var(--accent-primary)' : 'var(--text-secondary)' }}>
            <TbFolder size={16} /> My Reports
          </button>

          {workspaces.map((ws) => (
            <button key={ws.id} onClick={() => setSelectedWs(ws.id)}
              style={{ ...wsItemStyle, fontWeight: selectedWs === ws.id ? 700 : 400, background: selectedWs === ws.id ? 'var(--bg-active)' : 'transparent', color: selectedWs === ws.id ? 'var(--accent-primary)' : 'var(--text-secondary)' }}>
              <TbFolder size={16} />
              <span style={_hs12}>{ws.name}</span>
              <span style={_hs13}>{ws.report_count}</span>
            </button>
          ))}

          {canEditOrg && (
            <div style={_hs14}>
              {showCreateWs ? (
                <div style={_hs15}>
                  <input
                    placeholder="Workspace name" value={newWsName}
                    onChange={(e) => setNewWsName(e.target.value)}
                    style={_hs16}
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
                    style={_hs17}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)'; }}
                  >
                    <TbX size={13} />
                  </button>
                </div>
              ) : (
                <button onClick={() => setShowCreateWs(true)}
                  style={_hs18}
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
        <main style={_hs19}>
          <div style={_hs20}>
            <div style={_hs21}>
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
                  style={_hs22}
                />
              ) : (
                <h2 style={_hs23}>{wsName}</h2>
              )}
              {selectedWs && (
                <>
                  {wsUserRole === 'admin' && !editingWsName && (
                    <button
                      className="btn-hover"
                      onClick={() => { setEditedWsName(wsName); setEditingWsName(true); }}
                      style={{ ...iconBtn, color: 'var(--text-muted)' }}
                      title="Rename workspace"
                    >
                      <TbEdit size={16} />
                    </button>
                  )}
                  {!wsIsPersonalOrg && wsCanSeeMembers && (
                    <button className="btn-hover" onClick={() => setShowMembers(!showMembers)} style={{ ...iconBtn, color: 'var(--text-muted)' }} title="Members">
                      <TbUsers size={16} />
                    </button>
                  )}
                  {wsUserRole === 'admin' && (
                    <button className="btn-hover btn-hover-danger" onClick={() => deleteWorkspace(selectedWs)} style={{ ...iconBtn, color: 'var(--state-danger)' }} title="Delete workspace">
                      <TbTrash size={14} />
                    </button>
                  )}
                </>
              )}
            </div>
            {canEdit && (
              <div style={_hs24}>
                <input
                  ref={importFileRef}
                  type="file"
                  accept=".json,application/json"
                  style={_hs25}
                  onChange={handleImportFile}
                />
                <button
                  className="btn-hover btn-hover-accent"
                  onClick={() => { setImportError(''); importFileRef.current?.click(); }}
                  style={{ ...primaryBtn, background: 'var(--bg-panel)', color: 'var(--accent-primary)', border: '1px solid var(--accent-primary-border)' }}
                  title="Import a report from a .openreport.json file"
                >
                  Import
                </button>
                <button className="btn-hover btn-hover-primary" onClick={() => { setNewTitle(''); setNewModelId(''); setCreateMode(null); setUploadError(''); setShowCreate(true); }} style={primaryBtn}>+ New Report</button>
              </div>
            )}
          </div>

          {/* Members panel */}
          {showMembers && selectedWs && !wsIsPersonalOrg && wsCanSeeMembers && (
            <div style={membersPanel}>
              <div style={_hs26}>Members</div>
              {wsOwner && (
                <div style={memberRow}>
                  <span>{wsOwner.display_name || wsOwner.email}</span>
                  <span style={_hs27}>Owner</span>
                </div>
              )}
              {wsMembers.map((m) => (
                <div key={m.id} style={memberRow}>
                  <span>{m.display_name || m.email}</span>
                  <div style={_hs28}>
                    {wsUserRole === 'admin' ? (
                      <>
                        <select value={m.role} onChange={(e) => updateMemberRole(m.id, e.target.value)}
                          style={_hs29}>
                          <option value="admin">Admin</option>
                          <option value="editor">Editor</option>
                          <option value="viewer">Viewer</option>
                        </select>
                        <button className="btn-hover btn-hover-danger" onClick={() => removeMember(m.id)} style={{ ...iconBtn, padding: '2px 4px' }}><TbX size={12} /></button>
                      </>
                    ) : (
                      <span style={_hs30}>{m.role}</span>
                    )}
                  </div>
                </div>
              ))}
              {wsUserRole === 'admin' && (
                <div style={_hs31}>
                  <div style={_hs32}>
                    <input placeholder="Search user..." value={newMemberEmail}
                      onChange={(e) => searchUsers(e.target.value)}
                      onFocus={() => userSuggestions.length > 0 && setShowSuggestions(true)}
                      onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                      style={_hs33} />
                    {showSuggestions && userSuggestions.length > 0 && (
                      <div style={_hs34}>
                        {userSuggestions.map((u) => (
                          <div key={u.id} onClick={() => selectSuggestion(u)}
                            style={_hs35}
                            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-active)'}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'var(--bg-panel)'}>
                            <span style={_hs36}>{u.display_name || u.email.split('@')[0]}</span>
                            <span style={_hs37}>{u.email}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <select value={newMemberRole} onChange={(e) => setNewMemberRole(e.target.value)}
                    style={_hs38}>
                    <option value="viewer">Viewer</option>
                    <option value="editor">Editor</option>
                    <option value="admin">Admin</option>
                  </select>
                  <button className="btn-hover btn-hover-primary" onClick={addMember} style={_hs39}>
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
                <h3 style={_hs40}>Import report</h3>
                <p style={_hs41}>
                  Source: <strong>{importBundle.report?.title || 'Untitled'}</strong>
                  {importBundle.report?.model_name && (
                    <> &middot; originally bound to model <code>{importBundle.report.model_name}</code></>
                  )}
                </p>
                <div style={_hs42}>
                  <label style={labelStyle}>Bind to data model</label>
                  <select
                    value={importModelId}
                    onChange={(e) => setImportModelId(e.target.value)}
                    style={inputStyle}
                  >
                    <option value="">— pick one —</option>
                    {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                  <p style={_hs43}>
                    Widgets will be re-queried against the model you pick. Field references in the bundle must match this model's dimensions and measures.
                  </p>
                </div>
                {importError && (
                  <div style={_hs44}>
                    {importError}
                  </div>
                )}
                <div style={_hs45}>
                  <button className="btn-hover" onClick={cancelImport} style={{ ...primaryBtn, background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border-default)' }}>Cancel</button>
                  <button className="btn-hover btn-hover-primary" onClick={submitImport} disabled={!importModelId || importing} style={primaryBtn}>
                    {importing ? 'Importing…' : 'Import'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Top-level import error (when file failed to parse before opening the modal) */}
          {importError && !importBundle && (
            <div style={_hs46}>
              {importError}
            </div>
          )}

          {/* Create report modal — wizard */}
          {showCreate && (
            <div style={modalOverlay}>
              <div style={{ ...actionModalCard, width: 480 }}>
                <h3 style={_hs47}>New Report{selectedWs ? ` in ${wsName}` : ''}</h3>

                {/* Title — always visible. Persisted through the database-connection
                    round trip via URL param so the user gets it back when they
                    return from the model editor. */}
                <div style={_hs48}>
                  <label style={labelStyle}>Title</label>
                  <input style={inputStyle} value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Report title" />
                </div>

                {/* Step 1: Choose source type */}
                {!createMode && (
                  <div>
                    <label style={{ ...labelStyle, marginBottom: 10 }}>Data source</label>
                    <div style={_hs49}>
                      {models.length > 0 && (
                        <button className="btn-hover" onClick={() => setCreateMode('model')} style={sourceCard}>
                          <TbLayoutDashboard size={28} color="var(--accent-primary)" />
                          <span style={_hs50}>Existing Model</span>
                          <span style={_hs51}>Use a data model already configured</span>
                        </button>
                      )}
                      <button className="btn-hover" onClick={() => setCreateMode('file')} style={sourceCard}>
                        <TbUpload size={28} color="#16a34a" />
                        <span style={_hs52}>Import File</span>
                        <span style={_hs53}>CSV, Excel, Parquet, JSON</span>
                      </button>
                      <button className="btn-hover" onClick={() => setCreateMode('connection')} style={sourceCard}>
                        <TbDatabase size={28} color="#f59e0b" />
                        <span style={_hs54}>Database</span>
                        <span style={_hs55}>Connect to a database</span>
                      </button>
                    </div>
                    <div style={_hs56}>
                      <button className="btn-hover" onClick={() => { setShowCreate(false); setCreateMode(null); }} style={secondaryBtn}>Cancel</button>
                    </div>
                  </div>
                )}

                {/* Step 2a: Choose existing model */}
                {createMode === 'model' && (
                  <div>
                    <div style={_hs57}>
                      <label style={labelStyle}>Model</label>
                      <select style={inputStyle} value={newModelId} onChange={(e) => setNewModelId(e.target.value)}>
                        <option value="">Select a model...</option>
                        {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                      </select>
                    </div>
                    <div style={_hs58}>
                      <button className="btn-hover" onClick={() => setCreateMode(null)} style={secondaryBtn}>← Back</button>
                      <button className="btn-hover btn-hover-primary" onClick={handleCreate} disabled={!newModelId} style={{ ...primaryBtn, opacity: newModelId ? 1 : 0.5 }}>Create Report</button>
                    </div>
                  </div>
                )}

                {/* Step 2b: Upload file */}
                {createMode === 'file' && (
                  <div>
                    <input ref={createFileRef} type="file" accept=".csv,.xlsx,.xls,.parquet,.json,.tsv" style={_hs59}
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
                        <div style={_hs60}>Importing data...</div>
                      ) : (
                        <>
                          <TbUpload size={32} color="var(--text-disabled)" />
                          <div style={_hs61}>Click to select a file</div>
                          <div style={_hs62}>CSV, Excel, Parquet, JSON (max 500 Mo)</div>
                        </>
                      )}
                    </div>
                    {uploadError && <div style={_hs63}>{uploadError}</div>}
                    <div style={_hs64}>
                      <button className="btn-hover" onClick={() => { setCreateMode(null); setUploadError(''); }} style={secondaryBtn}>← Back</button>
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
            <div style={_hs65}>Loading...</div>
          ) : wsReports.length === 0 ? (
            <div style={_hs66}>
              No reports{selectedWs ? ' in this workspace' : ''}.
            </div>
          ) : (
            <div style={_hs67}>
              {wsReports.map((report) => (
                <div key={report.id} style={report.is_public ? { ...cardStyle, ...publicCardAccent } : cardStyle}>
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
                    style={_hs68}>
                    <h3
                      title={report.title}
                      style={_hs69}
                    >{report.title}</h3>
                    {report.model_name && (
                      // Flex row so the long model name still truncates with
                      // an ellipsis while the edit pencil stays visible on
                      // the right. Pencil only renders when the user has
                      // edit rights AND the report carries a model_id (the
                      // workspaces list endpoint includes it — see
                      // server/routes/workspaces.js).
                      <div style={_hs70}>
                        <span
                          style={_hs71}
                          title={report.model_name}
                        >{report.model_name}</span>
                        {canEdit && report.model_id && (
                          <button
                            onClick={(e) => { e.stopPropagation(); navigate(`/models/${report.model_id}`); }}
                            title="Edit model"
                            style={_hs72}
                            onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.55'; }}
                          >
                            <TbPencil size={12} />
                          </button>
                        )}
                      </div>
                    )}
                    {typeof report.fileSize === 'number' && (
                      <p style={_hs73}>
                        {formatFileSize(report.fileSize)}
                      </p>
                    )}
                    <p style={_hs74}>Last edit {new Date(report.updated_at).toLocaleString()}</p>
                    {cardCacheStats[report.id]?.builtAt && (
                      <p style={_hs75}>Last refresh {new Date(cardCacheStats[report.id].builtAt).toLocaleString()}</p>
                    )}
                  </div>
                  <div style={_hs76}>
                    <button onClick={() => window.open(`/view/${report.id}`, '_blank')} title="View" {...cardActionBtn('accent')}><TbEye size={16} /></button>
                    {canEdit && <button onClick={() => navigate(`/edit/${report.id}`)} title="Edit" {...cardActionBtn()}><TbEdit size={16} /></button>}
                    {canEdit && (() => {
                      const warming = cardWarmingIds.has(report.id);
                      return (
                        <button
                          onClick={() => refreshReportCacheFromCard(report)}
                          disabled={warming}
                          title={warming ? 'Refreshing cache…' : 'Refresh cache for this report'}
                          {...cardActionBtn(warming ? 'accent' : 'muted')}
                        >
                          {warming
                            ? <TbLoader2 size={16} className="spin" />
                            : <TbRefresh size={16} />}
                        </button>
                      );
                    })()}
                    {canEdit && (
                      <div style={_hs77}
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
                              onClick={() => {
                                setCardMenu(null);
                                // Pre-select the first workspace that ISN'T the report's current one,
                                // otherwise the Move button opens disabled and visually differs from
                                // its enabled twin in the Rename modal.
                                const candidates = [
                                  ...(personalWorkspace ? [personalWorkspace] : []),
                                  ...workspaces,
                                ];
                                const firstOther = candidates.find((w) => w.id !== report.workspace_id);
                                setMoveModal({ report, targetWs: firstOther ? firstOther.id : '' });
                              }}
                              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                              <TbArrowsRightLeft size={14} /> Move to workspace
                            </button>
                            {canEdit && (
                              <button style={cardMenuItem}
                                onClick={() => { setCardMenu(null); togglePublic(report); }}
                                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                                {report.is_public
                                  ? <><TbShareOff size={14} /> Make private</>
                                  : <><TbShare size={14} /> Share public link</>}
                              </button>
                            )}
                            {(wsUserRole === 'admin' || activeOrgRole === 'admin' || user?.role === 'admin') && (
                              <button style={cardMenuItem}
                                onClick={() => { setCardMenu(null); toggleLiveMode(report); }}
                                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                                title={report.live_mode
                                  ? 'Switch this report back to the cached (rollup) data source — faster, default.'
                                  : 'Switch this report to a live source query — bypasses the rollup cache on every widget.'}>
                                {report.live_mode
                                  ? <><TbDatabase size={14} /> Use cached data</>
                                  : <><TbBolt size={14} /> Use live query</>}
                              </button>
                            )}
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
                            {/* Cache schedules — works in both OSS and cloud. */}
                            <button style={cardMenuItem}
                              onClick={() => openCacheSchedules(report)}
                              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                              <TbCalendarTime size={14} /> Schedule refresh
                            </button>
                            {/* Schedule email — cloud-only. The endpoint 404s in OSS,
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
                  {/* Cache footprint for this report. Populated lazily —
                      only after the user clicks Refresh at least once,
                      so the report list itself loads fast. While a
                      refresh is in flight the size · rows line is
                      replaced by a smoothly-advancing progress bar
                      (trickle driver above), then restored once the warm
                      finishes. Click → opens the per-widget breakdown. */}
                  {(() => {
                    const warming = cardWarmingIds.has(report.id);
                    if (!cardCacheStats[report.id] && !warming) return null;
                    if (warming) {
                      const pct = Math.max(0, Math.min(100, cardWarmingDisplayPct[report.id] ?? 0));
                      return (
                        <div style={_hs78}>
                          <div
                            style={_hs79}
                          >
                            Refreshing data…
                          </div>
                          <div
                            className="rollup-progress determinate"
                            aria-label="Refreshing data"
                            role="progressbar"
                            aria-valuenow={Math.round(pct)}
                            aria-valuemin={0}
                            aria-valuemax={100}
                          >
                            <span style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    }
                    return (
                      <div
                        onClick={(e) => { e.stopPropagation(); openCacheInspect(report.id, report.title, report.workspace_id); }}
                        style={_hs80}
                        title="Click to see the rollup storage breakdown"
                      >
                        {cardCacheStats[report.id].rollupCount > 0
                          ? `${formatBytes(cardCacheStats[report.id].diskBytes || 0)} · ${(cardCacheStats[report.id].totalRows || 0).toLocaleString()} rows`
                          : 'No cache — Refresh to build'}
                      </div>
                    );
                  })()}
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
              <button className="btn-hover" style={actionModalBtnSecondary} onClick={() => setRenameModal(null)}>Cancel</button>
              <button className="btn-hover btn-hover-primary" style={actionModalBtnPrimary} onClick={submitRename} disabled={!renameModal.value.trim()}>Save</button>
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
              <button className="btn-hover" style={actionModalBtnSecondary} onClick={() => setMoveModal(null)}>Cancel</button>
              <button className="btn-hover btn-hover-primary" style={actionModalBtnPrimary} onClick={submitMove} disabled={!moveModal.targetWs || moveModal.targetWs === moveModal.report.workspace_id}>Move</button>
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
            <div style={_hs81}>
              The 20 most recent saves. Restoring a version saves the current state as a new entry first.
            </div>
            {historyModal.loading ? (
              <div style={_hs82}>Loading...</div>
            ) : historyModal.error ? (
              <div style={_hs83}>{historyModal.error}</div>
            ) : historyModal.versions.length === 0 ? (
              <div style={_hs84}>
                No previous versions yet.
              </div>
            ) : (
              <div style={_hs85}>
                {historyModal.versions.map((v) => (
                  <div key={v.id} style={historyRow}>
                    <div style={_hs86}>
                      <div style={_hs87}>
                        {v.title}
                      </div>
                      <div style={_hs88}>
                        {new Date(v.saved_at).toLocaleString()} · {v.saved_by_name || v.saved_by_email || 'unknown'}
                      </div>
                    </div>
                    <button className="btn-hover btn-hover-accent" style={historyRestoreBtn} onClick={() => restoreVersion(v.id)} title="Restore this version">
                      <TbArrowBackUp size={14} /> Restore
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div style={actionModalActions}>
              <button className="btn-hover" style={actionModalBtnSecondary} onClick={() => setHistoryModal(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Refresh schedules — works in both OSS and cloud. Each tick warms
          the report's queries to populate queryCache + preAggCache. */}
      {cacheScheduleModal && (
        <CacheScheduleModal
          modal={cacheScheduleModal}
          runningIds={cacheScheduleRunning}
          onClose={() => setCacheScheduleModal(null)}
          onCreate={createCacheSchedule}
          onToggle={toggleCacheSchedule}
          onDelete={deleteCacheSchedule}
          onRunNow={runCacheScheduleNow}
        />
      )}

      {/* Schedule emails — cloud-only. Lists the report's existing schedules
          and a small inline form to create / edit one. Phase 1: deep link in
          the email; PDF attachment + per-recipient personalisation later. */}
      {scheduleModal && (
        <ScheduleModal
          modal={scheduleModal}
          runningIds={runningScheduleIds}
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

      {/* Per-report cache breakdown — opened by clicking the "Cache: …" line
          on a report card. Pure read-only inspector backed by the
          /cache-schedules/inspect/:reportId endpoint, which runs the same
          planForReport the warmer does and matches stored cache entries
          back to their owning visual. */}
      {cacheInspect.reportId && (
        <CacheInspectorModal
          reportId={cacheInspect.reportId}
          reportTitle={cacheInspect.reportTitle}
          workspaceId={cacheInspect.workspaceId}
          canManage={canEdit || user?.role === 'admin'}
          data={cacheInspect.data}
          loading={cacheInspect.loading}
          error={cacheInspect.error}
          onClose={() => setCacheInspect({ reportId: null, workspaceId: null, data: null, loading: false, error: null })}
          onCleared={() => openCacheInspect(cacheInspect.reportId, cacheInspect.reportTitle, cacheInspect.workspaceId)}
          formatBytes={formatBytes}
        />
      )}
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
const cardStyle = { position: 'relative', backgroundColor: 'var(--bg-panel)', borderRadius: 8, border: '1px solid var(--border-default)', display: 'flex', flexDirection: 'column', transition: 'box-shadow 0.15s' };
// Public reports get a colored border (green = "publicly available")
// so an admin scanning the workspace can spot sharable reports at a
// glance. Background stays the regular panel colour to keep the cards
// visually quiet — only the rim differs.
const publicCardAccent = { borderColor: 'var(--state-success)' };
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

// Row styles for the report-version history modal. The shared modal chrome
// (`actionModal*`, `cardActionBtn`) lives in components/dashboardModalStyles.
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

function formatFileSize(bytes) {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
const inputStyle = { width: '100%', padding: '8px 10px', border: '1px solid var(--border-default)', borderRadius: 6, fontSize: 13, outline: 'none', boxSizing: 'border-box', background: 'var(--bg-panel)', color: 'var(--text-primary)' };
const labelStyle = { display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4, fontWeight: 500 };
const modalOverlay = { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 };
const sourceCard = {
  flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
  padding: '20px 12px', border: '1px solid var(--border-default)', borderRadius: 8, background: 'var(--bg-panel)',
  cursor: 'pointer', textAlign: 'center', transition: 'all 0.15s', color: 'var(--text-primary)',
};
const sidebarStyle = { width: 240, backgroundColor: 'var(--bg-panel)', borderRight: '1px solid var(--border-default)', overflow: 'auto', flexShrink: 0 };
const wsItemStyle = { display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 16px', border: 'none', cursor: 'pointer', fontSize: 13, textAlign: 'left' };
const membersPanel = { backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border-default)', borderRadius: 8, padding: 16, marginBottom: 20 };
const memberRow = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', fontSize: 13, borderBottom: '1px solid var(--bg-subtle)' };
