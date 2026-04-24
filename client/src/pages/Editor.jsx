import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import ReportCanvas from '../components/Canvas/ReportCanvas';
import Toolbar from '../components/Toolbar/Toolbar';
import { WidgetConfigPanel, DataModelPanel } from '../components/PropertyPanel/PropertyPanel';
import { WIDGET_TYPES } from '../components/Widgets';
import SettingsPanel from '../components/SettingsPanel/SettingsPanel';
import { useHistory } from '../hooks/useHistory';
import api from '../utils/api';

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

  const [report, setReport] = useState(null);
  const [model, setModel] = useState(null);
  const [selectedWidget, setSelectedWidget] = useState(null);
  const [clipboard, setClipboard] = useState(null);
  const [reportFilters, setReportFilters] = useState({});
  const [slicerSelections, setSlicerSelections] = useState({});
  // Cross-highlight: which widget is the source and what value is highlighted
  const [crossHighlight, setCrossHighlight] = useState(null); // { widgetId, dim, value }
  const crossHighlightRef = useRef(null);
  crossHighlightRef.current = crossHighlight;

  // Undo/redo state: tracks layout + widgets together (for current page)
  const history = useHistory({ layout: [], widgets: {} });
  const { layout, widgets } = history.state;
  // Ref mirror so click handlers always read the freshest widget state (closures can be stale)
  const widgetsRef = useRef(widgets);
  widgetsRef.current = widgets;
  // Snapshot of the last-saved (or last-loaded) report state — used to detect real modifications
  const savedSnapshotRef = useRef('');

  // Sync slicerSelections from widgets' config.selectedValues (e.g. after undo/redo).
  // Compares content to avoid updates when nothing actually changed.
  useEffect(() => {
    const fromWidgets = {};
    for (const w of Object.values(widgets || {})) {
      if (w?.type !== 'filter') continue;
      const dim = w.dataBinding?.selectedDimensions?.[0];
      const vals = w.config?.selectedValues;
      if (dim && Array.isArray(vals) && vals.length > 0) fromWidgets[dim] = vals;
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
      // reportFilters = slicer ∪ crossHighlight; update slicer portion to match widgets
      const next = { ...fromWidgets };
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
    // Clear any cross-filter originated from this widget — drill navigation should reset the leaf-level cross-filter
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
  const skipNextRefetch = useRef(false); // set to true when filters are restored from saved state
  const prevRefreshCounter = useRef(0);

  const [refreshCounter, setRefreshCounter] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = useCallback(() => {
    setRefreshing((r) => r ? r : true);
    setRefreshCounter((n) => n + 1);
  }, []);

  useEffect(() => {
    const json = JSON.stringify(reportFilters || {});
    const sourceId = crossFilterSourceRef.current;
    const refreshRequested = refreshCounter !== prevRefreshCounter.current;
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

    const toFetch = Object.entries(currentWidgets).filter(([wId, w]) => {
      if (!w || w.type === 'filter' || w.type === 'text') return false;
      // On explicit refresh, refetch ALL (including cross-filter source)
      if (!refreshRequested && wId === sourceId) return false;
      const b = w.dataBinding || {};
      const hasMeas = w.type === 'scatter' ? !!(b.scatterMeasures?.x && b.scatterMeasures?.y)
        : w.type === 'combo' ? (b.comboBarMeasures?.length > 0 || b.comboLineMeasures?.length > 0)
        : b.selectedMeasures?.length > 0;
      return (b.selectedDimensions?.length > 0 || hasMeas);
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
        const mergedFilters = { ...(reportFilters || {}), ...drillFilters };

        return api.post(`/models/${model.id}/query`, {
          dimensionNames: allDims, measureNames: [...new Set(meass)],
          limit: w.config?.dataLimit || 1000, filters: mergedFilters,
        }, { signal: controller.signal }).then((res) => {
          const rows = res.data?.rows;
          if (!rows || rows.length === 0) return { wId, data: { _rowCount: 0 } };
          let newData = {};
          const keys = Object.keys(rows[0]);
          if (w.type === 'pivotTable') {
            const rowDimNames = dims.filter((d) => !colDimsB.includes(d));
            newData = { rawRows: rows,
              _rowDims: rowDimNames.map((d) => { const def = (model.dimensions || []).find((x) => x.name === d); return def?.label || def?.name || d; }),
              _colDims: colDimsB.map((d) => { const def = (model.dimensions || []).find((x) => x.name === d); return def?.label || def?.name || d; }),
              _measures: meass.map((m) => { const def = (model.measures || []).find((x) => x.name === m); return def?.label || def?.name || m; }),
            };
          } else if (w.type === 'scatter') {
            if (sm.x && sm.y) {
              const gl = (name, list) => { const d = list.find((x) => x.name === name); return d?.label || d?.name || name; };
              const dimLbl = dims.length > 0 ? gl(dims[0], model.dimensions || []) : null;
              const grpLbl = grpBy.length > 0 ? gl(grpBy[0], model.dimensions || []) : null;
              const xLbl = gl(sm.x, model.measures || []);
              const yLbl = gl(sm.y, model.measures || []);
              const sizeLbl = sm.size ? gl(sm.size, model.measures || []) : null;
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
              const axisKey = dims.length > 0 ? fk(gl(dims[0], model.dimensions || [])) || keys[0] : keys[0];
              const grpLabel = grpBy.length > 0 ? gl(grpBy[0], model.dimensions || []) : null;
              const grpKey = grpLabel ? fk(grpLabel) : null;
              const labels = [...new Set(rows.map((r) => String(r[axisKey] ?? '')))];
              // Bar series: split by legend
              let barSeries = [];
              if (grpKey) {
                const ug = [...new Set(rows.map((r) => String(r[grpKey] ?? '')))].sort();
                cbm.forEach((mn) => { const ml = gl(mn, model.measures || []); const mk = fk(ml); if (!mk) return;
                  ug.forEach((gv) => { barSeries.push({ name: cbm.length === 1 ? gv : `${gv} - ${ml}`, values: labels.map((l) => { const row = rows.find((r) => String(r[axisKey] ?? '') === l && String(r[grpKey] ?? '') === gv); return row ? Number(row[mk]) || 0 : 0; }) }); });
                });
              } else {
                cbm.forEach((mn) => { const ml = gl(mn, model.measures || []); const mk = fk(ml); if (!mk) return; barSeries.push({ name: ml, values: labels.map((l) => { const row = rows.find((r) => String(r[axisKey] ?? '') === l); return row ? Number(row[mk]) || 0 : 0; }) }); });
              }
              // Line series: aggregate across legend
              const lineSeries = clm.map((mn) => { const ml = gl(mn, model.measures || []); const mk = fk(ml); if (!mk) return null;
                return { name: ml, values: labels.map((l) => rows.filter((r) => String(r[axisKey] ?? '') === l).reduce((s, r) => s + (Number(r[mk]) || 0), 0)) };
              }).filter(Boolean);
              newData = { labels, barSeries, lineSeries };
              newData._barMeasureLabel = cbm.map((mn) => gl(mn, model.measures || [])).join(', ');
              newData._lineMeasureLabel = clm.map((mn) => gl(mn, model.measures || [])).join(', ');
            }
          } else if (w.type === 'table') {
            newData = { columns: keys, rows: rows.map((r) => Object.values(r).map((v) => v != null ? String(v) : '')) };
          } else if (w.type === 'pie' || w.type === 'treemap') {
            newData = { items: rows.map((r) => ({ name: String(r[keys[0]]), value: Number(r[keys[keys.length - 1]]) || 0 })) };
          } else if (w.type === 'scorecard' || w.type === 'gauge') {
            const firstRow = rows[0];
            if (firstRow) {
              const valueMeasName = w.dataBinding?.selectedMeasures?.[0];
              const valueMeasDef = (model.measures || []).find((m) => m.name === valueMeasName);
              const valueKey = valueMeasDef?.label || valueMeasDef?.name || valueMeasName;
              const measureVal = valueKey && firstRow[valueKey] !== undefined ? firstRow[valueKey] : Object.values(firstRow)[0];
              newData = {
                value: measureVal,
                label: valueMeasDef?.label || valueMeasName || '',
              };
              if (w.type === 'gauge') {
                const extractMeas = (measName) => {
                  if (!measName) return undefined;
                  const def = (model.measures || []).find((m) => m.name === measName);
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
          meass.forEach((mn) => { const md = (model.measures || []).find((x) => x.name === mn); if (md?.format) mf[md.label || md.name] = md.format; });
          newData._measureFormats = mf;
          if (dims.length > 0) {
            newData._dimName = dims[0];
            const axisDim = (model.dimensions || []).find((x) => x.name === dims[0]);
            newData._dimLabel = axisDim?.label || axisDim?.name || dims[0];
            if (axisDim?.datePart) newData._datePart = axisDim.datePart;
            else if (axisDim?.type === 'date') newData._datePart = 'full_date';
          }
          if (meass.length > 0) {
            const m0 = (model.measures || []).find((x) => x.name === meass[0]);
            newData._measureLabel = m0?.label || m0?.name || meass[0];
          }
          newData._rowCount = rows.length;
          if (isDrillable) {
            newData._hierarchy = fullHierarchy.map((dn) => {
              const def = (model.dimensions || []).find((x) => x.name === dn);
              return { name: dn, label: def?.label || def?.name || dn };
            });
            newData._drillPath = drillPath;
            newData._drillDepth = drillPath.length;
            newData._isDrillLeaf = drillPath.length >= fullHierarchy.length - 1;
          }
          return { wId, data: newData };
        }).catch((err) => {
          if (err?.name === 'CanceledError' || err?.code === 'ERR_CANCELED') return { wId, data: null };
          const msg = err?.response?.data?.error || err?.message || 'Query failed';
          return { wId, data: { _error: msg, _rowCount: 0 } };
        });
      });

      // Wait for ALL to complete, then batch update (silent — data fetch is not undoable)
      Promise.all(promises).then((results) => {
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
    };
  }, [reportFilters, model, refreshCounter]); // eslint-disable-line react-hooks/exhaustive-deps

  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [settings, setSettings] = useState({});
  const [showSettings, setShowSettings] = useState(false);

  // Multi-page support
  const [pages, setPages] = useState([{ id: 'page-1', name: 'Page 1' }]);
  const [currentPageIdx, setCurrentPageIdx] = useState(0);
  const [editingPageName, setEditingPageName] = useState(null);
  const pagesDataRef = useRef({}); // stores { [pageId]: { layout, widgets } }

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

  const [pageContextMenu, setPageContextMenu] = useState(null); // { idx, x, y }

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
    setPageContextMenu(null);
  }, [pages, currentPageIdx, history, setSelectedWidget]);

  const renamePage = useCallback((idx, newName) => {
    const trimmed = newName.trim();
    if (!trimmed) { setEditingPageName(null); return; }
    // Check for duplicate name
    const isDuplicate = pages.some((p, i) => i !== idx && p.name.toLowerCase() === trimmed.toLowerCase());
    if (isDuplicate) {
      alert(`A page named "${trimmed}" already exists.`);
      setEditingPageName(null);
      return;
    }
    setPages((prev) => prev.map((p, i) => i === idx ? { ...p, name: trimmed } : p));
    setEditingPageName(null);
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
        // Skip the resulting refetch — saved widget data already reflects these filters.
        const hasSavedFilter = Object.values(firstPageWidgets).some((w) => {
          if (w?.type !== 'filter') return false;
          return Array.isArray(w.config?.selectedValues) && w.config.selectedValues.length > 0;
        });
        if (hasSavedFilter) skipNextRefetch.current = true;

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

      setWidgets((prev) => ({
        ...prev,
        [selectedWidget]: {
          ...existing,
          type,
          data: convertedData,
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
  }, [widgets, model, history]);

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

      // Build pages array for save — slicer selections already live in widget.config.selectedValues
      const pagesForSave = pages.map((p) => ({
        id: p.id,
        name: p.name,
        layout: pagesDataRef.current[p.id]?.layout || [],
        widgets: pagesDataRef.current[p.id]?.widgets || {},
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
    return <div style={{ padding: 40, color: '#94a3b8' }}>Loading report...</div>;
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Toolbar
        reportTitle={title}
        onTitleChange={setTitle}
        onAddWidget={handleAddWidget}
        onSave={handleSave}
        saving={saving}
        modelName={model?.name}
        modelId={model?.id}
        onUndo={history.undo}
        onRedo={history.redo}
        canUndo={history.canUndo}
        canRedo={history.canRedo}
        onOpenSettings={() => setShowSettings(true)}
        reportId={id}
        onRefresh={handleRefresh}
        refreshing={refreshing}
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
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Left column: canvas + pages bar, so pages bar doesn't overlap Config/Data panels */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
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
              onDrillUp={handleDrillUp}
              onDrillReset={handleDrillReset}
              crossHighlight={crossHighlight}
            />
          </div>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 0, padding: '0 8px',
            backgroundColor: '#f1f5f9', borderTop: '1px solid #e2e8f0', height: 30, flexShrink: 0,
          }}>
          {pages.map((page, idx) => (
            <div key={page.id}
              onClick={() => switchPage(idx)}
              onDoubleClick={() => setEditingPageName(idx)}
              onContextMenu={(e) => { e.preventDefault(); setPageContextMenu({ idx, x: e.clientX, y: e.clientY }); }}
              style={{
                padding: '4px 14px', fontSize: 11, cursor: 'pointer', userSelect: 'none',
                borderRight: '1px solid #e2e8f0',
                backgroundColor: idx === currentPageIdx ? '#fff' : 'transparent',
                color: idx === currentPageIdx ? '#7c3aed' : '#64748b',
                fontWeight: idx === currentPageIdx ? 600 : 400,
                borderTop: idx === currentPageIdx ? '2px solid #7c3aed' : '2px solid transparent',
                display: 'flex', alignItems: 'center', gap: 4,
              }}
            >
              {editingPageName === idx ? (
                <input
                  autoFocus
                  defaultValue={page.name}
                  onBlur={(e) => renamePage(idx, e.target.value || page.name)}
                  onKeyDown={(e) => { if (e.key === 'Enter') renamePage(idx, e.target.value || page.name); if (e.key === 'Escape') setEditingPageName(null); }}
                  onClick={(e) => e.stopPropagation()}
                  style={{ border: 'none', outline: 'none', fontSize: 11, width: 80, background: 'transparent', fontWeight: 600, color: '#7c3aed' }}
                />
              ) : page.name}
            </div>
          ))}
          <button onClick={addPage} title="Add page"
            style={{ padding: '4px 10px', fontSize: 14, border: 'none', background: 'transparent', cursor: 'pointer', color: '#94a3b8', fontWeight: 700 }}>+</button>
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
          model={model}
        />
        <DataModelPanel
          widgetId={selectedWidget}
          widget={selectedWidget ? widgets[selectedWidget] : null}
          onUpdate={handleUpdateWidget}
          onUpdateSilent={handleUpdateWidgetSilent}
          model={model}
          onModelUpdate={reloadModel}
          reportFilters={crossHighlight?.widgetId === selectedWidget ? slicerSelections : reportFilters}
        />

        {/* Page context menu */}
        {pageContextMenu && (
          <>
            <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 99 }}
              onClick={() => setPageContextMenu(null)} />
            <div style={{
              position: 'fixed', bottom: window.innerHeight - pageContextMenu.y, left: pageContextMenu.x, zIndex: 100,
              backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: 6,
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)', overflow: 'hidden', minWidth: 140,
            }}>
              <button onClick={() => { setEditingPageName(pageContextMenu.idx); setPageContextMenu(null); }}
                style={ctxMenuItem}>Rename</button>
              <button onClick={() => { copyPage(pageContextMenu.idx); }}
                style={ctxMenuItem}>Duplicate</button>
              {pages.length > 1 && (
                <button onClick={() => { deletePage(pageContextMenu.idx); setPageContextMenu(null); }}
                  style={{ ...ctxMenuItem, color: '#dc2626' }}>Delete</button>
              )}
            </div>
          </>
        )}
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
          backgroundColor: saveMsg === 'Saved' ? '#22c55e' : '#ef4444', color: '#fff',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)', animation: 'fadeIn 0.2s',
        }}>{saveMsg === 'Saved' ? '✓ Report saved' : '✗ Save failed'}</div>
      )}
    </div>
  );
}

const ctxMenuItem = {
  display: 'block', width: '100%', padding: '8px 16px', border: 'none',
  background: '#fff', cursor: 'pointer', fontSize: 12, color: '#334155',
  textAlign: 'left',
};
