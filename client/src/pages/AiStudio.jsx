import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate, useBlocker } from 'react-router-dom';
import { TbArrowLeft, TbPencil, TbExternalLink, TbHelp, TbArrowBackUp, TbArrowForwardUp, TbDeviceFloppy } from 'react-icons/tb';
import api from '../utils/api';
import { toast } from '../components/Toast/toast';
import Viewer from './Viewer';
import AiPanel from '../components/AiPanel/AiPanel';
import StartConversation from '../components/AiPanel/StartConversation';
import Modal from '../components/Modal/Modal';
import { WIDGET_TYPES } from '../components/Widgets';
import { useTheme } from '../hooks/useTheme';
import { useHistory } from '../hooks/useHistory';
import { CHART_COLORS } from '../utils/chartPalette';
import { applyWidgetsProposal, applyDesignToPages, applyReportChanges, applyVisualProposal, buildPageContext, withMeasureFormats } from '../utils/aiProposal';
import { pagesFromProposal } from '../utils/proposedReport';
import { snapshotPage, settled, contactSheet } from '../utils/pageSnapshot';
import { useDiscardDraftOnExit } from '../hooks/useDiscardDraftOnExit';
import { useAuth } from '../hooks/useAuth';
import { useGraph } from '../hooks/graphContext';
import { usePermissions } from '../hooks/usePermissions';
import { useIsCompact } from '../hooks/useMediaQuery';
import { takeHandOver } from '../utils/assistantHandoff';
import { acceptFiles } from '../utils/importFiles';
import { homeOf } from '../utils/uiMode';
import ModeSwitch from '../components/AppShell/ModeSwitch';
import WorkspacePicker from '../components/AppShell/WorkspacePicker';
import UserMenu from '../components/AppShell/UserMenu';
import { TopbarSwitcher } from '../cloud';

// The AI studio: the assistant on the left, the report as its readers see it
// on the right. Every card applied here changes a working copy of the report
// that the viewer shows at once — undone and redone like the editor's
// gestures (Ctrl+Z / Ctrl+Y, the two buttons in the bar) — and Save writes it
// to the report itself, the same document the editor saves. Leaving with
// changes in hand asks first. Edit opens the editor on the result whenever
// hand work is wanted.
//
// The same screen is the home of the chat face of the app (`/chat`, no
// report yet): the panel then holds the conversation that leads to a report
// (StartConversation — questions with choices, files dropped anywhere on the
// screen) and the right side waits for it. Once the report exists the studio
// goes on at `/studio/:id`, nothing moving.
const PAGE = { width: 1140, height: 800 };
const shellStyle = (over) => ({
  display: 'flex', height: '100vh', background: 'var(--bg-app)', color: 'var(--text-primary)',
  outline: over ? '3px dashed var(--accent-primary)' : 'none', outlineOffset: -8, transition: 'outline-color 0.15s',
});
const rightStyle = { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' };
const barStyle = { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderBottom: '1px solid var(--border-default)', background: 'var(--bg-panel)' };
const titleStyle = { flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
const spacerStyle = { flex: 1 };
const tagStyle = { fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--accent-primary)', background: 'var(--accent-primary-soft)', padding: '2px 7px', borderRadius: 999 };
const btn = { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', fontSize: 12, borderRadius: 6, border: '1px solid var(--border-default)', background: 'var(--bg-panel)', color: 'var(--text-secondary)', cursor: 'pointer' };
const primaryBtn = { ...btn, border: 'none', background: 'var(--accent-primary)', color: '#fff', fontWeight: 600 };
const quietBtn = { ...btn, border: 'none', background: 'transparent' };
const iconBtn = (enabled) => ({ ...btn, padding: '5px 7px', opacity: enabled ? 1 : 0.4, cursor: enabled ? 'pointer' : 'default' });
const saveBtn = (dirty) => (dirty ? primaryBtn : { ...btn, opacity: 0.5, cursor: 'default' });
const savedStyle = { fontSize: 12, color: 'var(--state-success)' };
const emptyStyle = { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 14, textAlign: 'center', padding: 24 };
const viewerWrap = { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' };
const leaveTitle = { margin: '0 0 8px', fontSize: 16, fontWeight: 600 };
const leaveText = { margin: '0 0 16px', fontSize: 13, lineHeight: 1.5, color: 'var(--text-secondary)' };
const leaveActions = { display: 'flex', justifyContent: 'flex-end', gap: 8 };

// Before a report exists the panel has no page to show the assistant.
const NO_MODEL = { dimensions: [], measures: [], dateColumn: null };
const noPage = () => ({});
const noProposal = async () => null;

// The report's pages, from a document saved with or without them.
const pagesOf = (doc) => (Array.isArray(doc.settings?.pages) && doc.settings.pages.length
  ? doc.settings.pages
  : [{ id: 'page-1', name: 'Page 1', layout: doc.layout || [], widgets: doc.widgets || {} }]);

// The page a report change lands on when it leaves the page shown alone:
// { idx } for another page, { isNew } for one it adds; null otherwise.
// A card that reached several pages: its review sees the whole report too.
function reachesSeveral(proposal) {
  if (proposal.kind === 'report') return true;
  if (proposal.kind === 'reportChanges') return (proposal.pages || []).length > 1;
  return proposal.kind === 'design' && (proposal.ops || []).some((op) => op.pageId || op.op === 'report_settings' || op.op === 'page_nav');
}

function otherPageOf(proposal, pages, shownIdx) {
  if (proposal.kind !== 'reportChanges') return null;
  const touched = (proposal.pages || []).filter((p) => !p.remove);
  if (!touched.length || touched.some((p) => p.shown)) return null;
  if (touched[0].isNew) return { isNew: true };
  const idx = pages.findIndex((p) => p.id === touched[0].pageId);
  return idx >= 0 && idx !== shownIdx ? { idx } : null;
}

// What Save writes, and what tells a working copy from the saved report.
const bodyOf = (doc) => ({ title: doc.title, layout: doc.layout, widgets: doc.widgets, settings: doc.settings });
const snapshot = (doc) => JSON.stringify(bodyOf(doc));

// The model as the report sees it: its own extras and overrides merged in,
// the same merge the editor and the viewer perform.
function effectiveModelOf(model, settings) {
  if (!model) return NO_MODEL;
  const s = settings || {};
  const over = (list, overrides) => (list || []).map((f) => (overrides?.[f.name] ? { ...f, ...overrides[f.name] } : f));
  // The model itself first (its id above all: the cards' previews query by it).
  return {
    ...model,
    dimensions: [...over(model.dimensions, s.dimensionOverrides), ...(s.extraDimensions || [])],
    measures: [...over(model.measures, s.measureOverrides), ...(s.extraMeasures || [])],
    dateColumn: model.dateColumn || null,
  };
}

// Typing in a box keeps the browser's own undo; the shortcuts are the report's elsewhere.
const inField = (el) => !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);

// One studio per report (`id`; none on `/chat`: the conversation before a
// report exists). Keyed by AiStudio below, so a new report is a new studio.
function Studio({ id }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { themes: availableThemes } = useTheme();
  const compact = useIsCompact();
  const { selectedWs, currentWsRole } = useGraph();
  const { canEdit, canEditOrg } = usePermissions(selectedWs, user, currentWsRole);
  // The working copy: { title, layout, widgets, settings, workspace_id, model_id, … }, one step per card applied.
  const history = useHistory(null);
  const doc = history.state;
  // The working copy as last rendered: a review reads its pages after a card changed them.
  const docRef = useRef(doc);
  docRef.current = doc;
  const [model, setModel] = useState(null);
  const [aiStatus, setAiStatus] = useState(null);
  const [error, setError] = useState(null);
  const [pageIdx, setPageIdx] = useState(0);
  // Bumped whenever the working copy changes, so the viewer draws it again.
  const [version, setVersion] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState(null);
  // The report as last written: the working copy is dirty when it differs.
  const savedRef = useRef('');
  // The title the app or the assistant gave, until someone types another.
  const givenTitleRef = useRef(null);
  const [savedTick, setSavedTick] = useState(0);
  // Handed over by the conversation before the report: the request typed there.
  const [initialRequest, setInitialRequest] = useState('');
  // Dropped anywhere on the screen before a report exists, listed in the panel.
  const [files, setFiles] = useState([]);
  const [fileOver, setFileOver] = useState(false);
  const draft = useDiscardDraftOnExit(id);
  const starting = !id;

  useEffect(() => {
    if (!id) return undefined;
    let stale = false;
    (async () => {
      try {
        const res = await api.get(`/reports/${id}`);
        const r = res.data.report;
        if (stale) return;
        draft.markLoaded(r);
        setInitialRequest(takeHandOver('report', id) || '');
        const loaded = { title: r.title, layout: r.layout || [], widgets: r.widgets || {}, settings: r.settings || {}, workspace_id: r.workspace_id, model_id: r.model_id, can_edit: r.can_edit, live_mode: r.live_mode };
        savedRef.current = snapshot(loaded);
        // A draft's title is the app's (files, a card), never typed: Save frees it.
        givenTitleRef.current = r.draft ? r.title : null;
        history.reset(loaded);
        if (r.model_id) {
          const m = await api.get(`/models/${r.model_id}`);
          if (!stale) setModel(m.data.model);
        }
      } catch (err) {
        if (!stale) setError(err.response?.data?.error || 'Report not found');
      }
    })();
    return () => { stale = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `draft` and `history` are stable hook handles
  }, [id]);

  const refreshAiStatus = useCallback(() => api.get('/ai/status').then((res) => setAiStatus(res.data)).catch(() => setAiStatus({ enabled: false })), []);
  // A card added a file to the model: its new fields are read again, for the cards' previews.
  const reloadModel = useCallback(() => {
    if (doc?.model_id) api.get(`/models/${doc.model_id}`).then((m) => setModel(m.data.model)).catch(() => { /* the next turn reads it from the server anyway */ });
  }, [doc?.model_id]);
  useEffect(() => { refreshAiStatus(); }, [refreshAiStatus]);

  const effectiveModel = useMemo(() => effectiveModelOf(model, doc?.settings), [model, doc?.settings]);
  const pages = doc ? pagesOf(doc) : [];
  const shownIdx = Math.min(pageIdx, Math.max(0, pages.length - 1));
  const page = pages[shownIdx] || { layout: [], widgets: {} };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `savedTick` says the saved snapshot changed
  const dirty = useMemo(() => !!doc && snapshot(doc) !== savedRef.current, [doc, savedTick]);
  const workingCopy = useMemo(() => (doc ? { id, ...doc } : null), [doc, id]);

  // What the assistant is shown: the page open on the right, as it stands,
  // and the look of the report's other pages (a style request is about the
  // whole report).
  const pageStateRef = useRef(null);
  pageStateRef.current = {
    layout: page.layout || [], widgets: page.widgets || {}, settings: doc?.settings || {},
    otherPages: pages.filter((_, i) => i !== shownIdx),
    pageId: page.id || null, pageName: page.name || '',
    themes: availableThemes, palette: CHART_COLORS,
    pageWidth: doc?.settings?.pageWidth || PAGE.width, pageHeight: doc?.settings?.pageHeight || PAGE.height,
  };
  const getPageContext = useCallback(() => buildPageContext(pageStateRef.current), []);

  // A change of the working copy: one undo step, drawn at once.
  const change = useCallback((next) => {
    history.set(next);
    setVersion((v) => v + 1);
  }, [history]);
  const undo = useCallback(() => { if (history.canUndo) { history.undo(); setVersion((v) => v + 1); } }, [history]);
  const redo = useCallback(() => { if (history.canRedo) { history.redo(); setVersion((v) => v + 1); } }, [history]);

  // Save writes the working copy to the report; a blank draft becomes a report.
  const save = useCallback(async () => {
    if (!doc || !dirty || saving) return false;
    setSaving(true);
    try {
      // A title the app or a card gave: a taken one becomes "… (2)" rather than a refusal.
      const res = await api.put(`/reports/${id}`, { ...bodyOf(doc), ...(doc.title && doc.title === givenTitleRef.current ? { autoTitle: true } : {}) });
      const savedTitle = res.data?.report?.title;
      const kept = savedTitle && savedTitle !== doc.title ? { ...doc, title: savedTitle } : doc;
      if (kept !== doc) { history.set(kept); givenTitleRef.current = savedTitle; }
      savedRef.current = snapshot(kept);
      setSavedTick((t) => t + 1);
      draft.markLoaded({ draft: false });
      setSaveMsg('Saved');
      setTimeout(() => setSaveMsg(null), 2000);
      return true;
    } catch (err) {
      toast(err.response?.data?.error || 'The report could not be saved');
      return false;
    } finally {
      setSaving(false);
    }
  }, [doc, dirty, saving, id, draft]);

  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key === 's') { e.preventDefault(); save(); return; }
      if (inField(e.target)) return;
      if (key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (key === 'y' || (key === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save, undo, redo]);

  // Changes in hand are not lost unasked: the browser's own prompt on a
  // close or reload, ours on a move within the app.
  useEffect(() => {
    if (!dirty) return undefined;
    const handler = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  const saveAndLeave = async () => { if (await save()) blocker.proceed?.(); else blocker.reset?.(); };

  const withPage = (current, idx, patch) => {
    const list = pagesOf(current).map((p, i) => (i === idx ? { ...p, ...patch } : p));
    return { ...current, layout: list[0].layout, widgets: list[0].widgets, settings: { ...current.settings, pages: list } };
  };

  // A widget moved or resized by hand on the page: one undo step, the viewer
  // already showing it — no reload, so nothing is queried again. The
  // assistant's next request reads the page as the author left it.
  const editLayout = useCallback((idx, layout) => {
    if (!doc) return;
    history.set(withPage(doc, idx, { layout }));
  }, [doc, history]);

  const applyOnce = useCallback(async (proposal) => {
    if (!doc) return null;
    const idx = Math.min(pageIdx, pagesOf(doc).length - 1);
    const state = pageStateRef.current;
    // Measures a card defines go on the model when this user may write it
    // (then everyone reading the report has them), else on the report itself.
    const keepMeasures = async (settings) => {
      // A measure defined again (`redefines`: the assistant fixing one it made) replaces it.
      const measures = Array.isArray(proposal.measures)
        ? proposal.measures.filter((m) => m.redefines || !effectiveModel.measures.some((x) => x.name === m.name))
          .map((m) => Object.fromEntries(Object.entries(m).filter(([k]) => k !== 'redefines')))
        : [];
      const others = (list) => (list || []).filter((m) => !measures.some((x) => x.name === m.name));
      if (!measures.length) return { settings, measures };
      if (model?.access === 'edit' || model?.access === 'manage') {
        // On the model as saved now: the model assistant may have written since this copy was read.
        let current = model.measures || [];
        try { current = (await api.get(`/models/${doc.model_id}`)).data.model.measures || current; } catch { /* unreadable now: the copy in hand */ }
        const saved = (await api.put(`/models/${doc.model_id}`, { measures: [...current.filter((m) => !measures.some((x) => x.name === m.name)), ...measures] })).data.model;
        // The row written, but still with the rights the GET computed: without
        // `access` the next card's measures went to the report instead of the model.
        setModel({ ...model, ...(saved || {}), access: model.access, measures: [...others(model.measures), ...measures] });
        return { settings, measures };
      }
      return { settings: { ...settings, extraMeasures: [...others(settings?.extraMeasures), ...measures] }, measures };
    };
    try {
      if (proposal.kind === 'report') {
        const { settings } = await keepMeasures(doc.settings);
        const added = pagesFromProposal(proposal);
        // A blank report takes the pages as its own; a report with content gets them after its pages.
        const current = pagesOf(doc);
        const blank = current.length === 1 && !(current[0].layout || []).length;
        const list = blank ? added : [...current, ...added];
        const title = blank && proposal.title ? proposal.title : doc.title;
        if (title !== doc.title) givenTitleRef.current = title;
        // A blank report takes the height its pages need; one with content keeps its own.
        const pageHeight = blank ? Math.max(state.pageHeight, Number(proposal.pageHeight) || 0) : state.pageHeight;
        change({ ...doc, title, layout: list[0].layout, widgets: list[0].widgets, settings: withMeasureFormats({ ...settings, pages: list, pageWidth: state.pageWidth, pageHeight }, proposal) });
        return { note: `${added.length} page${added.length > 1 ? 's' : ''} added to the report.`, createdIdx: blank ? 0 : current.length };
      }
      if (proposal.kind === 'customVisual') {
        // The visual joins the workspace library at once; the page waits for Save.
        const res = await api.post(`/workspaces/${doc.workspace_id}/visuals/generated`, { manifest: proposal.manifest, visualJs: proposal.visualJs });
        const result = applyVisualProposal(proposal, res.data.visual, doc.workspace_id, { ...state, effectiveModel, widgetTypes: WIDGET_TYPES });
        if (result.error) { toast(result.error); return { note: 'Added to the library, but not to the page.' }; }
        change(withPage(doc, idx, { layout: result.layout, widgets: result.widgets }));
        return { note: 'Added to the workspace library and to the page.' };
      }
      if (proposal.kind === 'reportChanges') {
        // The report as a whole: pages added, visuals replaced, removed, laid out again — one undo step.
        const { settings, measures } = await keepMeasures(doc.settings);
        const withNew = measures.length ? { ...effectiveModel, measures: [...effectiveModel.measures.filter((m) => !measures.some((x) => x.name === m.name)), ...measures] } : effectiveModel;
        const result = applyReportChanges(proposal, { pages: pagesOf(doc), currentIdx: idx, pageWidth: state.pageWidth, pageHeight: state.pageHeight, effectiveModel: withNew, widgetTypes: WIDGET_TYPES, title: doc.title });
        if (result.error) { toast(result.error); return null; }
        const title = proposal.title && proposal.title !== doc.title ? proposal.title : null;
        if (title) givenTitleRef.current = title;
        if (!result.applied && !measures.length && !title) { toast('None of these changes fits the report any more'); return null; }
        const list = result.pages;
        const pageHeight = Math.max(state.pageHeight, Number(proposal.pageHeight) || 0);
        change({ ...doc, ...(title ? { title } : {}), layout: list[0].layout, widgets: list[0].widgets, settings: withMeasureFormats({ ...settings, pages: list, pageHeight }, proposal) });
        if (idx >= list.length) setPageIdx(list.length - 1);
        // The first page the card created, for its review.
        const before = new Set(pagesOf(doc).map((p) => p.id));
        const created = list.findIndex((p) => !before.has(p.id));
        return { note: `Applied${result.skipped ? ` (${result.skipped} no longer applicable)` : ''}.`, ...(created >= 0 ? { createdIdx: created } : {}) };
      }
      if (proposal.kind === 'design') {
        // Every page the proposal touches, in one undo step.
        const result = applyDesignToPages(proposal, { pages: pagesOf(doc), currentIdx: idx, settings: doc.settings, pageWidth: state.pageWidth, pageHeight: state.pageHeight, themes: state.themes });
        if (!result.applied) { toast('None of these changes fits the report any more'); return null; }
        const list = result.pages;
        change({ ...doc, layout: list[0].layout, widgets: list[0].widgets, settings: { ...(result.settings || doc.settings), pages: list } });
        return { note: `Applied${result.skipped ? ` (${result.skipped} no longer applicable)` : ''}.` };
      }
      const result = applyWidgetsProposal(proposal, { ...state, effectiveModel, widgetTypes: WIDGET_TYPES });
      if (result.error) { toast(result.error); return null; }
      const next = withPage(doc, idx, { layout: result.layout, widgets: result.widgets });
      change({ ...next, settings: withMeasureFormats(next.settings, proposal) });
      return { note: 'Added to the page.' };
    } catch (err) {
      toast(err.response?.data?.error || 'The visual could not be added');
      return null;
    }
  }, [doc, pageIdx, effectiveModel, change, model]);

  // The page node the embedded viewer draws into, captured for the review.
  const pageNodeRef = useRef(null);
  // The page menu, drawn beside the page in the review's pictures.
  const navNodeRef = useRef(null);
  // A change that lands on the page shown is reviewed by the assistant: the
  // page as it was and as it is now go back to it with the card's outcome
  // (AiPanel sends them). Asked by Jonathan: it should see what it did and
  // say when it is bad. Values masked when the instance shares no data.
  //
  // A card that changes another page than the one shown (or adds one) is
  // reviewed on THAT page: the studio turns to it first. Reviewing the page
  // shown, untouched, it said "the page is the same before and after" (seen
  // with Karim). A page the card creates has no before: one picture goes.
  const [showPage, setShowPage] = useState(null);
  const turnTo = async (idx) => {
    setShowPage({ idx, at: Date.now() });
    await new Promise((resolve) => setTimeout(resolve, 50));
    await settled(pageNodeRef.current);
  };
  const applyProposal = useCallback(async (proposal) => {
    const onPage = ['widgets', 'design', 'reportChanges'].includes(proposal.kind);
    const shotOptions = () => ({ mask: aiStatus?.dataSharing !== 'schema+cache', nav: navNodeRef.current });
    // Every page in small, then back to the page under review.
    const withSheet = async (images, backTo) => {
      const count = pagesOf(docRef.current || {}).length;
      if (!reachesSeveral(proposal) || count < 2) return { images };
      const shots = [];
      for (let i = 0; i < count; i++) {
        await turnTo(i);
        shots.push(await snapshotPage(pageNodeRef.current, { ...shotOptions(), width: count <= 4 ? 720 : 480 }));
      }
      await turnTo(backTo);
      const sheet = await contactSheet(shots);
      return sheet ? { images: [...images, sheet], sheet: true } : { images };
    };
    // A whole report: its first page, once drawn, goes to the designer for the
    // look of every page (server REVIEW_NEW_REPORT) — it kept the defaults.
    if (proposal.kind === 'report') {
      const result = await applyOnce(proposal);
      if (!result) return result;
      await turnTo(result.createdIdx || 0);
      const first = await snapshotPage(pageNodeRef.current, shotOptions());
      return first ? { ...result, review: { ...(await withSheet([first], result.createdIdx || 0)), of: 'report' } } : result;
    }
    const target = otherPageOf(proposal, pagesOf(doc), shownIdx);
    if (target && target.idx !== undefined) await turnTo(target.idx);
    const before = onPage && !target?.isNew ? await snapshotPage(pageNodeRef.current, shotOptions()) : null;
    const result = await applyOnce(proposal);
    if (!result || (!before && !target?.isNew)) return result;
    if (target?.isNew) {
      if (result.createdIdx === undefined) return result;
      await turnTo(result.createdIdx);
    } else {
      // Drawn, then its data fetched and the charts settled.
      await settled(pageNodeRef.current);
    }
    const after = await snapshotPage(pageNodeRef.current, shotOptions());
    const reviewed = target?.isNew ? result.createdIdx : target?.idx ?? shownIdx;
    // The page in small is captured only once the author asks for the review
    // (AiPanel): turning every page over after each card was for nothing when
    // they did not.
    const images = before ? [before, after] : [after];
    return after ? { ...result, review: { images, complete: () => withSheet(images, reviewed) } } : result;
  }, [applyOnce, aiStatus, doc, shownIdx]);

  // Files dropped anywhere on the screen, before a report exists.
  const draggingFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');
  const dropZone = starting && canEdit ? {
    onDragOver: (e) => { if (!draggingFiles(e)) return; e.preventDefault(); setFileOver(true); },
    onDragLeave: (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setFileOver(false); },
    onDrop: (e) => { if (!draggingFiles(e)) return; e.preventDefault(); setFileOver(false); setFiles((prev) => acceptFiles(prev, e.dataTransfer.files)); },
  } : {};

  if (error) return <main style={shellStyle(false)}><div style={emptyStyle}>{error}</div></main>;
  if (!aiStatus || (!starting && !doc)) return <main style={shellStyle(false)}><div style={emptyStyle}>Loading…</div></main>;
  const aiAvailable = aiStatus.enabled || aiStatus.reason === 'setup';
  const home = homeOf(user);

  return (
    <main style={shellStyle(fileOver)} {...dropZone}>
      {starting ? (
        <AiPanel reportId={null} model={NO_MODEL} widgets={{}} settings={{}} status={aiStatus} onStatusChange={refreshAiStatus}
          getPageContext={noPage} onApplyProposal={noProposal} studio>
          <StartConversation files={files} onFiles={setFiles} aiStatus={aiStatus} />
        </AiPanel>
      ) : aiAvailable && doc.model_id ? (
        <AiPanel
          reportId={id}
          model={effectiveModel}
          widgets={page.widgets || {}}
          settings={doc.settings}
          status={aiStatus}
          onStatusChange={refreshAiStatus}
          getPageContext={getPageContext}
          onApplyProposal={applyProposal}
          onUndo={undo}
          studio
          initialRequest={initialRequest}
          onModelChanged={reloadModel}
          modelId={doc.model_id}
          modelEditable={model?.access === 'edit' || model?.access === 'manage'}
          onClose={() => navigate(home)}
        />
      ) : null}
      <div style={rightStyle}>
        <div style={barStyle}>
          {!starting && (
            <button type="button" style={btn} onClick={() => navigate(home)} title="Back"><TbArrowLeft size={14} /> {home === '/chat' ? 'Chat' : 'Reports'}</button>
          )}
          <ModeSwitch mode={home === '/chat' ? 'chat' : 'build'} compact={compact} />
          {starting ? (
            <>
              <WorkspacePicker canCreate={canEditOrg} />
              <span style={spacerStyle} />
            </>
          ) : (
            <>
              <span style={titleStyle}>{doc.title}</span>
              <span style={tagStyle}>AI studio</span>
              {doc.can_edit !== false && (
                <>
                  <button type="button" style={iconBtn(history.canUndo)} onClick={undo} disabled={!history.canUndo} title="Undo (Ctrl+Z)" aria-label="Undo"><TbArrowBackUp size={15} /></button>
                  <button type="button" style={iconBtn(history.canRedo)} onClick={redo} disabled={!history.canRedo} title="Redo (Ctrl+Y)" aria-label="Redo"><TbArrowForwardUp size={15} /></button>
                  {saveMsg && <span style={savedStyle}>{saveMsg}</span>}
                  <button type="button" style={saveBtn(dirty && !saving)} onClick={save} disabled={!dirty || saving} title="Save the report (Ctrl+S)">
                    <TbDeviceFloppy size={14} /> {saving ? 'Saving…' : 'Save'}
                  </button>
                </>
              )}
              <button type="button" style={btn} onClick={() => navigate(`/view/${id}`)} title="Open the report as readers see it"><TbExternalLink size={14} /> View</button>
              {doc.can_edit !== false && (
                <button type="button" style={btn} onClick={() => navigate(`/edit/${id}`)} title="Continue by hand in the editor"><TbPencil size={14} /> Edit</button>
              )}
            </>
          )}
          <button type="button" style={quietBtn} onClick={() => navigate('/help')} title="Help: the user guide" aria-label="Help">
            <TbHelp size={15} />{!compact && <span>Help</span>}
          </button>
          {TopbarSwitcher && <TopbarSwitcher />}
          <UserMenu compact={compact} where={starting ? 'chat' : 'studio'} />
        </div>
        <div style={viewerWrap}>
          {starting ? null : pages.some((p) => (p.layout || []).length) ? (
            <Viewer reportId={id} embedded version={version} workingCopy={workingCopy} onPageChange={setPageIdx} showPage={showPage} pageRef={pageNodeRef} navRef={navNodeRef} onLayoutEdit={canEdit ? editLayout : null} />
          ) : (
            <div style={emptyStyle}>
              {aiAvailable
                ? 'Ask the assistant for the report you need: it builds it here, page by page. A targeted question adds a visual to the page shown.'
                : 'The assistant is not available for this account: open the editor to build the report by hand.'}
            </div>
          )}
        </div>
      </div>

      {blocker.state === 'blocked' && (
        <Modal width={440} onClose={() => blocker.reset?.()}>
          <h3 style={leaveTitle}>Unsaved changes</h3>
          <p style={leaveText}>The assistant's changes are not saved on this report yet. Save them before leaving?</p>
          <div style={leaveActions}>
            <button type="button" style={btn} onClick={() => blocker.reset?.()} disabled={saving}>Cancel</button>
            <button type="button" style={btn} onClick={() => blocker.proceed?.()} disabled={saving}>Leave without saving</button>
            <button type="button" style={primaryBtn} onClick={saveAndLeave} disabled={saving}>{saving ? 'Saving…' : 'Save and leave'}</button>
          </div>
        </Modal>
      )}
    </main>
  );
}

// `/chat` and `/studio/:id` both render this page at the same place of the
// tree, so React keeps one instance across them: without the key, a report
// opened after another one kept its working copy on the viewer and its
// conversation in the panel. A new id is a fresh studio.
export default function AiStudio() {
  const { id } = useParams();
  return <Studio key={id || 'start'} id={id} />;
}
