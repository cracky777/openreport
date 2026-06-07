import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import ReportCanvas from '../components/Canvas/ReportCanvas';
import api from '../utils/api';
import { prepareGlobalRulesForWidget } from '../utils/reportFilterRules';
import { parseFiltersFromUrl, syncFiltersToUrl, parsePrintFiltersFromUrl } from '../utils/urlFilters';
import { buildWidgetQueryPayload } from '../utils/widgetQueryPayload';
import { buildWidgetData } from '../utils/widgetDataBuilder';
import { TbMaximize, TbMinimize, TbRefresh } from 'react-icons/tb';
import { useTheme } from '../hooks/useTheme';
import PagesColumn from '../components/PagesColumn/PagesColumn';
import ExportMenu from '../components/ExportMenu/ExportMenu';

export default function Viewer() {
  const { id } = useParams();
  const { getThemeVars } = useTheme();
  const [report, setReport] = useState(null);
  const [model, setModel] = useState(null);
  const [error, setError] = useState(null);
  const [widgets, setWidgets] = useState({});
  const widgetsRef = useRef({});
  widgetsRef.current = widgets;
  const [reportFilters, setReportFilters] = useState({});
  // Effective model = model + report-scoped extras/overrides (Editor
  // parity — see Editor.jsx effectiveModel). The Viewer used the RAW
  // model to resolve response columns, so any widget bound to a
  // report-scoped `_calc.*`/`_filt.*` measure or an overridden label
  // couldn't be mapped → empty visual (while the Editor, which merges
  // these, rendered fine). Every response-column / label lookup in the
  // data-build effect now consults this instead of `model`.
  const effectiveModel = useMemo(() => {
    if (!model) return { dimensions: [], measures: [], dateColumn: null };
    const s = report?.settings || {};
    const overD = s.dimensionOverrides || {};
    const overM = s.measureOverrides || {};
    const rawDims = Array.isArray(model.dimensions) ? model.dimensions : [];
    const rawMeas = Array.isArray(model.measures) ? model.measures : [];
    const baseDims = rawDims.map((d) => {
      const ov = overD[d.name];
      return ov ? { ...d, ...ov, _source: 'model' } : { ...d, _source: 'model' };
    });
    const extraDims = (s.extraDimensions || []).map((d) => ({ ...d, _source: 'report' }));
    const baseMeas = rawMeas.map((m) => {
      const ov = overM[m.name];
      return ov ? { ...m, ...ov, _source: 'model' } : { ...m, _source: 'model' };
    });
    const extraMeas = (s.extraMeasures || []).map((m) => ({ ...m, _source: 'report' }));
    return {
      ...model,
      dimensions: [...baseDims, ...extraDims],
      measures: [...baseMeas, ...extraMeas],
      dateColumn: s.dateColumn != null ? s.dateColumn : model.dateColumn,
    };
  }, [model, report?.settings]);
  const urlFiltersAppliedRef = useRef(false);
  // Once the model is loaded, apply URL filters:
  //   - `?f_<col>=…`  → merged into `report.settings.reportFilters`. URL
  //     rules win over saved rules for the same field, so a shared link
  //     reproduces the exact filtered view; non-`in` rules from settings
  //     (between, comparisons, etc.) and rules on other fields stay.
  //   - `pf=…`        → merged into the local slicer-shaped `reportFilters`.
  //     This is the cloud scheduler's per-recipient personalisation hook,
  //     applied as if the recipient had clicked those slicer values.
  useEffect(() => {
    if (!model || urlFiltersAppliedRef.current) return;
    urlFiltersAppliedRef.current = true;
    const fromUrl = parseFiltersFromUrl(window.location.search, model);
    if (Array.isArray(fromUrl) && fromUrl.length > 0) {
      setReport((prev) => {
        if (!prev) return prev;
        const existing = Array.isArray(prev?.settings?.reportFilters) ? prev.settings.reportFilters : [];
        const urlFields = new Set(fromUrl.map((r) => r.field));
        const merged = [...existing.filter((r) => !urlFields.has(r.field)), ...fromUrl];
        return { ...prev, settings: { ...(prev.settings || {}), reportFilters: merged } };
      });
    }
    const fromPrint = parsePrintFiltersFromUrl(window.location.search, model);
    if (fromPrint && Object.keys(fromPrint).length > 0) {
      setReportFilters((prev) => ({ ...prev, ...fromPrint }));
    }
  }, [model]);
  // Keep `?f_<col>=…` in sync with the report-level rules so the URL
  // matches the active filter set even after the user navigates pages.
  // Slicer-driven `reportFilters` are NOT mirrored — only Settings panel
  // rules are.
  useEffect(() => {
    syncFiltersToUrl(report?.settings?.reportFilters, model);
  }, [report?.settings?.reportFilters, model]);
  // Tracks only slicer-driven selections (not cross-filters) — drives FilterWidget visual state
  const [slicerSelections, setSlicerSelections] = useState({});
  const [refreshCounter, setRefreshCounter] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [crossHighlight, setCrossHighlight] = useState(null);
  const crossHighlightRef = useRef(null);
  crossHighlightRef.current = crossHighlight;
  const crossFilterSourceRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const canvasRef = useRef(null);
  const [pages, setPages] = useState([]);
  const [currentPageIdx, setCurrentPageIdx] = useState(0);
  const pageStateRef = useRef({}); // { [pageIdx]: { widgets, reportFilters, crossHighlight } }

  // Print mode — used by the server-side scheduler renderer. The URL is
  // /view/:id?print=1&page=<idx>. In this mode we strip the toolbar, the
  // pages column and the canvas padding so Puppeteer produces a 1:1 PDF
  // of the report canvas only. `page` selects which page to land on so
  // the renderer can iterate and produce one PDF per report page.
  const [printMode, printPageIdx] = useMemo(() => {
    if (typeof window === 'undefined') return [false, null];
    const params = new URLSearchParams(window.location.search);
    const isPrint = params.get('print') === '1';
    const pageStr = params.get('page');
    const pageIdx = pageStr != null ? parseInt(pageStr, 10) : null;
    return [isPrint, Number.isFinite(pageIdx) ? pageIdx : null];
  }, []);

  // Load report + model
  useEffect(() => {
    const load = async () => {
      try {
        const res = await api.get(`/reports/${id}`);
        const r = res.data.report;
        setReport(r);

        // Load pages
        const reportPages = r.pages || r.settings?.pages;
        let firstPageWidgets = {};
        const startIdx = (printPageIdx != null && reportPages && printPageIdx >= 0 && printPageIdx < reportPages.length)
          ? printPageIdx
          : 0;
        if (reportPages && reportPages.length > 0) {
          setPages(reportPages);
          firstPageWidgets = reportPages[startIdx].widgets || {};
          setWidgets(firstPageWidgets);
          setCurrentPageIdx(startIdx);
        } else {
          setPages([{ id: 'page-1', name: 'Page 1', layout: r.layout, widgets: r.widgets }]);
          firstPageWidgets = r.widgets || {};
          setWidgets(firstPageWidgets);
        }

        // Restore slicer selections from saved filter widgets' config.selectedValues
        const initialSlicerSel = {};
        for (const w of Object.values(firstPageWidgets)) {
          if (w?.type !== 'filter') continue;
          const dim = w.dataBinding?.selectedDimensions?.[0];
          const vals = w.config?.selectedValues;
          if (dim && Array.isArray(vals) && vals.length > 0) initialSlicerSel[dim] = vals;
        }
        if (Object.keys(initialSlicerSel).length > 0) {
          setSlicerSelections(initialSlicerSel);
          // URL filters take priority over saved slicer selections so a
          // shared filtered link wins over per-widget defaults.
          setReportFilters((prev) => ({ ...initialSlicerSel, ...prev }));
        }

        if (r.model_id) {
          try {
            const modelRes = await api.get(`/models/${r.model_id}`);
            setModel(modelRes.data.model);
          } catch { /* model might not be accessible */ }
        }
      } catch (err) {
        setError(err.response?.data?.error || 'Report not found');
      }
    };
    load();
  }, [id]);

  // Slicer filter
  // Slicer search — same contract as Editor.handleSlicerSearch. Lets the
  // viewer (read-only) user search beyond the cap-1000 initial fetch.
  // Results land in `data._searchedValues`; bypassCache stays clean.
  const slicerSearchSeqRef = useRef({});
  const handleSlicerSearch = useCallback(async (widgetId, searchTerm) => {
    const w = widgetsRef.current?.[widgetId];
    if (!w || w.type !== 'filter') return;
    const dim = w.dataBinding?.selectedDimensions?.[0];
    if (!dim || !model?.id) return;
    const term = (searchTerm || '').trim();
    const mySeq = (slicerSearchSeqRef.current[widgetId] || 0) + 1;
    slicerSearchSeqRef.current[widgetId] = mySeq;

    if (!term) {
      setWidgets((prev) => {
        const cur = prev[widgetId];
        if (!cur || !cur.data) return prev;
        if (cur.data._searchedValues === undefined && cur.data._isSearching === undefined) return prev;
        const nextData = { ...cur.data };
        delete nextData._searchedValues;
        delete nextData._isSearching;
        return { ...prev, [widgetId]: { ...cur, data: nextData } };
      });
      return;
    }

    setWidgets((prev) => {
      const cur = prev[widgetId];
      if (!cur) return prev;
      return { ...prev, [widgetId]: { ...cur, data: { ...(cur.data || {}), _isSearching: true } } };
    });

    try {
      const reportExtras = {
        extraDimensions: report?.settings?.extraDimensions || [],
        extraMeasures: report?.settings?.extraMeasures || [],
        dimensionOverrides: report?.settings?.dimensionOverrides || {},
        measureOverrides: report?.settings?.measureOverrides || {},
      };
      const res = await api.post(`/models/${model.id}/query`, {
        dimensionNames: [dim],
        measureNames: [],
        limit: 1000,
        filters: {},
        widgetFilters: [{ field: dim, op: 'contains', value: term, isMeasure: false }],
        distinct: true,
        reportId: id,
        bypassCache: true,
        ...reportExtras,
      });
      if (slicerSearchSeqRef.current[widgetId] !== mySeq) return;
      const rows = res.data?.rows || [];
      const keys = rows.length > 0 ? Object.keys(rows[0]) : [];
      const values = keys.length > 0
        ? [...new Set(rows.map((r) => r[keys[0]]).filter((v) => v != null))]
        : [];
      setWidgets((prev) => {
        const cur = prev[widgetId];
        if (!cur) return prev;
        return { ...prev, [widgetId]: { ...cur, data: { ...(cur.data || {}), _searchedValues: values, _isSearching: false } } };
      });
    } catch {
      if (slicerSearchSeqRef.current[widgetId] !== mySeq) return;
      setWidgets((prev) => {
        const cur = prev[widgetId];
        if (!cur) return prev;
        return { ...prev, [widgetId]: { ...cur, data: { ...(cur.data || {}), _isSearching: false } } };
      });
    }
  }, [model, id, report?.settings]);

  const handleSlicerFilter = useCallback((widgetId, dimensionName, selectedValues) => {
    setSlicerSelections((prev) => {
      const next = { ...prev };
      if (!selectedValues || selectedValues.length === 0) {
        delete next[dimensionName];
      } else {
        next[dimensionName] = selectedValues;
      }
      return next;
    });
    setReportFilters((prev) => {
      const next = { ...prev };
      if (!selectedValues || selectedValues.length === 0) {
        const ch = crossHighlightRef.current;
        if (ch && ch.dim === dimensionName) {
          next[dimensionName] = [ch.value];
        } else {
          delete next[dimensionName];
        }
      } else {
        next[dimensionName] = selectedValues;
      }
      return next;
    });
  }, []);

  // Drill-down helpers
  const DRILLABLE_TYPES = ['bar', 'line', 'combo', 'pie', 'treemap'];
  const isWidgetDrillable = useCallback((w) => {
    if (!w || !DRILLABLE_TYPES.includes(w.type)) return false;
    const dims = w.dataBinding?.selectedDimensions || [];
    return dims.length > 1;
  }, []);
  const isWidgetAtLeaf = useCallback((w) => {
    const dims = w?.dataBinding?.selectedDimensions || [];
    const path = Array.isArray(w?.drillPath) ? w.drillPath : [];
    return path.length >= Math.max(0, dims.length - 1);
  }, []);
  // Drill-scoped refetch (mirrors Editor): only the drilling widget refires
  // on intermediate drill steps. Cross-filter at leaf level still updates
  // reportFilters and propagates to other visuals as before.
  const drillingWidgetIdRef = useRef(null);
  const applyDrillMutation = useCallback((widgetId, mutate) => {
    setWidgets((prev) => {
      const w = prev?.[widgetId];
      if (!w) return prev;
      const nextPath = mutate(Array.isArray(w.drillPath) ? w.drillPath : []);
      return { ...prev, [widgetId]: { ...w, drillPath: nextPath, _loading: true } };
    });
    const prevCH = crossHighlightRef.current;
    if (prevCH && prevCH.widgetId === widgetId) {
      setCrossHighlight(null);
      setReportFilters((p) => {
        const n = { ...p };
        if (slicerSelections[prevCH.dim]) n[prevCH.dim] = slicerSelections[prevCH.dim];
        else delete n[prevCH.dim];
        return n;
      });
    }
    drillingWidgetIdRef.current = widgetId;
    setRefreshCounter((n) => n + 1);
  }, [slicerSelections]);
  const handleDrillDown = useCallback((widgetId, dim, value) => {
    applyDrillMutation(widgetId, (cur) => [...cur, { dim, value }]);
  }, [applyDrillMutation]);
  const handleDrillUp = useCallback((widgetId) => {
    applyDrillMutation(widgetId, (cur) => cur.slice(0, -1));
  }, [applyDrillMutation]);
  const handleDrillReset = useCallback((widgetId) => {
    applyDrillMutation(widgetId, () => []);
  }, [applyDrillMutation]);

  // Cross-filter click
  const handleCrossFilter = useCallback((sourceWidgetId, dimensionName, value) => {
    const w = widgetsRef.current?.[sourceWidgetId];
    if (w && isWidgetDrillable(w) && !isWidgetAtLeaf(w)) {
      handleDrillDown(sourceWidgetId, dimensionName, value);
      return;
    }
    const prev = crossHighlightRef.current;
    const isSame = prev && prev.widgetId === sourceWidgetId && prev.value === value;
    if (isSame) {
      crossFilterSourceRef.current = null;
      setCrossHighlight(null);
      setReportFilters((p) => {
        const n = { ...p };
        if (slicerSelections[dimensionName]) {
          n[dimensionName] = slicerSelections[dimensionName];
        } else {
          delete n[dimensionName];
        }
        return n;
      });
    } else {
      crossFilterSourceRef.current = sourceWidgetId;
      setCrossHighlight({ widgetId: sourceWidgetId, dim: dimensionName, value });
      setReportFilters((p) => {
        const n = { ...p };
        if (prev && prev.dim && prev.dim !== dimensionName) {
          if (slicerSelections[prev.dim]) {
            n[prev.dim] = slicerSelections[prev.dim];
          } else {
            delete n[prev.dim];
          }
        }
        n[dimensionName] = [value];
        return n;
      });
    }
  }, [slicerSelections, handleDrillDown, isWidgetDrillable, isWidgetAtLeaf]);

  // Refetch when filters change. Also force a refetch the first time the model becomes
  // available so the viewer receives fresh data — saved widget data reflects the owner's
  // view at save time, but RLS rules require us to re-query as the current user.
  const prevFiltersJson = useRef('{}');
  const skipNextRefetch = useRef(false);
  const prevRefreshCounter = useRef(0);
  const modelInitialFetchDoneRef = useRef(false);
  useEffect(() => {
    if (model && !modelInitialFetchDoneRef.current) {
      modelInitialFetchDoneRef.current = true;
      // Clear the saved (owner-snapshot) widget data immediately so the viewer
      // never sees unfiltered rows during the brief moment before the RLS-aware
      // refetch resolves. The widgets will render their loading state instead.
      // Object-only widget types (text / image / shape) never refetch, so
      // marking them loading would strand them on the spinner forever — the
      // fetch loop's `toFetch` filter (below) excludes them, so the
      // _loading=true flag we'd set here is never cleared. Leave them
      // untouched.
      const NON_DATA_TYPES = new Set(['text', 'image', 'shape']);
      setWidgets((prev) => {
        const next = {};
        for (const [wId, w] of Object.entries(prev || {})) {
          if (!w || NON_DATA_TYPES.has(w.type)) {
            next[wId] = w;
          } else {
            next[wId] = { ...w, data: undefined, _loading: true };
          }
        }
        return next;
      });
      setRefreshCounter((n) => n + 1);
    }
  }, [model]);
  useEffect(() => {
    if (skipNextRefetch.current) {
      skipNextRefetch.current = false;
      prevFiltersJson.current = JSON.stringify(reportFilters || {});
      prevRefreshCounter.current = refreshCounter;
      return;
    }
    const json = JSON.stringify(reportFilters || {});
    const sourceId = crossFilterSourceRef.current;
    const refreshRequested = refreshCounter !== prevRefreshCounter.current;
    prevRefreshCounter.current = refreshCounter;
    // Skip only if NOTHING changed: filters identical AND no fresh cross-filter click AND no refresh request
    if (json === prevFiltersJson.current && sourceId === null && !refreshRequested) return;
    prevFiltersJson.current = json;
    if (!model) { setRefreshing(false); return; }

    crossFilterSourceRef.current = null;
    // Drill scope: an intermediate drill click only refetches its widget;
    // siblings stay on their previous data. (Cross-filter at leaf is handled
    // separately via reportFilters.)
    const drillingId = drillingWidgetIdRef.current;
    drillingWidgetIdRef.current = null;

    // Use current page widgets — prefer the live `widgets` state (contains fresh drill mutations)
    const currentWidgets = widgets && Object.keys(widgets).length > 0 ? widgets : (pages[currentPageIdx]?.widgets || {});

    // Collect widgets to fetch, then mark them all as loading in one batch.
    // Filter widgets are now included so their distinct value list is also RLS-filtered
    // (previously they reused the owner's saved values, which leaked unauthorized rows).
    const toFetch = Object.entries(currentWidgets).filter(([wId, w]) => {
      if (!w) return false;
      if (drillingId && wId !== drillingId) return false;
      if (!refreshRequested && wId === sourceId) return false;
      const b = w.dataBinding || {};
      const hasMeas = w.type === 'scatter' ? !!(b.scatterMeasures?.x && b.scatterMeasures?.y)
        : w.type === 'combo' ? ((b.comboBarMeasures?.length > 0) || (b.comboLineMeasures?.length > 0))
        : (b.selectedMeasures?.length > 0);
      const hasMainBinding = (b.selectedDimensions?.length > 0 || hasMeas);
      // Conditional formatting may need fetching even on a widget that has
      // only a colour-measure binding (e.g. shapes).
      const hasColorMeas = !!b.colorMeasure && w.config?.colorCondition?.enabled === true;
      // Filter widgets always fetch — they need RLS-filtered distinct values
      // for their bound dimension.
      if (w.type === 'filter') return hasMainBinding;
      if (w.type === 'text') return hasColorMeas;
      return hasMainBinding || hasColorMeas;
    });
    if (toFetch.length > 0) {
      setWidgets((prev) => {
        const next = { ...prev };
        toFetch.forEach(([wId]) => { if (next[wId]) next[wId] = { ...next[wId], _loading: true }; });
        return next;
      });
    }

    toFetch.forEach(([wId, w]) => {
      // Build the query bodies + per-widget metadata. Viewer differs from
      // Editor in a few places (bypassCache driven by report.live_mode
      // instead of a manual-refresh flag; filter widgets fetch a distinct
      // list rather than being excluded upstream; no queryId/abort plumbing
      // because Viewer has no Cancel control); these are passed as options.
      const { meta, bodies } = buildWidgetQueryPayload(w, wId, {
        effectiveModel,
        reportFilters,
        currentWidgets,
        crossHighlight: crossHighlightRef.current,
        reportId: id,
        reportLevelFilters: prepareGlobalRulesForWidget(report?.settings?.reportFilters, wId),
        reportExtras: {
          extraDimensions: report?.settings?.extraDimensions || [],
          extraMeasures: report?.settings?.extraMeasures || [],
          dimensionOverrides: report?.settings?.dimensionOverrides || {},
          measureOverrides: report?.settings?.measureOverrides || {},
        },
        bypassCache: !!(report?.live_mode),
        filterWidgetMode: 'distinct',
        dedupMeasures: false,
      });

      const mainPromise = bodies.main
        ? api.post(`/models/${model.id}/query`, bodies.main)
        : Promise.resolve({ data: { rows: [] } });
      const colorPromise = bodies.color
        ? api.post(`/models/${model.id}/query`, bodies.color).catch(() => null)
        : Promise.resolve(null);
      const totalPromise = bodies.total
        ? api.post(`/models/${model.id}/query`, bodies.total).catch(() => null)
        : Promise.resolve(null);
      const n1Promise = bodies.n1
        ? api.post(`/models/${model.id}/query`, bodies.n1).catch(() => null)
        : Promise.resolve(null);
      const comboLinePromise = bodies.comboLine
        ? api.post(`/models/${model.id}/query`, bodies.comboLine).catch(() => null)
        : Promise.resolve(null);

      Promise.all([mainPromise, colorPromise, totalPromise, n1Promise, comboLinePromise]).then(([res, colorRes, totalRes, n1Res, comboLineRes]) => {
        const rows = res.data?.rows;
        // Per the bug investigation, the Viewer keeps `[...dims]` for the
        // row dim list so a dim pinned to both row + column zones still
        // appears in `_rowDims` (the alternative drops the dim from the
        // rows axis, which the user reported as broken UX). Editor uses
        // `true`; if the divergence proves problematic it'll be unified
        // alongside the next phase of the data-builder extraction.
        const data = buildWidgetData({
          widget: w, rows, meta, effectiveModel,
          colorRes, totalRes, n1Res, comboLineRes,
          pivotFilterRowDims: false,
        });
        setWidgets((prev) => ({ ...prev, [wId]: { ...prev[wId], _loading: false, data } }));
      }).catch((err) => {
        const msg = err?.response?.data?.error || err?.message || 'Query failed';
        const code = err?.response?.data?.code || null;
        const timeoutMs = err?.response?.data?.timeoutMs || null;
        setWidgets((prev) => ({ ...prev, [wId]: { ...prev[wId], _loading: false, data: { _error: msg, _errorCode: code, _errorTimeoutMs: timeoutMs, _rowCount: 0 } } }));
      });
    });
  }, [reportFilters, refreshCounter, report?.live_mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Print mode — fire one explicit refresh ~1s after the report loads, on top
  // of the initial automatic fetch. The server-side renderer's networkidle0
  // covers both rounds, so the captured PDF reflects truly fresh data even
  // when there's a cache layer (Cube.js, model-level pre-aggregations) that
  // could have served stale results to the initial mount.
  useEffect(() => {
    if (!printMode || !report) return;
    const t = setTimeout(() => setRefreshCounter((n) => n + 1), 1000);
    return () => clearTimeout(t);
  }, [printMode, report?.id]);

  // Reset refreshing after re-render (simple approach — fetch is async, but UI feedback is fine)
  useEffect(() => {
    if (refreshing) {
      const t = setTimeout(() => setRefreshing(false), 800);
      return () => clearTimeout(t);
    }
  }, [refreshing, refreshCounter]);

  const handleRefresh = useCallback(() => {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshCounter((n) => n + 1);
  }, [refreshing]);

  // Fullscreen toggle
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);


  if (error) {
    return <div style={{ padding: 60, textAlign: 'center', color: 'var(--state-danger)' }}>{error}</div>;
  }
  if (!report) {
    return <div style={{ padding: 40, color: 'var(--text-disabled)' }}>Loading...</div>;
  }

  return (
    <div style={{
      // Print mode strips the surrounding viewport so Puppeteer's
      // page.pdf captures the canvas only. Otherwise: standard fullscreen.
      height: printMode ? 'auto' : '100vh',
      display: 'flex',
      flexDirection: 'column',
      backgroundColor: printMode ? 'transparent' : 'var(--bg-app)',
    }}>
      {/* Viewer toolbar — compact */}
      <header className="no-print" style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '4px 10px', backgroundColor: 'var(--bg-panel)', borderBottom: '1px solid var(--border-default)',
        flexShrink: 0,
      }}>
        <img src="/favicon.png" alt="Open Report" style={{ height: 22 }} />
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>{report.title}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button onClick={handleRefresh} disabled={refreshing} style={{ ...toolBtnSmall, opacity: refreshing ? 0.5 : 1, cursor: refreshing ? 'not-allowed' : 'pointer' }} title="Refresh all widgets">
            <TbRefresh size={14} style={{ animation: refreshing ? 'spin 0.8s linear infinite' : undefined }} />
          </button>
          <ExportMenu
            report={report}
            widgets={widgets}
            canvasRef={canvasRef}
            buttonStyle={toolBtnSmall}
          />
          <button onClick={toggleFullscreen} style={toolBtnSmall} title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
            {isFullscreen ? <TbMinimize size={14} /> : <TbMaximize size={14} />}
          </button>
        </div>
      </header>

      {/* Report area — canvas + pages column live inside the report theme wrapper so the column inherits the report's theme. */}
      <div
        data-theme={report?.settings?.theme?.key || 'light'}
        style={{ display: 'flex', flex: 1, minHeight: 0, ...(report?.settings?.theme?.vars || getThemeVars('light')) }}
      >
        {(pages.length > 1 || report?.settings?.pageNav?.title || report?.settings?.pageNav?.logo) && (
          <PagesColumn
            editMode={false}
            pages={pages}
            currentPageIdx={currentPageIdx}
            onSwitch={(idx) => {
              if (idx === currentPageIdx) return;
              pageStateRef.current[currentPageIdx] = { widgets, reportFilters, slicerSelections, crossHighlight };
              const saved = pageStateRef.current[idx];
              setCurrentPageIdx(idx);
              skipNextRefetch.current = true;
              if (saved) {
                setWidgets(saved.widgets);
                setReportFilters(saved.reportFilters);
                setSlicerSelections(saved.slicerSelections || {});
                setCrossHighlight(saved.crossHighlight);
              } else {
                setWidgets(pages[idx].widgets || {});
                setReportFilters({});
                setSlicerSelections({});
                setCrossHighlight(null);
              }
            }}
            config={report?.settings?.pageNav}
          />
        )}
        <ReportCanvas
          layout={pages[currentPageIdx]?.layout || report.layout}
          widgets={widgets}
          readOnly
          settings={report.settings}
          reportFilters={slicerSelections}
          onSlicerFilter={handleSlicerFilter}
          onSlicerSearch={handleSlicerSearch}
          onCrossFilter={handleCrossFilter}
          onDrillUp={handleDrillUp}
          onDrillReset={handleDrillReset}
          crossHighlight={crossHighlight}
          reportRef={canvasRef}
          printMode={printMode}
        />
      </div>

      {/* Print styles — also kicks in for the server-side renderer because
          Puppeteer's page.pdf() simulates print media by default. */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          html, body, #root { margin: 0 !important; padding: 0 !important; background: transparent !important; }
        }
      `}</style>
    </div>
  );
}

const toolbarStyle = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '8px 20px', backgroundColor: 'var(--bg-panel)', borderBottom: '1px solid var(--border-default)',
  flexShrink: 0,
};

const toolBtn = {
  padding: '6px 8px', border: '1px solid var(--border-default)', borderRadius: 6,
  background: 'var(--bg-panel)', cursor: 'pointer', display: 'flex', alignItems: 'center',
  color: 'var(--text-secondary)',
};

const toolBtnSmall = {
  padding: '4px 6px', border: '1px solid var(--border-default)', borderRadius: 4,
  background: 'var(--bg-panel)', cursor: 'pointer', display: 'flex', alignItems: 'center',
  color: 'var(--text-muted)', fontSize: 12,
};

