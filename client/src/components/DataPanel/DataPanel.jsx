import { useState, useEffect, useRef, useCallback } from 'react';
import { TbPencil, TbChevronDown } from 'react-icons/tb';
import api from '../../utils/api';
import SqlExpressionInput from '../SqlExpressionInput/SqlExpressionInput';
import { sanitizeWidgetFilters } from '../../utils/widgetFilters';
import { computeBindingKey } from '../../utils/bindingKey';
import { shiftFiltersForN1, shiftWidgetFiltersForN1, hasShiftableFilterForN1 } from '../../utils/comparePeriod';

export default function DataPanel({ widgetId, widget, onUpdate, onUpdateSilent, onSetWidgetLoading, model, onModelUpdate, settings, onSettingsChange, reportFilters, refreshNonce, reportId }) {
  // Helper used by every action that previously mutated the model. Updates
  // the report's `settings` JSON in-memory; the user's next Save persists it
  // to /api/reports/:id. Returns false when the host didn't provide
  // `onSettingsChange` — callers MUST treat that as a hard failure and
  // refuse to fall back to model mutation. Touching the underlying model
  // from the report editor is never the right behaviour.
  const updateSettings = (patch) => {
    if (typeof onSettingsChange !== 'function') {
      console.error('[DataPanel] onSettingsChange prop is missing — refusing to mutate the model. Action ignored.');
      return false;
    }
    onSettingsChange({ ...(settings || {}), ...patch });
    return true;
  };
  const [status, setStatus] = useState(null);
  const [showCalcForm, setShowCalcForm] = useState(false);
  const [calcLabel, setCalcLabel] = useState('');
  const [calcExpr, setCalcExpr] = useState('');
  const [calcSaving, setCalcSaving] = useState(false);
  const [editingField, setEditingField] = useState(null); // measure name being edited
  const [editForm, setEditForm] = useState({});
  const [editingDim, setEditingDim] = useState(null); // dimension name being edited
  const [dimEditForm, setDimEditForm] = useState({});
  const [loading, setLoading] = useState(false);
  // Date Table is collapsed by default — only the main date column is shown,
  // the per-period extension dims (year, month, weekday, …) appear when opened.
  const [dateTableOpen, setDateTableOpen] = useState(false);
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;
  // Fetch-related updates (loading flag, fetched data) should NOT pollute undo history
  const onUpdateSilentRef = useRef(onUpdateSilent || onUpdate);
  onUpdateSilentRef.current = onUpdateSilent || onUpdate;
  const widgetRef = useRef(widget);
  widgetRef.current = widget;
  const widgetIdRef = useRef(widgetId);
  widgetIdRef.current = widgetId;

  if (!model) {
    return (
      <div style={{ marginBottom: 16 }}>
        <div style={sectionTitle}>Data Source</div>
        <div style={{ fontSize: 12, color: 'var(--text-disabled)' }}>No model linked to this report.</div>
      </div>
    );
  }

  const hasWidget = widgetId && widget && widget.type !== 'text';
  const binding = hasWidget ? (widget.dataBinding || {}) : {};
  const selectedDims = binding.selectedDimensions || [];
  const groupBy = binding.groupBy || [];
  const columnDims = binding.columnDimensions || [];

  // Build measures list based on widget type
  const isScatter = widget?.type === 'scatter';
  const isCombo = widget?.type === 'combo';
  const scatterMeas = binding.scatterMeasures || {};
  const comboBarMeas = binding.comboBarMeasures || [];
  const comboLineMeas = binding.comboLineMeasures || [];
  const gaugeThresholdMeasure = binding.gaugeThresholdMeasure;
  const gaugeMaxMeasure = binding.gaugeMaxMeasure;
  const selectedMeass = isScatter
    ? [scatterMeas.x, scatterMeas.y, scatterMeas.size].filter(Boolean)
    : isCombo
      ? [...new Set([...comboBarMeas, ...comboLineMeas])]
      : widget?.type === 'gauge'
        ? [...new Set([...(binding.selectedMeasures || []), gaugeThresholdMeasure, gaugeMaxMeasure].filter(Boolean))]
        : (binding.selectedMeasures || []);

  // Variables still needed downstream by the fetcher / status / etc.
  const isFilterWidget = widget?.type === 'filter';
  const colorEnabled = widget?.config?.colorCondition?.enabled === true;
  const colorMeasure = colorEnabled ? (binding.colorMeasure || '') : '';
  // Combine report-level filters (Settings panel) with the widget's own
  // filters — same pattern as Editor.jsx's main fetch path. Without this,
  // DataPanel-triggered refetches (binding edits, drag-drop) silently drop
  // the report-wide filters until something else nudges Editor.jsx into
  // refetching.
  const reportLevelFilters = Array.isArray(settings?.reportFilters) ? settings.reportFilters : [];
  const ownWidgetFilters = Array.isArray(binding.widgetFilters) ? binding.widgetFilters : [];
  const widgetFilters = [...reportLevelFilters, ...ownWidgetFilters];
  const aggOverrides = binding.measureAggOverrides || {};

  // Cache key — shared with Editor.jsx via computeBindingKey so both fetchers
  // agree on what counts as the "same" binding. After Editor's refetch (drill,
  // filter change, refresh), it stamps `data._fetchedBinding` with this same
  // value so re-selecting the widget doesn't trigger an unnecessary refetch.
  const bindingKey = hasWidget ? computeBindingKey({ widget, model, reportFilters }) : '';
  const selectionKey = hasWidget ? `${widgetId}:${bindingKey}` : '';

  // Drag start handler
  const handleDragStart = (e, fieldName, fieldType) => {
    e.dataTransfer.setData('application/field-name', fieldName);
    e.dataTransfer.setData('application/field-type', fieldType); // 'dimension' or 'measure'
    e.dataTransfer.effectAllowed = 'copyMove';
  };

  // Track previous (widgetId, bindingKey) plus a per-widget refresh nonce
  // map. The map is critical: refreshNonce is the SELECTED widget's nonce
  // and changes each time the selection moves to a widget with a
  // different historical nonce — clicking from a refreshed widget (nonce=1)
  // to an untouched one (nonce=0) would otherwise look like a refresh
  // request and trigger a fetch we don't want.
  const prevWidgetIdRef = useRef(null);
  const prevBindingKeyRef = useRef(null);
  const prevRefreshNoncesByWidgetRef = useRef({});
  useEffect(() => {
    if (!selectionKey) {
      prevWidgetIdRef.current = null;
      prevBindingKeyRef.current = null;
      return;
    }

    const parts = selectionKey.split(':');
    const wId = parts[0];
    const dims = parts[1]?.split(',').filter(Boolean) || [];
    const meass = parts[2]?.split(',').filter(Boolean) || [];
    const grpBy = parts[3]?.split(',').filter(Boolean) || [];

    const hasMainBinding = dims.length > 0 || meass.length > 0;
    const hasColorMeas = !!colorMeasure;

    const capturedWidget = widgetRef.current;
    const capturedWidgetId = widgetIdRef.current;

    const prevWId = prevWidgetIdRef.current;
    const prevBK = prevBindingKeyRef.current;
    // Per-widget previous nonce. `undefined` means "first time we see this
    // widget" — not a refresh request.
    const prevNonceForThisWidget = prevRefreshNoncesByWidgetRef.current[capturedWidgetId];
    prevWidgetIdRef.current = capturedWidgetId;
    prevBindingKeyRef.current = bindingKey;
    prevRefreshNoncesByWidgetRef.current[capturedWidgetId] = refreshNonce;

    if (!hasMainBinding && !hasColorMeas) {
      setStatus(null);
      return;
    }
    if (!capturedWidget || !capturedWidgetId) return;

    const refreshTriggered = prevNonceForThisWidget !== undefined
      && prevNonceForThisWidget !== refreshNonce;
    // Selection change = different widget than the previous render. Skip:
    // the user is just navigating, no data work expected.
    if (prevWId !== null && prevWId !== capturedWidgetId && !refreshTriggered) {
      const hasCachedData = capturedWidget.data?._fetchedBinding === bindingKey
        && Object.keys(capturedWidget.data).length > 1;
      if (hasCachedData) setStatus({ type: 'ok', message: 'cached' });
      return;
    }
    // Same widget but binding unchanged AND no manual refresh: just a
    // benign re-render (parent re-rendered for an unrelated reason).
    if (prevWId === capturedWidgetId && prevBK === bindingKey && !refreshTriggered) {
      return;
    }
    // First time we see this widget (initial mount with no prior render):
    // honour the cache if it's there, otherwise let Editor.jsx's main
    // fetch loop be the one to populate it. We don't auto-fetch on first
    // sight either — explicit refresh / binding edit is the contract.
    if (prevWId === null) {
      const hasCachedData = capturedWidget.data?._fetchedBinding === bindingKey
        && Object.keys(capturedWidget.data).length > 1;
      if (hasCachedData) setStatus({ type: 'ok', message: 'cached' });
      return;
    }

    let cancelled = false;
    let stampedLoadingFor = null; // widgetId we set _loading on, so we can revert on abort
    const abortController = new AbortController();
    // Per-fetch queryIds — registered server-side via inFlightQueries.
    // On abort/supersede we POST /cancel-query for each so the SQL is
    // killed at the DB level (HTTP abort alone leaves it running).
    const activeQueryIds = new Set();
    const newQueryId = () => {
      const id = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `q-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      activeQueryIds.add(id);
      return id;
    };

    const timer = setTimeout(async () => {
      setLoading(true);
      setStatus(null);

      // Mark widget as loading (silent — not an undoable action)
      const lw = widgetRef.current;
      if (lw && widgetIdRef.current === capturedWidgetId) {
        onUpdateSilentRef.current(capturedWidgetId, { ...lw, _loading: true });
        stampedLoadingFor = capturedWidgetId;
      }

      try {
        // Include groupBy and column dimensions in the query
        const colDimsBinding = capturedWidget.dataBinding?.columnDimensions || [];

        // Drill-down support — mirror Editor/Viewer logic
        const DRILLABLE_LOCAL = ['bar', 'line', 'combo', 'pie', 'treemap'];
        const fullHierarchyLocal = [...dims];
        const isDrillableLocal = DRILLABLE_LOCAL.includes(capturedWidget.type) && fullHierarchyLocal.length > 1;
        const drillPathLocal = [];
        if (isDrillableLocal) {
          const raw = Array.isArray(capturedWidget.drillPath) ? capturedWidget.drillPath : [];
          for (let i = 0; i < raw.length && i < fullHierarchyLocal.length - 1; i++) {
            if (raw[i]?.dim === fullHierarchyLocal[i]) drillPathLocal.push(raw[i]);
            else break;
          }
        }
        let effectiveDims = dims;
        const drillFiltersLocal = {};
        if (isDrillableLocal) {
          drillPathLocal.forEach(({ dim, value }) => { if (dim && value != null) drillFiltersLocal[dim] = [String(value)]; });
          const activeDim = fullHierarchyLocal[drillPathLocal.length] || fullHierarchyLocal[0];
          effectiveDims = [activeDim];
        }

        // Build unique dimension list for SQL query (each dim appears once even if in both Rows and Columns)
        const seen = new Set();
        const allDims = [];
        for (const d of [...effectiveDims, ...grpBy, ...colDimsBinding]) {
          if (!seen.has(d)) { seen.add(d); allDims.push(d); }
        }

        // Deduplicate measures for SQL query (same measure in multiple scatter slots = one SQL column)
        const uniqueMeass = [...new Set(meass)];

        const mergedFiltersLocal = isFilterWidget ? {} : { ...(reportFilters || {}), ...drillFiltersLocal };

        // Report-scoped extras/overrides — must be sent on every /query so the
        // server can resolve report-only dims/measures (e.g. _date.year from
        // a Date Table created in this report).
        const reportExtras = {
          extraDimensions: settings?.extraDimensions || [],
          extraMeasures: settings?.extraMeasures || [],
          dimensionOverrides: settings?.dimensionOverrides || {},
          measureOverrides: settings?.measureOverrides || {},
        };

        // Server-side Top N (mirrors Editor.jsx). Restricted to a single
        // displayed dimension on bar/pie/treemap with at least one measure.
        const TOP_N_TYPES_LOCAL = ['bar', 'pie', 'treemap'];
        const topNApplies = TOP_N_TYPES_LOCAL.includes(capturedWidget.type)
          && capturedWidget.config?.topNEnabled === true
          && uniqueMeass.length > 0
          && allDims.length === 1;
        const topNValue = topNApplies ? Math.max(1, Math.floor(capturedWidget.config?.topN ?? 20)) : 0;
        const topNMeasure = topNApplies ? uniqueMeass[0] : null;
        const widgetFiltersWithTopN = topNApplies
          ? [...widgetFilters, { field: topNMeasure, op: 'top_n', value: topNValue, isMeasure: true }]
          : widgetFilters;

        // Main query (skipped when only colour-by-measure is bound, e.g. for shape/text widgets)
        const mainQid = hasMainBinding ? newQueryId() : null;
        const mainPromise = hasMainBinding
          ? api.post(`/models/${model.id}/query`, {
              queryId: mainQid,
              dimensionNames: allDims,
              measureNames: uniqueMeass,
              measureAggOverrides: Object.keys(aggOverrides).length > 0 ? aggOverrides : undefined,
              limit: isFilterWidget ? 1000000 : (capturedWidget.config?.dataLimit || 1000),
              filters: mergedFiltersLocal,
              widgetFilters: sanitizeWidgetFilters(widgetFiltersWithTopN),
              distinct: isFilterWidget || undefined,
              reportId,
              bypassCache: refreshTriggered,
              ...reportExtras,
            }, { signal: abortController.signal })
              .finally(() => { if (mainQid) activeQueryIds.delete(mainQid); })
          : Promise.resolve({ data: { rows: [] } });

        // Conditional formatting — single-row aggregate of the bound colour measure
        const colorQid = hasColorMeas ? newQueryId() : null;
        const colorPromise = hasColorMeas
          ? api.post(`/models/${model.id}/query`, {
              queryId: colorQid,
              dimensionNames: [],
              measureNames: [colorMeasure],
              limit: 1,
              filters: mergedFiltersLocal,
              widgetFilters: sanitizeWidgetFilters(widgetFilters),
              reportId,
              bypassCache: refreshTriggered,
              ...reportExtras,
            }, { signal: abortController.signal })
              .catch(() => null)
              .finally(() => { if (colorQid) activeQueryIds.delete(colorQid); })
          : Promise.resolve(null);

        // Total query for the Others bucket — runs only when Top N is active.
        const totalQid = topNApplies ? newQueryId() : null;
        const totalPromise = topNApplies
          ? api.post(`/models/${model.id}/query`, {
              queryId: totalQid,
              dimensionNames: [],
              measureNames: [topNMeasure],
              limit: 1,
              filters: mergedFiltersLocal,
              widgetFilters: sanitizeWidgetFilters(widgetFilters),
              reportId,
              bypassCache: refreshTriggered,
              ...reportExtras,
            }, { signal: abortController.signal })
              .catch(() => null)
              .finally(() => { if (totalQid) activeQueryIds.delete(totalQid); })
          : Promise.resolve(null);

        // N-1 comparison query (scorecards only). Shifts every filter on
        // `compareDateDim` back by one year so the parallel SQL returns
        // the previous-period value with the same WHERE shape otherwise.
        const compareDateDim = capturedWidget.type === 'scorecard'
          ? (capturedWidget.dataBinding?.compareDateDim || null) : null;
        // Same as Editor.jsx: drop any date dim to opt in, then shift
        // every year-like or full-date filter on the model's dim list.
        const shouldFetchN1 = !!compareDateDim
          && hasShiftableFilterForN1(mergedFiltersLocal, widgetFilters, model?.dimensions);
        const n1Filters = shouldFetchN1
          ? shiftFiltersForN1(mergedFiltersLocal, model?.dimensions)
          : null;
        const n1WidgetFilters = shouldFetchN1
          ? shiftWidgetFiltersForN1(widgetFilters, model?.dimensions)
          : null;
        const n1Qid = shouldFetchN1 ? newQueryId() : null;
        const n1Promise = shouldFetchN1
          ? api.post(`/models/${model.id}/query`, {
              queryId: n1Qid,
              dimensionNames: allDims,
              measureNames: uniqueMeass,
              limit: 1,
              filters: n1Filters,
              widgetFilters: sanitizeWidgetFilters(n1WidgetFilters),
              reportId,
              bypassCache: refreshTriggered,
              ...reportExtras,
            }, { signal: abortController.signal })
              .catch(() => null)
              .finally(() => { if (n1Qid) activeQueryIds.delete(n1Qid); })
          : Promise.resolve(null);

        const [res, colorRes, totalRes, n1Res] = await Promise.all([mainPromise, colorPromise, totalPromise, n1Promise]);
        let _colorValue;
        if (colorRes) {
          const cRow = colorRes.data?.rows?.[0];
          if (cRow) {
            const v = Object.values(cRow)[0];
            const num = typeof v === 'number' ? v : parseFloat(v);
            if (!isNaN(num)) _colorValue = num;
          }
        }

        if (cancelled) return;

        const rows = res.data.rows;
        const maxReached = res.data.maxReached || false;
        let newData = {};
        // Use latest widget type (not captured) to handle type changes during fetch
        const currentType = widgetRef.current?.type || capturedWidget.type;

        if (currentType === 'pivotTable') {
          if (rows.length > 0) {
            // Pass raw rows + metadata for client-side pivoting
            const rowDimNames = [...dims];
            const measNames = meass.map((m) => {
              const measDef = (model.measures || []).find((x) => x.name === m);
              return measDef?.label || measDef?.name || m;
            });
            const dimLabels = dims.map((d) => {
              const dimDef = (model.dimensions || []).find((x) => x.name === d);
              return dimDef?.label || dimDef?.name || d;
            });
            const colDimLabels = colDimsBinding.map((d) => {
              const dimDef = (model.dimensions || []).find((x) => x.name === d);
              return dimDef?.label || dimDef?.name || d;
            });
            newData = {
              rawRows: rows,
              _rowDims: rowDimNames.map((d) => {
                const dimDef = (model.dimensions || []).find((x) => x.name === d);
                return dimDef?.label || dimDef?.name || d;
              }),
              _colDims: colDimLabels,
              _measures: measNames,
            };
          }
        } else if (currentType === 'scatter') {
          const sm = capturedWidget.dataBinding?.scatterMeasures || {};
          if (rows.length > 0 && sm.x && sm.y) {
            const gl = (name, list) => { const d = list.find((x) => x.name === name); return d?.label || d?.name || name; };
            const keys = Object.keys(rows[0]);
            const fk = (label) => keys.find((k) => k === label) || null;

            const dimKey = dims.length > 0 ? fk(gl(dims[0], model.dimensions || [])) : null;
            const grpKey = grpBy.length > 0 ? fk(gl(grpBy[0], model.dimensions || [])) : null;
            const xKey = fk(gl(sm.x, model.measures || []));
            const yKey = fk(gl(sm.y, model.measures || []));
            const sizeKey = sm.size ? fk(gl(sm.size, model.measures || [])) : null;

            if (xKey && yKey) {
              const buildPoint = (r) => ({
                x: Number(r[xKey]) || 0,
                y: Number(r[yKey]) || 0,
                size: sizeKey ? Number(r[sizeKey]) || 0 : undefined,
                label: dimKey ? String(r[dimKey] ?? '') : undefined,
              });

              if (grpKey) {
                const groups = {};
                rows.forEach((r) => {
                  const g = String(r[grpKey] ?? '');
                  if (!groups[g]) groups[g] = [];
                  groups[g].push(buildPoint(r));
                });
                newData = {
                  points: rows.map(buildPoint),
                  seriesGroups: Object.entries(groups).map(([name, pts]) => ({ name, points: pts })),
                };
              } else {
                newData = { points: rows.map(buildPoint) };
              }

              newData._xLabel = gl(sm.x, model.measures || []);
              newData._yLabel = gl(sm.y, model.measures || []);
              newData._hasSize = !!sizeKey;
              if (sizeKey) newData._sizeLabel = gl(sm.size, model.measures || []);
            }
          }
        } else if (currentType === 'combo') {
          if (rows.length > 0) {
            const keys = Object.keys(rows[0]);
            const gl = (name, list) => { const d = list.find((x) => x.name === name); return d?.label || d?.name || name; };
            const fk = (label) => keys.find((k) => k === label) || null;

            const cBarMeas = capturedWidget.dataBinding?.comboBarMeasures || [];
            const cLineMeas = capturedWidget.dataBinding?.comboLineMeasures || [];
            const axisKey = effectiveDims.length > 0 ? fk(gl(effectiveDims[0], model.dimensions || [])) || keys[0] : keys[0];
            const grpLabel = grpBy.length > 0 ? gl(grpBy[0], model.dimensions || []) : null;
            const grpKey = grpLabel ? fk(grpLabel) : null;

            const labels = [...new Set(rows.map((r) => String(r[axisKey] ?? '')))];

            // Bar series: split by legend (like bar chart)
            let barSeries = [];
            if (grpKey) {
              const uniqueGroups = [...new Set(rows.map((r) => String(r[grpKey] ?? '')))].sort();
              cBarMeas.forEach((mn) => {
                const measLabel = gl(mn, model.measures || []);
                const measKey = fk(measLabel);
                if (!measKey) return;
                uniqueGroups.forEach((gv) => {
                  const seriesName = cBarMeas.length === 1 ? gv : `${gv} - ${measLabel}`;
                  barSeries.push({
                    name: seriesName,
                    values: labels.map((l) => {
                      const row = rows.find((r) => String(r[axisKey] ?? '') === l && String(r[grpKey] ?? '') === gv);
                      return row ? Number(row[measKey]) || 0 : 0;
                    }),
                  });
                });
              });
            } else {
              cBarMeas.forEach((mn) => {
                const measLabel = gl(mn, model.measures || []);
                const measKey = fk(measLabel);
                if (!measKey) return;
                barSeries.push({
                  name: measLabel,
                  values: labels.map((l) => {
                    const row = rows.find((r) => String(r[axisKey] ?? '') === l);
                    return row ? Number(row[measKey]) || 0 : 0;
                  }),
                });
              });
            }

            // Line series: aggregate across legend groups (one line per measure)
            const lineSeries = cLineMeas.map((mn) => {
              const measLabel = gl(mn, model.measures || []);
              const measKey = fk(measLabel);
              if (!measKey) return null;
              return {
                name: measLabel,
                values: labels.map((l) => {
                  const matchingRows = rows.filter((r) => String(r[axisKey] ?? '') === l);
                  return matchingRows.reduce((sum, r) => sum + (Number(r[measKey]) || 0), 0);
                }),
              };
            }).filter(Boolean);

            newData = { labels, barSeries, lineSeries };
            newData._barMeasureLabel = cBarMeas.map((mn) => gl(mn, model.measures || [])).join(', ');
            newData._lineMeasureLabel = cLineMeas.map((mn) => gl(mn, model.measures || [])).join(', ');
          }
        } else if (currentType === 'filter') {
          if (rows.length > 0) {
            const keys = Object.keys(rows[0]);
            const dimDef = (model.dimensions || []).find((x) => x.name === dims[0]);
            newData = {
              values: [...new Set(rows.map((r) => r[keys[0]]).filter((v) => v != null))],
              label: dims[0] || '',
              _isDate: dimDef?.type === 'date',
            };
          }
        } else if (currentType === 'table') {
          if (rows.length > 0) {
            const dataLimit = capturedWidget.config?.dataLimit || 1000;
            let columns = Object.keys(rows[0]);
            // Reorder columns according to columnOrder if set
            const colOrder = capturedWidget.dataBinding?.columnOrder;
            if (colOrder && colOrder.length > 0) {
              // Map dimension/measure names to their labels (column keys in the result)
              const allFields = [...(model.dimensions || []), ...(model.measures || [])];
              const nameToLabel = {};
              for (const f of allFields) nameToLabel[f.name] = f.label || f.name;
              const orderedLabels = colOrder.map((n) => nameToLabel[n]).filter(Boolean);
              // Reorder: ordered labels first, then any remaining
              const orderedCols = orderedLabels.filter((l) => columns.includes(l));
              const rest = columns.filter((c) => !orderedCols.includes(c));
              columns = [...orderedCols, ...rest];
            }
            newData = {
              columns,
              rows: rows.map((r) => columns.map((c) => r[c] != null ? String(r[c]) : '')),
              _hasMore: rows.length >= dataLimit,
              _loadingMore: false,
            };
          }
        } else if (currentType === 'scorecard' || currentType === 'gauge') {
          const firstRow = rows[0];
          if (firstRow) {
            // Value measure is the one in selectedMeasures[0] (capturedWidget.dataBinding.selectedMeasures[0])
            const valueMeasName = capturedWidget.dataBinding?.selectedMeasures?.[0];
            const valueMeasDef = model.measures?.find((m) => m.name === valueMeasName);
            const valueKey = valueMeasDef?.label || valueMeasDef?.name || valueMeasName;
            const measureVal = valueKey && firstRow[valueKey] !== undefined ? firstRow[valueKey] : Object.values(firstRow)[0];
            newData = {
              value: measureVal,
              label: valueMeasDef?.label || valueMeasName || '',
            };
            // N-1 comparison (scorecard only).
            if (currentType === 'scorecard' && n1Res?.data?.rows?.[0]) {
              const n1Row = n1Res.data.rows[0];
              const n1Raw = valueKey && n1Row[valueKey] !== undefined ? n1Row[valueKey] : Object.values(n1Row)[0];
              const n1Num = typeof n1Raw === 'number' ? n1Raw : parseFloat(String(n1Raw));
              if (!isNaN(n1Num)) newData._n1Value = n1Num;
            }
            // Threshold & max from measures (gauge only)
            if (currentType === 'gauge') {
              const extractMeasureValue = (measName) => {
                if (!measName) return undefined;
                const def = model.measures?.find((m) => m.name === measName);
                const key = def?.label || def?.name || measName;
                const raw = firstRow[key];
                if (typeof raw === 'number') return raw;
                if (raw != null) {
                  const parsed = parseFloat(String(raw));
                  if (!isNaN(parsed)) return parsed;
                }
                return undefined;
              };
              const th = extractMeasureValue(capturedWidget.dataBinding?.gaugeThresholdMeasure);
              if (th !== undefined) newData.threshold = th;
              const mx = extractMeasureValue(capturedWidget.dataBinding?.gaugeMaxMeasure);
              if (mx !== undefined) newData.maxValue = mx;
            }
          }
        } else if (currentType === 'pie' || currentType === 'treemap') {
          if (rows.length > 0) {
            const keys = Object.keys(rows[0]);
            newData = {
              items: rows.map((r) => ({
                name: String(r[keys[0]]),
                value: Number(r[keys[keys.length - 1]]) || 0,
              })),
            };
          }
        } else if (rows.length > 0) {
          // bar / line charts
          const keys = Object.keys(rows[0]);

          if (grpBy.length > 0 && keys.length >= 3) {
            // Has Legend: pivot into multi-series
            const axisKey = keys[0];
            const groupKey = keys[1];
            const valueKey = keys[keys.length - 1];

            const uniqueLabels = [...new Set(rows.map((r) => String(r[axisKey])))];
            const uniqueGroups = [...new Set(rows.map((r) => String(r[groupKey])))];

            const series = uniqueGroups.map((groupVal) => {
              const values = uniqueLabels.map((label) => {
                const row = rows.find((r) => String(r[axisKey]) === label && String(r[groupKey]) === groupVal);
                return row ? Number(row[valueKey]) || 0 : 0;
              });
              return { name: groupVal, values };
            });

            newData = { labels: uniqueLabels, series };
          } else {
            newData = {
              labels: rows.map((r) => String(r[keys[0]])),
              values: rows.map((r) => Number(r[keys[keys.length - 1]]) || 0),
            };
          }
        }

        if (cancelled) return;
        newData._maxReached = maxReached;
        newData._fetchedBinding = bindingKey;
        // Attach primary dimension name for cross-filtering (use active dim when drilling)
        const primaryDim = effectiveDims[0] || dims[0];
        if (primaryDim) {
          const dimDef = (model.dimensions || []).find((x) => x.name === primaryDim);
          newData._dimName = dimDef?.name || primaryDim;
          newData._dimLabel = dimDef?.label || dimDef?.name || primaryDim;
        }
        if (meass.length > 0) {
          const m0 = (model.measures || []).find((x) => x.name === meass[0]);
          newData._measureLabel = m0?.label || m0?.name || meass[0];
        }
        // Attach measure formats for widget rendering
        const measureFormats = {};
        for (const measName of meass) {
          const measDef = (model.measures || []).find((x) => x.name === measName);
          if (measDef?.format) measureFormats[measDef.label || measDef.name] = measDef.format;
        }
        newData._measureFormats = measureFormats;
        // Attach date part info for chronological sorting in charts
        if (primaryDim) {
          const axisDim = (model.dimensions || []).find((x) => x.name === primaryDim);
          if (axisDim?.datePart) newData._datePart = axisDim.datePart;
          else if (axisDim?.type === 'date') newData._datePart = 'full_date';
          // Per-zone axis sort needs the dim's type + datePart to pick the
          // right comparator (chrono for month names, numeric for date parts).
          if (axisDim) newData._axisDimDef = { type: axisDim.type, datePart: axisDim.datePart };
        }
        if (grpBy.length > 0) {
          const legendDim = (model.dimensions || []).find((x) => x.name === grpBy[0]);
          if (legendDim) newData._legendDimDef = { type: legendDim.type, datePart: legendDim.datePart };
        }
        newData._rowCount = rows.length;
        newData._colorValue = _colorValue;
        newData._sql = res.data?.sql || null;
        // Server-side Top N — extract grand total so the widget can derive
        // Others = total − Σ(top N).
        if (topNApplies && totalRes) {
          const tRow = totalRes.data?.rows?.[0];
          if (tRow) {
            const v = Object.values(tRow)[0];
            const num = typeof v === 'number' ? v : parseFloat(v);
            if (!isNaN(num)) newData._othersTotal = num;
          }
        }
        // Expose drill metadata so canvas can render the up/reset buttons
        if (isDrillableLocal) {
          newData._hierarchy = fullHierarchyLocal.map((dn) => {
            const def = (model.dimensions || []).find((x) => x.name === dn);
            return { name: dn, label: def?.label || def?.name || dn };
          });
          newData._drillPath = drillPathLocal;
          newData._drillDepth = drillPathLocal.length;
          newData._isDrillLeaf = drillPathLocal.length >= fullHierarchyLocal.length - 1;
        }
        const latestWidget = widgetRef.current;
        if (latestWidget && widgetIdRef.current === capturedWidgetId) {
          onUpdateSilentRef.current(capturedWidgetId, { ...latestWidget, data: newData, _loading: false });
        }
        setStatus({ type: 'ok' });
      } catch (err) {
        if (cancelled) return;
        const ew = widgetRef.current;
        const msg = err?.response?.data?.error || err?.message || 'Query failed';
        const code = err?.response?.data?.code || null;
        const timeoutMs = err?.response?.data?.timeoutMs || null;
        if (ew && widgetIdRef.current === capturedWidgetId) {
          onUpdateSilentRef.current(capturedWidgetId, { ...ew, _loading: false, data: { ...(ew.data || {}), _error: msg, _errorCode: code, _errorTimeoutMs: timeoutMs, _rowCount: 0 } });
        }
        setStatus({ type: 'error', message: code === 'TIMEOUT' ? `Timeout after ${Math.round((timeoutMs || 0) / 1000)}s` : msg });
      } finally {
        setLoading(false);
      }
    }, 150);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      abortController.abort();
      // Aborting the AbortController only cuts the HTTP response — the
      // SQL keeps running on the database. Fire /cancel-query for each
      // still-registered queryId so the server invokes the dialect's
      // native cancel (pg_cancel_backend / KILL QUERY / request.cancel
      // / jobs.cancel / interrupt) and frees the connection.
      if (activeQueryIds.size > 0) {
        for (const qid of activeQueryIds) {
          api.post('/models/cancel-query', { queryId: qid }).catch(() => { /* best effort */ });
        }
        activeQueryIds.clear();
      }
      // If we already stamped `_loading: true` on a widget for this run
      // and the fetch is being aborted (user clicked another widget,
      // edited binding again, etc.), clear the flag so the spinner
      // doesn't stay stuck on that widget. The catch path returns
      // silently on `cancelled`, so this is the only place the cleanup
      // can happen.
      if (stampedLoadingFor && typeof onSetWidgetLoading === 'function') {
        onSetWidgetLoading(stampedLoadingFor, false);
      }
    };
  }, [selectionKey, bindingKey, model.id, refreshNonce]);

  // Helper to get short table name
  const shortTable = (t) => t.includes('.') ? t.split('.').pop() : t;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, flexShrink: 0 }}>
        <div style={{ ...sectionTitle, display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
          <span>Data —&nbsp;</span>
          {model.id ? (
            <a
              href={`/models/${model.id}`}
              target="_blank"
              rel="noopener noreferrer"
              title={`${model.name} — open data model`}
              style={modelLinkStyle}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'var(--accent-primary)';
                const pencil = e.currentTarget.querySelector('[data-pencil]');
                if (pencil) pencil.style.opacity = '1';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'var(--text-disabled)';
                const pencil = e.currentTarget.querySelector('[data-pencil]');
                if (pencil) pencil.style.opacity = '0.5';
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{model.name}</span>
              <TbPencil data-pencil size={11} style={{ opacity: 0.5, transition: 'opacity 0.12s', flexShrink: 0 }} />
            </a>
          ) : (
            <span>{model.name}</span>
          )}
        </div>
        {loading && <div style={loadingDot} />}
      </div>

      {/* Measures first — fixed height, does not shrink when editing */}
      <FieldSection label={
        <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
          <span>Measures</span>
          <button onClick={() => setShowCalcForm(!showCalcForm)} style={addCalcBtnSmall}>+ Measure</button>
        </span>
      } style={{ flex: '0 0 auto', maxHeight: showCalcForm ? '45%' : '25%' }}>
        {showCalcForm && (
          <div style={{ padding: 6, background: 'var(--bg-active)', borderRadius: 4, marginBottom: 4, border: '1px solid var(--accent-primary-border)' }}>
            <input type="text" placeholder="Label" value={calcLabel}
              onChange={(e) => setCalcLabel(e.target.value)}
              style={{ ...calcInputStyle, marginBottom: 4 }} />
            <SqlExpressionInput value={calcExpr} onChange={setCalcExpr} model={model} />
            <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
              <button onClick={() => { setShowCalcForm(false); setCalcLabel(''); setCalcExpr(''); }}
                style={{ fontSize: 11, padding: '2px 8px', border: '1px solid var(--border-default)', borderRadius: 3, background: 'var(--bg-panel)', cursor: 'pointer', color: 'var(--text-muted)' }}>Cancel</button>
              <button disabled={!calcLabel || !calcExpr || calcSaving} onClick={async () => {
                setCalcSaving(true);
                try {
                  const measName = `_calc.${calcLabel.replace(/\s+/g, '_').toLowerCase()}`;
                  const newMeasure = {
                    name: measName, table: '', column: '', aggregation: 'custom',
                    expression: calcExpr, label: calcLabel,
                  };
                  // Report-scoped: append to settings.extraMeasures so this
                  // calc lives only inside the current report. If
                  // updateSettings refuses, abort — never mutate the model.
                  const wrote = updateSettings({
                    extraMeasures: [...((settings && settings.extraMeasures) || []), newMeasure],
                  });
                  if (!wrote) return;
                  setCalcLabel(''); setCalcExpr(''); setShowCalcForm(false);
                } catch (err) { console.error(err); }
                finally { setCalcSaving(false); }
              }}
                style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', border: 'none', borderRadius: 3, background: 'var(--accent-primary)', color: '#fff', cursor: 'pointer' }}>
                {calcSaving ? '...' : 'Add'}
              </button>
            </div>
          </div>
        )}
        <div style={listBox}>
          {(model.measures || []).map((m) => (
              <div
                key={m.name}
                draggable
                onDragStart={(e) => handleDragStart(e, m.name, 'measure')}
                onClick={(e) => {
                  e.stopPropagation();
                  if (editingField === m.name) {
                    setEditingField(null);
                  } else {
                    setEditingField(m.name);
                    setEditingDim(null); // close dimension edit if open
                    setEditForm({
                      label: m.label || m.column,
                      expression: m.expression || '',
                      decimals: m.format?.decimals ?? 2,
                      thousandSep: m.format?.thousandSep ?? ' ',
                      prefix: m.format?.prefix ?? '',
                      suffix: m.format?.suffix ?? '',
                    });
                  }
                }}
                title={m.aggregation === 'custom' ? `SQL: ${m.expression}` : `${m.table}.${m.column} (${m.aggregation})`}
                style={{
                  ...dragItem,
                  backgroundColor: editingField === m.name ? 'var(--bg-active)' : selectedMeass.includes(m.name) ? 'var(--state-success-soft)' : 'transparent',
                  borderLeft: editingField === m.name ? '3px solid var(--accent-primary)' : selectedMeass.includes(m.name) ? '3px solid var(--state-success)' : '3px solid transparent',
                }}
              >
                <span style={dragHandle}>⠿</span>
                <span style={truncatedLabel} title={m.label || m.column}>{m.label || m.column}</span>
                <span style={{ ...(m.aggregation === 'custom' ? customTag : measTag), flexShrink: 0 }}>
                  {m.aggregation === 'custom' ? 'fx' : m.aggregation}
                </span>
              </div>
            ))}
          </div>
        </FieldSection>

      {/* Edit panel — between measures and dimensions */}
      {editingField && (() => {
        const m = (model.measures || []).find((x) => x.name === editingField);
        if (!m) return null;
        return (
          <div style={{ ...editPanelStyle, flexShrink: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent-primary)', marginBottom: 6 }}>
              Edit: {m.label || m.column}
            </div>
            <div style={editRow}>
              <span style={editLabel}>Label</span>
              <input type="text" value={editForm.label}
                onChange={(e) => setEditForm({ ...editForm, label: e.target.value })}
                style={editInput} />
            </div>

            {m.aggregation === 'custom' && (
              <div style={{ marginBottom: 6 }}>
                <span style={editLabel}>SQL Expression</span>
                <SqlExpressionInput value={editForm.expression}
                  onChange={(v) => setEditForm({ ...editForm, expression: v })} model={model} />
              </div>
            )}

            <div style={editRow}>
              <span style={editLabel}>Decimals</span>
              <input type="number" min={0} max={10} value={editForm.decimals}
                onChange={(e) => setEditForm({ ...editForm, decimals: parseInt(e.target.value) || 0 })}
                style={{ ...editInput, width: 50 }} />
            </div>
            <div style={editRow}>
              <span style={editLabel}>Thousands sep.</span>
              <select value={editForm.thousandSep}
                onChange={(e) => setEditForm({ ...editForm, thousandSep: e.target.value })}
                style={{ ...editInput, width: 70 }}>
                <option value=" ">Space</option>
                <option value=",">Comma</option>
                <option value=".">Dot</option>
                <option value="">None</option>
              </select>
            </div>
            <div style={editRow}>
              <span style={editLabel}>Prefix</span>
              <input type="text" value={editForm.prefix} placeholder="e.g. $"
                onChange={(e) => setEditForm({ ...editForm, prefix: e.target.value })}
                style={{ ...editInput, width: 50 }} />
            </div>
            <div style={editRow}>
              <span style={editLabel}>Suffix</span>
              <input type="text" value={editForm.suffix} placeholder="e.g. €"
                onChange={(e) => setEditForm({ ...editForm, suffix: e.target.value })}
                style={{ ...editInput, width: 50 }} />
            </div>

            <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', marginTop: 6 }}>
              {m._source === 'report' && (
                <button
                  onClick={async () => {
                    // Move this measure from settings.extraMeasures into
                    // model.measures so every report on this model can use it.
                    try {
                      const promoted = { ...m };
                      delete promoted._source;
                      const newModelMeasures = [...(model.measures || []).filter((x) => x._source !== 'report'), promoted];
                      await api.put(`/models/${model.id}`, { measures: newModelMeasures });
                      const remaining = ((settings && settings.extraMeasures) || []).filter((x) => x.name !== m.name);
                      if (typeof onSettingsChange === 'function') onSettingsChange({ ...(settings || {}), extraMeasures: remaining });
                      if (onModelUpdate) onModelUpdate();
                      setEditingField(null);
                    } catch (err) { console.error(err); }
                  }}
                  title="Make this measure available to all reports using this model"
                  style={{ ...editCancelBtn, color: 'var(--accent-primary)', borderColor: 'var(--accent-primary)' }}
                >
                  ↑ Promote to model
                </button>
              )}
              <button onClick={() => setEditingField(null)} style={editCancelBtn}>Close</button>
              <button onClick={async () => {
                try {
                  const patch = {
                    label: editForm.label,
                    ...(m.aggregation === 'custom' ? { expression: editForm.expression } : {}),
                    format: {
                      decimals: editForm.decimals,
                      thousandSep: editForm.thousandSep,
                      prefix: editForm.prefix,
                      suffix: editForm.suffix,
                    },
                  };
                  let wrote = false;
                  if (m._source === 'report') {
                    // Edit a report-scoped measure: mutate the entry inside
                    // settings.extraMeasures.
                    const currentExtras = (settings && settings.extraMeasures) || [];
                    wrote = updateSettings({
                      extraMeasures: currentExtras.map((x) => x.name === m.name ? { ...x, ...patch } : x),
                    });
                  } else {
                    // Edit a model-scoped measure: write to settings.measureOverrides
                    // so the underlying model isn't touched.
                    const currentOv = (settings && settings.measureOverrides) || {};
                    wrote = updateSettings({
                      measureOverrides: { ...currentOv, [m.name]: { ...(currentOv[m.name] || {}), ...patch } },
                    });
                  }
                  if (!wrote) return;
                  setEditingField(null);
                } catch (err) { console.error(err); }
              }} style={editSaveBtn}>Save</button>
            </div>
          </div>
        );
      })()}

      {/* Date table — collapsible block. We render a plain container
          rather than `FieldSection` so the chevron sits in a real header
          (no `<label>` wrapping, no `flex: 1` listBox quirks that made
          the body collapse to 0 height when toggled). */}
      {model.dateColumn && (() => {
        const dateCol = (model.dimensions || []).find((d) => d.name === model.dateColumn);
        if (!dateCol) return null;
        const dateParts = (model.dimensions || []).filter((d) => d.datePartOf === model.dateColumn);
        return (
          <div style={{ marginBottom: 8, flexShrink: 0 }}>
            <div
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                marginBottom: 3, gap: 6,
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)', fontWeight: 500 }}>
                📅 Date Table
              </span>
              <button
                onClick={async (e) => {
                  e.stopPropagation();
                  const currentDateCol = model.dateColumn;
                  const currentExtras = (settings && settings.extraDimensions) || [];
                  updateSettings({
                    dateColumn: null,
                    extraDimensions: currentExtras.filter((x) => x.datePartOf !== currentDateCol),
                  });
                }}
                style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'var(--state-warning-soft)', color: 'var(--state-warning)', fontWeight: 600, border: 'none', cursor: 'pointer' }}
              >✕ remove</button>
            </div>
            <div style={{ border: '1px solid var(--border-default)', borderRadius: 4, maxHeight: 220, overflow: 'auto' }}>
              {/* Main date column — always visible. The chevron lives here
                  because id_date is the field that decomposes into year /
                  month / weekday / … */}
              <div
                draggable
                onDragStart={(e) => handleDragStart(e, dateCol.name, 'dimension')}
                title={`${dateCol.table}.${dateCol.column}`}
                style={{
                  ...dragItem, paddingLeft: 4,
                  backgroundColor: (selectedDims.includes(dateCol.name) || columnDims.includes(dateCol.name) || groupBy.includes(dateCol.name)) ? 'var(--state-warning-soft)' : 'transparent',
                  borderLeft: (selectedDims.includes(dateCol.name) || columnDims.includes(dateCol.name) || groupBy.includes(dateCol.name)) ? '3px solid var(--state-warning)' : '3px solid transparent',
                }}
              >
                {dateParts.length > 0 ? (
                  <span
                    onClick={(e) => { e.stopPropagation(); setDateTableOpen((o) => !o); }}
                    onMouseDown={(e) => e.stopPropagation()}
                    draggable={false}
                    title={dateTableOpen ? 'Hide date parts' : 'Show date parts'}
                    style={{
                      display: 'inline-flex', alignItems: 'center', cursor: 'pointer',
                      color: 'var(--text-secondary)', flexShrink: 0,
                      transition: 'transform 0.15s',
                      transform: dateTableOpen ? 'rotate(0deg)' : 'rotate(-90deg)',
                    }}
                  >
                    <TbChevronDown size={14} />
                  </span>
                ) : (
                  <span style={{ display: 'inline-block', width: 14, flexShrink: 0 }} />
                )}
                <span style={dragHandle}>⠿</span>
                <span style={{ ...truncatedLabel, fontWeight: 600 }} title={dateCol.label || dateCol.column}>{dateCol.label || dateCol.column}</span>
                <span style={{ ...dateTag, flexShrink: 0 }}>📅</span>
              </div>
              {/* Date parts — collapsed by default, expanded via the chevron */}
              {dateTableOpen && dateParts.map((dp) => (
                <div
                  key={dp.name}
                  draggable
                  onDragStart={(e) => handleDragStart(e, dp.name, 'dimension')}
                  title={dp.datePart}
                  style={{
                    ...dragItem, paddingLeft: 20,
                    backgroundColor: (selectedDims.includes(dp.name) || columnDims.includes(dp.name) || groupBy.includes(dp.name)) ? 'var(--state-warning-soft)' : 'transparent',
                    borderLeft: (selectedDims.includes(dp.name) || columnDims.includes(dp.name) || groupBy.includes(dp.name)) ? '3px solid var(--state-warning)' : '3px solid transparent',
                  }}
                >
                  <span style={dragHandle}>⠿</span>
                  <span style={{ ...truncatedLabel, fontSize: 11, color: 'var(--text-muted)' }} title={dp.label}>{dp.label}</span>
                  <span style={{ fontSize: 8, color: 'var(--text-disabled)', flexShrink: 0 }}>{dp.datePart}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Dimensions grouped by table */}
      {model.dimensions?.length > 0 && (
        <FieldSection label="Dimensions" style={{ flex: '1 1 75%' }}>
          <div style={listBoxLarge}>
            {(() => {
              // Group dimensions by table (exclude the active dateColumn)
              const groups = {};
              for (const d of model.dimensions) {
                if (d.name === model.dateColumn || d.datePartOf) continue; // shown in Date Table section
                const table = shortTable(d.table);
                if (!groups[table]) groups[table] = [];
                groups[table].push(d);
              }
              return Object.entries(groups).map(([table, dims]) => (
                <div key={table}>
                  <div style={tableGroupHeader}>{table}</div>
                  {dims.map((d) => (
                    <div
                      key={d.name}
                      draggable
                      onDragStart={(e) => handleDragStart(e, d.name, 'dimension')}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (editingDim === d.name) {
                          setEditingDim(null);
                        } else {
                          setEditingDim(d.name);
                          setDimEditForm({ label: d.label || d.column, type: d.type || 'string' });
                          setEditingField(null); // close measure edit if open
                        }
                      }}
                      title={`${d.table}.${d.column}`}
                      style={{
                        ...dragItem,
                        paddingLeft: 12,
                        backgroundColor: editingDim === d.name ? 'var(--bg-active)' : (selectedDims.includes(d.name) || columnDims.includes(d.name) || groupBy.includes(d.name)) ? 'var(--bg-active)' : 'transparent',
                        borderLeft: editingDim === d.name ? '3px solid var(--accent-primary)' : (selectedDims.includes(d.name) || columnDims.includes(d.name) || groupBy.includes(d.name)) ? '3px solid var(--accent-primary)' : '3px solid transparent',
                      }}
                    >
                      <span style={dragHandle}>⠿</span>
                      <span style={truncatedLabel} title={d.label || d.column}>{d.label || d.column}</span>
                      {d.type === 'date' && (
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            // Date Table is now report-scoped: only touch settings.
                            updateSettings({ dateColumn: d.name });
                          }}
                          title="Set as date table for this report"
                          style={{ ...dateTag, cursor: 'pointer', border: 'none', padding: '1px 4px', fontSize: 8 }}
                        >📅</button>
                      )}
                    </div>
                  ))}
                </div>
              ));
            })()}
          </div>
        </FieldSection>
      )}

      {/* Dimension edit panel — below dimensions */}
      {editingDim && (() => {
        const d = (model.dimensions || []).find((x) => x.name === editingDim);
        if (!d) return null;
        return (
          <div style={{ ...editPanelStyle, flexShrink: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent-primary)', marginBottom: 6 }}>
              Edit: {d.label || d.column}
            </div>
            <div style={editRow}>
              <span style={editLabel}>Label</span>
              <input type="text" value={dimEditForm.label}
                onChange={(e) => setDimEditForm({ ...dimEditForm, label: e.target.value })}
                style={editInput} />
            </div>
            <div style={editRow}>
              <span style={editLabel}>Type</span>
              <select value={(dimEditForm.type === 'number' ? 'decimal' : dimEditForm.type) || 'string'}
                onChange={(e) => setDimEditForm({ ...dimEditForm, type: e.target.value })}
                style={{ ...editInput, width: 110 }}>
                <option value="string">Text</option>
                <option value="integer">Integer</option>
                <option value="decimal">Decimal</option>
                <option value="date">Date</option>
                <option value="boolean">Boolean</option>
              </select>
            </div>
            {dimEditForm.type === 'date' && !model.dateColumn && (
              <>
                <div style={editRow}>
                  <span style={editLabel}>Date table</span>
                  <input type="checkbox" checked={dimEditForm.setAsDateTable ?? false}
                    onChange={(e) => setDimEditForm({ ...dimEditForm, setAsDateTable: e.target.checked, generateParts: e.target.checked ? (dimEditForm.generateParts ?? true) : false })} />
                </div>
                {dimEditForm.setAsDateTable && (
                  <div style={editRow}>
                    <span style={editLabel}>Date parts</span>
                    <input type="checkbox" checked={dimEditForm.generateParts ?? true}
                      onChange={(e) => setDimEditForm({ ...dimEditForm, generateParts: e.target.checked })} />
                  </div>
                )}
              </>
            )}
            {dimEditForm.type === 'date' && model.dateColumn === d.name && !model.dimensions?.some((x) => x.name.startsWith('_date.')) && (
              <div style={editRow}>
                <span style={editLabel}>Date parts</span>
                <input type="checkbox" checked={dimEditForm.generateParts ?? false}
                  onChange={(e) => setDimEditForm({ ...dimEditForm, generateParts: e.target.checked })} />
              </div>
            )}
            <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', marginTop: 6 }}>
              {d._source === 'report' && (
                <button
                  onClick={async () => {
                    // Promote a report-scoped dimension to the model so every
                    // report on this model can use it. Only the dim itself is
                    // moved — never its sibling date-parts. Promoting a parent
                    // date column should NOT silently drag along all of its
                    // generated date parts (year, month, ...). The user who
                    // wants those in the model can promote each individually.
                    try {
                      const promoted = { ...d };
                      delete promoted._source;
                      // Strip any leaked _source markers from the model dims
                      // we keep — they're an internal-only annotation.
                      const cleanedModelDims = (model.dimensions || [])
                        .filter((x) => x._source !== 'report')
                        .map((x) => { const c = { ...x }; delete c._source; return c; });
                      const newModelDims = [...cleanedModelDims, promoted];
                      await api.put(`/models/${model.id}`, { dimensions: newModelDims });
                      const extras = (settings && settings.extraDimensions) || [];
                      const remaining = extras.filter((x) => x.name !== d.name);
                      if (typeof onSettingsChange === 'function') onSettingsChange({ ...(settings || {}), extraDimensions: remaining });
                      if (onModelUpdate) onModelUpdate();
                      setEditingDim(null);
                    } catch (err) { console.error(err); }
                  }}
                  title="Make this dimension available to all reports using this model"
                  style={{ ...editCancelBtn, color: 'var(--accent-primary)', borderColor: 'var(--accent-primary)' }}
                >
                  ↑ Promote to model
                </button>
              )}
              <button onClick={() => setEditingDim(null)} style={editCancelBtn}>Close</button>
              <button onClick={async () => {
                try {
                  // All edits stay scoped to the report — never mutate the
                  // underlying model. Label/type changes on a model dim
                  // become a `dimensionOverrides[d.name]` entry; on a report
                  // dim they mutate the matching `extraDimensions` entry.
                  // Date-table flag and generated date parts go to settings.
                  const labelTypePatch = { label: dimEditForm.label, type: dimEditForm.type };
                  let nextSettings = { ...(settings || {}) };

                  // Apply the label/type change at the right scope
                  if (d._source === 'report') {
                    nextSettings.extraDimensions = (nextSettings.extraDimensions || []).map((x) =>
                      x.name === d.name ? { ...x, ...labelTypePatch } : x);
                  } else {
                    const ov = nextSettings.dimensionOverrides || {};
                    nextSettings.dimensionOverrides = {
                      ...ov,
                      [d.name]: { ...(ov[d.name] || {}), ...labelTypePatch },
                    };
                  }

                  // Generate date parts → push them as report-scoped
                  // extras (filtered to drop any previous parts of any
                  // date column to keep the section clean).
                  if (dimEditForm.generateParts) {
                    const filteredExtras = (nextSettings.extraDimensions || []).filter((x) => !String(x.name || '').startsWith('_date.'));
                    const dateParts = [
                      { suffix: 'year', label: 'Year', expr: 'num_year' },
                      { suffix: 'month_num', label: 'Month Number', expr: 'num_month' },
                      { suffix: 'month_name', label: 'Month Name', expr: 'name_month' },
                      { suffix: 'week', label: 'Week', expr: 'num_week' },
                      { suffix: 'day_of_week', label: 'Day of Week', expr: 'num_day_of_week' },
                      { suffix: 'day_name', label: 'Day Name', expr: 'name_day' },
                    ];
                    const generated = dateParts.map((p) => ({
                      name: `_date.${p.suffix}`,
                      table: d.table,
                      column: d.column,
                      type: p.expr.startsWith('name') ? 'string' : 'integer',
                      label: p.label,
                      datePartOf: d.name,
                      datePart: p.expr,
                    }));
                    nextSettings.extraDimensions = [...filteredExtras, ...generated];
                  }

                  if (dimEditForm.setAsDateTable) {
                    nextSettings.dateColumn = d.name;
                  }

                  if (typeof onSettingsChange !== 'function') {
                    console.error('[DataPanel] onSettingsChange prop is missing — refusing to mutate the model. Action ignored.');
                    return;
                  }
                  onSettingsChange(nextSettings);
                  setEditingDim(null);
                } catch (err) { console.error(err); }
              }} style={{ ...editSaveBtn, background: 'var(--accent-primary)' }}>Save</button>
            </div>
          </div>
        );
      })()}

      {model.dimensions?.length === 0 && model.measures?.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--text-disabled)', marginTop: 4 }}>
          This model has no dimensions or measures defined yet.
        </div>
      )}

      {status?.type === 'error' && (
        <div style={{ fontSize: 11, marginTop: 4, color: 'var(--state-danger)' }}>
          Error: {status.message}
        </div>
      )}

      {!widgetId && (
        <div style={{ fontSize: 12, color: 'var(--text-disabled)', marginTop: 8 }}>Drag fields onto the widget config panel.</div>
      )}
    </div>
  );
}

function FieldSection({ label, children, style }) {
  return (
    <div style={{ marginBottom: 8, display: 'flex', flexDirection: 'column', minHeight: 0, ...style }}>
      <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 3, fontWeight: 500, flexShrink: 0 }}>{label}</label>
      {children}
    </div>
  );
}

const sectionTitle = {
  fontSize: 11, fontWeight: 600, color: 'var(--text-disabled)', textTransform: 'uppercase', marginBottom: 0,
};
const modelLinkStyle = {
  display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 0,
  color: 'var(--text-disabled)', textDecoration: 'none',
  cursor: 'pointer', transition: 'color 0.12s',
};
const loadingDot = {
  width: 8, height: 8, borderRadius: '50%', background: 'var(--accent-primary)',
  animation: 'pulse 1s infinite',
};
const listBox = {
  flex: 1, overflow: 'auto', border: '1px solid var(--border-default)', borderRadius: 4, minHeight: 0,
};
const listBoxLarge = {
  flex: 1, overflow: 'auto', border: '1px solid var(--border-default)', borderRadius: 4, minHeight: 0,
};
const tableGroupHeader = {
  fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase',
  padding: '5px 8px 3px', backgroundColor: 'var(--bg-subtle)', borderBottom: '1px solid var(--border-default)',
  position: 'sticky', top: 0, zIndex: 1, letterSpacing: '0.04em',
};
const dragItem = {
  display: 'flex', alignItems: 'center', gap: 4, padding: '4px 6px',
  cursor: 'grab', userSelect: 'none', borderBottom: '1px solid var(--border-subtle)',
  minWidth: 0, // ensures children can shrink for ellipsis
};
const dragHandle = {
  fontSize: 10, color: 'var(--border-strong)', cursor: 'grab', flexShrink: 0,
};
// Label inside a field row — truncates with "…" if too long
const truncatedLabel = {
  flex: 1, minWidth: 0, fontSize: 12,
  overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
};
const dimTag = {
  fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'var(--bg-active)', color: 'var(--accent-primary)', fontWeight: 600,
};
const measTag = {
  fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'var(--state-success-soft)', color: 'var(--state-success)', fontWeight: 600,
};
const dateTag = {
  fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'var(--state-warning-soft)', color: 'var(--state-warning)', fontWeight: 600,
};
const customTag = {
  fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'var(--bg-active)', color: 'var(--accent-primary)', fontWeight: 700,
};
const editPanelStyle = {
  padding: 8, background: 'var(--bg-panel-alt)', borderBottom: '1px solid var(--border-default)',
};
const editRow = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5,
};
const editLabel = {
  fontSize: 10, color: 'var(--text-muted)', fontWeight: 500,
};
const editInput = {
  padding: '3px 6px', border: '1px solid var(--border-default)', borderRadius: 3,
  fontSize: 11, outline: 'none', boxSizing: 'border-box',
};
const editCancelBtn = {
  fontSize: 10, padding: '2px 8px', border: '1px solid var(--border-default)', borderRadius: 3,
  background: 'var(--bg-panel)', cursor: 'pointer', color: 'var(--text-muted)',
};
const editSaveBtn = {
  fontSize: 10, fontWeight: 600, padding: '2px 8px', border: 'none', borderRadius: 3,
  background: 'var(--accent-primary)', color: '#fff', cursor: 'pointer',
};
const addCalcBtnSmall = {
  fontSize: 10, fontWeight: 600, padding: '1px 6px', border: '1px solid var(--accent-primary)',
  borderRadius: 3, background: 'var(--bg-active)', color: 'var(--accent-primary)', cursor: 'pointer',
};
const calcInputStyle = {
  width: '100%', padding: '4px 6px', border: '1px solid var(--accent-primary-border)', borderRadius: 3,
  fontSize: 11, outline: 'none', boxSizing: 'border-box', background: 'var(--bg-panel)', color: 'var(--text-primary)',
};
