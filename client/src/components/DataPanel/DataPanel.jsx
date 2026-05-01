import { useState, useEffect, useRef, useCallback } from 'react';
import { TbPencil } from 'react-icons/tb';
import api from '../../utils/api';
import SqlExpressionInput from '../SqlExpressionInput/SqlExpressionInput';
import { sanitizeWidgetFilters } from '../../utils/widgetFilters';

export default function DataPanel({ widgetId, widget, onUpdate, onUpdateSilent, model, onModelUpdate, reportFilters }) {
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

  // Key based on binding + model version + filters (slicers don't include filters)
  const modelVersion = (model?.measures?.length || 0) + ':' + (model?.dimensions?.length || 0);
  const isFilterWidget = widget?.type === 'filter';
  const filtersKey = !isFilterWidget && reportFilters ? JSON.stringify(reportFilters) : '';
  const scatterKey = isScatter ? `${scatterMeas.x || ''}:${scatterMeas.y || ''}:${scatterMeas.size || ''}` : '';
  const comboKey = isCombo ? `bar:${comboBarMeas.join(',')}|line:${comboLineMeas.join(',')}` : '';
  const gaugeKey = widget?.type === 'gauge' ? `threshold:${gaugeThresholdMeasure || ''}|max:${gaugeMaxMeasure || ''}` : '';
  const aggOverrides = binding.measureAggOverrides || {};
  const aggKey = Object.keys(aggOverrides).length > 0 ? JSON.stringify(aggOverrides) : '';
  // Include widget.type in the key so converting between widget types (e.g. pivot
  // → table) triggers a re-fetch with the new shape.
  const typeKey = widget?.type || '';
  // Conditional formatting — colour-by-measure binding contributes to the key so the
  // fetcher re-runs when the measure or the enabled flag changes.
  const colorEnabled = widget?.config?.colorCondition?.enabled === true;
  const colorMeasure = colorEnabled ? (binding.colorMeasure || '') : '';
  const colorKey = `cm:${colorMeasure}`;
  // Per-widget filters — refetch when any filter rule changes
  const widgetFilters = Array.isArray(binding.widgetFilters) ? binding.widgetFilters : [];
  const widgetFiltersKey = widgetFilters.length > 0 ? `wf:${JSON.stringify(widgetFilters)}` : '';
  const bindingKey = hasWidget ? `${selectedDims.join(',')}:${selectedMeass.join(',')}:${groupBy.join(',')}:${columnDims.join(',')}:${scatterKey}:${comboKey}:${gaugeKey}:${aggKey}:${colorKey}:${widgetFiltersKey}:${modelVersion}:${filtersKey}:${typeKey}` : '';
  // Full key including widgetId to detect widget switch
  const selectionKey = hasWidget ? `${widgetId}:${bindingKey}` : '';

  // Drag start handler
  const handleDragStart = (e, fieldName, fieldType) => {
    e.dataTransfer.setData('application/field-name', fieldName);
    e.dataTransfer.setData('application/field-type', fieldType); // 'dimension' or 'measure'
    e.dataTransfer.effectAllowed = 'copyMove';
  };

  // Auto-fetch when dimensions/measures selection changes
  useEffect(() => {
    if (!selectionKey) return;

    const parts = selectionKey.split(':');
    const wId = parts[0];
    const dims = parts[1]?.split(',').filter(Boolean) || [];
    const meass = parts[2]?.split(',').filter(Boolean) || [];
    const grpBy = parts[3]?.split(',').filter(Boolean) || [];

    const hasMainBinding = dims.length > 0 || meass.length > 0;
    const hasColorMeas = !!colorMeasure;
    if (!hasMainBinding && !hasColorMeas) {
      setStatus(null);
      return;
    }

    const capturedWidget = widgetRef.current;
    const capturedWidgetId = widgetIdRef.current;
    if (!capturedWidget || !capturedWidgetId) return;

    // Skip fetch if widget already has data for this exact binding
    if (capturedWidget.data?._fetchedBinding === bindingKey && Object.keys(capturedWidget.data).length > 1) {
      setStatus({ type: 'ok', message: 'cached' });
      return;
    }

    let cancelled = false;
    const abortController = new AbortController();

    const timer = setTimeout(async () => {
      setLoading(true);
      setStatus(null);

      // Mark widget as loading (silent — not an undoable action)
      const lw = widgetRef.current;
      if (lw && widgetIdRef.current === capturedWidgetId) {
        onUpdateSilentRef.current(capturedWidgetId, { ...lw, _loading: true });
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

        // Main query (skipped when only colour-by-measure is bound, e.g. for shape/text widgets)
        const mainPromise = hasMainBinding
          ? api.post(`/models/${model.id}/query`, {
              dimensionNames: allDims,
              measureNames: uniqueMeass,
              measureAggOverrides: Object.keys(aggOverrides).length > 0 ? aggOverrides : undefined,
              limit: isFilterWidget ? 1000000 : (capturedWidget.config?.dataLimit || 1000),
              filters: mergedFiltersLocal,
              widgetFilters: sanitizeWidgetFilters(widgetFilters),
              distinct: isFilterWidget || undefined,
            }, { signal: abortController.signal })
          : Promise.resolve({ data: { rows: [] } });

        // Conditional formatting — single-row aggregate of the bound colour measure
        const colorPromise = hasColorMeas
          ? api.post(`/models/${model.id}/query`, {
              dimensionNames: [],
              measureNames: [colorMeasure],
              limit: 1,
              filters: mergedFiltersLocal,
              widgetFilters: sanitizeWidgetFilters(widgetFilters),
            }, { signal: abortController.signal }).catch(() => null)
          : Promise.resolve(null);

        const [res, colorRes] = await Promise.all([mainPromise, colorPromise]);
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
        }
        newData._rowCount = rows.length;
        newData._colorValue = _colorValue;
        newData._sql = res.data?.sql || null;
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
        if (ew && widgetIdRef.current === capturedWidgetId) {
          onUpdateSilentRef.current(capturedWidgetId, { ...ew, _loading: false, data: { ...(ew.data || {}), _error: msg, _rowCount: 0 } });
        }
        setStatus({ type: 'error', message: msg });
      } finally {
        setLoading(false);
      }
    }, 150);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      abortController.abort();
    };
  }, [selectionKey, bindingKey, model.id]);

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
                  const newMeasures = [...(model.measures || []), {
                    name: measName, table: '', column: '', aggregation: 'custom',
                    expression: calcExpr, label: calcLabel,
                  }];
                  await api.put(`/models/${model.id}`, { measures: newMeasures });
                  if (onModelUpdate) onModelUpdate();
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
              <button onClick={() => setEditingField(null)} style={editCancelBtn}>Close</button>
              <button onClick={async () => {
                try {
                  const newMeasures = (model.measures || []).map((x) => x.name === m.name
                    ? {
                        ...x,
                        label: editForm.label,
                        ...(x.aggregation === 'custom' ? { expression: editForm.expression } : {}),
                        format: {
                          decimals: editForm.decimals,
                          thousandSep: editForm.thousandSep,
                          prefix: editForm.prefix,
                          suffix: editForm.suffix,
                        },
                      }
                    : x);
                  await api.put(`/models/${model.id}`, { measures: newMeasures });
                  if (onModelUpdate) onModelUpdate();
                  setEditingField(null);
                } catch (err) { console.error(err); }
              }} style={editSaveBtn}>Save</button>
            </div>
          </div>
        );
      })()}

      {/* Date table — only shown when a dateColumn is set */}
      {model.dateColumn && (() => {
        const dateCol = (model.dimensions || []).find((d) => d.name === model.dateColumn);
        if (!dateCol) return null;
        const dateParts = (model.dimensions || []).filter((d) => d.datePartOf === model.dateColumn);
        return (
          <FieldSection label={
            <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
              <span>📅 Date Table</span>
              <button onClick={async (e) => {
                e.stopPropagation();
                // Remove date column and all its parts
                const newDims = (model.dimensions || []).filter((x) => x.datePartOf !== model.dateColumn);
                await api.put(`/models/${model.id}`, { dateColumn: '', dimensions: newDims });
                if (onModelUpdate) onModelUpdate();
              }} style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'var(--state-warning-soft)', color: 'var(--state-warning)', fontWeight: 600, border: 'none', cursor: 'pointer' }}>✕ remove</button>
            </span>
          } style={{ flex: '0 0 auto', maxHeight: '30%' }}>
            <div style={listBox}>
              {/* Main date column */}
              <div
                draggable
                onDragStart={(e) => handleDragStart(e, dateCol.name, 'dimension')}
                title={`${dateCol.table}.${dateCol.column}`}
                style={{
                  ...dragItem, paddingLeft: 8,
                  backgroundColor: (selectedDims.includes(dateCol.name) || columnDims.includes(dateCol.name) || groupBy.includes(dateCol.name)) ? 'var(--state-warning-soft)' : 'transparent',
                  borderLeft: (selectedDims.includes(dateCol.name) || columnDims.includes(dateCol.name) || groupBy.includes(dateCol.name)) ? '3px solid var(--state-warning)' : '3px solid transparent',
                }}
              >
                <span style={dragHandle}>⠿</span>
                <span style={{ ...truncatedLabel, fontWeight: 600 }} title={dateCol.label || dateCol.column}>{dateCol.label || dateCol.column}</span>
                <span style={{ ...dateTag, flexShrink: 0 }}>📅</span>
              </div>
              {/* Date parts */}
              {dateParts.map((dp) => (
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
          </FieldSection>
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
                            await api.put(`/models/${model.id}`, { dateColumn: d.name });
                            if (onModelUpdate) onModelUpdate();
                          }}
                          title="Set as date table"
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
              <select value={dimEditForm.type || 'string'}
                onChange={(e) => setDimEditForm({ ...dimEditForm, type: e.target.value })}
                style={{ ...editInput, width: 90 }}>
                <option value="string">Text</option>
                <option value="number">Number</option>
                <option value="date">Date</option>
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
              <button onClick={() => setEditingDim(null)} style={editCancelBtn}>Close</button>
              <button onClick={async () => {
                try {
                  let newDimensions = (model.dimensions || []).map((x) => x.name === d.name
                    ? { ...x, label: dimEditForm.label, type: dimEditForm.type }
                    : x);

                  // Generate date part dimensions
                  if (dimEditForm.generateParts) {
                    // Remove existing date parts first
                    newDimensions = newDimensions.filter((x) => !x.name.startsWith('_date.'));
                    const dateParts = [
                      { suffix: 'year', label: 'Year', expr: 'num_year' },
                      { suffix: 'month_num', label: 'Month Number', expr: 'num_month' },
                      { suffix: 'month_name', label: 'Month Name', expr: 'name_month' },
                      { suffix: 'week', label: 'Week', expr: 'num_week' },
                      { suffix: 'day_of_week', label: 'Day of Week', expr: 'num_day_of_week' },
                      { suffix: 'day_name', label: 'Day Name', expr: 'name_day' },
                    ];
                    dateParts.forEach((p) => {
                      newDimensions.push({
                        name: `_date.${p.suffix}`,
                        table: d.table,
                        column: d.column,
                        type: p.expr.startsWith('name') ? 'string' : 'number',
                        label: p.label,
                        datePartOf: d.name,
                        datePart: p.expr,
                      });
                    });
                  }

                  const updates = { dimensions: newDimensions };
                  if (dimEditForm.setAsDateTable) updates.dateColumn = d.name;
                  await api.put(`/models/${model.id}`, updates);
                  if (onModelUpdate) onModelUpdate();
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
