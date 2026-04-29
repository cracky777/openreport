import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import ReportCanvas from '../components/Canvas/ReportCanvas';
import api from '../utils/api';
import { sanitizeWidgetFilters } from '../utils/widgetFilters';
import { parseFiltersFromUrl, syncFiltersToUrl } from '../utils/urlFilters';
import { filterForTarget } from '../utils/crossFilter';
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
  const urlFiltersAppliedRef = useRef(false);
  // Once the model is loaded, seed reportFilters from the URL `?f_<col>=…` params.
  // URL filters win over saved slicer defaults so a shared link is reproducible.
  useEffect(() => {
    if (!model || urlFiltersAppliedRef.current) return;
    urlFiltersAppliedRef.current = true;
    const fromUrl = parseFiltersFromUrl(window.location.search, model);
    if (fromUrl && Object.keys(fromUrl).length > 0) {
      setReportFilters((prev) => ({ ...prev, ...fromUrl }));
    }
  }, [model]);
  useEffect(() => { syncFiltersToUrl(reportFilters, model); }, [reportFilters, model]);
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
        if (reportPages && reportPages.length > 0) {
          setPages(reportPages);
          firstPageWidgets = reportPages[0].widgets || {};
          setWidgets(firstPageWidgets);
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
      // Text widgets aren't refetched, so we leave them untouched.
      setWidgets((prev) => {
        const next = {};
        for (const [wId, w] of Object.entries(prev || {})) {
          if (!w || w.type === 'text') {
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

    // Use current page widgets — prefer the live `widgets` state (contains fresh drill mutations)
    const currentWidgets = widgets && Object.keys(widgets).length > 0 ? widgets : (pages[currentPageIdx]?.widgets || {});

    // Collect widgets to fetch, then mark them all as loading in one batch.
    // Filter widgets are now included so their distinct value list is also RLS-filtered
    // (previously they reused the owner's saved values, which leaked unauthorized rows).
    const toFetch = Object.entries(currentWidgets).filter(([wId, w]) => {
      if (!w) return false;
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

      // Drill-down support
      const DRILLABLE = ['bar', 'line', 'combo', 'pie', 'treemap'];
      const isDrillable = DRILLABLE.includes(w.type) && fullHierarchy.length > 1;
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
      // Apply cross-filter exclusions per target before merging drill filters.
      const baseFilters = { ...(reportFilters || {}) };
      const targetFilters = filterForTarget(wId, baseFilters, currentWidgets, crossHighlightRef.current);
      const mergedFilters = { ...targetFilters, ...drillFilters };

      // Filter widgets need a distinct list of values for their bound dimension. They must NOT
      // be filtered by reportFilters (so the slicer doesn't filter itself), but RLS still applies.
      const isFilterWidget = w.type === 'filter';
      const queryFilters = isFilterWidget ? {} : mergedFilters;
      const queryLimit = isFilterWidget ? 1000000 : (w.config?.dataLimit || 1000);

      const reportLevelFilters = Array.isArray(report?.settings?.reportFilters) ? report.settings.reportFilters : [];
      const widgetOwnFilters = Array.isArray(w.dataBinding?.widgetFilters) ? w.dataBinding.widgetFilters : [];
      const widgetFilters = [...reportLevelFilters, ...widgetOwnFilters];
      const colorMeasure = (w.config?.colorCondition?.enabled === true) ? w.dataBinding?.colorMeasure : undefined;
      const hasMainBinding = (allDims.length > 0 || meass.length > 0);
      const mainPromise = hasMainBinding
        ? api.post(`/models/${model.id}/query`, {
            dimensionNames: allDims, measureNames: meass,
            limit: queryLimit, filters: queryFilters,
            widgetFilters: sanitizeWidgetFilters(widgetFilters),
            distinct: isFilterWidget || undefined,
          })
        : Promise.resolve({ data: { rows: [] } });
      const colorPromise = colorMeasure
        ? api.post(`/models/${model.id}/query`, {
            dimensionNames: [], measureNames: [colorMeasure], limit: 1,
            filters: queryFilters,
            widgetFilters: sanitizeWidgetFilters(widgetFilters),
          }).catch(() => null)
        : Promise.resolve(null);
      Promise.all([mainPromise, colorPromise]).then(([res, colorRes]) => {
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
        if (!rows || rows.length === 0) {
          // Empty result — clear widget data so it reflects the filter instead of keeping stale data
          const emptyData = isFilterWidget
            ? { values: [], label: dims[0] || '', _rowCount: 0, _colorValue }
            : { _rowCount: 0, _colorValue };
          setWidgets((prev) => ({ ...prev, [wId]: { ...prev[wId], _loading: false, data: emptyData } }));
          return;
        }
        let newData = {};
        const keys = Object.keys(rows[0]);
        if (w.type === 'filter') {
          const dimDef = (model.dimensions || []).find((x) => x.name === dims[0]);
          newData = {
            values: [...new Set(rows.map((r) => r[keys[0]]).filter((v) => v != null))],
            label: dims[0] || '',
            _isDate: dimDef?.type === 'date',
          };
        } else if (w.type === 'pivotTable') {
          const rowDimNames = [...dims];
          newData = { rawRows: rows,
            _rowDims: rowDimNames.map((d) => { const def = (model.dimensions || []).find((x) => x.name === d); return def?.label || def?.name || d; }),
            _colDims: colDimsB.map((d) => { const def = (model.dimensions || []).find((x) => x.name === d); return def?.label || def?.name || d; }),
            _measures: meass.map((m) => { const def = (model.measures || []).find((x) => x.name === m); return def?.label || def?.name || m; }),
          };
        } else if (w.type === 'scatter') {
          const sm = binding.scatterMeasures || {};
          if (sm.x && sm.y) {
            const gl = (name, list) => { const d = list.find((x) => x.name === name); return d?.label || d?.name || name; };
            const fk = (label) => keys.find((k) => k === label) || null;
            const dk = dims.length > 0 ? fk(gl(dims[0], model.dimensions || [])) : null;
            const gk = grpBy.length > 0 ? fk(gl(grpBy[0], model.dimensions || [])) : null;
            const xk = fk(gl(sm.x, model.measures || []));
            const yk = fk(gl(sm.y, model.measures || []));
            const sk = sm.size ? fk(gl(sm.size, model.measures || [])) : null;
            if (xk && yk) {
              const bp = (r) => ({ x: Number(r[xk]) || 0, y: Number(r[yk]) || 0, size: sk ? Number(r[sk]) || 0 : undefined, label: dk ? String(r[dk] ?? '') : undefined });
              if (gk) {
                const groups = {};
                rows.forEach((r) => { const g = String(r[gk] ?? ''); if (!groups[g]) groups[g] = []; groups[g].push(bp(r)); });
                newData = { points: rows.map(bp), seriesGroups: Object.entries(groups).map(([name, pts]) => ({ name, points: pts })) };
              } else {
                newData = { points: rows.map(bp) };
              }
              newData._xLabel = gl(sm.x, model.measures || []);
              newData._yLabel = gl(sm.y, model.measures || []);
              newData._hasSize = !!sk;
              if (sk) newData._sizeLabel = gl(sm.size, model.measures || []);
            }
          }
        } else if (w.type === 'combo') {
          const cbm = binding.comboBarMeasures || [];
          const clm = binding.comboLineMeasures || [];
          const gl = (name, list) => { const d = list.find((x) => x.name === name); return d?.label || d?.name || name; };
          const fk = (label) => keys.find((k) => k === label) || null;
          const axisKey = dims.length > 0 ? fk(gl(dims[0], model.dimensions || [])) || keys[0] : keys[0];
          const grpLabel = grpBy.length > 0 ? gl(grpBy[0], model.dimensions || []) : null;
          const grpKey = grpLabel ? fk(grpLabel) : null;
          const labels = [...new Set(rows.map((r) => String(r[axisKey] ?? '')))];
          let barSeries = [];
          if (grpKey) {
            const ug = [...new Set(rows.map((r) => String(r[grpKey] ?? '')))].sort();
            cbm.forEach((mn) => { const ml = gl(mn, model.measures || []); const mk = fk(ml); if (!mk) return;
              ug.forEach((gv) => { barSeries.push({ name: cbm.length === 1 ? gv : `${gv} - ${ml}`, values: labels.map((l) => { const row = rows.find((r) => String(r[axisKey] ?? '') === l && String(r[grpKey] ?? '') === gv); return row ? Number(row[mk]) || 0 : 0; }) }); });
            });
          } else {
            cbm.forEach((mn) => { const ml = gl(mn, model.measures || []); const mk = fk(ml); if (!mk) return; barSeries.push({ name: ml, values: labels.map((l) => { const row = rows.find((r) => String(r[axisKey] ?? '') === l); return row ? Number(row[mk]) || 0 : 0; }) }); });
          }
          const lineSeries = clm.map((mn) => { const ml = gl(mn, model.measures || []); const mk = fk(ml); if (!mk) return null;
            return { name: ml, values: labels.map((l) => rows.filter((r) => String(r[axisKey] ?? '') === l).reduce((s, r) => s + (Number(r[mk]) || 0), 0)) };
          }).filter(Boolean);
          newData = { labels, barSeries, lineSeries };
          newData._barMeasureLabel = cbm.map((mn) => gl(mn, model.measures || [])).join(', ');
          newData._lineMeasureLabel = clm.map((mn) => gl(mn, model.measures || [])).join(', ');
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
        newData._colorValue = _colorValue;
        setWidgets((prev) => ({ ...prev, [wId]: { ...prev[wId], _loading: false, data: newData } }));
      }).catch((err) => {
        const msg = err?.response?.data?.error || err?.message || 'Query failed';
        setWidgets((prev) => ({ ...prev, [wId]: { ...prev[wId], _loading: false, data: { _error: msg, _rowCount: 0 } } }));
      });
    });
  }, [reportFilters, refreshCounter]); // eslint-disable-line react-hooks/exhaustive-deps

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
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-app)' }}>
      {/* Viewer toolbar — compact */}
      <header className="no-print" style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '4px 10px', backgroundColor: 'var(--bg-panel)', borderBottom: '1px solid var(--border-default)',
        flexShrink: 0,
      }}>
        <img src="/favicon.svg" alt="Open Report" style={{ height: 22 }} />
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
          onCrossFilter={handleCrossFilter}
          onDrillUp={handleDrillUp}
          onDrillReset={handleDrillReset}
          crossHighlight={crossHighlight}
          reportRef={canvasRef}
        />
      </div>

      {/* Print styles */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { margin: 0; padding: 0; }
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

