import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import ReportCanvas from '../components/Canvas/ReportCanvas';
import Toolbar from '../components/Toolbar/Toolbar';
import ExportMenu from '../components/ExportMenu/ExportMenu';
import { WidgetConfigPanel, DataModelPanel } from '../components/PropertyPanel/PropertyPanel';
import { WIDGET_TYPES } from '../components/Widgets';
import SettingsPanel from '../components/SettingsPanel/SettingsPanel';
import ReportFilterBar from '../components/ReportFilterBar/ReportFilterBar';
import PagesColumn, { PAGES_COLUMN_TRANSITION_MS } from '../components/PagesColumn/PagesColumn';
import { useHistory } from '../hooks/useHistory';
import { useTheme } from '../hooks/useTheme';
import api from '../utils/api';
import { sanitizeWidgetFilters } from '../utils/widgetFilters';
import { prepareGlobalRulesForWidget } from '../utils/reportFilterRules';
import { parseFiltersFromUrl, syncFiltersToUrl } from '../utils/urlFilters';
import { computeBindingKey } from '../utils/bindingKey';
import { filterForTarget } from '../utils/crossFilter';
import { shiftFiltersForN1, shiftWidgetFiltersForN1, hasShiftableFilterForN1 } from '../utils/comparePeriod';

// Convert data between widget formats
function convertData(data, fromType, toType) {
  if (!data || Object.keys(data).length === 0) return data;

  // Extract labels and values from any source format
  let labels = [];
  let values = [];

  if (data.labels && data.values) {
    // bar, line format
    labels = data.labels;
    values = data.values;
  } else if (data.items) {
    // pie format
    labels = data.items.map((item) => item.name);
    values = data.items.map((item) => item.value);
  } else if (data.columns && data.rows) {
    // table format
    labels = data.rows.map((r) => r[0]);
    values = data.rows.map((r) => parseFloat(r[r.length - 1]) || 0);
  } else if (data.rawRows || data.points || data.barSeries || data.lineSeries) {
    // pivotTable / scatter / combo format — clear data, will need refetch
    return {};
  } else if (data.value !== undefined) {
    // scorecard format - can't meaningfully convert
    return data;
  } else {
    return data;
  }

  // Convert to target format
  switch (toType) {
    case 'bar':
    case 'line':
      return { labels, values };
    case 'pie':
    case 'treemap':
      return { items: labels.map((name, i) => ({ name, value: values[i] || 0 })) };
    case 'table':
      return {
        columns: ['Label', 'Value'],
        rows: labels.map((l, i) => [String(l), String(values[i] || 0)]),
      };
    case 'scorecard':
    case 'gauge':
      return {
        value: values.reduce((a, b) => a + b, 0),
        label: 'Total',
      };
    case 'pivotTable':
    case 'scatter':
    case 'combo':
      // Needs specific data format — clear data to force a refetch
      return {};
    default:
      return data;
  }
}

// Canonical JSON serializer — keys sorted so object key ordering doesn't affect the output.
function canonicalStringify(obj) {
  if (obj === null || obj === undefined) return 'null';
  if (typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(canonicalStringify).join(',') + ']';
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalStringify(obj[k])).join(',') + '}';
}

// Build a stable snapshot string used to detect real modifications against the last-saved state.
// Strips transient widget data/loading flags — only persisted config matters — and emits keys in
// canonical order so a difference means a real change, not a re-ordered object.
function buildSnapshot(title, settings, pagesArr) {
  const cleanWidget = (w) => {
    if (!w) return {};
    // Only keep fields that represent the user-authored configuration of the widget.
    // Anything else (data, _loading, _error, transient cached state…) is runtime noise.
    const out = {
      type: w.type,
      config: w.config || {},
      dataBinding: w.dataBinding || {},
    };
    if (Array.isArray(w.drillPath) && w.drillPath.length > 0) out.drillPath = w.drillPath;
    return out;
  };
  const cleanPage = (p) => ({
    id: p.id, name: p.name,
    layout: p.layout || [],
    widgets: Object.fromEntries(Object.entries(p.widgets || {}).map(([k, w]) => [k, cleanWidget(w)])),
  });
  // Server nests pages inside settings for storage — strip that copy out; our `pagesArr` is the canonical one.
  const settingsSansPages = { ...(settings || {}) };
  delete settingsSansPages.pages;
  return canonicalStringify({ title: title || '', settings: settingsSansPages, pages: (pagesArr || []).map(cleanPage) });
}

export default function Editor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { getThemeVars } = useTheme();

  const [report, setReport] = useState(null);
  const [model, setModel] = useState(null);
  // Report-level settings (theme, page size, report filters, etc.). Declared
  // early so useEffect dep arrays referencing `settings.reportFilters` don't
  // trip the temporal dead zone.
  const [settings, setSettings] = useState({});

  // Effective model = model + report-scoped extras/overrides applied. The
  // model itself stays untouched; this is what every UI that reads dims /
  // measures (DataPanel, dimension pickers, drill helpers) consults so
  // changes made in the report editor stay scoped to this report. Each
  // entry carries `_source: 'model' | 'report'` so the DataPanel knows
  // whether an action targets settings overrides or settings extras.
  const effectiveModel = useMemo(() => {
    // Always return an object so render code can call `effectiveModel.dimensions`
    // safely during the brief window where the model hasn't loaded yet.
    if (!model) return { dimensions: [], measures: [], dateColumn: null };
    const overD = settings?.dimensionOverrides || {};
    const overM = settings?.measureOverrides || {};
    const baseDims = (model.dimensions || []).map((d) => {
      const ov = overD[d.name];
      return ov ? { ...d, ...ov, _source: 'model' } : { ...d, _source: 'model' };
    });
    const extraDims = (settings?.extraDimensions || []).map((d) => ({ ...d, _source: 'report' }));
    const baseMeas = (model.measures || []).map((m) => {
      const ov = overM[m.name];
      return ov ? { ...m, ...ov, _source: 'model' } : { ...m, _source: 'model' };
    });
    const extraMeas = (settings?.extraMeasures || []).map((m) => ({ ...m, _source: 'report' }));
    return {
      ...model,
      dimensions: [...baseDims, ...extraDims],
      measures: [...baseMeas, ...extraMeas],
      // Report-level dateColumn wins over the model's (the report editor's
      // Date Table toggle now writes to settings, not the model).
      dateColumn: settings?.dateColumn != null ? settings.dateColumn : model.dateColumn,
    };
  }, [model, settings]);
  const [selectedWidget, setSelectedWidget] = useState(null);
  // Edit Interactions mode — Power BI–style toggle for configuring per-pair
  // cross-filter behaviour. While active, each non-source widget shows a
  // filter / off toggle in its top-right corner. The handler is declared
  // further down because it depends on the history hook.
  const [editInteractions, setEditInteractions] = useState(false);
  // When set, the edit-interactions overlay's source is a report-level
  // global filter rule (settings.reportFilters[idx]) instead of the currently
  // selected widget. Cleared when edit-interactions mode exits or a different
  // source is picked.
  const [interactionsRuleIdx, setInteractionsRuleIdx] = useState(null);
  const [clipboard, setClipboard] = useState(null);
  const [reportFilters, setReportFilters] = useState({});
  // Live mirror so callbacks (refreshSlicer / slicer search) can read the
  // currently-applied filter selections without re-creating on every
  // change. Same pattern as widgetsRef / crossHighlightRef below.
  const reportFiltersRef = useRef(reportFilters);
  reportFiltersRef.current = reportFilters;
  // Live mirror of `settings`. refreshSlicer must read the global filter
  // rules + report extras from HERE, not from its closure: the
  // ReportFilterBar "Save & refresh" path calls onChange (setSettings —
  // async) then onRefresh (handleRefresh → refreshSlicer) SYNCHRONOUSLY
  // in the same tick, so the closure's `settings` is still pre-commit and
  // the slicer query would carry the OLD global filter. The onChange
  // handler updates this ref synchronously (before onRefresh runs) so the
  // synchronous refreshSlicer sees the just-committed rules.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const urlFiltersAppliedRef = useRef(false);
  // Once the model is loaded, seed `settings.reportFilters` from the URL
  // `?f_<col>=…` params. URL rules win over saved rules for the same field
  // (so a shared link fully reproduces the filtered view); rules on other
  // fields, and non-`in` rules (between, comparisons, …) saved in settings
  // stay untouched. Runs once per model instance; further changes flow
  // back to the URL via the sync effect below.
  useEffect(() => {
    if (!model || urlFiltersAppliedRef.current) return;
    urlFiltersAppliedRef.current = true;
    const fromUrl = parseFiltersFromUrl(window.location.search, model);
    if (Array.isArray(fromUrl) && fromUrl.length > 0) {
      setSettings((prev) => {
        const existing = Array.isArray(prev?.reportFilters) ? prev.reportFilters : [];
        const urlFields = new Set(fromUrl.map((r) => r.field));
        const merged = [...existing.filter((r) => !urlFields.has(r.field)), ...fromUrl];
        return { ...prev, reportFilters: merged };
      });
    }
  }, [model]);
  // Mirror `settings.reportFilters` (the report-level rules configured in
  // the Settings panel) into the URL so a filtered view is bookmarkable.
  // Slicer-driven `reportFilters` are NOT URL-mirrored — only Settings
  // panel rules are, since slicers are a runtime/interactive concern.
  useEffect(() => {
    syncFiltersToUrl(settings?.reportFilters, model);
  }, [settings?.reportFilters, model]);
  const [slicerSelections, setSlicerSelections] = useState({});
  // Cross-highlight: which widget is the source and what value is highlighted
  const [crossHighlight, setCrossHighlight] = useState(null); // { widgetId, dim, value }
  const crossHighlightRef = useRef(null);
  crossHighlightRef.current = crossHighlight;

  // Undo/redo state: tracks layout + widgets together (for current page)
  const history = useHistory({ layout: [], widgets: {} });
  const { layout, widgets } = history.state;

  // Edit Interactions handler (defined after history is initialised). Toggles
  // the target's id in the currently-selected source widget's exclusion list.
  // Scoped-refetch ref consumed by the main fetch loop. When the user
  // toggles a target's interaction (None ↔ Filter), only that target needs
  // to refetch — its cross-filter inclusion just flipped, so its current
  // data could be stale even though no other widget changed.
  const interactionToggleTargetRef = useRef(null);
  const handleToggleCrossFilter = useCallback((targetId) => {
    // Global-filter-rule source: toggle goes to settings.reportFilters[idx].exclusions
    if (interactionsRuleIdx != null) {
      setSettings((prev) => {
        const rules = Array.isArray(prev?.reportFilters) ? [...prev.reportFilters] : [];
        const rule = rules[interactionsRuleIdx];
        if (!rule) return prev;
        const excl = Array.isArray(rule.exclusions) ? rule.exclusions : [];
        const next = excl.includes(targetId)
          ? excl.filter((x) => x !== targetId)
          : [...excl, targetId];
        rules[interactionsRuleIdx] = { ...rule, exclusions: next };
        return { ...prev, reportFilters: rules };
      });
      interactionToggleTargetRef.current = targetId;
      setRefreshCounter((n) => n + 1);
      return;
    }
    // Widget source (existing flow)
    const sourceId = selectedWidget;
    if (!sourceId || sourceId === targetId) return;
    history.set((prev) => {
      const src = prev.widgets?.[sourceId];
      if (!src) return prev;
      const exclusions = Array.isArray(src.config?.crossFilterExclusions) ? src.config.crossFilterExclusions : [];
      const next = exclusions.includes(targetId)
        ? exclusions.filter((x) => x !== targetId)
        : [...exclusions, targetId];
      return {
        ...prev,
        widgets: {
          ...prev.widgets,
          [sourceId]: { ...src, config: { ...(src.config || {}), crossFilterExclusions: next } },
        },
      };
    });
    // Trigger a scoped refetch of just the target. The main fetch loop
    // reads this ref and filters its widget list down to it.
    interactionToggleTargetRef.current = targetId;
    setRefreshCounter((n) => n + 1);
  }, [selectedWidget, history, interactionsRuleIdx]);

  // Reset the rule source whenever edit-interactions mode is turned off so
  // a stale idx doesn't leak into the next session.
  useEffect(() => {
    if (!editInteractions) setInteractionsRuleIdx(null);
  }, [editInteractions]);
  // Ref mirror so click handlers always read the freshest widget state (closures can be stale)
  const widgetsRef = useRef(widgets);
  widgetsRef.current = widgets;
  // Snapshot of the last-saved (or last-loaded) report state — used to detect real modifications
  const savedSnapshotRef = useRef('');

  // Sync slicerSelections from widgets' config.selectedValues (e.g. after undo/redo).
  // Compares content to avoid updates when nothing actually changed.
  useEffect(() => {
    // Track ALL dims bound to a slicer widget — including slicers with no
    // current selection. These are "slicer-managed" dims; clearing the
    // slicer must drop the dim from reportFilters. Previously we built the
    // managed set from `fromWidgets` (only slicers WITH a selection), so
    // clearing a slicer left its old value preserved as if it were a URL
    // filter, and visuals stayed stuck on the previous selection.
    const slicerManagedDims = new Set();
    const fromWidgets = {};
    for (const w of Object.values(widgets || {})) {
      if (w?.type !== 'filter') continue;
      const dim = w.dataBinding?.selectedDimensions?.[0];
      if (!dim) continue;
      slicerManagedDims.add(dim);
      const vals = w.config?.selectedValues;
      if (Array.isArray(vals) && vals.length > 0) fromWidgets[dim] = vals;
    }
    const sameContent = (a, b) => {
      const aK = Object.keys(a), bK = Object.keys(b);
      if (aK.length !== bK.length) return false;
      for (const k of aK) {
        if (!b[k] || a[k].length !== b[k].length) return false;
        for (let i = 0; i < a[k].length; i++) if (a[k][i] !== b[k][i]) return false;
      }
      return true;
    };
    setSlicerSelections((prev) => sameContent(prev, fromWidgets) ? prev : fromWidgets);
    setReportFilters((prev) => {
      // reportFilters = (URL/external for dims without a slicer) ∪ slicer ∪ crossHighlight
      // Preserve prev entries only when the dim is NOT slicer-managed.
      const preserved = {};
      for (const [k, v] of Object.entries(prev || {})) {
        if (!slicerManagedDims.has(k)) preserved[k] = v;
      }
      const next = { ...preserved, ...fromWidgets };
      const ch = crossHighlightRef.current;
      if (ch?.dim) next[ch.dim] = [ch.value];
      return sameContent(prev, next) ? prev : next;
    });
  }, [widgets]);

  // Called by slicers when selection changes — writes to widget config (recorded in history).
  // The useEffect above will auto-sync slicerSelections and reportFilters from widgets.
  const handleSlicerFilter = useCallback((widgetId, dimensionName, selectedValues) => {
    history.set((prev) => {
      const w = prev.widgets?.[widgetId];
      if (!w) return prev;
      const cfg = { ...(w.config || {}) };
      if (selectedValues && selectedValues.length > 0) cfg.selectedValues = selectedValues;
      else delete cfg.selectedValues;
      return { ...prev, widgets: { ...prev.widgets, [widgetId]: { ...w, config: cfg } } };
    });
    // If a chart cross-highlight was active on the same dim, the slicer
    // change must take precedence — otherwise the slicer-sync effect
    // would overwrite the slicer's new value with the lingering
    // cross-highlight. The user is explicitly asking via the slicer now.
    if (crossHighlightRef.current?.dim === dimensionName) {
      crossFilterSourceRef.current = null;
      setCrossHighlight(null);
    }
  }, [history]);

  // Drill-down handlers — update widget.drillPath silently and trigger refetch
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
  // Marks a refetch as drill-scoped: the next fetch effect run reads this and
  // narrows toFetch to the drilling widget only, so other visuals stay put.
  // (Cross-filter at leaf level still propagates via reportFilters as before.)
  const drillingWidgetIdRef = useRef(null);
  // Same idea as `drillingWidgetIdRef` but for the per-widget Refresh
  // button (the 🔄 icon on each visual). When clicked, only THAT widget
  // refetches — the others keep their cached data and don't get re-queried.
  const widgetRefreshIdRef = useRef(null);
  const applyDrillMutation = useCallback((widgetId, mutate) => {
    history.setSilent((prev) => {
      const w = prev.widgets?.[widgetId];
      if (!w) return prev;
      const nextPath = mutate(Array.isArray(w.drillPath) ? w.drillPath : []);
      return {
        ...prev,
        widgets: { ...prev.widgets, [widgetId]: { ...w, drillPath: nextPath, _loading: true } },
      };
    });
    // Clear any cross-filter that originated from this widget — drill
    // navigation resets the leaf-level cross-filter. When that happens,
    // OTHER widgets were filtered by reportFilters and now need to
    // refetch too, so we DON'T scope the refresh in that case (clearing
    // the cross-highlight changes reportFilters globally). Otherwise the
    // drill is purely local to this widget and we narrow the refetch to
    // it — sibling visuals stay put.
    const prevCH = crossHighlightRef.current;
    let crossHighlightWasCleared = false;
    if (prevCH && prevCH.widgetId === widgetId) {
      setCrossHighlight(null);
      setReportFilters((p) => {
        const n = { ...p };
        if (slicerSelections[prevCH.dim]) n[prevCH.dim] = slicerSelections[prevCH.dim];
        else delete n[prevCH.dim];
        return n;
      });
      crossHighlightWasCleared = true;
    }
    if (!crossHighlightWasCleared) {
      drillingWidgetIdRef.current = widgetId;
    }
    setRefreshCounter((n) => n + 1);
  }, [history, slicerSelections]);
  const handleDrillDown = useCallback((widgetId, dim, value) => {
    applyDrillMutation(widgetId, (cur) => [...cur, { dim, value }]);
  }, [applyDrillMutation]);
  const handleDrillUp = useCallback((widgetId) => {
    applyDrillMutation(widgetId, (cur) => cur.slice(0, -1));
  }, [applyDrillMutation]);
  const handleDrillReset = useCallback((widgetId) => {
    applyDrillMutation(widgetId, () => []);
  }, [applyDrillMutation]);

  // Slicer search — when the user types into a FilterWidget's search box,
  // we fire a fresh /query with a `contains` filter so they can find values
  // beyond the cap-1000 initial fetch. Results land in `data._searchedValues`
  // (the `_` prefix means it's stripped at save — purely transient state).
  // `bypassCache: true` keeps the queryCache clean of throwaway searches.
  const slicerSearchSeqRef = useRef({}); // wId → monotonic id, drops out-of-order results
  const handleSlicerSearch = useCallback(async (widgetId, searchTerm) => {
    const w = widgetsRef.current?.[widgetId];
    if (!w || w.type !== 'filter') return;
    const dim = w.dataBinding?.selectedDimensions?.[0];
    if (!dim || !model?.id) return;
    const term = (searchTerm || '').trim();

    const mySeq = (slicerSearchSeqRef.current[widgetId] || 0) + 1;
    slicerSearchSeqRef.current[widgetId] = mySeq;

    // Clear search → drop _searchedValues; FilterWidget falls back to data.values
    if (!term) {
      history.setSilent((prev) => {
        const cur = prev.widgets?.[widgetId];
        if (!cur || !cur.data) return prev;
        // No-op fast path: nothing to clear means no state churn.
        if (cur.data._searchedValues === undefined && cur.data._isSearching === undefined) return prev;
        const nextData = { ...cur.data };
        delete nextData._searchedValues;
        delete nextData._isSearching;
        return { ...prev, widgets: { ...prev.widgets, [widgetId]: { ...cur, data: nextData } } };
      });
      return;
    }

    history.setSilent((prev) => {
      const cur = prev.widgets?.[widgetId];
      if (!cur) return prev;
      return { ...prev, widgets: { ...prev.widgets, [widgetId]: { ...cur, data: { ...(cur.data || {}), _isSearching: true } } } };
    });

    try {
      // Live ref, not closure (consistency with refreshSlicer / Save &
      // refresh — the search must reflect the latest committed global
      // filter, see settingsRef).
      const s = settingsRef.current || {};
      const reportExtras = {
        extraDimensions: s.extraDimensions || [],
        extraMeasures: s.extraMeasures || [],
        dimensionOverrides: s.dimensionOverrides || {},
        measureOverrides: s.measureOverrides || {},
      };
      // Include the report-level global filters (snowflake joins etc. are
      // resolved by the server's bridge-table BFS). Without these the
      // search would return distinct values that the rest of the report
      // wouldn't actually display.
      const reportLevelFilters = prepareGlobalRulesForWidget(s.reportFilters, widgetId);
      const ownWidgetFilters = Array.isArray(w.dataBinding?.widgetFilters) ? w.dataBinding.widgetFilters : [];
      // Same applied-filter universe as the main slicer list (see
      // refreshSlicer): a searched list must stay constrained by the
      // other active filters (e.g. global client). Drop this slicer's
      // own dim.
      const appliedFilters = { ...(reportFiltersRef.current || {}) };
      delete appliedFilters[dim];
      const res = await api.post(`/models/${model.id}/query`, {
        dimensionNames: [dim],
        measureNames: [],
        limit: 1000,
        filters: appliedFilters,
        widgetFilters: [
          ...reportLevelFilters,
          ...ownWidgetFilters,
          { field: dim, op: 'contains', value: term, isMeasure: false },
        ],
        distinct: true,
        reportId: id,
        bypassCache: true,
        ...reportExtras,
      });
      // Stale-response guard — a slower earlier search must not overwrite a
      // newer one that already landed.
      if (slicerSearchSeqRef.current[widgetId] !== mySeq) return;
      const rows = res.data?.rows || [];
      const keys = rows.length > 0 ? Object.keys(rows[0]) : [];
      const values = keys.length > 0
        ? [...new Set(rows.map((r) => r[keys[0]]).filter((v) => v != null))]
        : [];
      history.setSilent((prev) => {
        const cur = prev.widgets?.[widgetId];
        if (!cur) return prev;
        return { ...prev, widgets: { ...prev.widgets, [widgetId]: { ...cur, data: { ...(cur.data || {}), _searchedValues: values, _isSearching: false } } } };
      });
    } catch {
      if (slicerSearchSeqRef.current[widgetId] !== mySeq) return;
      history.setSilent((prev) => {
        const cur = prev.widgets?.[widgetId];
        if (!cur) return prev;
        return { ...prev, widgets: { ...prev.widgets, [widgetId]: { ...cur, data: { ...(cur.data || {}), _isSearching: false } } } };
      });
    }
    // `settings` read via settingsRef (see refreshSlicer) — not a dep.
  }, [model, id, history]); // eslint-disable-line react-hooks/exhaustive-deps

  // Global Refresh extends to slicers too. Editor's main fetch effect
  // skips `filter` widgets (their distinct values don't change when other
  // slicers' selections change), so on a manual Refresh we have to fire a
  // dedicated /query per slicer to pull a fresh list. `bypassCache: true`
  // forces a hit to the source DB — that's the whole point of "Refresh".
  const refreshSlicer = useCallback(async (widgetId) => {
    const w = widgetsRef.current?.[widgetId];
    if (!w || w.type !== 'filter') return;
    const dim = w.dataBinding?.selectedDimensions?.[0];
    if (!dim || !model?.id) return;
    history.setSilent((prev) => {
      const cur = prev.widgets?.[widgetId];
      if (!cur) return prev;
      return { ...prev, widgets: { ...prev.widgets, [widgetId]: { ...cur, _loading: true } } };
    });
    try {
      // Read from the live ref, NOT the closure — see settingsRef. The
      // "Save & refresh" path invokes this synchronously right after
      // setSettings, before any re-render, so the closure's `settings`
      // would still be the pre-commit global filter.
      const s = settingsRef.current || {};
      const reportExtras = {
        extraDimensions: s.extraDimensions || [],
        extraMeasures: s.extraMeasures || [],
        dimensionOverrides: s.dimensionOverrides || {},
        measureOverrides: s.measureOverrides || {},
      };
      // Apply the report-level global filters so the slicer's distinct
      // values reflect the same filter universe as the rest of the report
      // (bridge tables are resolved server-side by the BFS in models.js).
      const reportLevelFilters = prepareGlobalRulesForWidget(s.reportFilters, widgetId);
      const ownWidgetFilters = Array.isArray(w.dataBinding?.widgetFilters) ? w.dataBinding.widgetFilters : [];
      // The slicer's value list MUST reflect the same applied selections
      // as the rest of the report: a global/other-slicer filter on a
      // related dim (e.g. client) must narrow this slicer (e.g.
      // destinataire) — the server bridges related dims through the fact.
      // Regular widgets do this via the `filters` map; slicers used to
      // send `{}`, so they never narrowed. Drop THIS slicer's own dim so
      // it still shows its full universe for that dim, constrained only
      // by the OTHER active filters.
      const appliedFilters = { ...(reportFiltersRef.current || {}) };
      delete appliedFilters[dim];
      const res = await api.post(`/models/${model.id}/query`, {
        dimensionNames: [dim],
        measureNames: [],
        limit: 1000,
        filters: appliedFilters,
        widgetFilters: [...reportLevelFilters, ...ownWidgetFilters],
        distinct: true,
        reportId: id,
        bypassCache: true,
        ...reportExtras,
      });
      const rows = res.data?.rows || [];
      const keys = rows.length > 0 ? Object.keys(rows[0]) : [];
      const values = keys.length > 0
        ? [...new Set(rows.map((r) => r[keys[0]]).filter((v) => v != null))]
        : [];
      const dimDef = (model.dimensions || []).find((x) => x.name === dim);
      history.setSilent((prev) => {
        const cur = prev.widgets?.[widgetId];
        if (!cur) return prev;
        const nextData = { ...(cur.data || {}) };
        nextData.values = values;
        nextData.label = dim;
        nextData._isDate = dimDef?.type === 'date';
        // Any stale search state from before the refresh is now wrong —
        // drop it so the slicer falls back to its fresh data.values.
        delete nextData._searchedValues;
        delete nextData._isSearching;
        return { ...prev, widgets: { ...prev.widgets, [widgetId]: { ...cur, _loading: false, data: nextData } } };
      });
    } catch {
      history.setSilent((prev) => {
        const cur = prev.widgets?.[widgetId];
        if (!cur) return prev;
        return { ...prev, widgets: { ...prev.widgets, [widgetId]: { ...cur, _loading: false } } };
      });
    }
    // `settings` intentionally NOT a dep — refreshSlicer reads it via
    // settingsRef so the synchronous "Save & refresh" path sees the
    // just-committed global filter (closure would be stale).
  }, [model, id, history]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live mirror of refreshSlicer. `useHistory` returns a fresh object every
  // render, so `refreshSlicer` (which depends on `history`) is a new function
  // every render. The slicer-cascade effect below must NOT depend on that
  // identity — if it did, the effect would re-run on every render, its
  // cleanup would cancel the 350ms debounce, and the sig guard would then
  // return early without rescheduling. Net: changing the global filter would
  // never actually fire refreshSlicer (only the direct handleRefresh path
  // worked). Calling through this ref keeps the latest impl without making
  // it an effect dependency.
  const refreshSlicerRef = useRef(refreshSlicer);
  refreshSlicerRef.current = refreshSlicer;

  // Called by chart widgets when user clicks a data point
  const crossFilterSourceRef = useRef(null);
  const handleCrossFilter = useCallback((sourceWidgetId, dimensionName, value) => {
    const w = widgetsRef.current?.[sourceWidgetId];
    // Route to drill-down if widget is drillable and not yet at leaf level
    if (w && isWidgetDrillable(w) && !isWidgetAtLeaf(w)) {
      handleDrillDown(sourceWidgetId, dimensionName, value);
      return;
    }
    const prev = crossHighlightRef.current;
    const isSame = prev && prev.widgetId === sourceWidgetId && prev.value === value;
    if (isSame) {
      crossFilterSourceRef.current = sourceWidgetId;
      setCrossHighlight(null);
      setReportFilters((p) => {
        const n = { ...p };
        if (slicerSelections[dimensionName]) n[dimensionName] = slicerSelections[dimensionName];
        else delete n[dimensionName];
        return n;
      });
    } else {
      crossFilterSourceRef.current = sourceWidgetId;
      setCrossHighlight({ widgetId: sourceWidgetId, dim: dimensionName, value });
      setReportFilters((p) => {
        const n = { ...p };
        if (prev && prev.dim && prev.dim !== dimensionName) {
          if (slicerSelections[prev.dim]) n[prev.dim] = slicerSelections[prev.dim];
          else delete n[prev.dim];
        }
        n[dimensionName] = [value];
        return n;
      });
    }
  }, [slicerSelections, handleDrillDown, isWidgetDrillable, isWidgetAtLeaf]);
  // When filters change, refetch all widgets
  // Cross-filter refetch with debounce + abort + loading indicator
  const prevFiltersJson = useRef('{}');
  const abortControllerRef = useRef(null);
  const debounceTimerRef = useRef(null);
  // Set of queryIds currently registered server-side. handleCancelFetch
  // fires a cancel-query call for each so the underlying SQL is aborted
  // (pg_cancel_backend, KILL QUERY, mssql request.cancel, etc.).
  const activeQueryIdsRef = useRef(new Set());
  // Tracks widgets marked _loading by the in-progress fetcher run. Cleared
  // when the fetch settles. If the effect's cleanup cancels the debounce
  // before it fires, we revert these flags so the spinner doesn't stick.
  const pendingLoadingRef = useRef(null);
  const skipNextRefetch = useRef(false); // set to true when filters are restored from saved state
  const prevRefreshCounter = useRef(0);
  // Tracks whether the *next* refresh-counter bump was caused by an
  // explicit user action (Refresh button) vs an internal trigger like
  // drill-down. Only the former should bypass the cache — drills should
  // still hit the pre-agg cache instead of re-running SQL on every
  // hierarchy change. Set right before the counter bump, consumed by
  // the fetch effect.
  const refreshIsManualRef = useRef(false);

  const [refreshCounter, setRefreshCounter] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = useCallback(() => {
    setRefreshing((r) => r ? r : true);
    refreshIsManualRef.current = true;
    setRefreshCounter((n) => n + 1);
    // Slicers don't go through the main fetch effect — kick them off
    // manually so a global Refresh actually picks up new dim values from
    // the source DB.
    const ws = widgetsRef.current || {};
    for (const [wId, w] of Object.entries(ws)) {
      if (w?.type === 'filter' && w.dataBinding?.selectedDimensions?.[0]) {
        refreshSlicer(wId);
      }
    }
  }, [refreshSlicer]);

  // Filter widgets are skipped by the main fetch effect, so without this
  // a change to the global filter (or a sibling slicer) never narrows a
  // slicer on a RELATED dim — e.g. picking a client must shrink the
  // destinataire slicer (server bridges the two through the fact).
  // refreshSlicer already excludes the slicer's OWN dim, so it keeps its
  // full universe for that dim but is constrained by the others. Skips
  // the initial mount (slicers already hold their saved/restored values
  // for the initial filter state) and debounces rapid filter clicks.
  // No loop: refreshSlicer writes widget.data, never reportFilters/
  // settings.reportFilters (this effect's deps).
  const slicerCascadeTimerRef = useRef(null);
  const slicerCascadeSigRef = useRef(null);
  useEffect(() => {
    const sig = JSON.stringify({
      r: reportFilters || {},
      s: Array.isArray(settings?.reportFilters) ? settings.reportFilters : [],
    });
    if (slicerCascadeSigRef.current === null) { slicerCascadeSigRef.current = sig; return; }
    if (slicerCascadeSigRef.current === sig) return;
    slicerCascadeSigRef.current = sig;
    if (slicerCascadeTimerRef.current) clearTimeout(slicerCascadeTimerRef.current);
    slicerCascadeTimerRef.current = setTimeout(() => {
      const ws = widgetsRef.current || {};
      for (const [wId, w] of Object.entries(ws)) {
        if (w?.type === 'filter' && w.dataBinding?.selectedDimensions?.[0]) {
          refreshSlicerRef.current?.(wId);
        }
      }
    }, 350);
    return () => { if (slicerCascadeTimerRef.current) clearTimeout(slicerCascadeTimerRef.current); };
    // refreshSlicer is intentionally NOT a dep — see refreshSlicerRef above.
    // Depending on it re-ran this effect every render and the cleanup kept
    // cancelling the debounce, so the global filter never narrowed slicers.
  }, [reportFilters, settings?.reportFilters]); // eslint-disable-line react-hooks/exhaustive-deps

  // Per-widget refresh nonces — bumped by the canvas Refresh button to
  // request a fresh fetch of one specific widget without triggering the
  // global refresh loop.
  const [widgetRefreshNonces, setWidgetRefreshNonces] = useState({});
  const handleRefreshWidget = useCallback((wId) => {
    if (!wId) return;
    // Bump the DataPanel-facing nonce so the panel's auxiliary fetches
    // (column-distinct previews, sqlOnly previews) re-fire too.
    setWidgetRefreshNonces((prev) => ({ ...prev, [wId]: (prev[wId] || 0) + 1 }));
    // Scope the widget-data refetch to this widget only, mark as a manual
    // refresh so the server bypasses the result cache, and bump
    // refreshCounter to wake the fetch effect. Without this the per-widget
    // 🔄 button only refreshed DataPanel previews — the actual chart's
    // queries (incl. the combo line-aux query) wouldn't re-fire.
    widgetRefreshIdRef.current = wId;
    refreshIsManualRef.current = true;
    setRefreshCounter((n) => n + 1);
  }, []);

  // Cancel an in-flight data fetch and clear the loading flags so the user
  // isn't stuck with a permanent spinner on a slow query.
  const handleCancelFetch = useCallback(() => {
    // Server-side: tell each registered query to cancel via the dialect's
    // native mechanism. Snapshot + clear the set first so a slow cancel
    // round-trip doesn't fire twice if the user double-clicks. Best-effort:
    // failures here just mean the SQL keeps running, the UI is freed below.
    const queryIds = Array.from(activeQueryIdsRef.current);
    activeQueryIdsRef.current.clear();
    queryIds.forEach((qid) => {
      api.post('/models/cancel-query', { queryId: qid }).catch(() => {});
    });
    if (abortControllerRef.current) abortControllerRef.current.abort();
    if (debounceTimerRef.current) { clearTimeout(debounceTimerRef.current); debounceTimerRef.current = null; }
    const pending = pendingLoadingRef.current;
    pendingLoadingRef.current = null;
    history.setSilent((prev) => {
      const next = { ...prev, widgets: { ...prev.widgets } };
      // Clear _loading on every widget currently marked, plus any explicitly
      // tracked. A user-initiated cancel isn't a data error — strip any
      // existing _error too so the widget either reverts to its previous
      // data or to an empty state (rather than the misleading "Check the
      // model" overlay).
      for (const wId of Object.keys(next.widgets)) {
        const w = next.widgets[wId];
        if (w?._loading || (pending && pending.includes(wId))) {
          const data = { ...(w.data || {}) };
          delete data._error;
          next.widgets[wId] = { ...w, _loading: false, data };
        }
      }
      return next;
    });
    setRefreshing(false);
  }, [history]);

  useEffect(() => {
    // Compare against report-level filters (from Settings) too — changing the
    // Settings filter list must trigger a refetch.
    const json = JSON.stringify({
      r: reportFilters || {},
      s: Array.isArray(settings?.reportFilters) ? settings.reportFilters : [],
    });
    const sourceId = crossFilterSourceRef.current;
    const refreshRequested = refreshCounter !== prevRefreshCounter.current;
    // `bypassCache` is for the Refresh button (force-fresh data), not
    // for drill-triggered refetches — those should still hit the pre-
    // agg cache. The drill flow bumps `refreshCounter` to nudge the
    // effect into running, but doesn't set `refreshIsManualRef`.
    const manualRefresh = refreshRequested && refreshIsManualRef.current;
    refreshIsManualRef.current = false;
    prevRefreshCounter.current = refreshCounter;
    // Skip refetch if we just restored filters from saved state — saved widget data already reflects them
    if (skipNextRefetch.current) {
      skipNextRefetch.current = false;
      prevFiltersJson.current = json;
      return;
    }
    // Skip only if NOTHING changed: filters identical AND no fresh cross-filter click AND no refresh request
    if (json === prevFiltersJson.current && sourceId === null && !refreshRequested) return;
    if (!model) return;
    prevFiltersJson.current = json;

    // Abort previous in-flight requests
    if (abortControllerRef.current) abortControllerRef.current.abort();
    // Clear previous debounce
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);

    crossFilterSourceRef.current = null;
    const currentWidgets = history.state.widgets;
    // Drill-scoped refetch: when a refresh was triggered by a drill click on
    // a non-leaf level, only the drilling widget needs to refire — other
    // visuals shouldn't react to an intermediate drill step. Consume the ref
    // here so it doesn't leak into subsequent unrelated refreshes.
    const drillingId = drillingWidgetIdRef.current;
    drillingWidgetIdRef.current = null;
    // Same idea as drillingId but for the interaction-toggle path: only
    // the target whose None↔Filter setting just changed should refetch.
    const interactionId = interactionToggleTargetRef.current;
    interactionToggleTargetRef.current = null;
    // Same idea again for the per-widget Refresh button (🔄 on each visual).
    const widgetRefreshId = widgetRefreshIdRef.current;
    widgetRefreshIdRef.current = null;
    const scopedToId = drillingId || interactionId || widgetRefreshId;

    const toFetch = Object.entries(currentWidgets).filter(([wId, w]) => {
      if (!w) return false;
      if (scopedToId && wId !== scopedToId) return false;
      // On explicit refresh, refetch ALL (including cross-filter source)
      if (!refreshRequested && wId === sourceId) return false;
      const b = w.dataBinding || {};
      const hasMeas = w.type === 'scatter' ? !!(b.scatterMeasures?.x && b.scatterMeasures?.y)
        : w.type === 'combo' ? (b.comboBarMeasures?.length > 0 || b.comboLineMeasures?.length > 0)
        : b.selectedMeasures?.length > 0;
      const hasMainBinding = (b.selectedDimensions?.length > 0 || hasMeas);
      // Conditional formatting — only counted as a reason to fetch when the toggle is on.
      const hasColorMeas = !!b.colorMeasure && w.config?.colorCondition?.enabled === true;
      if ((w.type === 'filter' || w.type === 'text') && !hasColorMeas) return false;
      if (!(hasMainBinding || hasColorMeas)) return false;
      // Per-widget cache: if this widget's effective filters (after the
      // interaction-exclusion stripping in filterForTarget) AND its
      // binding shape are unchanged from the last successful fetch,
      // there's nothing new to query — skip the refetch. Without this,
      // every reportFilters mutation re-fired SQL on every visual even
      // when the source's "interactions = None" meant nothing actually
      // changed for them.
      const baseFiltersForKey = { ...(reportFilters || {}) };
      const targetFiltersForKey = filterForTarget(wId, baseFiltersForKey, currentWidgets, crossHighlightRef.current);
      const widgetBindingKey = computeBindingKey({ widget: w, model, reportFilters: targetFiltersForKey });
      if (!refreshRequested
          && wId !== scopedToId
          && w.data?._fetchedBinding === widgetBindingKey
          && Object.keys(w.data || {}).length > 1) {
        return false;
      }
      return true;
    });

    if (toFetch.length === 0) return;

    // Mark all target widgets as loading (silent — not an undoable action)
    history.setSilent((prev) => {
      const next = { ...prev, widgets: { ...prev.widgets } };
      toFetch.forEach(([wId]) => {
        if (next.widgets[wId]) next.widgets[wId] = { ...next.widgets[wId], _loading: true };
      });
      return next;
    });
    // Remember which widgets we marked so the cleanup can revert if the
    // debounce gets cancelled before the fetch fires.
    pendingLoadingRef.current = toFetch.map(([wId]) => wId);

    // Debounce 150ms — if user clicks rapidly, only the last one fires
    debounceTimerRef.current = setTimeout(() => {
      const controller = new AbortController();
      abortControllerRef.current = controller;

      const promises = toFetch.map(([wId, w]) => {
        const binding = w.dataBinding || {};
        let dims = binding.selectedDimensions || [];
        const fullHierarchy = [...dims];
        const sm = binding.scatterMeasures || {};
        const cbm = binding.comboBarMeasures || [];
        const clm = binding.comboLineMeasures || [];
        const meass = w.type === 'scatter'
          ? [sm.x, sm.y, sm.size].filter(Boolean)
          : w.type === 'combo'
            ? [...new Set([...cbm, ...clm])]
            : w.type === 'gauge'
              ? [...new Set([...(binding.selectedMeasures || []), binding.gaugeThresholdMeasure, binding.gaugeMaxMeasure].filter(Boolean))]
              : (binding.selectedMeasures || []);
        const grpBy = binding.groupBy || [];
        const colDimsB = binding.columnDimensions || [];

        // Drill-down support: for drillable widgets with >1 dim, use only active dim + filter by drill path
        const DRILLABLE = ['bar', 'line', 'combo', 'pie', 'treemap'];
        const isDrillable = DRILLABLE.includes(w.type) && fullHierarchy.length > 1;
        // Clean drillPath entries that no longer match the hierarchy (stale after bucket edits)
        const drillPath = [];
        if (isDrillable) {
          const raw = Array.isArray(w.drillPath) ? w.drillPath : [];
          for (let i = 0; i < raw.length && i < fullHierarchy.length - 1; i++) {
            if (raw[i]?.dim === fullHierarchy[i]) drillPath.push(raw[i]);
            else break;
          }
        }
        const drillFilters = {};
        if (isDrillable) {
          drillPath.forEach(({ dim, value }) => { if (dim && value != null) drillFilters[dim] = [String(value)]; });
          const activeDim = fullHierarchy[drillPath.length] || fullHierarchy[0];
          dims = [activeDim];
        }

        const allDims = [...dims, ...grpBy.filter((g) => !dims.includes(g)), ...colDimsB.filter((g) => !dims.includes(g) && !grpBy.includes(g))];
        // Cross-filter "Edit interactions" — drop filter dims that come from a
        // source widget which excludes this target. Drill filters are
        // self-imposed by the same widget so they're preserved unchanged.
        const baseFilters = { ...(reportFilters || {}) };
        const targetFilters = filterForTarget(wId, baseFilters, currentWidgets, crossHighlightRef.current);
        const mergedFilters = { ...targetFilters, ...drillFilters };

        const colorMeasure = (w.config?.colorCondition?.enabled === true) ? binding.colorMeasure : undefined;
        // Per-widget view of the report-level global filters. See
        // prepareGlobalRulesForWidget for the dual responsibility (drop
        // excluded rules + strip the editor-only `exclusions` field so it
        // doesn't pollute the preAggCache shape key).
        const reportLevelFilters = prepareGlobalRulesForWidget(settings?.reportFilters, wId);
        const widgetOwnFilters = Array.isArray(binding.widgetFilters) ? binding.widgetFilters : [];
        let widgetFilters = [...reportLevelFilters, ...widgetOwnFilters];
        const hasMainBinding = (allDims.length > 0 || meass.length > 0);

        // Server-side Top N — push the limit into the SQL via a synthetic
        // top_n widget filter when enabled on bar/pie/treemap with measures.
        // Without this, the legacy 1000-row + alphabetical default ORDER BY
        // means a high-cardinality drill-down (commune-level) returns the
        // first 1000 names alphabetically rather than the actual top values.
        const TOP_N_TYPES = ['bar', 'pie', 'treemap'];
        // Restricted to a single displayed dimension. Multi-dim queries
        // (groupBy / columnDimensions) include extra GROUP BY columns, so a
        // top_n on a measure would pick the top (axis × group) pairs, not the
        // top axis values — meaningless for a bar/pie cluster.
        const topNApplies = TOP_N_TYPES.includes(w.type)
          && w.config?.topNEnabled === true
          && meass.length > 0
          && allDims.length === 1;
        const topNValue = topNApplies ? Math.max(1, Math.floor(w.config?.topN ?? 20)) : 0;
        const topNMeasure = topNApplies ? meass[0] : null;
        if (topNApplies) {
          widgetFilters = [
            ...widgetFilters,
            { field: topNMeasure, op: 'top_n', value: topNValue, isMeasure: true },
          ];
        }

        // Report-scoped definitions live on report.settings — the backend
        // merges them with effectiveModel.dimensions/measures so this report can
        // reference dims/measures that don't exist (or have a different
        // label/type) on the underlying model.
        const reportExtras = {
          extraDimensions: settings?.extraDimensions || [],
          extraMeasures: settings?.extraMeasures || [],
          dimensionOverrides: settings?.dimensionOverrides || {},
          measureOverrides: settings?.measureOverrides || {},
        };
        // Generate a queryId so the server can register this fetch in its
        // in-flight map; handleCancelFetch posts to /models/cancel-query
        // with this id to abort the SQL via the dialect's native mechanism.
        const mainQueryId = (typeof crypto !== 'undefined' && crypto.randomUUID)
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random()}`;
        activeQueryIdsRef.current.add(mainQueryId);
        // Per-widget aggregation overrides — e.g. the user flipped a
        // model-defined SUM measure to AVG via the PropertyPanel. Stored
        // on the widget binding. EVERY auxiliary query (main / total /
        // color / n1 / comboLine / sqlOnly preview) needs to forward it,
        // otherwise the server falls back to the model's default agg and
        // the chart value silently diverges from the property panel.
        const aggOverrides = binding.measureAggOverrides || {};
        const aggOverridesPayload = Object.keys(aggOverrides).length > 0 ? aggOverrides : undefined;
        const mainQueryBody = {
          dimensionNames: allDims, measureNames: [...new Set(meass)],
          measureAggOverrides: aggOverridesPayload,
          limit: w.config?.dataLimit || 1000, filters: mergedFilters,
          widgetFilters: sanitizeWidgetFilters(widgetFilters),
          queryId: mainQueryId,
          // Report context — cloud uses this to resolve the workspace
          // override for query timeout. OSS ignores it.
          reportId: id,
          // Manual refresh skips the result cache but still warms it on
          // the way back. Other re-renders (filter / drill / interaction
          // toggle) read straight from cache when shape matches.
          bypassCache: manualRefresh,
          ...reportExtras,
        };
        const mainPromise = hasMainBinding
          ? api.post(`/models/${model.id}/query`, mainQueryBody, { signal: controller.signal })
              .finally(() => { activeQueryIdsRef.current.delete(mainQueryId); })
          : Promise.resolve({ data: { rows: [] } });

        // Total query for the Others bucket — runs only when Top N is active.
        // Sums the same measure WITHOUT the dimension grouping so we can
        // compute Others = total - Σ(top N) accurately.
        const totalPromise = topNApplies
          ? api.post(`/models/${model.id}/query`, {
              dimensionNames: [],
              measureNames: [topNMeasure],
              measureAggOverrides: aggOverridesPayload,
              limit: 1,
              filters: mergedFilters,
              // The top_n synthetic filter is dropped here — we want the
              // grand total, not the truncated one.
              widgetFilters: sanitizeWidgetFilters([...reportLevelFilters, ...widgetOwnFilters]),
              reportId: id,
              bypassCache: manualRefresh,
              ...reportExtras,
            }, { signal: controller.signal }).catch(() => null)
          : Promise.resolve(null);
        // Fire a sqlOnly request in parallel — the server returns the assembled
        // SQL without executing it, so the SQL viewer modal can show the
        // query even while a slow main query is still running. Best-effort.
        if (hasMainBinding) {
          api.post(`/models/${model.id}/query`, { ...mainQueryBody, sqlOnly: true }, { signal: controller.signal })
            .then((r) => {
              const previewSql = r?.data?.sql;
              if (!previewSql) return;
              history.setSilent((prev) => {
                const w2 = prev.widgets?.[wId];
                if (!w2 || w2.data?._sql) return prev; // main query already settled — don't overwrite
                return {
                  ...prev,
                  widgets: { ...prev.widgets, [wId]: { ...w2, data: { ...(w2.data || {}), _sql: previewSql } } },
                };
              });
            })
            .catch(() => { /* ignore — we'll just lack the preview */ });
        }
        const colorPromise = colorMeasure
          ? api.post(`/models/${model.id}/query`, {
              dimensionNames: [], measureNames: [colorMeasure],
              measureAggOverrides: aggOverridesPayload,
              limit: 1, filters: mergedFilters,
              // Drop the synthetic top_n filter for the color aggregate — it
              // doesn't apply when there's no GROUP BY.
              widgetFilters: sanitizeWidgetFilters([...reportLevelFilters, ...widgetOwnFilters]),
              reportId: id,
              bypassCache: manualRefresh,
              ...reportExtras,
            }, { signal: controller.signal }).catch(() => null)
          : Promise.resolve(null);

        // N-1 comparison query (scorecards only). Same SQL shape as the
        // main fetch but every filter on `compareDateDim` is shifted by
        // -1 year so we can render a "vs last year" comparison.
        const compareDateDim = w.type === 'scorecard' ? (binding.compareDateDim || null) : null;
        // The N-1 query is enabled by the user dropping ANY date dim into
        // "Compare with". The system then walks every active filter
        // (merged + widget) and shifts the year component on year-like
        // and full-date dims, leaving month/day filters as-is so the
        // comparison reads "same period, previous year".
        const shouldFetchN1 = !!compareDateDim
          && hasShiftableFilterForN1(mergedFilters, widgetFilters, effectiveModel?.dimensions);
        const n1Filters = shouldFetchN1
          ? shiftFiltersForN1(mergedFilters, effectiveModel?.dimensions)
          : null;
        const n1WidgetFilters = shouldFetchN1
          ? shiftWidgetFiltersForN1(widgetFilters, effectiveModel?.dimensions)
          : null;
        const n1Promise = shouldFetchN1
          ? api.post(`/models/${model.id}/query`, {
              dimensionNames: allDims,
              measureNames: [...new Set(meass)],
              measureAggOverrides: aggOverridesPayload,
              limit: 1,
              filters: n1Filters,
              widgetFilters: sanitizeWidgetFilters(n1WidgetFilters),
              reportId: id,
              bypassCache: manualRefresh,
              ...reportExtras,
            }, { signal: controller.signal }).catch(() => null)
          : Promise.resolve(null);

        // Combo + groupBy + line measures: bars need (dim, groupBy)
        // granularity (each group/category gets its own bar), but the line
        // should be aggregated at the (dim) level only. The previous
        // implementation reduced the line client-side by summing across
        // groups — fine for additive measures, broken for ratios/averages,
        // and worse still it propagates per-row div-by-zero errors from
        // the server (when a category has 0 in the denominator). Run a
        // dedicated line query with just (dim, lineMeasures) so the line
        // is aggregated at the right level and the per-category quirks
        // can't blow up the whole widget.
        const comboLineApplies = w.type === 'combo' && grpBy.length > 0 && clm.length > 0;
        const comboLinePromise = comboLineApplies
          ? api.post(`/models/${model.id}/query`, {
              dimensionNames: dims,
              measureNames: [...new Set(clm)],
              measureAggOverrides: aggOverridesPayload,
              limit: w.config?.dataLimit || 1000,
              filters: mergedFilters,
              widgetFilters: sanitizeWidgetFilters(widgetFilters),
              reportId: id,
              bypassCache: manualRefresh,
              ...reportExtras,
            }, { signal: controller.signal }).catch(() => null)
          : Promise.resolve(null);

        return Promise.all([mainPromise, colorPromise, totalPromise, n1Promise, comboLinePromise]).then(([res, colorRes, totalRes, n1Res, comboLineRes]) => {
          // Conditional formatting — extract a single aggregated value from the color query
          let _colorValue;
          if (colorRes) {
            const cRow = colorRes.data?.rows?.[0];
            if (cRow) {
              const v = Object.values(cRow)[0];
              const num = typeof v === 'number' ? v : parseFloat(v);
              if (!isNaN(num)) _colorValue = num;
            }
          }

          const rows = res.data?.rows;
          // Combine both queries' SQL when an auxiliary line query was
          // fired, so the SQL viewer shows the user every statement that
          // contributed to the rendered chart — not just the bars query.
          const mainSql = res.data?.sql || null;
          const lineSql = comboLineRes?.data?.sql || null;
          const sql = mainSql && lineSql
            ? `-- Main query (bars)\n${mainSql}\n\n-- Line aggregation (dim only, no groupBy)\n${lineSql}`
            : mainSql;
          if (!rows || rows.length === 0) {
            // Even on empty results, we keep the drill metadata around so the
            // canvas still shows the up/reset arrows — otherwise the user gets
            // stranded at a drilled level they can't navigate back from.
            const emptyData = { _rowCount: 0, _colorValue, _sql: sql };
            if (isDrillable) {
              emptyData._hierarchy = fullHierarchy.map((dn) => {
                const def = (effectiveModel.dimensions || []).find((x) => x.name === dn);
                return { name: dn, label: def?.label || def?.name || dn };
              });
              emptyData._drillPath = drillPath;
              emptyData._drillDepth = drillPath.length;
              emptyData._isDrillLeaf = drillPath.length >= fullHierarchy.length - 1;
            }
            // Use the per-widget targetFilters (post interaction-exclusion
            // stripping) so the cache key matches what `toFetch` checks
            // when deciding whether to skip subsequent renders.
            emptyData._fetchedBinding = computeBindingKey({ widget: w, model, reportFilters: targetFilters });
            return { wId, data: emptyData };
          }
          let newData = {};
          const keys = Object.keys(rows[0]);
          if (w.type === 'pivotTable') {
            const rowDimNames = dims.filter((d) => !colDimsB.includes(d));
            newData = { rawRows: rows,
              _rowDims: rowDimNames.map((d) => { const def = (effectiveModel.dimensions || []).find((x) => x.name === d); return def?.label || def?.name || d; }),
              _colDims: colDimsB.map((d) => { const def = (effectiveModel.dimensions || []).find((x) => x.name === d); return def?.label || def?.name || d; }),
              _measures: meass.map((m) => { const def = (effectiveModel.measures || []).find((x) => x.name === m); return def?.label || def?.name || m; }),
            };
          } else if (w.type === 'scatter') {
            if (sm.x && sm.y) {
              const gl = (name, list) => { const d = list.find((x) => x.name === name); return d?.label || d?.name || name; };
              const dimLbl = dims.length > 0 ? gl(dims[0], effectiveModel.dimensions || []) : null;
              const grpLbl = grpBy.length > 0 ? gl(grpBy[0], effectiveModel.dimensions || []) : null;
              const xLbl = gl(sm.x, effectiveModel.measures || []);
              const yLbl = gl(sm.y, effectiveModel.measures || []);
              const sizeLbl = sm.size ? gl(sm.size, effectiveModel.measures || []) : null;
              const fk = (l) => keys.find((k) => k === l) || null;
              const dk = dimLbl ? fk(dimLbl) : null;
              const gk = grpLbl ? fk(grpLbl) : null;
              const xk = fk(xLbl), yk = fk(yLbl);
              const sk = sizeLbl ? fk(sizeLbl) : null;
              if (xk && yk) {
                const bp = (r) => ({ x: Number(r[xk]) || 0, y: Number(r[yk]) || 0, size: sk ? Number(r[sk]) || 0 : undefined, label: dk ? String(r[dk] ?? '') : undefined });
                if (gk) {
                  const groups = {};
                  rows.forEach((r) => { const g = String(r[gk] ?? ''); if (!groups[g]) groups[g] = []; groups[g].push(bp(r)); });
                  newData = { points: rows.map(bp), seriesGroups: Object.entries(groups).map(([name, pts]) => ({ name, points: pts })) };
                } else {
                  newData = { points: rows.map(bp) };
                }
                newData._xLabel = xLbl;
                newData._yLabel = yLbl;
                newData._hasSize = !!sk;
                if (sk) newData._sizeLabel = sizeLbl;
              }
            }
          } else if (w.type === 'combo') {
            if (rows.length > 0) {
              const gl = (name, list) => { const d = list.find((x) => x.name === name); return d?.label || d?.name || name; };
              const fk = (label) => keys.find((k) => k === label) || null;
              const axisKey = dims.length > 0 ? fk(gl(dims[0], effectiveModel.dimensions || [])) || keys[0] : keys[0];
              const grpLabel = grpBy.length > 0 ? gl(grpBy[0], effectiveModel.dimensions || []) : null;
              const grpKey = grpLabel ? fk(grpLabel) : null;
              const labels = [...new Set(rows.map((r) => String(r[axisKey] ?? '')))];
              // Bar series: split by legend
              let barSeries = [];
              if (grpKey) {
                const ug = [...new Set(rows.map((r) => String(r[grpKey] ?? '')))].sort();
                cbm.forEach((mn) => { const ml = gl(mn, effectiveModel.measures || []); const mk = fk(ml); if (!mk) return;
                  ug.forEach((gv) => { barSeries.push({ name: cbm.length === 1 ? gv : `${gv} - ${ml}`, values: labels.map((l) => { const row = rows.find((r) => String(r[axisKey] ?? '') === l && String(r[grpKey] ?? '') === gv); return row ? Number(row[mk]) || 0 : 0; }) }); });
                });
              } else {
                cbm.forEach((mn) => { const ml = gl(mn, effectiveModel.measures || []); const mk = fk(ml); if (!mk) return; barSeries.push({ name: ml, values: labels.map((l) => { const row = rows.find((r) => String(r[axisKey] ?? '') === l); return row ? Number(row[mk]) || 0 : 0; }) }); });
              }
              // Line series: when there's a groupBy we run a dedicated
              // query (comboLineRes) that aggregates the line at the
              // (dim) level only — the rows there have one entry per
              // axis value with the line measure already aggregated
              // correctly. Without that auxiliary query (no groupBy or
              // the request errored), fall back to the legacy client-
              // side reduce which is only correct for additive measures.
              let lineSeries;
              const lineRows = comboLineRes?.data?.rows;
              if (lineRows && grpBy.length > 0) {
                const lineKeys = lineRows.length > 0 ? Object.keys(lineRows[0]) : [];
                lineSeries = clm.map((mn) => {
                  const ml = gl(mn, effectiveModel.measures || []);
                  const mk = lineKeys.includes(ml) ? ml : (lineKeys.includes(mn) ? mn : null);
                  if (!mk) return null;
                  return {
                    name: ml,
                    values: labels.map((l) => {
                      const row = lineRows.find((r) => String(r[axisKey] ?? '') === l);
                      return row ? Number(row[mk]) || 0 : 0;
                    }),
                  };
                }).filter(Boolean);
              } else {
                lineSeries = clm.map((mn) => { const ml = gl(mn, effectiveModel.measures || []); const mk = fk(ml); if (!mk) return null;
                  return { name: ml, values: labels.map((l) => rows.filter((r) => String(r[axisKey] ?? '') === l).reduce((s, r) => s + (Number(r[mk]) || 0), 0)) };
                }).filter(Boolean);
              }
              newData = { labels, barSeries, lineSeries };
              newData._barMeasureLabel = cbm.map((mn) => gl(mn, effectiveModel.measures || [])).join(', ');
              newData._lineMeasureLabel = clm.map((mn) => gl(mn, effectiveModel.measures || [])).join(', ');
            }
          } else if (w.type === 'table') {
            newData = { columns: keys, rows: rows.map((r) => Object.values(r).map((v) => v != null ? String(v) : '')) };
          } else if (w.type === 'customVisual') {
            // Normalised tabular form for custom visuals — `rows` are kept as-is
            // (server-side already keys them by display label) and `fields` describes
            // the role of each column so the iframe-rendered visual can interpret them.
            const dimsMeta = dims.map((name) => {
              const d = (effectiveModel.dimensions || []).find((x) => x.name === name);
              return { name: d?.label || d?.name || name, role: 'category', sourceName: name };
            });
            const measMeta = meass.map((name) => {
              const m = (effectiveModel.measures || []).find((x) => x.name === name);
              return { name: m?.label || m?.name || name, role: 'value', format: m?.format, sourceName: name };
            });
            newData = { rows, fields: { dimensions: dimsMeta, measures: measMeta } };
          } else if (w.type === 'pie' || w.type === 'treemap') {
            newData = { items: rows.map((r) => ({ name: String(r[keys[0]]), value: Number(r[keys[keys.length - 1]]) || 0 })) };
          } else if (w.type === 'scorecard' || w.type === 'gauge') {
            const firstRow = rows[0];
            if (firstRow) {
              const valueMeasName = w.dataBinding?.selectedMeasures?.[0];
              const valueMeasDef = (effectiveModel.measures || []).find((m) => m.name === valueMeasName);
              const valueKey = valueMeasDef?.label || valueMeasDef?.name || valueMeasName;
              const measureVal = valueKey && firstRow[valueKey] !== undefined ? firstRow[valueKey] : Object.values(firstRow)[0];
              newData = {
                value: measureVal,
                label: valueMeasDef?.label || valueMeasName || '',
              };
              // N-1 comparison value (scorecard only). Same column key as
              // the main value — the parallel query has the same SELECT
              // shape, only its WHERE shifted.
              if (w.type === 'scorecard' && n1Res?.data?.rows?.[0]) {
                const n1Row = n1Res.data.rows[0];
                const n1Raw = valueKey && n1Row[valueKey] !== undefined ? n1Row[valueKey] : Object.values(n1Row)[0];
                const n1Num = typeof n1Raw === 'number' ? n1Raw : parseFloat(String(n1Raw));
                if (!isNaN(n1Num)) newData._n1Value = n1Num;
              }
              if (w.type === 'gauge') {
                const extractMeas = (measName) => {
                  if (!measName) return undefined;
                  const def = (effectiveModel.measures || []).find((m) => m.name === measName);
                  const key = def?.label || def?.name || measName;
                  const raw = firstRow[key];
                  if (typeof raw === 'number') return raw;
                  if (raw != null) {
                    const parsed = parseFloat(String(raw));
                    if (!isNaN(parsed)) return parsed;
                  }
                  return undefined;
                };
                const th = extractMeas(w.dataBinding?.gaugeThresholdMeasure);
                if (th !== undefined) newData.threshold = th;
                const mx = extractMeas(w.dataBinding?.gaugeMaxMeasure);
                if (mx !== undefined) newData.maxValue = mx;
              }
            }
          } else if (grpBy.length > 0 && keys.length >= 3) {
            const [axisKey, groupKey] = keys; const valueKey = keys[keys.length - 1];
            const ul = [...new Set(rows.map((r) => String(r[axisKey])))];
            const ug = [...new Set(rows.map((r) => String(r[groupKey])))];
            newData = { labels: ul, series: ug.map((gv) => ({ name: gv, values: ul.map((l) => { const row = rows.find((r) => String(r[axisKey]) === l && String(r[groupKey]) === gv); return row ? Number(row[valueKey]) || 0 : 0; }) })) };
          } else {
            newData = { labels: rows.map((r) => String(r[keys[0]])), values: rows.map((r) => Number(r[keys[keys.length - 1]]) || 0) };
          }
          const mf = {};
          // Track interval-typed measure columns so widgets can format them
          // as a human duration ("1h", "30min", "45s") rather than the raw
          // EPOCH-seconds number the server returns. Keyed by display label
          // (matches what shows up as the column name in the row payload).
          const durationCols = [];
          meass.forEach((mn) => {
            const md = (effectiveModel.measures || []).find((x) => x.name === mn);
            if (!md) return;
            const colKey = md.label || md.name;
            if (md.format) mf[colKey] = md.format;
            if (String(md.dataType || '').toLowerCase() === 'interval') durationCols.push(colKey);
          });
          newData._measureFormats = mf;
          if (durationCols.length > 0) newData._durationColumns = durationCols;
          if (dims.length > 0) {
            newData._dimName = dims[0];
            const axisDim = (effectiveModel.dimensions || []).find((x) => x.name === dims[0]);
            newData._dimLabel = axisDim?.label || axisDim?.name || dims[0];
            if (axisDim?.datePart) newData._datePart = axisDim.datePart;
            else if (axisDim?.type === 'date') newData._datePart = 'full_date';
            if (axisDim) newData._axisDimDef = { type: axisDim.type, datePart: axisDim.datePart };
          }
          if (grpBy.length > 0) {
            // Per-zone Legend sort needs the type/datePart so the widget
            // can sort series chronologically when the legend is a
            // date-part dim (months in calendar order, not alphabetical).
            const legendDim = (effectiveModel.dimensions || []).find((x) => x.name === grpBy[0]);
            if (legendDim) newData._legendDimDef = { type: legendDim.type, datePart: legendDim.datePart };
          }
          if (meass.length > 0) {
            const m0 = (effectiveModel.measures || []).find((x) => x.name === meass[0]);
            newData._measureLabel = m0?.label || m0?.name || meass[0];
          }
          newData._rowCount = rows.length;
          if (isDrillable) {
            newData._hierarchy = fullHierarchy.map((dn) => {
              const def = (effectiveModel.dimensions || []).find((x) => x.name === dn);
              return { name: dn, label: def?.label || def?.name || dn };
            });
            newData._drillPath = drillPath;
            newData._drillDepth = drillPath.length;
            newData._isDrillLeaf = drillPath.length >= fullHierarchy.length - 1;
          }
          newData._colorValue = _colorValue;
          newData._sql = sql;
          // Server-side Top N: extract the grand total so the widget can
          // derive Others = total − Σ(top N) without further client work.
          if (topNApplies && totalRes) {
            const tRow = totalRes.data?.rows?.[0];
            if (tRow) {
              const v = Object.values(tRow)[0];
              const num = typeof v === 'number' ? v : parseFloat(v);
              if (!isNaN(num)) newData._othersTotal = num;
            }
          }
          // Stamp the binding cache key so DataPanel doesn't refetch on the
          // next widget selection — the data is already fresh for this
          // binding. Use the per-widget targetFilters so the key matches
          // the no-op skip check in `toFetch`.
          newData._fetchedBinding = computeBindingKey({ widget: w, model, reportFilters: targetFilters });
          return { wId, data: newData };
        }).catch((err) => {
          if (err?.name === 'CanceledError' || err?.code === 'ERR_CANCELED') return { wId, data: null };
          const msg = err?.response?.data?.error || err?.message || 'Query failed';
          const code = err?.response?.data?.code || null;
          const timeoutMs = err?.response?.data?.timeoutMs || null;
          return { wId, data: { _error: msg, _errorCode: code, _errorTimeoutMs: timeoutMs, _rowCount: 0 } };
        });
      });

      // Wait for ALL to complete, then batch update (silent — data fetch is not undoable)
      Promise.all(promises).then((results) => {
        // The fetch fired — the loading flags will be replaced below, no need
        // for the cleanup safety net to revert them.
        pendingLoadingRef.current = null;
        if (controller.signal.aborted) { setRefreshing(false); return; }
        history.setSilent((prev) => {
          const next = { ...prev, widgets: { ...prev.widgets } };
          results.forEach(({ wId, data }) => {
            if (next.widgets[wId]) {
              next.widgets[wId] = { ...next.widgets[wId], _loading: false, data: data || {} };
            }
          });
          return next;
        });
        setRefreshing(false);
      });
    }, 150);

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      // If we marked widgets as loading but the debounced fetch never fired,
      // revert those flags so the spinner doesn't stick. (Cleared once the
      // fetch actually starts so the in-flight Promise.all owns the cleanup.)
      const pending = pendingLoadingRef.current;
      if (pending && pending.length > 0) {
        pendingLoadingRef.current = null;
        history.setSilent((prev) => {
          const next = { ...prev, widgets: { ...prev.widgets } };
          for (const wId of pending) {
            if (next.widgets[wId]) next.widgets[wId] = { ...next.widgets[wId], _loading: false };
          }
          return next;
        });
      }
    };
    // `settingsFiltersKey` is intentionally NOT in the deps. Edits to
    // `settings.reportFilters` come through the ReportFilterBar, which calls
    // `handleRefresh` directly on every commit — so reacting here would
    // double-fire the fetch.
  }, [reportFilters, model, refreshCounter]); // eslint-disable-line react-hooks/exhaustive-deps

  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [reportFilterBarOpen, setReportFilterBarOpen] = useState(false);
  // Live count of visible chips in the filter bar — emitted by ReportFilterBar
  // so the toolbar badge reflects unsaved removals/additions in real time.
  // Falls back to persisted length until the bar has reported once.
  const [liveReportFilterCount, setLiveReportFilterCount] = useState(null);

  // Multi-page support
  const [pages, setPages] = useState([{ id: 'page-1', name: 'Page 1' }]);
  const [currentPageIdx, setCurrentPageIdx] = useState(0);
  const pagesDataRef = useRef({}); // stores { [pageId]: { layout, widgets } }

  // While the pages column animates open/closed, take the canvas out of the flex flow and pin
  // it absolutely at its current position/size. That way the column animation doesn't shift or
  // resize the canvas — neither layout nor paint of the widgets is touched. When the animation
  // ends, the canvas re-enters flex and reflows once to its new size.
  const canvasWrapperRef = useRef(null);
  // Ref attached to the actual report canvas DOM node — used by ExportMenu for PDF/PNG capture.
  const canvasRef = useRef(null);
  const [pinnedRect, setPinnedRect] = useState(null);
  const pinCanvas = useCallback(() => {
    const el = canvasWrapperRef.current;
    if (!el || !el.parentElement) return;
    const r = el.getBoundingClientRect();
    const p = el.parentElement.getBoundingClientRect();
    setPinnedRect({ left: r.left - p.left, top: r.top - p.top, width: r.width, height: r.height });
  }, []);
  const unpinCanvas = useCallback(() => setPinnedRect(null), []);
  const handlePagesNavAnimation = useCallback(() => {
    pinCanvas();
    setTimeout(unpinCanvas, PAGES_COLUMN_TRANSITION_MS);
  }, [pinCanvas, unpinCanvas]);

  // Switch page: save current, load target
  const switchPage = useCallback((idx) => {
    if (idx === currentPageIdx) return;
    const curPage = pages[currentPageIdx];
    if (curPage) {
      pagesDataRef.current[curPage.id] = { layout: history.state.layout, widgets: history.state.widgets };
    }
    setCurrentPageIdx(idx);
    setSelectedWidget(null);
    const targetPage = pages[idx];
    const targetData = pagesDataRef.current[targetPage.id] || { layout: [], widgets: {} };
    history.set(targetData);
  }, [currentPageIdx, pages, history, setSelectedWidget]);

  const addPage = useCallback(() => {
    const curPage = pages[currentPageIdx];
    pagesDataRef.current[curPage.id] = { layout: history.state.layout, widgets: history.state.widgets };
    const newId = `page-${Date.now()}`;
    // Generate unique page name
    let num = pages.length + 1;
    while (pages.some((p) => p.name.toLowerCase() === `page ${num}`)) num++;
    const newPages = [...pages, { id: newId, name: `Page ${num}` }];
    setPages(newPages);
    pagesDataRef.current[newId] = { layout: [], widgets: {} };
    setCurrentPageIdx(newPages.length - 1);
    setSelectedWidget(null);
    history.set({ layout: [], widgets: {} });
  }, [pages, currentPageIdx, history, setSelectedWidget]);

  const deletePage = useCallback((idx) => {
    if (pages.length <= 1) return;
    if (!confirm(`Delete "${pages[idx].name}"?`)) return;
    const pageId = pages[idx].id;
    delete pagesDataRef.current[pageId];
    const newPages = pages.filter((_, i) => i !== idx);
    setPages(newPages);
    const newIdx = idx >= newPages.length ? newPages.length - 1 : idx;
    setCurrentPageIdx(newIdx);
    setSelectedWidget(null);
    const targetData = pagesDataRef.current[newPages[newIdx].id] || { layout: [], widgets: {} };
    history.set(targetData);
  }, [pages, history, setSelectedWidget]);

  const copyPage = useCallback((idx) => {
    const curPage = pages[currentPageIdx];
    pagesDataRef.current[curPage.id] = { layout: history.state.layout, widgets: history.state.widgets };
    const srcPage = pages[idx];
    const srcData = pagesDataRef.current[srcPage.id] || { layout: [], widgets: {} };
    const newId = `page-${Date.now()}`;
    // Generate unique copy name
    let copyName = `${srcPage.name} (copy)`;
    let n = 2;
    while (pages.some((p) => p.name.toLowerCase() === copyName.toLowerCase())) {
      copyName = `${srcPage.name} (copy ${n++})`;
    }
    // Deep copy layout and widgets
    const copiedLayout = JSON.parse(JSON.stringify(srcData.layout));
    const copiedWidgets = JSON.parse(JSON.stringify(srcData.widgets));
    const newPages = [...pages, { id: newId, name: copyName }];
    pagesDataRef.current[newId] = { layout: copiedLayout, widgets: copiedWidgets };
    setPages(newPages);
    setCurrentPageIdx(newPages.length - 1);
    setSelectedWidget(null);
    history.set({ layout: copiedLayout, widgets: copiedWidgets });
  }, [pages, currentPageIdx, history, setSelectedWidget]);

  const renamePage = useCallback((idx, newName) => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    // Check for duplicate name
    const isDuplicate = pages.some((p, i) => i !== idx && p.name.toLowerCase() === trimmed.toLowerCase());
    if (isDuplicate) {
      alert(`A page named "${trimmed}" already exists.`);
      return;
    }
    setPages((prev) => prev.map((p, i) => i === idx ? { ...p, name: trimmed } : p));
  }, [pages]);

  const setLayout = useCallback((updater) => {
    history.set((prev) => ({
      ...prev,
      layout: typeof updater === 'function' ? updater(prev.layout) : updater,
    }));
  }, [history]);

  const setWidgets = useCallback((updater) => {
    history.set((prev) => ({
      ...prev,
      widgets: typeof updater === 'function' ? updater(prev.widgets) : updater,
    }));
  }, [history]);

  // Batch update layout + widgets together (single undo step)
  const setLayoutAndWidgets = useCallback((layoutUpdater, widgetsUpdater) => {
    history.set((prev) => ({
      layout: typeof layoutUpdater === 'function' ? layoutUpdater(prev.layout) : layoutUpdater,
      widgets: typeof widgetsUpdater === 'function' ? widgetsUpdater(prev.widgets) : widgetsUpdater,
    }));
  }, [history]);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await api.get(`/reports/${id}`);
        const r = res.data.report;
        setReport(r);
        setTitle(r.title);
        setSettings(r.settings || {});
        // Auto-reveal the filter bar on load if the report already has rules,
        // so users don't lose sight of active filters. After this initial sync
        // the bar is fully user-controlled (toolbar toggle / × dismiss).
        if (Array.isArray(r.settings?.reportFilters) && r.settings.reportFilters.length > 0) {
          setReportFilterBarOpen(true);
        }

        // Load pages (backward compat: if no pages, create one from layout/widgets)
        const reportPages = r.pages || r.settings?.pages;
        let firstPageWidgets = {};
        if (reportPages && reportPages.length > 0) {
          setPages(reportPages.map((p) => ({ id: p.id, name: p.name })));
          reportPages.forEach((p) => {
            pagesDataRef.current[p.id] = { layout: p.layout || [], widgets: p.widgets || {} };
          });
          firstPageWidgets = reportPages[0].widgets || {};
          history.set({ layout: reportPages[0].layout || [], widgets: firstPageWidgets });
        } else {
          const defaultPage = { id: 'page-1', name: 'Page 1' };
          setPages([defaultPage]);
          pagesDataRef.current[defaultPage.id] = { layout: r.layout || [], widgets: r.widgets || {} };
          firstPageWidgets = r.widgets || {};
          history.set({ layout: r.layout || [], widgets: firstPageWidgets });
        }
        setCurrentPageIdx(0);

        // slicerSelections/reportFilters are auto-derived from widgets' config.selectedValues.
        // Skip the resulting refetch — but only when the saved data is actually
        // present. Reports saved before the data.values cap fix could have
        // stripped widget.data; in that case we must let the effect fire so
        // visuals repopulate.
        const hasSavedFilter = Object.values(firstPageWidgets).some((w) => {
          if (w?.type !== 'filter') return false;
          return Array.isArray(w.config?.selectedValues) && w.config.selectedValues.length > 0;
        });
        const hasUsableSavedData = Object.values(firstPageWidgets).every((w) => {
          if (!w || w.type === 'text' || w.type === 'shape' || w.type === 'image') return true;
          const d = w.data;
          if (!d || typeof d !== 'object') return false;
          return Array.isArray(d.values)
            || Array.isArray(d.rows)
            || Array.isArray(d.labels)
            || Array.isArray(d.items)
            || Array.isArray(d.points)
            || Array.isArray(d.barSeries)
            || Array.isArray(d.rawRows)
            || typeof d.value !== 'undefined';
        });
        if (hasSavedFilter && hasUsableSavedData) skipNextRefetch.current = true;

        if (r.model_id) {
          const modelRes = await api.get(`/models/${r.model_id}`);
          setModel(modelRes.data.model);
        }
        // After initial load, the state matches what's on the server — snapshot it
        savedSnapshotRef.current = buildSnapshot(
          r.title,
          r.settings || {},
          reportPages && reportPages.length > 0
            ? reportPages.map((p) => ({ id: p.id, name: p.name, layout: p.layout || [], widgets: p.widgets || {} }))
            : [{ id: 'page-1', name: 'Page 1', layout: r.layout || [], widgets: r.widgets || {} }],
        );
      } catch {
        navigate('/');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id, navigate]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard shortcuts: Delete, Ctrl+Z, Ctrl+Y
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Delete selected widget
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedWidget) {
        // Don't delete if user is typing in an input
        const tag = e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

        e.preventDefault();
        handleDeleteWidget(selectedWidget);
      }

      // Ctrl+Z = undo
      if (e.ctrlKey && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        history.undo();
      }

      // Ctrl+Y or Ctrl+Shift+Z = redo
      if ((e.ctrlKey && e.key === 'y') || (e.ctrlKey && e.shiftKey && e.key === 'z')) {
        e.preventDefault();
        history.redo();
      }

      // Ctrl+C = copy selected widget
      if (e.ctrlKey && e.key === 'c' && selectedWidget) {
        const tag = e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        const widgetData = widgets[selectedWidget];
        const layoutItem = layout.find((l) => l.i === selectedWidget);
        if (widgetData && layoutItem) {
          setClipboard({ widget: JSON.parse(JSON.stringify(widgetData)), layout: { ...layoutItem } });
        }
      }

      // Ctrl+V = paste copied widget
      if (e.ctrlKey && e.key === 'v' && clipboard) {
        const tag = e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        e.preventDefault();
        const newId = uuidv4();
        const newLayout = {
          ...clipboard.layout,
          i: newId,
          x: (clipboard.layout.x || 0) + 20,
          y: (clipboard.layout.y || 0) + 20,
        };
        const newWidget = JSON.parse(JSON.stringify(clipboard.widget));
        // Clear fetched data to avoid stale cache
        if (newWidget.data) delete newWidget.data._fetchedBinding;
        setLayoutAndWidgets(
          (prev) => [...prev, newLayout],
          (prev) => ({ ...prev, [newId]: newWidget }),
        );
        setSelectedWidget(newId);
        // Update clipboard position for next paste
        setClipboard({ widget: clipboard.widget, layout: newLayout });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedWidget, history, clipboard, widgets, layout, setLayoutAndWidgets]);

  const handleAddWidget = useCallback((type, subType, extraConfig, customSize) => {
    const widgetId = uuidv4();
    const defaultSize = customSize || WIDGET_TYPES[type]?.defaultSize || { w: 24, h: 16 };

    // If a widget is selected and not adding a shape/object, transform it
    if (selectedWidget && widgets[selectedWidget] && type !== 'shape') {
      const existing = widgets[selectedWidget];
      const convertedData = convertData(existing.data, existing.type, type);

      // Clean dataBinding: remove fields not supported by the new type
      const newBinding = { ...existing.dataBinding };
      if (type !== 'bar') {
        delete newBinding.groupBy;
      }

      // Strip the cache marker so the data panel re-fetches with the new
      // widget type's expected shape instead of reusing the converted (best
      // effort) blob.
      const { _fetchedBinding, ...convertedDataNoCache } = convertedData || {};
      setWidgets((prev) => ({
        ...prev,
        [selectedWidget]: {
          ...existing,
          type,
          data: convertedDataNoCache,
          dataBinding: newBinding,
          config: {
            ...existing.config,
            subType: subType || undefined,
          },
        },
      }));
      return;
    }

    const pw = settings.pageWidth || 1140;
    const ph = settings.pageHeight || 800;
    const ww = defaultSize.w > 100 ? defaultSize.w : defaultSize.w * 20;
    const wh = defaultSize.h > 100 ? defaultSize.h : defaultSize.h * 20;

    setLayoutAndWidgets(
      (prevLayout) => [
        ...prevLayout,
        {
          i: widgetId,
          x: Math.max(0, Math.round((pw - ww) / 2)),
          y: Math.max(0, Math.round((ph - wh) / 2)),
          w: ww,
          h: wh,
        },
      ],
      (prevWidgets) => ({
        ...prevWidgets,
        [widgetId]: {
          type,
          data: {},
          config: {
            ...(subType ? { subType } : {}),
            // Filter widgets: no border by default, tighter padding
            ...(type === 'filter' ? { borderEnabled: false } : {}),
            ...extraConfig,
          },
        },
      })
    );

    setSelectedWidget(widgetId);
  }, [selectedWidget, widgets, setWidgets, setLayoutAndWidgets]);

  const handleUpdateWidget = useCallback((widgetId, updatedWidget) => {
    setWidgets((prev) => ({
      ...prev,
      [widgetId]: updatedWidget,
    }));
  }, [setWidgets]);

  // Silent version — for fetch-related updates (loading/data) that should NOT pollute undo history
  const handleUpdateWidgetSilent = useCallback((widgetId, updatedWidget) => {
    history.setSilent((prev) => ({
      ...prev,
      widgets: { ...prev.widgets, [widgetId]: updatedWidget },
    }));
  }, [history]);
  // Granular loading-flag setter — used by DataPanel to clear `_loading`
  // on a widget whose fetch got aborted mid-flight (the user clicked
  // another widget before the fetch returned). Without this the spinner
  // stays stuck on the original widget.
  const handleSetWidgetLoading = useCallback((widgetId, isLoading) => {
    history.setSilent((prev) => {
      const w = prev.widgets?.[widgetId];
      if (!w) return prev;
      if (!!w._loading === !!isLoading) return prev;
      return { ...prev, widgets: { ...prev.widgets, [widgetId]: { ...w, _loading: !!isLoading } } };
    });
  }, [history]);

  const handleBringToFront = useCallback((widgetId) => {
    setLayout((prev) => {
      const maxZ = Math.max(...prev.map((item) => item.z || 1));
      return prev.map((item) => item.i === widgetId ? { ...item, z: maxZ + 1 } : item);
    });
  }, [setLayout]);

  const handleSendToBack = useCallback((widgetId) => {
    setLayout((prev) => {
      const minZ = Math.min(...prev.map((item) => item.z || 1));
      return prev.map((item) => item.i === widgetId ? { ...item, z: Math.max(1, minZ - 1) } : item);
    });
  }, [setLayout]);

  const handleBringForward = useCallback((widgetId) => {
    setLayout((prev) => {
      const currentZ = prev.find((item) => item.i === widgetId)?.z || 1;
      return prev.map((item) => item.i === widgetId ? { ...item, z: currentZ + 1 } : item);
    });
  }, [setLayout]);

  const handleSendBackward = useCallback((widgetId) => {
    setLayout((prev) => {
      const currentZ = prev.find((item) => item.i === widgetId)?.z || 1;
      return prev.map((item) => item.i === widgetId ? { ...item, z: Math.max(1, currentZ - 1) } : item);
    });
  }, [setLayout]);

  const handleDeleteWidget = useCallback((widgetId) => {
    const prevCH = crossHighlightRef.current;
    const wasCrossFilterSource = prevCH && prevCH.widgetId === widgetId;

    setLayoutAndWidgets(
      (prevLayout) => prevLayout.filter((item) => item.i !== widgetId),
      (prevWidgets) => {
        const next = { ...prevWidgets };
        delete next[widgetId];
        return next;
      }
    );
    setSelectedWidget(null);

    // Clear cross-highlight if deleting the source widget — slicer state auto-resyncs via useEffect(widgets)
    if (wasCrossFilterSource) setCrossHighlight(null);
  }, [setLayoutAndWidgets]);

  const handleLoadMore = useCallback(async (widgetId) => {
    const widget = widgets[widgetId];
    if (!widget || widget.type !== 'table' || !model) return;
    if (widget.data?._loadingMore || widget.data?._hasMore === false) return;

    const binding = widget.dataBinding || {};
    const dims = binding.selectedDimensions || [];
    const meass = binding.selectedMeasures || [];
    if (dims.length === 0 && meass.length === 0) return;

    const currentRows = widget.data?.rows || [];
    const dataLimit = widget.config?.dataLimit || 1000;

    // Apply the same filter stack as the main fetcher so paginated rows match
    // the user's filter selection. Without this, scrolling appends unfiltered
    // data to a filtered table.
    const baseFilters = { ...(reportFilters || {}) };
    const targetFilters = filterForTarget(widgetId, baseFilters, widgets, crossHighlightRef.current);
    const reportLevelFilters = prepareGlobalRulesForWidget(settings?.reportFilters, widgetId);
    const widgetOwnFilters = Array.isArray(binding.widgetFilters) ? binding.widgetFilters : [];
    const combinedWidgetFilters = [...reportLevelFilters, ...widgetOwnFilters];

    // Mark as loading (silent — not undoable)
    history.setSilent((prev) => ({
      ...prev,
      widgets: { ...prev.widgets, [widgetId]: { ...prev.widgets[widgetId], data: { ...prev.widgets[widgetId].data, _loadingMore: true } } },
    }));

    try {
      const res = await api.post(`/models/${model.id}/query`, {
        dimensionNames: dims,
        measureNames: meass,
        limit: dataLimit,
        offset: currentRows.length,
        filters: targetFilters,
        widgetFilters: sanitizeWidgetFilters(combinedWidgetFilters),
        // Pass the report's extras so the load-more SQL matches the initial
        // query exactly (extras affect dim resolution + SELECT shape).
        extraDimensions: settings?.extraDimensions || [],
        extraMeasures: settings?.extraMeasures || [],
        dimensionOverrides: settings?.dimensionOverrides || {},
        measureOverrides: settings?.measureOverrides || {},
      });

      const newRows = res.data.rows;
      const hasMore = newRows.length >= dataLimit;

      history.setSilent((prev) => {
        const w = prev.widgets[widgetId];
        if (!w) return prev;
        const existingRows = w.data?.rows || [];
        const columns = w.data?.columns || (newRows.length > 0 ? Object.keys(newRows[0]) : []);
        const appendedRows = newRows.map((r) => Object.values(r).map((v) => v != null ? String(v) : ''));

        return {
          ...prev,
          widgets: {
            ...prev.widgets,
            [widgetId]: {
              ...w,
              data: {
                columns,
                rows: [...existingRows, ...appendedRows],
                _loadingMore: false,
                _hasMore: hasMore,
              },
            },
          },
        };
      });
    } catch (err) {
      console.error('Load more failed:', err);
      history.setSilent((prev) => ({
        ...prev,
        widgets: { ...prev.widgets, [widgetId]: { ...prev.widgets[widgetId], data: { ...prev.widgets[widgetId].data, _loadingMore: false } } },
      }));
    }
  }, [widgets, model, history, reportFilters, settings?.reportFilters]);

  const reloadModel = useCallback(async () => {
    if (!report?.model_id) return;
    try {
      const res = await api.get(`/models/${report.model_id}`);
      setModel(res.data.model);

      // Invalidate cache on all widgets so they refetch with updated measures
      setWidgets((prev) => {
        const next = {};
        for (const [id, w] of Object.entries(prev)) {
          if (w.data?._fetchedBinding) {
            next[id] = { ...w, data: { ...w.data, _fetchedBinding: null } };
          } else {
            next[id] = w;
          }
        }
        return next;
      });
    } catch (err) {
      console.error('Failed to reload model:', err);
    }
  }, [report?.model_id, setWidgets]);

  const [saveMsg, setSaveMsg] = useState(null);
  const handleSave = async () => {
    setSaving(true);
    try {
      // Save current page state first
      const curPage = pages[currentPageIdx];
      pagesDataRef.current[curPage.id] = { layout, widgets };

      // Bound the save payload: a high-cardinality slicer's `data.values`
      // can balloon to MBs (limit: 1_000_000 on slicer queries). Cap it to
      // 1000 entries here — FilterWidget windows at 200 with a "Show more"
      // button anyway, so anything beyond that is unreachable from the UI.
      // Other widget data (labels/rows/series) is already bounded by the
      // per-widget `dataLimit` (default 1000) at query time, no need to
      // touch it. Everything else (including `_*` cache fields) is left
      // intact so reload still renders immediately.
      const SLICER_VALUE_CAP = 1000;
      const stripWidget = (w) => {
        if (!w || typeof w !== 'object') return w;
        if (
          w.data
          && typeof w.data === 'object'
          && !Array.isArray(w.data)
          && Array.isArray(w.data.values)
          && w.data.values.length > SLICER_VALUE_CAP
        ) {
          return {
            ...w,
            data: { ...w.data, values: w.data.values.slice(0, SLICER_VALUE_CAP) },
          };
        }
        return w;
      };
      const stripWidgets = (ws) => {
        const out = {};
        for (const [wId, w] of Object.entries(ws || {})) out[wId] = stripWidget(w);
        return out;
      };

      // Build pages array for save — slicer selections already live in widget.config.selectedValues
      const pagesForSave = pages.map((p) => ({
        id: p.id,
        name: p.name,
        layout: pagesDataRef.current[p.id]?.layout || [],
        widgets: stripWidgets(pagesDataRef.current[p.id]?.widgets || {}),
      }));

      // Also save layout/widgets at root for backward compat (first page)
      await api.put(`/reports/${id}`, {
        title, settings,
        layout: pagesForSave[0]?.layout || [],
        widgets: pagesForSave[0]?.widgets || {},
        pages: pagesForSave,
      });
      savedSnapshotRef.current = buildSnapshot(title, settings, pagesForSave);
      setSaveMsg('Saved');
      setTimeout(() => setSaveMsg(null), 2000);
    } catch (err) {
      console.error('Save failed:', err);
      setSaveMsg('Save failed');
      setTimeout(() => setSaveMsg(null), 3000);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div style={{ padding: 40, color: 'var(--text-disabled)' }}>Loading report...</div>;
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Toolbar
        workspaceId={report?.workspace_id}
        reportTitle={title}
        onTitleChange={setTitle}
        onAddWidget={handleAddWidget}
        editInteractions={editInteractions}
        onToggleEditInteractions={() => setEditInteractions((v) => !v)}
        canEditInteractions={!!selectedWidget}
        onSave={handleSave}
        saving={saving}
        onUndo={history.undo}
        onRedo={history.redo}
        canUndo={history.canUndo}
        canRedo={history.canRedo}
        onOpenSettings={() => setShowSettings(true)}
        onOpenReportFilters={() => setReportFilterBarOpen((v) => !v)}
        reportFilterCount={liveReportFilterCount != null
          ? liveReportFilterCount
          : (Array.isArray(settings?.reportFilters) ? settings.reportFilters.length : 0)}
        reportFilterBarVisible={reportFilterBarOpen}
        reportId={id}
        onRefresh={handleRefresh}
        refreshing={refreshing}
        exportMenu={(() => {
          // Build a report-shaped object pulling the multi-page snapshot — JSON export
          // needs every page, not just the one currently visible. Layout/widgets at the
          // top level mirror the current page (for filename + Excel current-sheet export).
          const curPage = pages[currentPageIdx];
          const pagesData = { ...pagesDataRef.current };
          if (curPage) pagesData[curPage.id] = { layout, widgets };
          const fullPages = pages.map((p) => ({
            id: p.id, name: p.name,
            layout: pagesData[p.id]?.layout || [],
            widgets: pagesData[p.id]?.widgets || {},
          }));
          return (
            <ExportMenu
              report={{
                title,
                model_id: model?.id || null,
                model_name: model?.name || null,
                layout,
                widgets,
                settings,
                pages: fullPages,
              }}
              widgets={widgets}
              canvasRef={canvasRef}
              onBeforeCapture={() => setSelectedWidget(null)}
              variant="toolbar"
              allowRawExport
            />
          );
        })()}
        isReportDirty={() => {
          // Compute the current snapshot (includes the currently-edited page + all cached pages)
          const curPage = pages[currentPageIdx];
          const pagesData = { ...pagesDataRef.current };
          if (curPage) pagesData[curPage.id] = { layout, widgets };
          const pagesForSnapshot = pages.map((p) => ({
            id: p.id, name: p.name,
            layout: pagesData[p.id]?.layout || [],
            widgets: pagesData[p.id]?.widgets || {},
          }));
          return buildSnapshot(title, settings, pagesForSnapshot) !== savedSnapshotRef.current;
        }}
      />
      <ReportFilterBar
        model={model}
        rules={settings?.reportFilters || []}
        onChange={(next) => {
          // Update the ref SYNCHRONOUSLY before setSettings: ReportFilterBar's
          // "Save & refresh" calls this then onRefresh() in the same tick,
          // and refreshSlicer (via handleRefresh) reads settingsRef — so it
          // must already hold the committed rules, not wait for the re-render.
          const ns = { ...settingsRef.current, reportFilters: next };
          settingsRef.current = ns;
          setSettings(ns);
        }}
        onRefresh={handleRefresh}
        visible={reportFilterBarOpen}
        onVisibilityChange={setReportFilterBarOpen}
        onVisibleCountChange={setLiveReportFilterCount}
        activeInteractionsRuleIdx={interactionsRuleIdx}
        onEditRuleInteractions={(idx) => {
          // Toggle off when re-clicked, else enter edit interactions mode with
          // this rule as the source (deselects the widget so the badge shows
          // on every visual).
          if (idx == null) {
            setInteractionsRuleIdx(null);
            setEditInteractions(false);
            return;
          }
          setSelectedWidget(null);
          setInteractionsRuleIdx(idx);
          setEditInteractions(true);
        }}
      />
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Canvas + pages column live inside the report theme wrapper, so the column inherits the report's theme variables. */}
        <div
          data-theme={settings?.theme?.key || 'light'}
          style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', position: 'relative', overflow: 'hidden', ...(settings?.theme?.vars || getThemeVars('light')) }}
        >
          <PagesColumn
            editMode
            pages={pages}
            currentPageIdx={currentPageIdx}
            onSwitch={switchPage}
            onAdd={addPage}
            onRename={renamePage}
            onCopy={copyPage}
            onDelete={deletePage}
            config={settings.pageNav}
            onConfigChange={(next) => setSettings({ ...settings, pageNav: next })}
            onAnimationStart={handlePagesNavAnimation}
          />
          <div
            ref={canvasWrapperRef}
            style={pinnedRect
              ? {
                  // Take the canvas out of flex flow during the column animation so it neither
                  // moves nor resizes. Snaps back into flex layout when the animation ends.
                  position: 'absolute',
                  left: pinnedRect.left,
                  top: pinnedRect.top,
                  width: pinnedRect.width,
                  height: pinnedRect.height,
                  display: 'flex',
                  contain: 'layout paint style',
                }
              : {
                  flex: 1, minWidth: 0, minHeight: 0,
                  display: 'flex',
                  contain: 'layout paint style',
                }}
          >
            <ReportCanvas
              layout={layout}
              widgets={widgets}
              selectedWidget={selectedWidget}
              onLayoutChange={setLayout}
              onSelectWidget={setSelectedWidget}
              settings={settings}
              onLoadMore={handleLoadMore}
              onWidgetUpdate={handleUpdateWidget}
              reportFilters={slicerSelections}
              onSlicerFilter={handleSlicerFilter}
              onCrossFilter={handleCrossFilter}
              onSlicerSearch={handleSlicerSearch}
              onDrillUp={handleDrillUp}
              onDrillReset={handleDrillReset}
              crossHighlight={crossHighlight}
              reportRef={canvasRef}
              editInteractions={editInteractions}
              interactionsRule={interactionsRuleIdx != null
                ? settings?.reportFilters?.[interactionsRuleIdx] || null
                : null}
              onToggleCrossFilter={handleToggleCrossFilter}
              onCancelFetch={handleCancelFetch}
              onRefreshWidget={handleRefreshWidget}
            />
          </div>
        </div>

        <WidgetConfigPanel
          widgetId={selectedWidget}
          widget={selectedWidget ? widgets[selectedWidget] : null}
          onUpdate={handleUpdateWidget}
          onDelete={handleDeleteWidget}
          onBringToFront={handleBringToFront}
          onSendToBack={handleSendToBack}
          onBringForward={handleBringForward}
          onSendBackward={handleSendBackward}
          model={effectiveModel}
          onResizeStart={pinCanvas}
          onResizeEnd={unpinCanvas}
        />
        <DataModelPanel
          widgetId={selectedWidget}
          widget={selectedWidget ? widgets[selectedWidget] : null}
          onUpdate={handleUpdateWidget}
          onUpdateSilent={handleUpdateWidgetSilent}
          onSetWidgetLoading={handleSetWidgetLoading}
          model={effectiveModel}
          onModelUpdate={reloadModel}
          settings={settings}
          onSettingsChange={setSettings}
          reportFilters={(() => {
            // Cross-highlight source: skip the highlight for itself (so a
            // chart filtering on click doesn't filter its own underlying
            // data). All other widgets honour the per-source exclusions
            // (`crossFilterExclusions`) — that's how a target with
            // interaction = None ignores the cross-filter even when the
            // user manually refreshes it.
            if (!selectedWidget) return reportFilters;
            const baseFilters = crossHighlight?.widgetId === selectedWidget
              ? slicerSelections
              : reportFilters;
            return filterForTarget(selectedWidget, baseFilters, widgets, crossHighlight);
          })()}
          refreshNonce={selectedWidget ? (widgetRefreshNonces[selectedWidget] || 0) : 0}
          reportId={id}
          onResizeStart={pinCanvas}
          onResizeEnd={unpinCanvas}
        />
      </div>

      {showSettings && (
        <SettingsPanel
          settings={settings}
          onSettingsChange={setSettings}
          onClose={() => setShowSettings(false)}
        />
      )}
      {saveMsg && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          padding: '8px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600, zIndex: 9999,
          backgroundColor: saveMsg === 'Saved' ? 'var(--state-success)' : 'var(--state-danger)', color: '#fff',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)', animation: 'fadeIn 0.2s',
        }}>{saveMsg === 'Saved' ? '✓ Report saved' : '✗ Save failed'}</div>
      )}
    </div>
  );
}

