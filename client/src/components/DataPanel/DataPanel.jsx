import { useState, useEffect, useRef, Fragment } from 'react';
import { useCalcWizard } from '../../hooks/useCalcWizard';
import { useFieldEdit } from '../../hooks/useFieldEdit';
import { createPortal } from 'react-dom';
import { TbChevronDown } from 'react-icons/tb';
import { ICON_SIZE } from '../actionIcons';
import ConfirmDeleteButton from '../ConfirmDeleteButton/ConfirmDeleteButton';
import api from '../../utils/api';
import SqlExpressionInput from '../SqlExpressionInput/SqlExpressionInput';
import FilterRulesEditor, { buildDefaultFilterRule } from '../FilterRulesEditor/FilterRulesEditor';
import { prepareGlobalRulesForWidget } from '../../utils/reportFilterRules';
import { computeBindingKey } from '../../utils/bindingKey';
import { buildWidgetQueryPayload } from '../../utils/widgetQueryPayload';
import { buildWidgetData } from '../../utils/widgetDataBuilder';

const _hs0 = { marginBottom: 16 };
const _hs1 = { fontSize: 12, color: 'var(--text-disabled)' };
const _hs2 = { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 };
const _hs3 = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' };
const _hs4 = { padding: 6, background: 'var(--bg-active)', borderRadius: 4, marginBottom: 4, border: '1px solid var(--accent-primary-border)', maxHeight: '100%', overflow: 'auto' };
const _hs5 = { display: 'flex', gap: 4, marginBottom: 4 };
const _hs6 = { display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 };
const _hs7 = { display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, fontSize: 11, color: 'var(--text-secondary)' };
const _hs8 = { color: 'var(--text-disabled)', cursor: 'help' };
const _hs9 = { marginTop: 6 };
const _hs10 = { fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', display: 'block', marginBottom: 4 };
const _hs11 = { display: 'flex', gap: 4, justifyContent: 'flex-end', marginTop: 6 };
const _hs12 = { fontSize: 11, padding: '2px 8px', border: '1px solid var(--border-default)', borderRadius: 3, background: 'var(--bg-panel)', cursor: 'pointer', color: 'var(--text-muted)' };
const _hs13 = { fontSize: 11, fontWeight: 600, padding: '2px 8px', border: 'none', borderRadius: 3, background: 'var(--accent-primary)', color: '#fff', cursor: 'pointer' };
const _hs14 = { display: 'flex', gap: 4, marginBottom: 4 };
const _hs15 = { display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 };
const _hs16 = { display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, fontSize: 11, color: 'var(--text-secondary)' };
const _hs17 = { color: 'var(--text-disabled)', cursor: 'help' };
const _hs18 = { marginTop: 6 };
const _hs19 = { marginBottom: 6 };
const _hs20 = { display: 'flex', gap: 4, justifyContent: 'flex-end', marginTop: 6 };
const _hs21 = { flex: 1 };
const _hs22 = { marginBottom: 8, flexShrink: 0 };
const _hs23 = {
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                marginBottom: 3, gap: 6,
              };
const _hs24 = { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)', fontWeight: 500 };
const _hs25 = { fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'var(--state-warning-soft)', color: 'var(--state-warning)', fontWeight: 600, border: 'none', cursor: 'pointer' };
const _hs26 = { border: '1px solid var(--border-default)', borderRadius: 4, maxHeight: 220, overflow: 'auto' };
const _hs27 = { display: 'inline-block', width: 14, flexShrink: 0 };
const _hs28 = { fontSize: 8, color: 'var(--text-disabled)', flexShrink: 0 };
const _hs29 = { flex: '1 1 75%' };
const _hs30 = { display: 'flex', gap: 4, justifyContent: 'flex-end', marginTop: 6 };
const _hs31 = { fontSize: 12, color: 'var(--text-disabled)', marginTop: 4 };
const _hs32 = { fontSize: 11, marginTop: 4, color: 'var(--state-danger)' };
const _hs33 = { fontSize: 12, color: 'var(--text-disabled)', marginTop: 8 };
const _hs34 = { display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 3, fontWeight: 500, flexShrink: 0 };

export default function DataPanel({ widgetId, widget, onUpdate, onUpdateSilent, onSetWidgetLoading, model, onModelUpdate, settings, onSettingsChange, reportFilters, refreshNonce, reportId, cacheBuiltAt }) {
  // Patches the report's in-memory `settings` JSON (persisted on the next
  // Save). Returns false when `onSettingsChange` is missing — callers must
  // treat that as a hard failure and never fall back to mutating the model,
  // which is wrong from the report editor.
  const updateSettings = (patch) => {
    if (typeof onSettingsChange !== 'function') {
      console.error('[DataPanel] onSettingsChange prop is missing — refusing to mutate the model. Action ignored.');
      return false;
    }
    onSettingsChange({ ...(settings || {}), ...patch });
    return true;
  };
  const [status, setStatus] = useState(null);
  // Measure-creation wizard + field-edit panel state live in the hooks
  // below. One form covers simple aggregation (SUM/AVG/COUNT/MIN/MAX on a
  // column), custom SQL, and an optional CASE WHEN filter context — all
  // stored under `_calc.<label>`. The server decides the SQL purely from
  // the measure's fields (aggregation/expression/filterRules).
  const {
    showCalcForm, setShowCalcForm,
    calcLabel, setCalcLabel,
    calcAggregation, setCalcAggregation,
    calcField, setCalcField,
    calcExpr, setCalcExpr,
    calcFilterEnabled, setCalcFilterEnabled,
    calcRules, setCalcRules,
    calcOverride, setCalcOverride,
    calcSaving, setCalcSaving,
    calcBareExpr, setCalcBareExpr,
  } = useCalcWizard();
  const {
    editingField, setEditingField,
    editForm, setEditForm,
    editingDim, setEditingDim,
    dimEditForm, setDimEditForm,
  } = useFieldEdit();
  // Inline-accordion mount points: the (large) edit-panel JSX stays where
  // it is in the tree and is portaled into a placeholder rendered right
  // under the active row, so it visually belongs to the clicked field.
  const [measurePanelMount, setMeasurePanelMount] = useState(null);
  const [dimPanelMount, setDimPanelMount] = useState(null);
  const [, setLoading] = useState(false);
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

  // Widgets without any data binding hide all the binding-related sections
  // (field wells, measures, filterRules editor, etc.). The data-panel header
  // still renders so the user can navigate to the underlying model. `model &&`
  // keeps this (and everything derived from it) inert when there's no model —
  // the hooks below must run unconditionally (Rules of Hooks), so the "no model"
  // bail happens after them, not here.
  const hasWidget = model && widgetId && widget && !['text', 'image', 'shape'].includes(widget.type);
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

  const colorEnabled = widget?.config?.colorCondition?.enabled === true;
  const colorMeasure = colorEnabled ? (binding.colorMeasure || '') : '';
  // Per-widget view of the report-level global filters, forwarded to
  // buildWidgetQueryPayload — which merges them with the widget's own filters
  // (same as Editor / Viewer). See prepareGlobalRulesForWidget for its dual
  // responsibility (drop excluded rules + strip the editor-only `exclusions`
  // field so it doesn't pollute the preAggCache shape key).
  const reportLevelFilters = prepareGlobalRulesForWidget(settings?.reportFilters, widgetId);

  // Cache key — shared with Editor.jsx via computeBindingKey so both fetchers
  // agree on what counts as the "same" binding. After Editor's refetch (drill,
  // filter change, refresh), it stamps `data._fetchedBinding` with this same
  // value so re-selecting the widget doesn't trigger an unnecessary refetch.
  const bindingKey = hasWidget ? computeBindingKey({ widget, model, reportFilters, settings, cacheBuiltAt }) : '';
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
    const dims = parts[1]?.split(',').filter(Boolean) || [];
    const meass = parts[2]?.split(',').filter(Boolean) || [];

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
        // Assemble the query bodies + resolved metadata via the shared util
        // (same path as Editor / Viewer, replacing DataPanel's former inline
        // copy). The config preview does NOT cross-filter, so no currentWidgets
        // / crossHighlight are passed — queries stay identical to before, and
        // filter widgets fetch their distinct value list ('distinct' mode).
        const { meta, bodies } = buildWidgetQueryPayload(capturedWidget, capturedWidgetId, {
          effectiveModel: model,
          reportFilters,
          reportId,
          reportLevelFilters,
          reportExtras: {
            extraDimensions: settings?.extraDimensions || [],
            extraMeasures: settings?.extraMeasures || [],
            dimensionOverrides: settings?.dimensionOverrides || {},
            measureOverrides: settings?.measureOverrides || {},
          },
          bypassCache: refreshTriggered,
          generateQueryId: newQueryId,
          filterWidgetMode: 'distinct',
          dedupMeasures: true,
        });

        const mainPromise = bodies.main
          ? api.post(`/models/${model.id}/query`, bodies.main, { signal: abortController.signal })
              .finally(() => { if (meta.mainQueryId) activeQueryIds.delete(meta.mainQueryId); })
          : Promise.resolve({ data: { rows: [] } });
        const colorPromise = bodies.color
          ? api.post(`/models/${model.id}/query`, bodies.color, { signal: abortController.signal }).catch(() => null)
          : Promise.resolve(null);
        const totalPromise = bodies.total
          ? api.post(`/models/${model.id}/query`, bodies.total, { signal: abortController.signal }).catch(() => null)
          : Promise.resolve(null);
        const n1Promise = bodies.n1
          ? api.post(`/models/${model.id}/query`, bodies.n1, { signal: abortController.signal }).catch(() => null)
          : Promise.resolve(null);
        const comboLinePromise = bodies.comboLine
          ? api.post(`/models/${model.id}/query`, bodies.comboLine, { signal: abortController.signal }).catch(() => null)
          : Promise.resolve(null);

        const [res, colorRes, totalRes, n1Res, comboLineRes] = await Promise.all([
          mainPromise, colorPromise, totalPromise, n1Promise, comboLinePromise,
        ]);
        if (cancelled) return;

        const mainSql = res.data?.sql || null;
        const lineSql = comboLineRes?.data?.sql || null;
        const sql = mainSql && lineSql
          ? `-- Main query\n${mainSql}\n\n-- Line aggregation (dim only, no groupBy)\n${lineSql}`
          : mainSql;

        let newData = buildWidgetData({
          widget: capturedWidget,
          rows: res.data?.rows,
          meta,
          effectiveModel: model,
          colorRes, totalRes, n1Res, comboLineRes,
          sql, bindingKey,
          // DataPanel kept every selected dim in the pivot row list (no
          // col-pin filtering) — match that (Viewer's behaviour) so migration
          // is a no-op for pivots.
          pivotFilterRowDims: false,
        });
        // buildWidgetData doesn't stamp _maxReached — carry it over.
        newData._maxReached = res.data?.maxReached || false;

        // Table: buildWidgetData emits the plain { columns, rows } shape but
        // NOT the DataPanel-preview "Load more" flag or the user's column
        // reordering. Re-derive them on top of the shared shape (preserves
        // prior behaviour).
        if (capturedWidget.type === 'table') {
          const tRows = res.data?.rows || [];
          if (tRows.length > 0) {
            const dataLimit = capturedWidget.config?.dataLimit || 1000;
            let columns = Object.keys(tRows[0]);
            const colOrder = capturedWidget.dataBinding?.columnOrder;
            if (colOrder && colOrder.length > 0) {
              const allFields = [...(model.dimensions || []), ...(model.measures || [])];
              const nameToLabel = {};
              for (const f of allFields) nameToLabel[f.name] = f.label || f.name;
              const orderedLabels = colOrder.map((n) => nameToLabel[n]).filter(Boolean);
              const orderedCols = orderedLabels.filter((l) => columns.includes(l));
              const rest = columns.filter((c) => !orderedCols.includes(c));
              columns = [...orderedCols, ...rest];
            }
            newData = {
              ...newData,
              columns,
              rows: tRows.map((r) => columns.map((c) => (r[c] != null ? String(r[c]) : ''))),
              _hasMore: tRows.length >= dataLimit,
              _loadingMore: false,
            };
          }
        }

        if (cancelled) return;
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
  }, [selectionKey, bindingKey, model?.id, refreshNonce]);

  // No model linked: bail AFTER all the hooks above so the hook order is
  // identical on every render (an early return before them breaks the Rules of
  // Hooks). With no model, hasWidget is false, so the derived binding values are
  // empty and the effect above no-ops.
  if (!model) {
    return (
      <div style={_hs0}>
        <div style={sectionTitle}>Data Source</div>
        <div style={_hs1}>No model linked to this report.</div>
      </div>
    );
  }

  // Helper to get short table name
  const shortTable = (t) => t.includes('.') ? t.split('.').pop() : t;

  return (
    <div style={_hs2}>
      {/* Measures first — fixed height, does not shrink when editing.
          (The model name + edit link moved to the panel header in
          PropertyPanel's DataModelPanel so "Data" isn't shown twice.) */}
      <FieldSection label={
        <span style={_hs3}>
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
          <div style={_hs4}>
            <input type="text" placeholder="Label" value={calcLabel}
              onChange={(e) => setCalcLabel(e.target.value)}
              style={{ ...calcInputStyle, marginBottom: 4 }} />
            <div style={_hs5}>
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
                  style={{ ...calcInputStyle, flex: 1, marginBottom: 0 }}>
                  <option value="">{calcAggregation === 'count' ? '— count(*) — all rows' : '— pick a column —'}</option>
                  {/* COUNT accepts any column type (text / date / number — it
                      counts non-null values regardless), so widen the picker
                      to include dimensions too. SUM / AVG / MIN / MAX stay
                      numeric-only by listing model.measures. */}
                  {calcAggregation === 'count' && (model.dimensions || []).filter((d) => d.table && d.column).map((d) => (
                    <option key={'d::' + d.name} value={`${d.table}::${d.column}`}>{d.label || d.column}</option>
                  ))}
                  {(model.measures || []).filter((mm) => mm.table && mm.column && mm.aggregation !== 'custom').map((mm) => (
                    <option key={mm.name} value={`${mm.table}::${mm.column}`}>{mm.label || mm.column}</option>
                  ))}
                </select>
              )}
            </div>
            <label style={_hs6}>
              <input type="checkbox" checked={calcFilterEnabled}
                onChange={(e) => setCalcFilterEnabled(e.target.checked)} />
              <span>Add filter</span>
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
                <label style={_hs7}>
                  <input type="checkbox" checked={calcOverride}
                    onChange={(e) => setCalcOverride(e.target.checked)} />
                  <span>Override report filters</span>
                  <span title="When ON, this measure ignores the report-level filter on the fields it filters on." style={_hs8}>ⓘ</span>
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
            <div style={_hs9}>
              <span style={_hs10}>SQL Expression</span>
              <SqlExpressionInput value={calcExpr}
                onChange={(v) => {
                  setCalcExpr(v);
                  setCalcBareExpr(v);
                  if (calcAggregation !== 'custom') setCalcAggregation('custom');
                  if (calcFilterEnabled) setCalcFilterEnabled(false);
                }}
                model={model} />
            </div>
            <div style={_hs11}>
              <button onClick={() => {
                setShowCalcForm(false); setCalcLabel(''); setCalcExpr(''); setCalcBareExpr(''); setCalcField('');
                setCalcAggregation('sum'); setCalcFilterEnabled(false); setCalcRules([]); setCalcOverride(false);
              }} style={_hs12}>Cancel</button>
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
                    // COUNT now accepts an optional column. When the user
                    // picks one, persist it like any other agg (table+col);
                    // when left blank, fall back to the COUNT(*) sentinel.
                    const [table, column] = (calcAggregation === 'custom')
                      ? ['', '']
                      : (calcAggregation === 'count'
                          ? (calcField ? calcField.split('::') : ['', '*'])
                          : calcField.split('::'));
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
                style={_hs13}>
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
                <div style={_hs14}>
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
                      style={{ ...editInput, flex: 1 }}>
                      <option value="">{editForm.aggregation === 'count' ? '— count(*) — all rows' : '— pick a column —'}</option>
                      {/* See wizard: COUNT accepts any column, so we show
                          dimensions on top of measures. Other aggregations
                          stay measure-only (numeric). */}
                      {editForm.aggregation === 'count' && (model.dimensions || []).filter((d) => d.table && d.column).map((d) => (
                        <option key={'d::' + d.name} value={`${d.table}::${d.column}`}>{d.label || d.column}</option>
                      ))}
                      {(model.measures || []).filter((mm) => mm.table && mm.column && mm.aggregation !== 'custom').map((mm) => (
                        <option key={mm.name} value={`${mm.table}::${mm.column}`}>{mm.label || mm.column}</option>
                      ))}
                    </select>
                  )}
                </div>
                <label style={_hs15}>
                  <input type="checkbox" checked={!!editForm.filterEnabled}
                    onChange={(e) => setEditForm({ ...editForm, filterEnabled: e.target.checked })} />
                  <span>Add filter</span>
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
                    <label style={_hs16}>
                      <input type="checkbox" checked={!!editForm.overrideFilters}
                        onChange={(e) => setEditForm({ ...editForm, overrideFilters: e.target.checked })} />
                      <span>Override report filters</span>
                      <span title="When ON, this measure ignores the report-level filter on the fields it filters on." style={_hs17}>ⓘ</span>
                    </label>
                  </>
                )}
                {/* SQL editor — ALWAYS visible. Auto-fills from the wizard
                    inputs above. Typing in here flips the aggregation to
                    'custom' so the user takes ownership of the SQL. */}
                <div style={_hs18}>
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
                <div style={_hs19}>
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

            <div style={_hs20}>
              {m._source === 'report' && (
                <>
                  <ConfirmDeleteButton
                    variant="icon"
                    size={ICON_SIZE.chip}
                    label="Delete this report-scoped measure"
                    style={iconBtn('var(--state-danger)')}
                    onConfirm={() => {
                      const remaining = ((settings && settings.extraMeasures) || []).filter((x) => x.name !== m.name);
                      if (!updateSettings({ extraMeasures: remaining })) return;
                      setEditingField(null);
                    }}
                  />
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
                  <span style={_hs21} />
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
                      // Same column-aware COUNT rule as the wizard above:
                      // honour the picked column when set, fall back to the
                      // COUNT(*) sentinel only when the user left it blank.
                      const [tbl, col] = editForm.aggregation === 'count'
                        ? (editForm.field ? editForm.field.split('::') : ['', '*'])
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
          <div style={_hs22}>
            <div
              style={_hs23}
            >
              <span style={_hs24}>
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
                style={_hs25}
              >✕ remove</button>
            </div>
            <div style={_hs26}>
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
                  <span style={_hs27} />
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
                  <span style={_hs28}>{dp.datePart}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Dimensions grouped by table */}
      {model.dimensions?.length > 0 && (
        <FieldSection label="Dimensions" style={_hs29}>
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
                      {d.typeWarning && (
                        <span
                          style={{ fontSize: 11, cursor: 'help', marginLeft: 2, flexShrink: 0 }}
                          title={`Type "${d.typeWarning.type}" matched only ${Math.round(d.typeWarning.ratio * 100)}% of sampled rows when the model was last saved`}
                        >⚠️</span>
                      )}
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
            <div style={_hs30}>
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
        <div style={_hs31}>
          This model has no dimensions or measures defined yet.
        </div>
      )}

      {status?.type === 'error' && (
        <div style={_hs32}>
          Error: {status.message}
        </div>
      )}

      {!widgetId && (
        <div style={_hs33}>Drag fields onto the widget config panel.</div>
      )}
    </div>
  );
}

function FieldSection({ label, children, style }) {
  return (
    <div style={{ marginBottom: 8, display: 'flex', flexDirection: 'column', minHeight: 0, ...style }}>
      <label style={_hs34}>{label}</label>
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
