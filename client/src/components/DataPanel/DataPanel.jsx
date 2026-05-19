import { useState, useEffect, useRef, useCallback, Fragment } from 'react';
import { createPortal } from 'react-dom';
import { TbChevronDown } from 'react-icons/tb';
import api from '../../utils/api';
import SqlExpressionInput from '../SqlExpressionInput/SqlExpressionInput';
import FilterRulesEditor, { buildDefaultFilterRule } from '../FilterRulesEditor/FilterRulesEditor';
import { sanitizeWidgetFilters } from '../../utils/widgetFilters';
import { prepareGlobalRulesForWidget } from '../../utils/reportFilterRules';
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
  // Unified measure-creation wizard. One form covers:
  //   - simple aggregation (SUM/AVG/COUNT/MIN/MAX on a column)
  //   - custom SQL expression
  //   - optional filter context (CASE WHEN inside the aggregate)
  // Stored under `_calc.<label>` regardless of shape — the server only
  // looks at the measure's fields (aggregation/expression/filterRules) to
  // decide what SQL to emit.
  const [showCalcForm, setShowCalcForm] = useState(false);
  const [calcLabel, setCalcLabel] = useState('');
  const [calcAggregation, setCalcAggregation] = useState('sum');
  const [calcField, setCalcField] = useState(''); // "table::column"
  const [calcExpr, setCalcExpr] = useState('');
  const [calcFilterEnabled, setCalcFilterEnabled] = useState(false);
  const [calcRules, setCalcRules] = useState([]);
  const [calcOverride, setCalcOverride] = useState(false);
  const [calcSaving, setCalcSaving] = useState(false);
  const [editingField, setEditingField] = useState(null); // measure name being edited
  const [editForm, setEditForm] = useState({});
  const [editingDim, setEditingDim] = useState(null); // dimension name being edited
  const [dimEditForm, setDimEditForm] = useState({});
  // Inline-accordion mount points: the (large) edit-panel JSX stays where
  // it is in the tree and is portaled into a placeholder rendered right
  // under the active row, so it visually belongs to the clicked field.
  const [measurePanelMount, setMeasurePanelMount] = useState(null);
  const [dimPanelMount, setDimPanelMount] = useState(null);
  const [loading, setLoading] = useState(false);
  // Date Table is collapsed by default — only the main date column is shown,
  // the per-period extension dims (year, month, weekday, …) appear when opened.
  const [dateTableOpen, setDateTableOpen] = useState(false);

  // Bare expression for create form's Custom-SQL mode — what the user
  // actually typed, before any CASE WHEN wrap from the filter toggle.
  const [calcBareExpr, setCalcBareExpr] = useState('');

  // Keep the create-form SQL editor in sync with the wizard inputs. Always
  // regenerates the editor (including CASE WHEN wrap when a filter is on,
  // even in Custom SQL mode). The bare expression is the canonical source
  // for custom mode; structured modes generate the SQL fully from
  // aggregation/column.
  useEffect(() => {
    if (!showCalcForm) return;
    const [table, column] = (calcAggregation === 'count')
      ? ['', '*']
      : (calcAggregation === 'custom' ? ['', ''] : (calcField || '').split('::'));
    const sql = buildMeasureSql({
      aggregation: calcAggregation,
      table: table || '',
      column: column || '',
      filterRules: calcFilterEnabled ? calcRules : null,
      overrideFilters: calcOverride,
      expression: calcBareExpr,
    });
    setCalcExpr(sql);
  }, [showCalcForm, calcAggregation, calcField, calcFilterEnabled, calcRules, calcOverride, calcBareExpr]);

  // Auto-sync for the edit panel. Same idea as the create form — regenerate
  // the editor from state, including the CASE WHEN wrap. Uses
  // `editForm.bareExpression` as the canonical un-wrapped expression for
  // custom-mode measures.
  useEffect(() => {
    if (!editingField) return;
    const [table, column] = (editForm.aggregation === 'count')
      ? ['', '*']
      : (editForm.aggregation === 'custom' ? ['', ''] : (editForm.field || '').split('::'));
    const sql = buildMeasureSql({
      aggregation: editForm.aggregation,
      table: table || '',
      column: column || '',
      filterRules: editForm.filterEnabled ? editForm.filterRules : null,
      overrideFilters: editForm.overrideFilters,
      expression: editForm.bareExpression || '',
    });
    if (sql !== editForm.expression) {
      setEditForm((prev) => ({ ...prev, expression: sql }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingField, editForm.aggregation, editForm.field, editForm.filterEnabled, editForm.filterRules, editForm.overrideFilters, editForm.bareExpression]);

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
  // Per-widget view of the report-level global filters. See
  // prepareGlobalRulesForWidget for the dual responsibility (drop excluded
  // rules + strip the editor-only `exclusions` field so it doesn't pollute
  // the preAggCache shape key).
  const reportLevelFilters = prepareGlobalRulesForWidget(settings?.reportFilters, widgetId);
  const ownWidgetFilters = Array.isArray(binding.widgetFilters) ? binding.widgetFilters : [];
  const widgetFilters = [...reportLevelFilters, ...ownWidgetFilters];
  const aggOverrides = binding.measureAggOverrides || {};

  // Cache key — shared with Editor.jsx via computeBindingKey so both fetchers
  // agree on what counts as the "same" binding. After Editor's refetch (drill,
  // filter change, refresh), it stamps `data._fetchedBinding` with this same
  // value so re-selecting the widget doesn't trigger an unnecessary refetch.
  const bindingKey = hasWidget ? computeBindingKey({ widget, model, reportFilters, settings }) : '';
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
              // Slicer fetch is capped to a small set (1000) so the queryCache
              // entry stays tiny — beyond that the slicer is unusable from
              // the UI (FilterWidget windows 200 with Show more), and the
              // user can search for any value beyond the cap via the
              // server-side search query path (handleSlicerSearch).
              limit: isFilterWidget ? 1000 : (capturedWidget.config?.dataLimit || 1000),
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
              measureAggOverrides: Object.keys(aggOverrides).length > 0 ? aggOverrides : undefined,
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
              measureAggOverrides: Object.keys(aggOverrides).length > 0 ? aggOverrides : undefined,
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
              measureAggOverrides: Object.keys(aggOverrides).length > 0 ? aggOverrides : undefined,
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
      {/* Measures first — fixed height, does not shrink when editing.
          (The model name + edit link moved to the panel header in
          PropertyPanel's DataModelPanel so "Data" isn't shown twice.) */}
      <FieldSection label={
        <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
          <span>Measures</span>
          <button onClick={() => setShowCalcForm(!showCalcForm)} style={addCalcBtnSmall}>+ Measure</button>
        </span>
      } style={{ flex: '0 0 auto', maxHeight: (showCalcForm || editingField) ? '60%' : '25%', transition: 'max-height 0.25s ease' }}>
        {/* Unified measure wizard:
              - Aggregation (SUM/AVG/COUNT/MIN/MAX/Custom)
              - Column (or custom SQL when aggregation = 'custom')
              - Optional filter context (CASE WHEN inside the aggregate)
            Persists to settings.extraMeasures under `_calc.<label>`. */}
        {showCalcForm && (
          <div style={{ padding: 6, background: 'var(--bg-active)', borderRadius: 4, marginBottom: 4, border: '1px solid var(--accent-primary-border)', maxHeight: '100%', overflow: 'auto' }}>
            <input type="text" placeholder="Label" value={calcLabel}
              onChange={(e) => setCalcLabel(e.target.value)}
              style={{ ...calcInputStyle, marginBottom: 4 }} />
            <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
              <select value={calcAggregation} onChange={(e) => setCalcAggregation(e.target.value)}
                style={{ ...calcInputStyle, flex: '0 0 auto', width: 90, marginBottom: 0 }}>
                <option value="sum">SUM</option>
                <option value="avg">AVG</option>
                <option value="count">COUNT</option>
                <option value="min">MIN</option>
                <option value="max">MAX</option>
                <option value="custom">Custom SQL</option>
              </select>
              {calcAggregation !== 'custom' && (
                <select value={calcField} onChange={(e) => setCalcField(e.target.value)}
                  style={{ ...calcInputStyle, flex: 1, marginBottom: 0 }}
                  disabled={calcAggregation === 'count'}>
                  <option value="">{calcAggregation === 'count' ? '— count(*)' : '— pick a column —'}</option>
                  {(model.measures || []).filter((mm) => mm.table && mm.column && mm.aggregation !== 'custom').map((mm) => (
                    <option key={mm.name} value={`${mm.table}::${mm.column}`}>{mm.label || mm.column}</option>
                  ))}
                </select>
              )}
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>
              <input type="checkbox" checked={calcFilterEnabled}
                onChange={(e) => setCalcFilterEnabled(e.target.checked)} />
              <span>Apply filter context (CASE WHEN inside the aggregate)</span>
            </label>
            {calcFilterEnabled && (
              <>
                {model && (
                  <select onChange={(e) => {
                    const v = e.target.value;
                    if (!v) return;
                    const [kind, name] = v.split('::');
                    setCalcRules([...calcRules, buildDefaultFilterRule(model, name, kind === 'm')]);
                    e.target.value = '';
                  }} value="" style={{ ...calcInputStyle, marginBottom: 4 }}>
                    <option value="">+ Add a filter on…</option>
                    {(model.dimensions || []).length > 0 && (
                      <optgroup label="Dimensions">
                        {model.dimensions.map((d) => (
                          <option key={'d::' + d.name} value={'d::' + d.name}>{d.label || d.name}</option>
                        ))}
                      </optgroup>
                    )}
                    {(model.measures || []).length > 0 && (
                      <optgroup label="Measures">
                        {model.measures.map((mm) => (
                          <option key={'m::' + mm.name} value={'m::' + mm.name}>{mm.label || mm.name}</option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                )}
                <FilterRulesEditor model={model} modelId={model?.id} rules={calcRules} onChange={setCalcRules} />
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, fontSize: 11, color: 'var(--text-secondary)' }}>
                  <input type="checkbox" checked={calcOverride}
                    onChange={(e) => setCalcOverride(e.target.checked)} />
                  <span>Override report filters on these fields</span>
                  <span title="When ON, this measure ignores the report-level filter on the fields it filters on." style={{ color: 'var(--text-disabled)', cursor: 'help' }}>ⓘ</span>
                </label>
              </>
            )}
            {/* SQL editor — ALWAYS visible. Auto-fills from the wizard
                inputs above, including the CASE WHEN wrap when a filter
                is active. Typing here:
                  - flips aggregation to 'custom' if it wasn't already
                  - clears the filter toggle so the typed SQL stands alone
                    (otherwise the wizard would re-wrap it on next render
                    and overwrite what the user just typed) */}
            <div style={{ marginTop: 6 }}>
              <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>SQL Expression</span>
              <SqlExpressionInput value={calcExpr}
                onChange={(v) => {
                  setCalcExpr(v);
                  setCalcBareExpr(v);
                  if (calcAggregation !== 'custom') setCalcAggregation('custom');
                  if (calcFilterEnabled) setCalcFilterEnabled(false);
                }}
                model={model} />
            </div>
            <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', marginTop: 6 }}>
              <button onClick={() => {
                setShowCalcForm(false); setCalcLabel(''); setCalcExpr(''); setCalcBareExpr(''); setCalcField('');
                setCalcAggregation('sum'); setCalcFilterEnabled(false); setCalcRules([]); setCalcOverride(false);
              }} style={{ fontSize: 11, padding: '2px 8px', border: '1px solid var(--border-default)', borderRadius: 3, background: 'var(--bg-panel)', cursor: 'pointer', color: 'var(--text-muted)' }}>Cancel</button>
              <button
                disabled={
                  !calcLabel || calcSaving
                  || (calcAggregation === 'custom' && !calcExpr)
                  || (calcAggregation !== 'custom' && calcAggregation !== 'count' && !calcField)
                  || (calcFilterEnabled && calcRules.length === 0)
                }
                onClick={async () => {
                  setCalcSaving(true);
                  try {
                    const measName = `_calc.${calcLabel.replace(/\s+/g, '_').toLowerCase()}`;
                    const [table, column] = (calcAggregation === 'custom')
                      ? ['', '']
                      : (calcAggregation === 'count' ? ['', '*'] : calcField.split('::'));
                    // Save the BARE expression (un-wrapped) + filterRules
                    // separately. The server's intersection / override
                    // branch applies the CASE WHEN at query time. The
                    // editor displays the wrapped form purely for
                    // visibility — never persisted directly.
                    const newMeasure = calcAggregation === 'custom' ? {
                      name: measName,
                      label: calcLabel,
                      table: '',
                      column: '',
                      aggregation: 'custom',
                      expression: calcBareExpr || calcExpr,
                      ...(calcFilterEnabled && calcRules.length > 0 ? {
                        filterRules: calcRules,
                        overrideFilters: calcOverride,
                      } : {}),
                    } : {
                      name: measName,
                      label: calcLabel,
                      table: table || '',
                      column: column || '',
                      aggregation: calcAggregation,
                      ...(calcFilterEnabled ? {
                        filterRules: calcRules,
                        overrideFilters: calcOverride,
                      } : {}),
                    };
                    const wrote = updateSettings({
                      extraMeasures: [...((settings && settings.extraMeasures) || []), newMeasure],
                    });
                    if (!wrote) return;
                    setCalcLabel(''); setCalcExpr(''); setCalcField('');
                    setCalcAggregation('sum'); setCalcFilterEnabled(false); setCalcRules([]); setCalcOverride(false);
                    setShowCalcForm(false);
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
            <Fragment key={m.name}>
              <div
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
                      aggregation: m.aggregation || 'sum',
                      field: (m.table && m.column && m.column !== '*') ? `${m.table}::${m.column}` : '',
                      // `bareExpression` is the un-wrapped expression — the
                      // user's actual SQL minus any CASE WHEN wrap. Auto-sync
                      // rebuilds the wrapped display from bareExpression +
                      // filterRules so the editor reflects what the server
                      // will run.
                      bareExpression: m.expression || '',
                      expression: m.expression || '', // filled by auto-sync
                      filterEnabled: Array.isArray(m.filterRules) && m.filterRules.length > 0,
                      filterRules: Array.isArray(m.filterRules) ? m.filterRules : [],
                      overrideFilters: !!m.overrideFilters,
                      // Decimals: leave empty when the measure has no
                      // explicit format. Pre-filling 2 would push a value
                      // the user never asked for into settings on Save;
                      // empty means "let the renderer pick" until the user
                      // explicitly types a number.
                      decimals: m.format?.decimals ?? '',
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
                <span
                  style={truncatedLabel}
                  title={
                    m.aggregation === 'custom'
                      ? `${m.label || m.name}${m.expression ? ` — fx: ${m.expression}` : ''}`
                      : `${m.label || m.column}${m.table ? ` — ${m.table}.${m.column}` : (m.column ? ` — ${m.column}` : '')}`
                  }
                >{m.label || m.column}</span>
                <span style={{ ...(m.aggregation === 'custom' ? customTag : measTag), flexShrink: 0 }}>
                  {m.aggregation === 'custom' ? 'fx' : m.aggregation}
                </span>
              </div>
              {editingField === m.name && (
                <div ref={(node) => setMeasurePanelMount((cur) => (cur === node ? cur : node))} />
              )}
            </Fragment>
            ))}
          </div>
        </FieldSection>

      {/* Measure edit panel — rendered (via portal) inline under the
          clicked row in the measures list so it visually belongs to it. */}
      {editingField && (() => {
        const m = (model.measures || []).find((x) => x.name === editingField);
        if (!m || !measurePanelMount) return null;
        return createPortal((
          <div style={{ ...editPanelStyle, flexShrink: 0 }}>
            <div style={editRow}>
              <span style={editLabel}>Label</span>
              <input type="text" value={editForm.label}
                onChange={(e) => setEditForm({ ...editForm, label: e.target.value })}
                style={editInput} />
            </div>

            {/* Report-scoped measures: full editable wizard, same UX as
                + Measure. Model-scoped measures: locked shape (only the
                custom expression is editable; agg/column belong to the
                model definition and shouldn't drift per-report). */}
            {m._source === 'report' ? (
              <>
                <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                  <select value={editForm.aggregation}
                    onChange={(e) => setEditForm({ ...editForm, aggregation: e.target.value })}
                    style={{ ...editInput, flex: '0 0 auto', width: 90 }}>
                    <option value="sum">SUM</option>
                    <option value="avg">AVG</option>
                    <option value="count">COUNT</option>
                    <option value="min">MIN</option>
                    <option value="max">MAX</option>
                    <option value="custom">Custom SQL</option>
                  </select>
                  {editForm.aggregation !== 'custom' && (
                    <select value={editForm.field}
                      onChange={(e) => setEditForm({ ...editForm, field: e.target.value })}
                      style={{ ...editInput, flex: 1 }}
                      disabled={editForm.aggregation === 'count'}>
                      <option value="">{editForm.aggregation === 'count' ? '— count(*)' : '— pick a column —'}</option>
                      {(model.measures || []).filter((mm) => mm.table && mm.column && mm.aggregation !== 'custom').map((mm) => (
                        <option key={mm.name} value={`${mm.table}::${mm.column}`}>{mm.label || mm.column}</option>
                      ))}
                    </select>
                  )}
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>
                  <input type="checkbox" checked={!!editForm.filterEnabled}
                    onChange={(e) => setEditForm({ ...editForm, filterEnabled: e.target.checked })} />
                  <span>Apply filter context (CASE WHEN inside the aggregate)</span>
                </label>
                {editForm.filterEnabled && (
                  <>
                    {model && (
                      <select onChange={(e) => {
                        const v = e.target.value;
                        if (!v) return;
                        const [kind, name] = v.split('::');
                        setEditForm({
                          ...editForm,
                          filterRules: [...(editForm.filterRules || []), buildDefaultFilterRule(model, name, kind === 'm')],
                        });
                        e.target.value = '';
                      }} value="" style={{ ...editInput, marginBottom: 4 }}>
                        <option value="">+ Add a filter on…</option>
                        {(model.dimensions || []).length > 0 && (
                          <optgroup label="Dimensions">
                            {model.dimensions.map((d) => (
                              <option key={'d::' + d.name} value={'d::' + d.name}>{d.label || d.name}</option>
                            ))}
                          </optgroup>
                        )}
                        {(model.measures || []).length > 0 && (
                          <optgroup label="Measures">
                            {model.measures.map((mm) => (
                              <option key={'m::' + mm.name} value={'m::' + mm.name}>{mm.label || mm.name}</option>
                            ))}
                          </optgroup>
                        )}
                      </select>
                    )}
                    <FilterRulesEditor model={model} modelId={model?.id}
                      rules={editForm.filterRules || []}
                      onChange={(rules) => setEditForm({ ...editForm, filterRules: rules })} />
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, fontSize: 11, color: 'var(--text-secondary)' }}>
                      <input type="checkbox" checked={!!editForm.overrideFilters}
                        onChange={(e) => setEditForm({ ...editForm, overrideFilters: e.target.checked })} />
                      <span>Override report filters on these fields</span>
                      <span title="When ON, this measure ignores the report-level filter on the fields it filters on." style={{ color: 'var(--text-disabled)', cursor: 'help' }}>ⓘ</span>
                    </label>
                  </>
                )}
                {/* SQL editor — ALWAYS visible. Auto-fills from the wizard
                    inputs above. Typing in here flips the aggregation to
                    'custom' so the user takes ownership of the SQL. */}
                <div style={{ marginTop: 6 }}>
                  <span style={editLabel}>SQL Expression</span>
                  <SqlExpressionInput value={editForm.expression || ''}
                    onChange={(v) => setEditForm({
                      ...editForm,
                      expression: v,
                      bareExpression: v,
                      aggregation: 'custom',
                      // Clear filter when user types so the typed SQL stands
                      // alone — otherwise the auto-sync would re-wrap on
                      // next render and overwrite what the user typed.
                      filterEnabled: false,
                    })}
                    model={model} />
                </div>
              </>
            ) : (
              m.aggregation === 'custom' && (
                <div style={{ marginBottom: 6 }}>
                  <span style={editLabel}>SQL Expression</span>
                  <SqlExpressionInput value={editForm.expression}
                    onChange={(v) => setEditForm({ ...editForm, expression: v })} model={model} />
                </div>
              )
            )}

            <div style={editRow}>
              <span style={editLabel}>Decimals</span>
              <input type="number" min={0} max={10} value={editForm.decimals ?? ''} placeholder="auto"
                onChange={(e) => {
                  const v = e.target.value;
                  setEditForm({
                    ...editForm,
                    decimals: v === '' ? '' : (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : ''),
                  });
                }}
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
                <>
                  <button
                    onClick={async () => {
                      if (!window.confirm(`Delete measure "${m.label || m.name}"?`)) return;
                      const remaining = ((settings && settings.extraMeasures) || []).filter((x) => x.name !== m.name);
                      const wrote = updateSettings({ extraMeasures: remaining });
                      if (!wrote) return;
                      setEditingField(null);
                    }}
                    title="Delete this report-scoped measure"
                    aria-label="Delete measure"
                    style={iconBtn('var(--state-danger)')}
                  >
                    🗑
                  </button>
                  <button
                    onClick={async () => {
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
                    title="Promote to model — make this measure available to every report on this model"
                    aria-label="Promote to model"
                    style={iconBtn('var(--accent-primary)')}
                  >
                    ↑
                  </button>
                  <span style={{ flex: 1 }} />
                </>
              )}
              <button onClick={() => setEditingField(null)} style={editCancelBtn}>Close</button>
              <button onClick={async () => {
                try {
                  // Build the patch. For report-scoped measures we let the
                  // user edit every shape field (agg/column/expression/
                  // filterRules) and stitch the resulting measure together
                  // here. When aggregation is 'custom' the SQL editor is
                  // the source of truth — we drop filterRules so the server
                  // doesn't double-wrap with CASE WHEN. For model-scoped
                  // measures we only touch label/expression/format.
                  const isReport = m._source === 'report';
                  let patch;
                  if (isReport) {
                    if (editForm.aggregation === 'custom') {
                      // Save the BARE expression + filterRules separately.
                      // The server's intersection/override branch applies
                      // the CASE WHEN at query time. The editor shows the
                      // wrapped form for visibility, never persisted.
                      patch = {
                        label: editForm.label,
                        aggregation: 'custom',
                        table: '',
                        column: '',
                        expression: editForm.bareExpression || editForm.expression,
                        ...(editForm.filterEnabled && (editForm.filterRules || []).length > 0
                          ? { filterRules: editForm.filterRules, overrideFilters: !!editForm.overrideFilters }
                          : { filterRules: undefined, overrideFilters: undefined }),
                        format: {
                          // Only persist decimals when the user actually
                          // typed a number — empty means "let the renderer
                          // decide" rather than forcing zero into the format.
                          ...(editForm.decimals === '' || editForm.decimals == null
                            ? {}
                            : { decimals: editForm.decimals }),
                          thousandSep: editForm.thousandSep,
                          prefix: editForm.prefix,
                          suffix: editForm.suffix,
                        },
                      };
                    } else {
                      const [tbl, col] = editForm.aggregation === 'count'
                        ? ['', '*']
                        : (editForm.field || '').split('::');
                      patch = {
                        label: editForm.label,
                        aggregation: editForm.aggregation,
                        table: tbl || '',
                        column: col || '',
                        expression: undefined,
                        ...(editForm.filterEnabled && (editForm.filterRules || []).length > 0
                          ? { filterRules: editForm.filterRules, overrideFilters: !!editForm.overrideFilters }
                          : { filterRules: undefined, overrideFilters: undefined }),
                        format: {
                          // Only persist decimals when the user actually
                          // typed a number — empty means "let the renderer
                          // decide" rather than forcing zero into the format.
                          ...(editForm.decimals === '' || editForm.decimals == null
                            ? {}
                            : { decimals: editForm.decimals }),
                          thousandSep: editForm.thousandSep,
                          prefix: editForm.prefix,
                          suffix: editForm.suffix,
                        },
                      };
                    }
                  } else {
                    patch = {
                      label: editForm.label,
                      ...(m.aggregation === 'custom' ? { expression: editForm.expression } : {}),
                      format: {
                        ...(editForm.decimals === '' || editForm.decimals == null
                          ? {}
                          : { decimals: editForm.decimals }),
                        thousandSep: editForm.thousandSep,
                        prefix: editForm.prefix,
                        suffix: editForm.suffix,
                      },
                    };
                  }
                  let wrote = false;
                  if (m._source === 'report') {
                    // Edit a report-scoped measure: mutate the entry inside
                    // settings.extraMeasures. When converting _filt.X to a
                    // custom expression, explicitly strip filterRules/
                    // overrideFilters so the server doesn't keep applying
                    // the CASE WHEN wrap on top of the user's SQL.
                    const currentExtras = (settings && settings.extraMeasures) || [];
                    wrote = updateSettings({
                      extraMeasures: currentExtras.map((x) => {
                        if (x.name !== m.name) return x;
                        // Merge then strip keys explicitly set to undefined
                        // in the patch (so e.g. disabling the filter toggle
                        // actually removes filterRules/overrideFilters from
                        // the saved object).
                        const merged = { ...x, ...patch };
                        for (const k of Object.keys(patch)) {
                          if (patch[k] === undefined) delete merged[k];
                        }
                        return merged;
                      }),
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
        ), measurePanelMount);
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
                    <Fragment key={d.name}>
                    <div
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
                    {editingDim === d.name && (
                      <div ref={(node) => setDimPanelMount((cur) => (cur === node ? cur : node))} />
                    )}
                    </Fragment>
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
        if (!d || !dimPanelMount) return null;
        return createPortal((
          <div style={{ ...editPanelStyle, flexShrink: 0 }}>
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
        ), dimPanelMount);
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

// Paren-aware aggregate transform — client port of the server helper.
// Walks the expression and applies `transform(fn, arg)` to each top-level
// SUM/AVG/MIN/MAX/COUNT call, tracking paren depth and string literals so
// a CASE WHEN containing `IN (...)` doesn't break the matcher.
function transformAggregates(expression, fns, transform) {
  if (!expression) return expression;
  const s = String(expression);
  const fnRegex = new RegExp(`^(${fns.join('|')})\\(`, 'i');
  let out = '';
  let i = 0;
  while (i < s.length) {
    if (s[i] === "'") {
      const end = s.indexOf("'", i + 1);
      if (end === -1) { out += s.slice(i); break; }
      out += s.slice(i, end + 1);
      i = end + 1;
      continue;
    }
    const prev = i > 0 ? s[i - 1] : '';
    const atBoundary = !/[A-Za-z0-9_]/.test(prev);
    const m = atBoundary ? s.slice(i).match(fnRegex) : null;
    if (!m) { out += s[i]; i++; continue; }
    const fn = m[1];
    let depth = 1;
    let j = i + m[0].length;
    let inStr = false;
    while (j < s.length && depth > 0) {
      const ch = s[j];
      if (inStr) {
        if (ch === "'") inStr = false;
      } else if (ch === "'") {
        inStr = true;
      } else if (ch === '(') {
        depth++;
      } else if (ch === ')') {
        depth--;
        if (depth === 0) break;
      }
      j++;
    }
    if (depth !== 0) { out += s[i]; i++; continue; }
    const arg = s.slice(i + m[0].length, j);
    out += transform(fn, arg);
    i = j + 1;
  }
  return out;
}

// Synthesize the SQL of a measure from its structured fields. Used by the
// wizard to keep the SQL editor in sync with the user's choices. The
// expression always comes through here so the user actually SEES what the
// server will run — including the CASE WHEN wrap when a filter is active,
// even for custom-expression measures.
function buildMeasureSql({ aggregation, table, column, filterRules, overrideFilters, expression }) {
  const hasFilter = Array.isArray(filterRules) && filterRules.length > 0;
  const fmtVal = (v) => {
    if (v == null) return 'NULL';
    if (Array.isArray(v)) return v.map(fmtVal).join(', ');
    if (typeof v === 'number' || /^-?\d+(\.\d+)?$/.test(String(v))) return String(v);
    return `'${String(v).replace(/'/g, "''")}'`;
  };
  const renderRule = (r) => {
    if (!r || !r.field || !r.op) return null;
    const f = `"${r.field}"`;
    const list = Array.isArray(r.values) ? r.values : (Array.isArray(r.value) ? r.value : null);
    switch (r.op) {
      case 'in': return list?.length ? `${f} IN (${list.map(fmtVal).join(', ')})` : null;
      case 'not_in': return list?.length ? `${f} NOT IN (${list.map(fmtVal).join(', ')})` : null;
      case 'eq': return `${f} = ${fmtVal(r.value)}`;
      case 'neq': return `${f} <> ${fmtVal(r.value)}`;
      case 'gt': return `${f} > ${fmtVal(r.value)}`;
      case 'gte': return `${f} >= ${fmtVal(r.value)}`;
      case 'lt': return `${f} < ${fmtVal(r.value)}`;
      case 'lte': return `${f} <= ${fmtVal(r.value)}`;
      case 'between': return list?.length === 2 ? `${f} BETWEEN ${fmtVal(list[0])} AND ${fmtVal(list[1])}` : null;
      case 'contains': return `${f} LIKE '%${String(r.value).replace(/'/g, "''")}%'`;
      case 'not_contains': return `${f} NOT LIKE '%${String(r.value).replace(/'/g, "''")}%'`;
      case 'starts_with': return `${f} LIKE '${String(r.value).replace(/'/g, "''")}%'`;
      case 'ends_with': return `${f} LIKE '%${String(r.value).replace(/'/g, "''")}'`;
      case 'is_empty': return `(${f} IS NULL OR ${f} = '')`;
      case 'is_not_empty': return `(${f} IS NOT NULL AND ${f} <> '')`;
      default: return null;
    }
  };
  const whenSql = hasFilter ? filterRules.map(renderRule).filter(Boolean).join(' AND ') : '';

  // Custom expression: optionally wrap each aggregate inside the expression
  // with CASE WHEN — same shape as what the server's transformAggregates
  // produces at query time.
  if (aggregation === 'custom') {
    const bare = expression || '';
    if (hasFilter && whenSql && !overrideFilters) {
      return transformAggregates(
        bare,
        ['SUM', 'AVG', 'MIN', 'MAX', 'COUNT'],
        (fn, arg) => `${fn}(CASE WHEN ${whenSql} THEN ${arg} END)`,
      );
    }
    if (hasFilter && whenSql && overrideFilters) {
      return `(SELECT ${bare}\n FROM <model>\n WHERE <visual filters except override fields>\n   AND ${whenSql})`;
    }
    return bare;
  }
  // Structured path: synthesize <AGG>(col) or <AGG>(CASE WHEN ... THEN col END)
  const isCount = aggregation === 'count' || (column === '*' && !table);
  const colExpr = isCount ? null : (table && column ? `"${table}"."${column}"` : null);
  const aggFn = isCount ? 'COUNT' : (aggregation || 'sum').toUpperCase();
  const baseAgg = isCount ? 'COUNT(*)' : `${aggFn}(${colExpr || 'col'})`;
  if (!hasFilter || !whenSql) return baseAgg;
  if (overrideFilters) {
    return `(SELECT ${baseAgg}\n FROM <model>\n WHERE <visual filters except override fields>\n   AND ${whenSql})`;
  }
  const inner = isCount ? '1' : colExpr;
  return `${aggFn}(CASE WHEN ${whenSql}\n     THEN ${inner} END)`;
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
// Inline-accordion edit panel, portaled directly under the active field
// row. It reuses the clicked row's highlight (--bg-active) + a 3px accent
// left border so it visually reads as one block with the field above.
// Full width + border-box + overflowX:hidden kills the horizontal
// scrollbar in the narrow dimensions list; no inner maxHeight/overflow so
// the form shows at full size and the (single) host list scroll handles
// height instead of a cramped scroll-within-scroll.
const editPanelStyle = {
  padding: 10,
  // Same family as the selected row (--bg-active) but blended toward the
  // panel bg so it's a touch dimmer — distinct from, yet clearly tied to,
  // the highlighted field above.
  background: 'color-mix(in srgb, var(--bg-active) 45%, var(--bg-panel))',
  borderLeft: '3px solid var(--accent-primary)',
  borderBottom: '1px solid var(--border-default)',
  boxSizing: 'border-box',
  width: '100%',
  overflowX: 'hidden',
  // Light shading so the panel reads as a recessed sub-block hanging
  // off the field row above (inset top + soft drop).
  boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.05), 0 1px 3px rgba(0,0,0,0.06)',
  // Slide-down + fade on open.
  animation: 'fieldEditIn 180ms ease-out',
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
// Square icon-only button. The native `title` attribute renders a tooltip
// after the OS hover delay so the icon stays compact but stays discoverable.
const iconBtn = (color) => ({
  fontSize: 12, padding: '2px 6px', border: `1px solid ${color}`, borderRadius: 3,
  background: 'var(--bg-panel)', color, cursor: 'pointer', lineHeight: 1,
  width: 24, height: 22, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
});
const addCalcBtnSmall = {
  fontSize: 10, fontWeight: 600, padding: '1px 6px', border: '1px solid var(--accent-primary)',
  borderRadius: 3, background: 'var(--bg-active)', color: 'var(--accent-primary)', cursor: 'pointer',
};
const calcInputStyle = {
  width: '100%', padding: '4px 6px', border: '1px solid var(--accent-primary-border)', borderRadius: 3,
  fontSize: 11, outline: 'none', boxSizing: 'border-box', background: 'var(--bg-panel)', color: 'var(--text-primary)',
};
