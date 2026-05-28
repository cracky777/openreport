import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import ReportCanvas from '../components/Canvas/ReportCanvas';
import Toolbar from '../components/Toolbar/Toolbar';
import ExportMenu from '../components/ExportMenu/ExportMenu';
import { WidgetConfigPanel, DataModelPanel } from '../components/PropertyPanel/PropertyPanel';
import { WIDGET_TYPES } from '../components/Widgets';
import { rectOf, newMergeGroupId } from '../utils/mergeFrames';
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
import { buildWidgetQueryPayload } from '../utils/widgetQueryPayload';
import { buildWidgetData } from '../utils/widgetDataBuilder';

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
  // Live mirror of `report` so refreshSlicer can stamp filter widgets
  // with the current rebuild timestamp without taking `report` as a
  // useCallback dep (which would re-create the callback every time
  // the report state changes — defeating the slicer cascade ref
  // pattern below).
  const reportRef = useRef(report);
  reportRef.current = report;
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
        // The URL only carries `field`+`values` (see urlFilters.js) — it
        // does NOT round-trip the editor-only `exclusions` (the per-visual
        // global-filter↔visual interaction config). Carry the existing
        // rule's `exclusions` onto the URL rule that overrides the same
        // field; otherwise every model (re)load silently wipes the
        // interaction and the next save persists the loss.
        const exclByField = new Map(
          existing
            .filter((r) => r && Array.isArray(r.exclusions))
            .map((r) => [r.field, r.exclusions])
        );
        const fromUrlMerged = fromUrl.map((r) =>
          exclByField.has(r.field) ? { ...r, exclusions: exclByField.get(r.field) } : r
        );
        const merged = [...existing.filter((r) => !urlFields.has(r.field)), ...fromUrlMerged];
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
      // Filter widgets are skipped by the main fetch effect (slicers
      // refetch via their dedicated refreshSlicer path). When the
      // toggled target IS a filter widget, the scoped-refetch trigger
      // alone would no-op → the slicer keeps its pre-toggle value
      // list (e.g. a date slicer still showing only January after the
      // global January filter's interaction was disabled on it).
      // Defer to next tick so refreshSlicer reads the just-committed
      // settings via settingsRef (setSettings is async).
      const target = history.state.widgets?.[targetId];
      if (target?.type === 'filter') {
        setTimeout(() => refreshSlicerRef.current?.(targetId), 0);
      }
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
    // Same filter-widget escape hatch as the global-rule branch above
    // — the main fetch loop skips slicers, so a target slicer would
    // otherwise stay stale.
    const target = history.state.widgets?.[targetId];
    if (target?.type === 'filter') {
      setTimeout(() => refreshSlicerRef.current?.(targetId), 0);
    }
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
    // Stamp the current cache-rebuild timestamp on the widget data
    // BEFORE the async fetch fires. If the editor re-runs its main
    // fetch effect (model load, settings reorder, …) while THIS
    // refreshSlicer is still in flight, the slicer-cascade check
    // would otherwise see the stale `_fetchedCacheBuiltAt` and
    // re-fire — flooding the source DB with duplicate distinct
    // queries. Stamping eagerly is safe: the catch branch below
    // doesn't touch data, so a failed fetch keeps the stamp; the
    // user can manual-refresh.
    const cbAtFetchStart = reportRef.current?.cache_built_at || null;
    history.setSilent((prev) => {
      const cur = prev.widgets?.[widgetId];
      if (!cur) return prev;
      return {
        ...prev,
        widgets: {
          ...prev.widgets,
          [widgetId]: {
            ...cur,
            _loading: true,
            data: { ...(cur.data || {}), _fetchedCacheBuiltAt: cbAtFetchStart },
          },
        },
      };
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
      // No bypassCache here: the server's slicer-distinct fast path
      // tries the rollup first (matches the freshly-rebuilt state)
      // and on MISS falls to LIVE while bypassing queryCache —
      // routes/models.js sets req._slicerDistinctBypassQueryCache
      // when distinct=true + 1 dim + 0 measures. Faster than the
      // previous always-live behaviour wherever a rollup carries the
      // slicer's dim in its grain.
      const res = await api.post(`/models/${model.id}/query`, {
        dimensionNames: [dim],
        measureNames: [],
        limit: 1000,
        filters: appliedFilters,
        widgetFilters: [...reportLevelFilters, ...ownWidgetFilters],
        distinct: true,
        reportId: id,
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
        // Stamp the report's current rebuild timestamp so the next
        // Editor open detects whether the cache has been rebuilt since
        // this fetch (workspace-card rebuild → editor reopen scenario).
        // null/undefined when the report has never been rebuilt.
        nextData._fetchedCacheBuiltAt = reportRef.current?.cache_built_at || null;
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
  // Tracks ONLY the global-filter-bar rules. The slicer re-narrow pass must
  // fire on a real global-filter change (or explicit refresh) — NOT on every
  // cross-filter / drill-leaf click, which would flood the server with heavy
  // bypassCache `DISTINCT` slicer queries and make drilling feel uncached.
  const prevSettingsFiltersRef = useRef(null);
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
  // Last triggered refresh type — drives the in-widget spinner colour so
  // the user sees at a glance whether the load they're watching came from
  // a live-source refetch (violet) or a post-cache-rebuild planner refetch
  // (cyan). Sticky across the fetch cycle because cacheWarming/refreshing
  // can flip off before every widget has finished its query.
  const [refreshKind, setRefreshKind] = useState(null); // 'live' | 'cache' | null
  const handleRefresh = useCallback(() => {
    setRefreshing((r) => r ? r : true);
    setRefreshKind('live');
    refreshIsManualRef.current = true;
    setRefreshCounter((n) => n + 1);
    // Slicers are refreshed by the main fetch effect (it bumps on
    // refreshCounter). We DON'T loop refreshSlicer here anymore: this
    // runs synchronously, and "Save & refresh" calls onChange (setSettings,
    // async) then onRefresh() in the same tick — a synchronous slicer
    // refresh would use the pre-commit global filter. The effect runs
    // post-render with the committed settings, which is correct.
  }, []);

  // ── "Rebuild cache & refresh" (split-button action on the toolbar
  // Refresh control). Unlike the plain Refresh (bypassCache → live source
  // query, skips the rollup planner), this re-materialises the rollup
  // cache via the same endpoint the Dashboard card uses, then triggers a
  // NORMAL refetch (refreshIsManualRef left false ⇒ bypassCache false) so
  // the planner serves the freshly-built rollups — the rollup-hit path
  // short-circuits the RAM queryCache, so there's no stale read even
  // though run-now doesn't flush queryCache. Progress is the same
  // rollup-by-rollup bar as the Dashboard, driven by polling
  // /cache-schedules/warming + a trickle so the bar always moves.
  const [cacheWarming, setCacheWarming] = useState(false);
  const [cacheWarmPct, setCacheWarmPct] = useState(0);
  const cacheWarmProgressRef = useRef({ done: 0, total: 0 });
  const cacheWarmPctRef = useRef(0);
  const cacheWarmCtlRef = useRef({ active: false, cancelled: false, pending: false, timer: null, trickle: null });
  const handleRebuildCache = useCallback(async () => {
    const st = cacheWarmCtlRef.current;
    if (st.active) return;
    st.active = true; st.cancelled = false; st.pending = true;
    cacheWarmProgressRef.current = { done: 0, total: 0 };
    cacheWarmPctRef.current = 0;
    setCacheWarmPct(0);
    setCacheWarming(true);

    const poll = async () => {
      try {
        const res = await api.get('/cache-schedules/warming');
        if (st.cancelled) return;
        const p = res.data?.progress?.[id];
        if (p && typeof p.total === 'number') {
          cacheWarmProgressRef.current = { done: p.done || 0, total: p.total || 0 };
        }
        const serverBuilding = Array.isArray(res.data?.reportIds) && res.data.reportIds.includes(id);
        if ((serverBuilding || st.pending) && !st.cancelled) {
          st.timer = setTimeout(poll, 2000);
        }
      } catch { /* logged out / transient — the awaited POST below still resolves */ }
    };
    poll();

    // Trickle the displayed % toward the next milestone every 450 ms (CSS
    // `width 0.4s` smooths it); snap up the instant a real rollup lands.
    st.trickle = setInterval(() => {
      const { done, total } = cacheWarmProgressRef.current;
      let floor, ceil;
      if (total > 0) {
        floor = Math.min(100, (done / total) * 100);
        ceil = Math.min(100, ((done + 1) / total) * 100);
      } else { floor = 0; ceil = 12; }
      let v = cacheWarmPctRef.current;
      if (v < floor) v = floor;
      const cap = floor + (ceil - floor) * 0.9;
      if (v < cap) v += Math.max(0.5, (cap - v) * 0.12);
      if (v > cap) v = cap;
      if (v > 100) v = 100;
      if (v !== cacheWarmPctRef.current) { cacheWarmPctRef.current = v; setCacheWarmPct(v); }
    }, 450);

    try {
      await api.post(`/cache-schedules/run-now/${id}`);
    } catch (err) {
      console.error('Rebuild cache failed:', err);
      setSaveMsg(err.response?.data?.error || 'Cache rebuild failed');
      setTimeout(() => setSaveMsg(null), 3000);
    } finally {
      st.cancelled = true; st.pending = false; st.active = false;
      if (st.timer) clearTimeout(st.timer);
      if (st.trickle) clearInterval(st.trickle);
      setCacheWarming(false);
      setCacheWarmPct(0);
      cacheWarmPctRef.current = 0;
      // Slicers don't go through the rollup planner — they fire a
      // dedicated `bypassCache:true, distinct:true` /query in
      // refreshSlicer. The main fetch effect below only loops them
      // when `manualRefresh || globalFilterChanged`, neither of which
      // holds here (post-rebuild = normal refetch). Without this
      // explicit loop, a slicer whose global-filter exclusion just
      // changed would stay on its pre-rebuild value list (e.g. a
      // date slicer that was filtered to January by a global filter
      // whose interaction was just disabled would keep showing only
      // January dates even after the cache rebuild).
      const slicers = history.state.widgets || {};
      for (const [wId, w] of Object.entries(slicers)) {
        if (w?.type === 'filter' && w.dataBinding?.selectedDimensions?.[0]) {
          refreshSlicerRef.current?.(wId);
        }
      }
      // Normal refetch (NOT a manual/live refresh) → rollup planner serves
      // the just-built rollups for the chart widgets. Tag this refresh as
      // 'cache' so the per-widget spinners colour-code the load.
      setRefreshKind('cache');
      setRefreshCounter((n) => n + 1);
    }
  }, [id, history]);
  useEffect(() => () => {
    // Editor unmounted mid-rebuild → stop the poll/trickle cleanly.
    const st = cacheWarmCtlRef.current;
    st.cancelled = true; st.active = false; st.pending = false;
    if (st.timer) clearTimeout(st.timer);
    if (st.trickle) clearInterval(st.trickle);
  }, []);

  // On mount, check whether the server is already rebuilding this report's
  // cache (user clicked rebuild then F5'd / navigated away and back). If
  // yes, reactivate the loader + the polling+trickle pair so the bar keeps
  // moving instead of disappearing on reload. When the server flips the
  // report out of its building set, teardown + trigger a refetch so the
  // widgets pick up the just-built rollups.
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    let localTimer = null;

    const startTrickle = () => {
      const st = cacheWarmCtlRef.current;
      if (st.trickle) return;
      st.trickle = setInterval(() => {
        const { done, total } = cacheWarmProgressRef.current;
        let floor, ceil;
        if (total > 0) {
          floor = Math.min(100, (done / total) * 100);
          ceil = Math.min(100, ((done + 1) / total) * 100);
        } else { floor = 0; ceil = 12; }
        let v = cacheWarmPctRef.current;
        if (v < floor) v = floor;
        const cap = floor + (ceil - floor) * 0.9;
        if (v < cap) v += Math.max(0.5, (cap - v) * 0.12);
        if (v > cap) v = cap;
        if (v > 100) v = 100;
        if (v !== cacheWarmPctRef.current) { cacheWarmPctRef.current = v; setCacheWarmPct(v); }
      }, 450);
    };

    const poll = async () => {
      if (cancelled) return;
      try {
        const res = await api.get('/cache-schedules/warming');
        if (cancelled) return;
        const inProgress = Array.isArray(res.data?.reportIds) && res.data.reportIds.includes(id);
        const p = res.data?.progress?.[id];
        if (p && typeof p.total === 'number') {
          cacheWarmProgressRef.current = { done: p.done || 0, total: p.total || 0 };
        }
        const st = cacheWarmCtlRef.current;
        if (inProgress) {
          // First detection (or post-F5) — show loader + start trickle.
          // `st.pending` is the marker that handleRebuildCache is already
          // managing its own lifecycle; defer to that case to avoid
          // racing the teardown.
          if (!st.active && !st.pending) {
            st.active = true; st.cancelled = false;
            cacheWarmPctRef.current = 0;
            setCacheWarmPct(0);
            setCacheWarming(true);
            startTrickle();
          }
          localTimer = setTimeout(poll, 2000);
        } else if (st.active && !st.pending) {
          // We were showing the loader for an in-flight rebuild we did
          // NOT trigger from this tab (no awaited POST) → rebuild just
          // finished server-side. Teardown + refetch so widgets pick up
          // the just-built rollups.
          st.active = false; st.cancelled = true;
          if (st.timer) clearTimeout(st.timer);
          if (st.trickle) { clearInterval(st.trickle); st.trickle = null; }
          setCacheWarming(false);
          setCacheWarmPct(0);
          cacheWarmPctRef.current = 0;
          const slicers = history.state.widgets || {};
          for (const [wId, w] of Object.entries(slicers)) {
            if (w?.type === 'filter' && w.dataBinding?.selectedDimensions?.[0]) {
              refreshSlicerRef.current?.(wId);
            }
          }
          setRefreshKind('cache');
          setRefreshCounter((n) => n + 1);
        }
        // else: idle and we weren't showing loader → stop polling.
      } catch { /* logged out / transient — let the next mount or rebuild action try again */ }
    };

    poll();

    return () => {
      cancelled = true;
      if (localTimer) clearTimeout(localTimer);
    };
  }, [id, history]);

  // NOTE: slicer re-narrowing on global-filter / cross-filter / refresh is
  // now done INSIDE the main fetch effect (search for "Slicers are skipped
  // by the chart fetch below"). That effect is the same proven trigger the
  // charts use and it runs post-render (committed settings). The previous
  // standalone debounced cascade effect was removed: its cleanup cancelled
  // its own setTimeout on any unrelated re-render within the debounce
  // window, so the global filter often never narrowed slicers.

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
    setRefreshKind('live');
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

    // Re-narrow related slicers (e.g. client → destinataire) using this
    // same proven, post-render trigger (committed `settings`, no stale
    // closure). CRITICAL SCOPE: fire ONLY when the global filter bar
    // actually changed, or on an explicit/global refresh — NEVER on a
    // cross-filter or drill-leaf click. refreshSlicer issues a heavy
    // bypassCache `DISTINCT` query per slicer; firing it on every chart
    // click floods the server and makes drilling feel uncached (the
    // regression). Cross-filter narrowing of a sibling slicer is not
    // worth that cost.
    const settingsFiltersKey = JSON.stringify(
      Array.isArray(settings?.reportFilters) ? settings.reportFilters : []
    );
    const globalFilterChanged = prevSettingsFiltersRef.current !== null
      && prevSettingsFiltersRef.current !== settingsFiltersKey;
    prevSettingsFiltersRef.current = settingsFiltersKey;
    // Detect that the rollup cache was rebuilt while the editor was
    // closed (workspace-card rebuild → user re-opens the report).
    // Filter widgets are skipped by the main fetch effect (line 930)
    // and refreshSlicer is only cascaded on manualRefresh or
    // globalFilterChanged — neither triggers on a fresh editor mount.
    // So a slicer with stale data.values (pre-rebuild) would stay
    // stuck until the user re-clicks 'rebuild cache & refresh' from
    // INSIDE the editor (which DOES loop refreshSlicer explicitly).
    // The fix: on every effect run, check whether any filter widget's
    // last-fetched-cache-stamp lags the current report's
    // cache_built_at. If yes, also cascade. The stamp is recorded by
    // refreshSlicer on every successful fetch, so subsequent renders
    // without a new rebuild see a match → no extra refresh.
    const reportCacheBuiltAt = report?.cache_built_at || null;
    const slicersHaveStaleCache = !!reportCacheBuiltAt
      && Object.values(currentWidgets).some((w) =>
        w?.type === 'filter'
        && w.dataBinding?.selectedDimensions?.[0]
        && w.data?._fetchedCacheBuiltAt !== reportCacheBuiltAt);
    if (!scopedToId && (globalFilterChanged || manualRefresh || slicersHaveStaleCache)) {
      for (const [wId, w] of Object.entries(currentWidgets)) {
        if (w?.type === 'filter' && w.dataBinding?.selectedDimensions?.[0]) {
          refreshSlicerRef.current?.(wId);
        }
      }
    }

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
      const widgetBindingKey = computeBindingKey({ widget: w, model, reportFilters: targetFiltersForKey, settings, cacheBuiltAt: report?.cache_built_at });
      if (!refreshRequested
          && wId !== scopedToId
          && w.data?._fetchedBinding === widgetBindingKey
          && Object.keys(w.data || {}).length > 1) {
        return false;
      }
      return true;
    });

    if (toFetch.length === 0) return;

    // Mark all target widgets as loading (silent — not an undoable action).
    // `_loadingKind` records WHY this fetch was triggered so the spinner
    // can colour the rotating arc accordingly: 'live' when the user asked
    // for a fresh bypassCache=true fetch (live source query), 'cache'
    // otherwise (planner / queryCache path). Set per-widget rather than
    // off the global `refreshKind` state so cross-filter / drill / binding
    // edits that happen AFTER a cache rebuild don't keep painting cyan —
    // they are normal-path fetches and should read as 'cache'.
    const loadingKindForThisFetch = manualRefresh ? 'live' : 'cache';
    history.setSilent((prev) => {
      const next = { ...prev, widgets: { ...prev.widgets } };
      toFetch.forEach(([wId]) => {
        if (next.widgets[wId]) next.widgets[wId] = { ...next.widgets[wId], _loading: true, _loadingKind: loadingKindForThisFetch };
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
        // Build the query bodies + per-widget metadata in one shot.
        // Pure utility — Editor passes manualRefresh as bypassCache and
        // skips filter widgets entirely (they're already excluded from
        // `toFetch` upstream).
        const { meta, bodies } = buildWidgetQueryPayload(w, wId, {
          effectiveModel,
          reportFilters,
          currentWidgets,
          crossHighlight: crossHighlightRef.current,
          reportId: id,
          reportLevelFilters: prepareGlobalRulesForWidget(settings?.reportFilters, wId),
          reportExtras: {
            extraDimensions: settings?.extraDimensions || [],
            extraMeasures: settings?.extraMeasures || [],
            dimensionOverrides: settings?.dimensionOverrides || {},
            measureOverrides: settings?.measureOverrides || {},
          },
          bypassCache: manualRefresh,
          generateQueryId: () => (typeof crypto !== 'undefined' && crypto.randomUUID)
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random()}`,
          filterWidgetMode: 'skip',
          dedupMeasures: true,
        });

        if (meta.mainQueryId) activeQueryIdsRef.current.add(meta.mainQueryId);
        const mainPromise = bodies.main
          ? api.post(`/models/${model.id}/query`, bodies.main, { signal: controller.signal })
              .finally(() => { if (meta.mainQueryId) activeQueryIdsRef.current.delete(meta.mainQueryId); })
          : Promise.resolve({ data: { rows: [] } });

        const totalPromise = bodies.total
          ? api.post(`/models/${model.id}/query`, bodies.total, { signal: controller.signal }).catch(() => null)
          : Promise.resolve(null);

        // SQL viewer preview — fire-and-forget so the modal can show the
        // assembled query even while a slow main query is still running.
        // Skips silently if the main query already settled and stamped _sql.
        if (bodies.sqlOnly) {
          api.post(`/models/${model.id}/query`, bodies.sqlOnly, { signal: controller.signal })
            .then((r) => {
              const previewSql = r?.data?.sql;
              if (!previewSql) return;
              history.setSilent((prev) => {
                const w2 = prev.widgets?.[wId];
                if (!w2 || w2.data?._sql) return prev;
                return {
                  ...prev,
                  widgets: { ...prev.widgets, [wId]: { ...w2, data: { ...(w2.data || {}), _sql: previewSql } } },
                };
              });
            })
            .catch(() => { /* ignore — we'll just lack the preview */ });
        }

        const colorPromise = bodies.color
          ? api.post(`/models/${model.id}/query`, bodies.color, { signal: controller.signal }).catch(() => null)
          : Promise.resolve(null);

        const n1Promise = bodies.n1
          ? api.post(`/models/${model.id}/query`, bodies.n1, { signal: controller.signal }).catch(() => null)
          : Promise.resolve(null);

        const comboLinePromise = bodies.comboLine
          ? api.post(`/models/${model.id}/query`, bodies.comboLine, { signal: controller.signal }).catch(() => null)
          : Promise.resolve(null);

        return Promise.all([mainPromise, colorPromise, totalPromise, n1Promise, comboLinePromise]).then(([res, colorRes, totalRes, n1Res, comboLineRes]) => {
          const rows = res.data?.rows;
          // Combine both queries' SQL when an auxiliary line query was
          // fired so the SQL viewer shows every statement contributing to
          // the rendered chart.
          const mainSql = res.data?.sql || null;
          const lineSql = comboLineRes?.data?.sql || null;
          const sql = mainSql && lineSql
            ? `-- Main query (bars)\n${mainSql}\n\n-- Line aggregation (dim only, no groupBy)\n${lineSql}`
            : mainSql;
          // Per-widget cache key — stamped on widget.data so DataPanel
          // doesn't re-fetch on the next selection. Computed with the
          // per-widget targetFilters (post interaction-exclusion) so the
          // key matches the toFetch skip check.
          const bindingKey = computeBindingKey({
            widget: w, model, reportFilters: meta.targetFilters, settings, cacheBuiltAt: report?.cache_built_at,
          });
          const data = buildWidgetData({
            widget: w, rows, meta, effectiveModel,
            colorRes, totalRes, n1Res, comboLineRes,
            sql, bindingKey,
            // Keep every selected dim in `_rowDims` even when the same dim
            // is pinned as a column too — matches Viewer's behaviour. The
            // historical Editor filter (`dims.filter(d => !colDimsB...)`)
            // emptied the row list in that case, which made rows disappear
            // after a cache rebuild's refetch (saved widget data with the
            // old shape was overwritten with `_rowDims=[]`). User confirmed
            // the "rows visible on both axes" output is the desired one.
            pivotFilterRowDims: false,
          });
          return { wId, data };
        }).catch((err) => {
          if (err?.name === 'CanceledError' || err?.code === 'ERR_CANCELED') return { wId, data: null };
          const msg = err?.response?.data?.error || err?.message || 'Query failed';
          const code = err?.response?.data?.code || null;
          const timeoutMs = err?.response?.data?.timeoutMs || null;
          return { wId, data: { _error: msg, _errorCode: code, _errorTimeoutMs: timeoutMs, _rowCount: 0 } };
        }).then(({ wId, data }) => {
          // Land each widget's data INDEPENDENTLY as soon as its own
          // query resolves — previously every widget was held back until
          // the slowest one in the batch settled (single `Promise.all`
          // → one final `setSilent`), so a 10 s outlier blocked an
          // otherwise 100 ms dashboard from rendering. Per-widget commit
          // means fast visuals paint immediately; the slow one fills in
          // when it's ready. React 18 batches the setSilent calls that
          // share a tick so a wave of fast widgets still resolves with a
          // single render.
          if (controller.signal.aborted) return { wId, data: null };
          history.setSilent((prev) => {
            if (!prev.widgets?.[wId]) return prev;
            return {
              ...prev,
              widgets: { ...prev.widgets, [wId]: { ...prev.widgets[wId], _loading: false, data: data || {} } },
            };
          });
          return { wId, data };
        });
      });

      // Outer await: just teardown the request-scoped flags once all
      // widgets have settled. Per-widget data already landed via the
      // per-promise commit above — no batched widget update here.
      Promise.all(promises).then(() => {
        pendingLoadingRef.current = null;
        if (controller.signal.aborted) { setRefreshing(false); return; }
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
    // `settings?.reportFilters` IS a dep: ReportFilterBar's plain "Save"
    // (commitSave) only calls onChange (setSettings) — NOT handleRefresh —
    // so without this dep a global-filter Save would refetch nothing
    // (charts AND slicers). The internal `json`/`prevFiltersJson` guard
    // already keys on `s: settings.reportFilters`, so adding the dep does
    // NOT double-fire — it dedupes when nothing actually changed.
  }, [reportFilters, settings?.reportFilters, model, refreshCounter]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // ── Frame-merge of adjacent visuals ─────────────────────────────────
  // Membership lives on each member's config.mergeGroup; the separator
  // flag on config.mergeSeparator (kept in sync across the group). Pairs
  // are merged one at a time (a group grows by chaining); the rendering,
  // solid-block drag AND all UI affordances (merge magnet, broken-magnet
  // unmerge, separator toggle) live on the canvas in ReportCanvas — no
  // panel UI needed.
  const handleMergeWith = useCallback((targetId) => {
    if (!selectedWidget || !targetId || targetId === selectedWidget) return;
    setLayoutAndWidgets(
      // Snap the target flush against the selected widget so there is NO
      // gap left between their frames (a small leftover gap is what made
      // the merged pair look like two separate cards). The selected one
      // stays put; only the target moves, on the touching axis only
      // (perpendicular position kept → partial overlap still allowed).
      (prevLayout) => {
        const s = prevLayout.find((l) => l.i === selectedWidget);
        const t = prevLayout.find((l) => l.i === targetId);
        if (!s || !t) return prevLayout;
        const sr = rectOf(s);
        const tr = rectOf(t);
        const vOverlap = Math.min(sr.y + sr.h, tr.y + tr.h) - Math.max(sr.y, tr.y);
        const hOverlap = Math.min(sr.x + sr.w, tr.x + tr.w) - Math.max(sr.x, tr.x);
        let nx = t.x, ny = t.y;
        if (vOverlap >= hOverlap) {
          // Side by side → close the horizontal gap.
          const tCx = tr.x + tr.w / 2;
          const sCx = sr.x + sr.w / 2;
          nx = tCx >= sCx ? sr.x + sr.w : sr.x - tr.w;
        } else {
          // Stacked → close the vertical gap.
          const tCy = tr.y + tr.h / 2;
          const sCy = sr.y + sr.h / 2;
          ny = tCy >= sCy ? sr.y + sr.h : sr.y - tr.h;
        }
        return prevLayout.map((l) => l.i === targetId
          ? { ...l, x: Math.max(0, nx), y: Math.max(0, ny) } : l);
      },
      (prevWidgets) => {
        const sel = prevWidgets[selectedWidget];
        const tgt = prevWidgets[targetId];
        if (!sel || !tgt) return prevWidgets;
        const selGid = sel.config?.mergeGroup || null;
        const tgtGid = tgt.config?.mergeGroup || null;
        const gid = selGid || tgtGid || newMergeGroupId();
        // Preserve an existing group's separator preference; default off.
        const sepSource = selGid ? sel : (tgtGid ? tgt : null);
        const sep = !!sepSource?.config?.mergeSeparator;
        const next = { ...prevWidgets };
        // Rehome any pre-existing group(s) of the two sides into `gid` so
        // chaining keeps a single coherent group.
        for (const [wid, w] of Object.entries(prevWidgets)) {
          const wg = w?.config?.mergeGroup;
          const isSide = wid === selectedWidget || wid === targetId;
          if (isSide || (wg && (wg === selGid || wg === tgtGid))) {
            next[wid] = { ...w, config: { ...(w.config || {}), mergeGroup: gid, mergeSeparator: sep } };
          }
        }
        return next;
      },
    );
  }, [selectedWidget, setLayoutAndWidgets]);

  const handleUnmergeSelected = useCallback(() => {
    if (!selectedWidget) return;
    setWidgets((prev) => {
      const sel = prev[selectedWidget];
      const gid = sel?.config?.mergeGroup;
      if (!gid) return prev;
      const next = { ...prev };
      // Drop the selected widget from the group.
      const { mergeGroup, mergeSeparator, ...restCfg } = sel.config || {};
      next[selectedWidget] = { ...sel, config: restCfg };
      // If only one member is left, clear it too (a lone member is not a
      // merge — keeps the data clean).
      const remaining = Object.entries(next).filter(([, w]) => w?.config?.mergeGroup === gid);
      if (remaining.length === 1) {
        const [wid, w] = remaining[0];
        const { mergeGroup: _g, mergeSeparator: _s, ...rc } = w.config || {};
        next[wid] = { ...w, config: rc };
      }
      return next;
    });
  }, [selectedWidget, setWidgets]);

  const handleToggleMergeSeparator = useCallback(() => {
    if (!selectedWidget) return;
    setWidgets((prev) => {
      const sel = prev[selectedWidget];
      const gid = sel?.config?.mergeGroup;
      if (!gid) return prev;
      const nextVal = !sel.config?.mergeSeparator;
      const next = { ...prev };
      for (const [wid, w] of Object.entries(prev)) {
        if (w?.config?.mergeGroup === gid) {
          next[wid] = { ...w, config: { ...(w.config || {}), mergeSeparator: nextVal } };
        }
      }
      return next;
    });
  }, [selectedWidget, setWidgets]);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await api.get(`/reports/${id}`);
        const r = res.data.report;
        setReport(r);
        setTitle(r.title);
        setSettings(r.settings || {});
        // Anchor the slicer-cascade baseline to the LOADED global filter
        // immediately. Without this the baseline is seeded lazily inside
        // the fetch effect, so the load-time `settings.reportFilters`
        // transition ({} → saved) is misread as a user global-filter
        // change and the slicer needlessly refetches on every editor open
        // (notably after a warm, when saved widget data is judged stale so
        // skipNextRefetch isn't set). Now: slicer refreshes ⟺ a real
        // post-load global-filter change OR an explicit/manual refresh.
        prevSettingsFiltersRef.current = JSON.stringify(
          Array.isArray(r.settings?.reportFilters) ? r.settings.reportFilters : []
        );
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
        onRebuildCache={handleRebuildCache}
        cacheWarming={cacheWarming}
        cacheWarmPct={cacheWarmPct}
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
              refreshKind={refreshKind}
              onMergeWith={handleMergeWith}
              onUnmerge={handleUnmergeSelected}
              onToggleSeparator={handleToggleMergeSeparator}
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
          cacheBuiltAt={report?.cache_built_at}
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

