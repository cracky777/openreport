import { createPortal } from 'react-dom';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import api from '../utils/api';
import { toast } from '../components/Toast/toast';
import ImportOptions, { DEFAULT_IMPORT_OPTIONS, appendImportOptions, importKind } from '../components/ImportOptions/ImportOptions';
import { readSheetNames } from '../utils/readSheetNames';
import { TbEye, TbShare, TbShareOff, TbShield, TbFolder, TbFolderPlus, TbUsers, TbUserPlus, TbArrowRight, TbDatabase, TbBolt, TbUpload, TbLayoutDashboard, TbLogout, TbUser, TbStack3, TbSun, TbMoon, TbDeviceLaptop, TbChevronDown, TbDotsVertical, TbCopy, TbArrowsRightLeft, TbHistory, TbArrowBackUp, TbLink, TbCalendarTime, TbBell, TbPlayerPlay, TbToggleLeftFilled, TbToggleRightFilled, TbLoader2, TbRefresh, TbFileText, TbCode } from 'react-icons/tb';
import { DeleteIcon, EditIcon, ICON_SIZE } from '../components/actionIcons';
import ConfirmDeleteButton from '../components/ConfirmDeleteButton/ConfirmDeleteButton';
import ConfirmDialog from '../components/ConfirmDialog/ConfirmDialog';
import { formatBytes } from '../utils/formatHuman';
import { useTheme } from '../hooks/useTheme';
import { usePermissions } from '../hooks/usePermissions';
import { useWorkspaceData } from '../hooks/useWorkspaceData';
import { useCardCacheWarming } from '../hooks/useCardCacheWarming';
import { TopbarSwitcher, UserMenuExtras } from '../cloud';
import { PrimaryButton, ImportButton } from '../components/PageHeader/PageHeader';
import DatasourceForm, { createModelAndNavigate } from '../components/DatasourceForm/DatasourceForm';

import Portal from '../components/Portal/Portal';
import Modal from '../components/Modal/Modal';
import { useGraph } from '../hooks/graphContext';
import { useJourneyFocus } from '../hooks/useJourneyFocus';
import { groupByParent } from '../utils/groupByParent';
import FilterCrumb from '../components/AppShell/FilterCrumb';
import CacheInspectorModal from '../components/CacheInspectorModal/CacheInspectorModal';
import CacheScheduleModal from '../components/CacheScheduleModal/CacheScheduleModal';
import ScheduleModal from '../components/ScheduleModal/ScheduleModal';
import { actionModalTitle, actionModalInput, actionModalActions, actionModalBtnSecondary, actionModalBtnPrimary, cardActionBtn } from '../components/dashboardModalStyles';

// Fills the stage slot AppShell gives it — the shell owns the viewport height
// and the header now.
const _hs0 = { flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0, backgroundColor: 'var(--bg-app)' };
const _hs1 = { fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: -0.5, display: 'flex', alignItems: 'center', gap: 12 };
const _hs2 = { height: 28 };
const _hs3 = { display: 'flex', alignItems: 'center', gap: 6 };
const _hs4 = { position: 'relative' };
const _hs5 = { display: 'flex', flexDirection: 'column', gap: 2, padding: '4px 8px 8px' };
const _hs6 = { display: 'inline-flex', alignItems: 'center', gap: 8 };
const _hs7 = { fontSize: 9, color: 'var(--text-muted)' };
const _hs8 = { display: 'inline-flex', alignItems: 'center', gap: 8 };
const _hs9 = { color: 'var(--accent-primary)' };
const _hs10 = { flex: 1, display: 'flex', minHeight: 0, minWidth: 0 };
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
const _hs19 = { flex: 1, minWidth: 0, overflow: 'auto', padding: '24px 32px' };
// Three columns: the actions sit in the middle one, on the axis of the cards,
// and stay put whether or not the crumb is showing. See Datasources.
const _hs20 = {
  display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)',
  alignItems: 'center', gap: 12, marginBottom: 20,
};
const _hs21 = { display: 'flex', alignItems: 'center', gap: 12, justifySelf: 'start' };
const _hs22 = {
                    fontSize: 18, fontWeight: 600, color: 'var(--text-primary)',
                    background: 'var(--bg-subtle)', border: '1px solid var(--border-default)',
                    outline: 'none', borderRadius: 6, padding: '2px 8px', minWidth: 200,
                  };
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
const _hs61 = { fontSize: 14, color: 'var(--text-secondary)', marginTop: 8 };
const _hs62 = { fontSize: 12, color: 'var(--text-disabled)', marginTop: 4 };
const _hs63 = { color: 'var(--state-danger)', fontSize: 12, marginBottom: 8 };
const _hs64 = { display: 'flex', justifyContent: 'flex-start' };
const _hs65 = { textAlign: 'center', color: 'var(--text-disabled)', marginTop: 60 };
// The empty column is where the journey starts, so it gets room rather than a
// one-line apology. Choices capped at the cards' own width, on their axis.
const emptyState = {
  marginTop: 60, display: 'flex', flexDirection: 'column',
  alignItems: 'center', textAlign: 'center',
};
const emptyTitle = { fontSize: 16, color: 'var(--text-muted)', marginBottom: 4 };
const emptySub = { fontSize: 13, color: 'var(--text-disabled)', marginBottom: 20 };
const emptyChoices = { display: 'flex', gap: 12, width: 'min(760px, 100%)' };
// One report per row rather than a grid: the journey's other stages are lists
// with join gutters either side, and a grid leaves nowhere for the incoming
// join to land.
const _hs67 = { display: 'flex', flexDirection: 'column', gap: 8 };
// Text left, actions right — the layout Sources and Models already use. The
// card used to stack a padded body over its own action bar, which made it
// twice the height of the other two stages: the same journey read as three
// unrelated kinds of object.
const cardBody = { cursor: 'pointer', flex: '1 1 180px', minWidth: 0 };
const cardTitle = {
  fontSize: 15, fontWeight: 600, color: 'var(--text-primary)',
  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
};
// Everything else on one line. nowrap + hidden is what keeps the card a fixed
// two lines tall whatever the report carries; the model name is the only
// segment allowed to shrink, so it ellipsises before anything else is clipped.
const cardMeta = {
  display: 'flex', alignItems: 'center', gap: 6, marginTop: 2,
  fontSize: 12, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden',
};
const metaDot = { color: 'var(--border-strong)', flexShrink: 0 };
// The 90px floor lives on the GROUP (name + pencil), not the name: on the name
// it inflated short names to 90px and pushed the pencil away from the text.
// Here the pencil hugs the name (gap 3) and any leftover width sits after it,
// while a crowded card still can't shrink the segment below the floor — the
// report keeps the one word saying what it was built on.
const metaModel = { display: 'inline-flex', alignItems: 'center', gap: 3, minWidth: 90, flex: '0 1 auto' };
const metaModelName = {
  color: 'var(--accent-primary)',
  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
  minWidth: 0, flex: '0 1 auto',
};
const metaModelEdit = {
  background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
  color: 'var(--accent-primary)', opacity: 0.55, transition: 'opacity 0.12s',
  display: 'inline-flex', alignItems: 'center', flexShrink: 0,
};
const metaSize = { color: 'var(--text-muted)', flexShrink: 0 };
const metaWhen = { color: 'var(--text-disabled)', flexShrink: 0 };
const cardActions = { display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 };
const cardMenuWrap = { position: 'relative' };
// A refresh in flight stays inside the meta line: as a footer it grew the card
// mid-refresh and shoved every join below it down a notch.
const metaProgress = { display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 };
const metaProgressLabel = { fontSize: 11, color: 'var(--accent-primary)' };
const metaProgressTrack = { width: 90 };
// A row is just a centred card now — JoinLayer draws the relations over the
// space either side of it.
const joinRowStyle = { display: 'flex', justifyContent: 'center' };

const cardStyle = { width: '100%', maxWidth: 760, flexShrink: 0, flexWrap: 'wrap', rowGap: 10,
  backgroundColor: 'var(--bg-panel)', padding: '16px 20px', borderRadius: 8,
  border: '1px solid var(--border-default)', display: 'flex', alignItems: 'center', gap: 14,
};
const publicCardAccent = { borderColor: 'var(--state-success)' };
// The actions menu carries its own z-index, but it is trapped in the card's
// stacking context (.journey-card is z-index 4) — so every card further down
// the list, at that same 4, painted over it. Raising the card lifts the menu
// with it. Stays well under the shell's own dropdowns at 200.
const cardMenuOpen = { zIndex: 10 };
// Last of the line and least load-bearing, so it is the one that gives way.
const cardCacheLink = {
  color: 'var(--text-disabled)',
  minWidth: 0, flex: '0 1 auto',
  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
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
  const { user, instance } = useAuth();
  // Instance policy: who may flip a report public. 'disabled' hides the
  // action for everyone, 'admins' keeps it for admins only.
  const canSharePublic = instance.publicSharingPolicy === 'everyone'
    || (instance.publicSharingPolicy === 'admins' && user?.role === 'admin');
  // Still needed to stamp the active theme onto exported/shared reports.
  const { resolved: themeResolved, themes: availableThemes } = useTheme();
  const navigate = useNavigate();
  // The branch the journey is focused on, resolved once for all three stages.
  const focus = useJourneyFocus();
  // Reports and models are shared across the whole journey; the setters stay
  // available so this page keeps applying its optimistic updates (delete,
  // share, live-mode) without waiting for a refetch.
  // The active workspace now lives in the shell-level graph — it is a context
  // shared by the three stages, set from the header picker.
  const {
    reports, setReports, models, refresh: refreshGraph,
    workspaces, personalWorkspace,
    selectedWs, loading, modelOrder,
  } = useGraph();
  const {
    wsReports, wsUserRole,
    setWsReports,
  } = useWorkspaceData(selectedWs, reports, personalWorkspace);
  const [showCreate, setShowCreate] = useState(false);
  // The source step was chosen before the dialog opened, so there is no step 1
  // to go back to — see leaveCreateStep.
  const [modePreset, setModePreset] = useState(false);
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
  const [importOpts, setImportOpts] = useState(DEFAULT_IMPORT_OPTIONS);
  const [selectedFile, setSelectedFile] = useState(null);
  const [sheetNames, setSheetNames] = useState([]);
  const createFileRef = useRef(null);
  // Import-from-JSON-bundle flow
  const importFileRef = useRef(null);
  const [importBundle, setImportBundle] = useState(null);   // parsed { format, report, ... } or null
  const [importModelId, setImportModelId] = useState('');
  const [importError, setImportError] = useState('');
  const [importing, setImporting] = useState(false);
  // Cloud-aware permission state (org role, platform-admin, write capability).
  const { activeOrgRole, canEdit } = usePermissions(selectedWs, user, wsUserRole);

  // Workspaces only — reports and models come from the shell-level graph, which
  // has already loaded them by the time this column slides in.
  const [searchParams, setSearchParams] = useSearchParams();
  // Open the new-report wizard on a model somebody else picked:
  // ?newReport=1&modelId=<id>. Two callers — the "+" on a model card, and the
  // model editor bouncing back from /models/:id?then=newReport, which adds
  // &title=<title> to carry back what the user had typed before leaving.
  //
  // Watches the parameters rather than firing on mount: this stage never
  // unmounts (all three ride the same ribbon), so arriving from Models is a
  // parameter change and nothing more. Stripping them afterwards keeps a
  // refresh from re-opening the wizard.
  useEffect(() => {
    if (searchParams.get('newReport') !== '1') return;
    const mid = searchParams.get('modelId');
    if (mid) {
      setNewModelId(mid);
      setCreateMode('model');
      setModePreset(true);
      setShowCreate(true);
    }
    setNewTitle(searchParams.get('title') || '');
    const rest = new URLSearchParams(searchParams);
    rest.delete('newReport');
    rest.delete('modelId');
    rest.delete('title');
    setSearchParams(rest, { replace: true });
  }, [searchParams, setSearchParams]);


  // Step 1: just record the pick — the import options only make sense once a
  // file is in hand, so the actual upload waits for the Import button. For an
  // Excel workbook we read its sheet names (in-browser) and pre-select them all.
  const handleFileSelected = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFile(file);
    setUploadError('');
    setImportOpts(DEFAULT_IMPORT_OPTIONS);
    setSheetNames([]);
    if (createFileRef.current) createFileRef.current.value = ''; // allow re-picking the same file
    if (importKind(file.name) === 'excel') {
      const names = await readSheetNames(file);
      setSheetNames(names);
      setImportOpts((o) => ({ ...o, sheets: names })); // default: import every sheet
    }
  };

  // Step 2: run the upload → model → report chain for the pending file.
  const handleFileForReport = async () => {
    const file = selectedFile;
    if (!file) return;
    setUploadingFile(true);
    setUploadError('');
    try {
      // 1. Upload file → creates DuckDB datasource (or reuses existing)
      const formData = new FormData();
      formData.append('file', file);
      formData.append('name', file.name.replace(/\.[^.]+$/, ''));
      appendImportOptions(formData, importOpts);
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
        // A fresh upload carries every imported table (name + columns); older or
        // reused datasources fall back to a single-table fetch.
        let tbls = ds.tables;
        if (!tbls || !tbls.length) {
          const colRes = await api.get(`/datasources/${ds.id}/tables/${ds.tableName}/columns`);
          tbls = [{ tableName: ds.tableName, columns: colRes.data.columns || [] }];
        }
        const numericTypes = ['integer', 'bigint', 'numeric', 'decimal', 'real', 'double', 'float', 'int', 'smallint', 'double precision', 'interval'];
        const dateTypes = ['date', 'timestamp', 'timestamptz', 'timestamp with time zone', 'timestamp without time zone', 'datetime', 'time', 'smalldatetime', 'datetime2'];
        const dimensions = [];
        const measures = [];
        const selectedTables = [];
        // With several sheets/tables, suffix labels with the sheet so homonym
        // columns stay distinguishable (and users don't accidentally combine
        // fields from unrelated tables, which the server now rejects).
        const multi = tbls.length > 1;
        const lbl = (t, col) => (multi ? `${col} (${t.tableName})` : col);
        tbls.forEach((t) => {
          selectedTables.push(t.tableName);
          (t.columns || []).forEach((c) => {
            const dimName = `${t.tableName}.${c.column_name}`;
            const dt = c.data_type?.toLowerCase() || '';
            const colType = numericTypes.includes(dt) ? 'number' : dateTypes.includes(dt) ? 'date' : 'string';
            dimensions.push({ name: dimName, table: t.tableName, column: c.column_name, type: colType, label: lbl(t, c.column_name) });
            if (numericTypes.includes(dt)) {
              measures.push({ name: `${t.tableName}.${c.column_name}_sum`, table: t.tableName, column: c.column_name, aggregation: 'sum', label: lbl(t, c.column_name) });
            }
          });
        });
        await api.put(`/models/${modelId}`, { selected_tables: selectedTables, dimensions, measures });
      }

      // 4. Create report with this model
      const reportRes = await api.post('/reports', {
        title: newTitle || ds.name,
        // Only when we fell back to the datasource's name — a title the user
        // typed keeps its conflict error.
        ...(newTitle ? {} : { autoTitle: true }),
        modelId,
        ...(selectedWs ? { workspaceId: selectedWs } : {}),
        settings: { theme: availableThemes[themeResolved] ? { key: themeResolved, ...availableThemes[themeResolved] } : null },
      });
      // Close before leaving, like the database branch already does. The
      // dialog is state, not a route, so nothing else would ever close it.
      setShowCreate(false);
      setCreateMode(null);
      navigate(`/edit/${reportRes.data.report.id}`);
    } catch (err) {
      setUploadError(err.response?.data?.error || err.message);
    } finally {
      setUploadingFile(false);
      if (createFileRef.current) createFileRef.current.value = '';
    }
  };

  // Creating from a filtered column pre-picks the model we're standing in,
  // and jumps straight past the source step it would otherwise ask for.
  //
  // `mode` lets a caller name the source itself — the empty state puts those
  // three choices on screen, so re-asking for them in the dialog would be
  // asking a question the user just answered.
  const openCreate = (mode) => {
    setNewTitle('');
    setUploadError('');
    setSelectedFile(null);
    const followed = focus.stage === 'models' ? focus.id : '';
    setNewModelId(followed);
    const preset = mode || (followed ? 'model' : null);
    setCreateMode(preset);
    setModePreset(!!preset);
    setShowCreate(true);
  };

  const closeCreate = () => {
    if (uploadingFile) return; // an import in flight owns the dialog
    setShowCreate(false);
    setCreateMode(null);
    setModePreset(false);
    setUploadError('');
    setSelectedFile(null);
  };

  // Backing out of a source step. When the source was picked before the dialog
  // even opened — from the empty state, a model card's "+", or the model
  // editor's round trip — step 1 is a screen the user never passed through,
  // and landing on it reads as the dialog going forwards, not back. There is
  // nothing behind that choice but the page itself.
  const leaveCreateStep = () => {
    if (modePreset) { closeCreate(); return; }
    setCreateMode(null);
    setUploadError('');
    setSelectedFile(null);
  };

  const handleCreate = async () => {
    if (!newModelId) return;
    try {
      const res = await api.post('/reports', {
        title: newTitle || 'Untitled Report', modelId: newModelId,
        ...(selectedWs ? { workspaceId: selectedWs } : {}),
        settings: { theme: availableThemes[themeResolved] ? { key: themeResolved, ...availableThemes[themeResolved] } : null },
      });
      navigate(`/edit/${res.data.report.id}`);
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to create report');
    }
  };

  // Confirmation belongs to the button that arms itself — see ConfirmDeleteButton.
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
      toast(`Public link copied: ${url}`, 'success');
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
    await refreshGraph();
  };

  // 3-dots menu state (per-card) + the modals it opens.
  const [cardMenu, setCardMenu] = useState(null);          // reportId of the open menu, or null
  const [embedModal, setEmbedModal] = useState(null);      // report object of the open embed dialog, or null
  const [renameModal, setRenameModal] = useState(null);    // { report, value }
  const [moveModal, setMoveModal] = useState(null);        // { report, targetWs }
  const [historyModal, setHistoryModal] = useState(null);  // { report, versions, loading }
  const [askRestore, setAskRestore] = useState(null);      // versionId awaiting confirmation
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
    await refreshGraph();
    if (selectedWs) {
      const wsRes = await api.get(`/workspaces/${selectedWs}`);
      setWsReports(wsRes.data.reports || []);
    }
  };

  const submitRename = async () => {
    if (!renameModal || !renameModal.value.trim()) return;
    const id = renameModal.report.id;
    const newTitle = renameModal.value.trim();
    try {
      await api.put(`/reports/${id}`, { title: newTitle });
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to rename report');
      return;
    }
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
    setAskRestore(null);
    if (!historyModal) return;
    await api.post(`/reports/${historyModal.report.id}/history/${versionId}/restore`);
    // Refresh the history list to reflect the new "current snapshot" version
    const res = await api.get(`/reports/${historyModal.report.id}/history`);
    setHistoryModal({ ...historyModal, versions: res.data.versions || [] });
    // Refresh the report list so the title in the card reflects the restored state
    await refreshGraph();
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
    await api.delete(`/cache-schedules/${s.id}`);
    await refreshCacheSchedules(s.report_id);
  };
  // Card cache warming + size stats — see hooks/useCardCacheWarming (the whole
  // poll/trickle/pending machine, moved out as one unit).
  const {
    // refreshReportCacheFromCard is no longer destructured: the refresh
    // action moved to the model cards (the cache is model-scoped); the hook
    // still tracks warming state so scheduled/remote builds animate the bar.
    cardWarmingIds, cardWarmingDisplayPct, cardCacheStats,
  } = useCardCacheWarming(wsReports);
  const runCacheScheduleNow = async (s) => {
    if (cacheScheduleRunning.has(s.id)) return;
    setCacheScheduleRunning((prev) => { const n = new Set(prev); n.add(s.id); return n; });
    try {
      const res = await api.post(`/cache-schedules/${s.id}/run`);
      const r = res.data?.result;
      if (r?.error) toast(`Run failed: ${r.error}`);
      await refreshCacheSchedules(s.report_id);
    } catch (err) {
      toast(err.response?.data?.error || err.message);
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

  // Arrived by following a model's join: narrow the list to that model's
  // reports. Lives in the URL so it is shareable and Back undoes it.
  // Reports follow their model's position in the column before them — the last
  // link of the chain that keeps the joins from crossing.
  const visibleReports = useMemo(() => {
    const scoped = focus.reportIds ? wsReports.filter((r) => focus.reportIds.has(r.id)) : wsReports;
    return groupByParent(scoped, modelOrder, 'model_id');
  }, [wsReports, focus.reportIds, modelOrder]);

  return (
    <div style={_hs0}>

      <div style={_hs10}>

        {/* Main content */}
        <main style={_hs19}>
          <div style={_hs20}>
            <div style={_hs21}>
              {focus.active && (
                <FilterCrumb label={focus.label} onClear={focus.clear} />
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
                <ImportButton
                  onClick={() => { setImportError(''); importFileRef.current?.click(); }}
                  title="Import a report from a .openreport.json file"
                >
                  Import report
                </ImportButton>
                {/* Wrapped: openCreate takes a source mode, and passing it straight
                    as a handler would hand it the click event instead. */}
                <PrimaryButton onClick={() => openCreate()}>+ New Report</PrimaryButton>
              </div>
            )}
          </div>

          {/* Members panel */}

          {/* Import-from-bundle modal */}
          {importBundle && (
            <Modal onClose={cancelImport} width={460}>
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
            </Modal>
          )}

          {/* Top-level import error (when file failed to parse before opening the modal) */}
          {importError && !importBundle && (
            <div style={_hs46}>
              {importError}
            </div>
          )}

          {/* Create report modal — wizard */}
          {/* Dismissible: the user reached for the browser's Back button to get
              out of it, which is what a dialog with no way out earns. Escape
              and the backdrop now close it — except mid-import, where the
              upload owns the dialog. */}
          {showCreate && (
            <Modal width={480} onClose={closeCreate}>
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
                    <button className="btn-hover" onClick={() => { setSelectedFile(null); setUploadError(''); setCreateMode('file'); }} style={sourceCard}>
                      <TbUpload size={28} color="#16a34a" />
                      <span style={_hs52}>Import File</span>
                      <span style={_hs53}>CSV, Excel, Parquet, JSON</span>
                    </button>
                    <button className="btn-hover" onClick={() => setCreateMode('connection')} style={sourceCard}>
                      <TbDatabase size={28} color="#f59e0b" />
                      <span style={_hs54}>Connect Database</span>
                      <span style={_hs55}>Connect to a database</span>
                    </button>
                  </div>
                  <div style={_hs56}>
                    <button className="btn-hover" onClick={closeCreate} style={secondaryBtn}>Cancel</button>
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
                    <button className="btn-hover" onClick={leaveCreateStep} style={secondaryBtn}>{modePreset ? 'Cancel' : '← Back'}</button>
                    <button className="btn-hover btn-hover-primary" onClick={handleCreate} disabled={!newModelId} style={{ ...primaryBtn, opacity: newModelId ? 1 : 0.5 }}>Create Report</button>
                  </div>
                </div>
              )}

              {/* Step 2b: Upload file */}
              {createMode === 'file' && (
                <div>
                  <input ref={createFileRef} type="file" accept=".csv,.xlsx,.xls,.parquet,.json,.tsv" style={_hs59}
                    onChange={handleFileSelected} />
                  {!selectedFile ? (
                    // No file yet → the drop zone.
                    <div
                      onClick={() => createFileRef.current?.click()}
                      style={{
                        border: '2px dashed #cbd5e1', borderRadius: 8, padding: '32px 20px', textAlign: 'center',
                        cursor: 'pointer', marginBottom: 12,
                        background: 'var(--bg-panel-alt)', transition: 'border-color 0.15s',
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--accent-primary)'}
                      onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--border-strong)'}
                    >
                      <TbUpload size={32} color="var(--text-disabled)" />
                      <div style={_hs61}>Click to select a file</div>
                      <div style={_hs62}>CSV, Excel, Parquet, JSON (max 500 Mo)</div>
                    </div>
                  ) : (
                    // File picked → a compact chip (name + remove) then the options.
                    // Removing the file restores the drop zone above.
                    <>
                      <div style={fileChipStyle}>
                        <TbFileText size={18} color="var(--accent-primary)" style={{ flexShrink: 0 }} />
                        <span style={fileChipNameStyle} title={selectedFile.name}>{selectedFile.name}</span>
                        <button
                          className="btn-hover"
                          onClick={() => { setSelectedFile(null); setUploadError(''); }}
                          disabled={uploadingFile}
                          title="Remove file"
                          style={fileChipRemoveStyle}
                        >
                          <DeleteIcon size={ICON_SIZE.modal} />
                        </button>
                      </div>
                      <ImportOptions value={importOpts} onChange={setImportOpts} kind={importKind(selectedFile.name)} sheetNames={sheetNames} />
                    </>
                  )}
                  {uploadError && <div style={_hs63}>{uploadError}</div>}
                  <div style={{ ...(_hs64), justifyContent: 'space-between', gap: 8 }}>
                    <button className="btn-hover" onClick={leaveCreateStep} style={secondaryBtn}>{modePreset ? 'Cancel' : '← Back'}</button>
                    {selectedFile && (() => {
                      // Block only when the sheets are known but none is ticked;
                      // if we couldn't read them, let the server pick the first.
                      const noSheets = importKind(selectedFile.name) === 'excel' && sheetNames.length > 0 && !(importOpts.sheets && importOpts.sheets.length);
                      const disabled = uploadingFile || noSheets;
                      return (
                        <button className="btn-hover btn-hover-primary" onClick={handleFileForReport} disabled={disabled} style={{ ...primaryBtn, opacity: disabled ? 0.6 : 1 }}>
                          {uploadingFile ? 'Importing…' : 'Import'}
                        </button>
                      );
                    })()}
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
                  onCancel={leaveCreateStep}
                />
              )}
            </Modal>
          )}

          {/* Reports grid */}
          {loading ? (
            <div style={_hs65}>Loading...</div>
          ) : wsReports.length === 0 ? (
            // Nothing to list, so the column carries the first step instead of
            // a sentence about its own emptiness. Same three choices the
            // dialog asks for, which is why picking one here skips that step.
            <div style={emptyState}>
              <p style={emptyTitle}>No reports in {wsName} yet</p>
              {canEdit ? (
                <>
                  <p style={emptySub}>Start from a file, a database, or a model you already have.</p>
                  <div style={emptyChoices}>
                    {models.length > 0 && (
                      <button className="btn-hover" onClick={() => openCreate('model')} style={sourceCard}>
                        <TbLayoutDashboard size={28} color="var(--accent-primary)" />
                        <span style={_hs50}>Existing Model</span>
                        <span style={_hs51}>Use a data model already configured</span>
                      </button>
                    )}
                    <button className="btn-hover" onClick={() => openCreate('file')} style={sourceCard}>
                      <TbUpload size={28} color="#16a34a" />
                      <span style={_hs52}>Import File</span>
                      <span style={_hs53}>CSV, Excel, Parquet, JSON</span>
                    </button>
                    <button className="btn-hover" onClick={() => openCreate('connection')} style={sourceCard}>
                      <TbDatabase size={28} color="#f59e0b" />
                      <span style={_hs54}>Connect Database</span>
                      <span style={_hs55}>Connect to a database</span>
                    </button>
                  </div>
                </>
              ) : (
                <p style={emptySub}>Nobody has shared a report here yet.</p>
              )}
            </div>
          ) : visibleReports.length === 0 ? (
            // Reports exist, the filter just matches none of them. Offering to
            // create one here would answer a question nobody asked — the way
            // out is dropping the filter, as on the other two stages.
            <div style={emptyState}>
              <p style={emptyTitle}>Nothing here for this filter</p>
              <p style={emptySub}>No report is built on it.</p>
              <button className="btn-hover btn-hover-primary" onClick={focus.clear} style={primaryBtn}>Show every report</button>
            </div>
          ) : (
            <div style={_hs67}>
              {visibleReports.map((report) => {
                const stats = cardCacheStats[report.id];
                const warming = cardWarmingIds.has(report.id);
                const menuOpen = cardMenu === report.id;
                const skin = report.is_public || menuOpen
                  ? { ...cardStyle, ...(report.is_public ? publicCardAccent : null), ...(menuOpen ? cardMenuOpen : null) }
                  : cardStyle;
                return (
                <div key={report.id} style={joinRowStyle}>
                <div className="journey-card" data-join-anchor={`reports:${report.id}`} style={skin}>
                  <div onClick={() => window.open(`/view/${report.id}`, '_blank')}
                    style={cardBody}>
                    <h3
                      title={report.title}
                      style={cardTitle}
                    >{report.title}</h3>
                    <div style={cardMeta}>
                      {report.model_name && (
                        // The pencil only renders when the user has edit rights
                        // AND the report carries a model_id (the workspaces list
                        // endpoint includes it — see server/routes/workspaces.js).
                        <>
                          <span style={metaModel}>
                            <span
                              style={metaModelName}
                              title={report.model_name}
                            >{report.model_name}</span>
                            {canEdit && report.model_id && (
                              <button
                                onClick={(e) => { e.stopPropagation(); navigate(`/models/${report.model_id}`); }}
                                title="Edit model"
                                style={metaModelEdit}
                                onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
                                onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.55'; }}
                              >
                                <EditIcon size={ICON_SIZE.chip} />
                              </button>
                            )}
                          </span>
                          <span style={metaDot}>·</span>
                        </>
                      )}
                      {typeof report.fileSize === 'number' && (
                        // Two byte counts can share this line (source file here,
                        // rollup cache after Last edit) — prefix both so they
                        // read unambiguously.
                        <>
                          <span
                            style={metaSize}
                            title={`Imported source file${report.sourceFile ? ` (${report.sourceFile})` : ''}`}
                          >{`file ${formatFileSize(report.fileSize)}`}</span>
                          <span style={metaDot}>·</span>
                        </>
                      )}
                      <span style={metaWhen}>Last edit {formatWhen(report.updated_at)}</span>
                      {/* Cache footprint for this report. Populated lazily —
                          only after the user clicks Refresh at least once,
                          so the report list itself loads fast. While a
                          refresh is in flight the size · rows segment is
                          replaced by a smoothly-advancing progress bar
                          (trickle driver above), then restored once the warm
                          finishes. Click → opens the per-widget breakdown. */}
                      {warming ? (
                        <>
                          <span style={metaDot}>·</span>
                          <div style={metaProgress}>
                            <span style={metaProgressLabel}>Refreshing data…</span>
                            {(() => {
                              const pct = Math.max(0, Math.min(100, cardWarmingDisplayPct[report.id] ?? 0));
                              return (
                                <div
                                  className="rollup-progress determinate"
                                  style={metaProgressTrack}
                                  aria-label="Refreshing data"
                                  role="progressbar"
                                  aria-valuenow={Math.round(pct)}
                                  aria-valuemin={0}
                                  aria-valuemax={100}
                                >
                                  <span style={{ width: `${pct}%` }} />
                                </div>
                              );
                            })()}
                          </div>
                        </>
                      ) : stats ? (
                        <>
                          <span style={metaDot}>·</span>
                          <span
                            onClick={(e) => { e.stopPropagation(); openCacheInspect(report.id, report.title, report.workspace_id); }}
                            style={cardCacheLink}
                            title={stats.builtAt
                              ? `Last refresh ${formatWhen(stats.builtAt)} — click to see the rollup storage breakdown`
                              : 'Click to see the rollup storage breakdown'}
                          >
                            {stats.rollupCount > 0
                              ? `cache ${formatBytes(stats.diskBytes || 0)} · ${(stats.totalRows || 0).toLocaleString()} rows`
                              : 'No cache — Refresh to build'}
                          </span>
                        </>
                      ) : null}
                    </div>
                  </div>
                  <div style={cardActions}>
                    <button onClick={() => window.open(`/view/${report.id}`, '_blank')} title="View" {...cardActionBtn('accent')}><TbEye size={16} /></button>
                    {canEdit && <button onClick={() => navigate(`/edit/${report.id}`)} title="Edit" {...cardActionBtn()}><EditIcon size={ICON_SIZE.card} /></button>}
                    {canEdit && (
                      <div style={cardMenuWrap}
                        ref={menuOpen ? cardMenuRef : null}>
                        <button
                          onClick={(e) => { e.stopPropagation(); setCardMenu(menuOpen ? null : report.id); }}
                          title="More actions"
                          {...cardActionBtn(menuOpen ? 'accent' : 'muted')}
                        >
                          <TbDotsVertical size={16} />
                        </button>
                        {menuOpen && (
                          <div style={cardMenuPanel}>
                            <button style={cardMenuItem}
                              onClick={() => { setCardMenu(null); setRenameModal({ report, value: report.title }); }}
                              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                              <EditIcon size={ICON_SIZE.modal} /> Rename
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
                            {/* Making a report public is gated by the instance
                                policy (admin setting); making it private again is
                                always allowed. The server enforces either way. */}
                            {canEdit && (report.is_public || canSharePublic) && (
                              <button style={cardMenuItem}
                                onClick={() => { setCardMenu(null); togglePublic(report); }}
                                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                                {report.is_public
                                  ? <><TbShareOff size={14} /> Make private</>
                                  : <><TbShare size={14} /> Share public link</>}
                              </button>
                            )}
                            {report.is_public && instance.publicSharingPolicy !== 'disabled' ? (
                              <button style={cardMenuItem}
                                onClick={() => {
                                  setCardMenu(null);
                                  const url = `${window.location.origin}/view/${report.id}`;
                                  navigator.clipboard?.writeText(url);
                                  toast(`Public link copied: ${url}`, 'success');
                                }}
                                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                                <TbLink size={14} /> Copy public link
                              </button>
                            ) : null}
                            {canEdit && (
                              <button style={cardMenuItem}
                                onClick={() => { setCardMenu(null); setEmbedModal(report); }}
                                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                                <TbCode size={14} /> Embed…
                              </button>
                            )}
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
                            {/* Threshold alerts live on the MODEL (the measures do),
                                but a report is where you notice a number worth
                                watching — this lands on the alerts page scoped to
                                this report's model, with it pre-picked for creation. */}
                            {canEdit && report.model_id && (
                              <button style={cardMenuItem}
                                onClick={() => { setCardMenu(null); navigate(`/alerts?modelId=${report.model_id}`); }}
                                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                                <TbBell size={14} /> Alerts…
                              </button>
                            )}
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
                            {(wsUserRole === 'admin' || activeOrgRole === 'admin' || user?.role === 'admin') && (
                              <>
                                <div style={cardMenuDivider} />
                                <button style={liveSwitchRow}
                                  onClick={() => toggleLiveMode(report)}
                                  onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                                  title={report.live_mode
                                    ? 'Live query: every widget queries the source database directly. Click to switch back to the rollup cache (default, faster).'
                                    : 'Rollup cache (default): widgets are served from pre-aggregated data. Click to switch to live source queries.'}>
                                  <span style={liveSwitchSide(!report.live_mode)}>Rollup cache</span>
                                  {report.live_mode
                                    ? <TbToggleRightFilled size={20} style={liveToggleOn} />
                                    : <TbToggleLeftFilled size={20} style={liveToggleOff} />}
                                  <span style={liveSwitchSide(!!report.live_mode)}>Live query</span>
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                    {/* Delete sat pinned to the card's top-right corner; in a
                        single row that corner is where the actions now are.
                        Last in the group, so the destructive one isn't the
                        neighbour of View. */}
                    {canEdit && (
                      <ConfirmDeleteButton
                        variant="icon"
                        label="Delete report"
                        onConfirm={() => deleteReport(report.id)}
                      />
                    )}
                  </div>
                </div>
                </div>
                );
              })}
            </div>
          )}
        </main>
      </div>

      {/* Rename modal */}
      {renameModal && (
        <Modal onClose={() => setRenameModal(null)}>
          <div style={actionModalTitle}>Rename report</div>
          <input autoFocus value={renameModal.value}
            onChange={(e) => setRenameModal({ ...renameModal, value: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter') submitRename(); }}
            style={actionModalInput} placeholder="Report title" />
          <div style={actionModalActions}>
            <button className="btn-hover" style={actionModalBtnSecondary} onClick={() => setRenameModal(null)}>Cancel</button>
            <button className="btn-hover btn-hover-primary" style={actionModalBtnPrimary} onClick={submitRename} disabled={!renameModal.value.trim()}>Save</button>
          </div>
        </Modal>
      )}

      {/* Move modal */}
      {moveModal && (
        <Modal onClose={() => setMoveModal(null)}>
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
      </Modal>
      )}

      {askRestore && (
        <ConfirmDialog
          title="Restore this version?"
          body="The current state is saved as a new history entry first, so this rollback is itself reversible."
          confirmLabel="Restore"
          onConfirm={() => restoreVersion(askRestore)}
          onCancel={() => setAskRestore(null)}
        />
      )}

      {/* History modal — admin only. Lists snapshots; restoring one snapshots
          the current state first so the rollback is itself reversible. */}
      {historyModal && (
        <Modal onClose={() => setHistoryModal(null)} width={520}>
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
                  <button className="btn-hover btn-hover-accent" style={historyRestoreBtn} onClick={() => setAskRestore(v.id)} title="Restore this version">
                    <TbArrowBackUp size={14} /> Restore
                  </button>
                </div>
              ))}
            </div>
          )}
          <div style={actionModalActions}>
            <button className="btn-hover" style={actionModalBtnSecondary} onClick={() => setHistoryModal(null)}>Close</button>
          </div>
      </Modal>
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

      {/* Embed token dialog — mints a signed URL/iframe for one report. */}
      {embedModal && (
        <EmbedDialog report={embedModal} onClose={() => setEmbedModal(null)} />
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
        <Portal>
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
        </Portal>
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

const primaryBtn = { padding: '8px 16px', fontSize: 13, fontWeight: 600, border: 'none', borderRadius: 6, background: 'var(--accent-primary)', color: '#fff', cursor: 'pointer' };
const secondaryBtn = { padding: '8px 16px', fontSize: 13, background: 'var(--bg-panel)', color: 'var(--text-secondary)', border: '1px solid var(--border-default)', borderRadius: 6, cursor: 'pointer' };
const fileChipStyle = { display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', marginBottom: 12, borderRadius: 8, border: '1px solid var(--border-default)', background: 'var(--bg-panel-alt)' };
const fileChipNameStyle = { flex: 1, minWidth: 0, fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const fileChipRemoveStyle = { display: 'inline-flex', alignItems: 'center', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 4, borderRadius: 6, flexShrink: 0 };

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
// Data-source footer of the card menu: a switch with BOTH labels around
// it ("Rollup cache ⟷ Live query"), pinned last under a divider. The
// switch points at the active side and that label is emphasised — the
// either/or is visible without an action-style item that hides the
// alternative. Clicking keeps the menu open so the flip is seen.
const cardMenuDivider = { height: 1, margin: '4px 0', background: 'var(--border-default)' };
const liveSwitchRow = {
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  padding: '7px 12px', fontSize: 12,
  background: 'transparent', border: 'none', borderRadius: 4,
  cursor: 'pointer', whiteSpace: 'nowrap', transition: 'background 0.12s',
};
const liveSwitchSide = (active) => ({
  color: active ? 'var(--text-primary)' : 'var(--text-muted)',
  fontWeight: active ? 600 : 400,
});
const liveToggleOn = { color: 'var(--accent-primary)', flexShrink: 0 };
const liveToggleOff = { color: 'var(--text-muted)', flexShrink: 0 };

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

// Short date + time. The full toLocaleString() spends a third of the meta line
// on seconds nobody reads, and that line now has to hold the model, the size
// and the cache footprint too.
function formatWhen(value) {
  return new Date(value).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

function formatFileSize(bytes) {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
const inputStyle = { width: '100%', padding: '8px 10px', border: '1px solid var(--border-default)', borderRadius: 6, fontSize: 13, outline: 'none', boxSizing: 'border-box', background: 'var(--bg-panel)', color: 'var(--text-primary)' };
const labelStyle = { display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4, fontWeight: 500 };
const sourceCard = {
  flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
  padding: '20px 12px', border: '1px solid var(--border-default)', borderRadius: 8, background: 'var(--bg-panel)',
  cursor: 'pointer', textAlign: 'center', transition: 'all 0.15s', color: 'var(--text-primary)',
};

// Mint a signed embed URL/iframe for one report. The token carries an optional
// RLS identity (email) and an expiry; generation requires write access to the
// report's model — the server enforces it, we just surface its message.
// Rendered through a portal: an ancestor in the dashboard tree carries a
// transform, which turns position:fixed into "fixed to that ancestor" and
// shoves the centered panel off-screen.
function EmbedDialog({ report, onClose }) {
  const [email, setEmail] = useState('');
  const [expiresIn, setExpiresIn] = useState(30 * 24 * 3600);
  const [result, setResult] = useState(null); // { url, expiresAt }
  const [generating, setGenerating] = useState(false);

  const generate = async () => {
    setGenerating(true);
    try {
      const res = await api.post(`/reports/${report.id}/embed-token`, {
        email: email.trim() || undefined,
        expiresIn,
      });
      // Build the URL from the browser's own origin: behind the dev proxy
      // (and some reverse proxies) the server sees a rewritten Host and
      // would print an internal one.
      setResult({ ...res.data, url: `${window.location.origin}/embed/${report.id}?token=${encodeURIComponent(res.data.token)}` });
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to create the embed link');
    } finally {
      setGenerating(false);
    }
  };

  const copy = (text, what) => {
    navigator.clipboard?.writeText(text);
    toast(`${what} copied`, 'success');
  };
  const iframeSnippet = result
    ? `<iframe src="${result.url}" width="100%" height="600" frameborder="0"></iframe>`
    : '';

  return createPortal(
    <div style={embedOverlay} onClick={onClose}>
      <div style={embedPanel} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 2 }}>Embed report</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14 }}>{report.title}</div>

        <label style={labelStyle}>Row-level security identity (optional email)</label>
        <input
          placeholder="viewer@customer.com — leave empty for no identity"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{ ...inputStyle, marginBottom: 10 }}
        />
        <label style={labelStyle}>Link expires after</label>
        <select value={expiresIn} onChange={(e) => setExpiresIn(Number(e.target.value))} style={{ ...inputStyle, marginBottom: 14 }}>
          <option value={3600}>1 hour</option>
          <option value={24 * 3600}>24 hours</option>
          <option value={30 * 24 * 3600}>30 days</option>
          <option value={365 * 24 * 3600}>1 year</option>
        </select>
        <div style={{ fontSize: 11, color: 'var(--text-disabled)', marginBottom: 14 }}>
          The identity feeds row-level security exactly like a signed-in viewer — with RLS enabled
          and no identity, the embed shows no rows. Anyone holding the link sees the report until it expires.
        </div>

        {result && (
          <>
            <label style={labelStyle}>Embed URL</label>
            <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
              <input readOnly value={result.url} style={{ ...inputStyle, fontSize: 11 }} onFocus={(e) => e.target.select()} />
              <button className="btn-hover" style={embedCopyBtn} onClick={() => copy(result.url, 'URL')}>Copy</button>
            </div>
            <label style={labelStyle}>Iframe snippet</label>
            <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
              <textarea readOnly value={iframeSnippet} rows={3} style={{ ...inputStyle, fontSize: 11, fontFamily: 'monospace', resize: 'none' }} onFocus={(e) => e.target.select()} />
              <button className="btn-hover" style={embedCopyBtn} onClick={() => copy(iframeSnippet, 'Snippet')}>Copy</button>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-disabled)', marginBottom: 8 }}>
              Expires {new Date(result.expiresAt).toLocaleString()}
            </div>
          </>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
          <button className="btn-hover" style={embedSecondaryBtn} onClick={onClose}>Close</button>
          <button
            className="btn-hover btn-hover-primary"
            style={embedPrimaryBtn}
            onClick={generate}
            disabled={generating}
          >{generating ? 'Generating…' : result ? 'Generate new link' : 'Generate link'}</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

const embedOverlay = {
  position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 300,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};
const embedPanel = {
  width: 520, maxWidth: '92vw', maxHeight: '90vh', overflowY: 'auto',
  background: 'var(--bg-panel)', border: '1px solid var(--border-default)',
  borderRadius: 10, padding: 20, boxShadow: '0 8px 30px rgba(0,0,0,0.2)',
};
const embedPrimaryBtn = { padding: '8px 14px', fontSize: 13, fontWeight: 600, border: 'none', borderRadius: 6, background: 'var(--accent-primary)', color: '#fff', cursor: 'pointer' };
const embedSecondaryBtn = { padding: '8px 14px', fontSize: 13, background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border-default)', borderRadius: 6, cursor: 'pointer' };
const embedCopyBtn = { padding: '6px 12px', fontSize: 12, background: 'transparent', color: 'var(--accent-primary)', border: '1px solid var(--border-default)', borderRadius: 6, cursor: 'pointer', flexShrink: 0 };

