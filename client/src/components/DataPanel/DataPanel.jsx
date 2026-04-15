import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../../utils/api';
import SqlExpressionInput from '../SqlExpressionInput/SqlExpressionInput';

export default function DataPanel({ widgetId, widget, onUpdate, model, onModelUpdate }) {
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
  const widgetRef = useRef(widget);
  widgetRef.current = widget;
  const widgetIdRef = useRef(widgetId);
  widgetIdRef.current = widgetId;

  if (!model) {
    return (
      <div style={{ marginBottom: 16 }}>
        <div style={sectionTitle}>Data Source</div>
        <div style={{ fontSize: 12, color: '#94a3b8' }}>No model linked to this report.</div>
      </div>
    );
  }

  const hasWidget = widgetId && widget && widget.type !== 'text';
  const binding = hasWidget ? (widget.dataBinding || {}) : {};
  const selectedDims = binding.selectedDimensions || [];
  const selectedMeass = binding.selectedMeasures || [];
  const groupBy = binding.groupBy || [];

  // Key based on binding + model version — widgetId not included so switching widgets doesn't refetch
  const modelVersion = (model?.measures?.length || 0) + ':' + (model?.dimensions?.length || 0);
  const bindingKey = hasWidget ? `${selectedDims.join(',')}:${selectedMeass.join(',')}:${groupBy.join(',')}:${modelVersion}` : '';
  // Full key including widgetId to detect widget switch
  const selectionKey = hasWidget ? `${widgetId}:${bindingKey}` : '';

  // Drag start handler
  const handleDragStart = (e, fieldName, fieldType) => {
    e.dataTransfer.setData('application/field-name', fieldName);
    e.dataTransfer.setData('application/field-type', fieldType); // 'dimension' or 'measure'
    e.dataTransfer.effectAllowed = 'copy';
  };

  // Auto-fetch when dimensions/measures selection changes
  useEffect(() => {
    if (!selectionKey) return;

    const parts = selectionKey.split(':');
    const wId = parts[0];
    const dims = parts[1]?.split(',').filter(Boolean) || [];
    const meass = parts[2]?.split(',').filter(Boolean) || [];
    const grpBy = parts[3]?.split(',').filter(Boolean) || [];

    if (dims.length === 0 && meass.length === 0) {
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

      // Mark widget as loading
      const lw = widgetRef.current;
      if (lw && widgetIdRef.current === capturedWidgetId) {
        onUpdateRef.current(capturedWidgetId, { ...lw, _loading: true });
      }

      try {
        // Include groupBy dimensions in the query
        const allDims = [...dims, ...grpBy.filter((g) => !dims.includes(g))];

        const res = await api.post(`/models/${model.id}/query`, {
          dimensionNames: allDims,
          measureNames: meass,
          limit: capturedWidget.config?.dataLimit || 1000,
        }, { signal: abortController.signal });

        if (cancelled) return;

        const rows = res.data.rows;
        const maxReached = res.data.maxReached || false;
        let newData = {};
        // Use latest widget type (not captured) to handle type changes during fetch
        const currentType = widgetRef.current?.type || capturedWidget.type;

        if (currentType === 'filter') {
          if (rows.length > 0) {
            const keys = Object.keys(rows[0]);
            newData = {
              values: rows.map((r) => r[keys[0]]).filter((v) => v != null),
              label: dims[0] || '',
            };
          }
        } else if (currentType === 'table') {
          if (rows.length > 0) {
            const dataLimit = capturedWidget.config?.dataLimit || 1000;
            newData = {
              columns: Object.keys(rows[0]),
              rows: rows.map((r) => Object.values(r).map((v) => v != null ? String(v) : '')),
              _hasMore: rows.length >= dataLimit,
              _loadingMore: false,
            };
          }
        } else if (currentType === 'scorecard') {
          const firstRow = rows[0];
          if (firstRow) {
            const values = Object.values(firstRow);
            const measureVal = values[values.length - 1];
            const measDef = model.measures?.find((m) => meass.includes(m.name));
            newData = {
              value: typeof measureVal === 'number' ? measureVal.toLocaleString() : String(measureVal),
              label: measDef?.label || meass[0] || '',
            };
          }
        } else if (currentType === 'pie') {
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
        // Attach measure formats for widget rendering
        const measureFormats = {};
        for (const measName of meass) {
          const measDef = (model.measures || []).find((x) => x.name === measName);
          if (measDef?.format) measureFormats[measDef.label || measDef.name] = measDef.format;
        }
        newData._measureFormats = measureFormats;
        const latestWidget = widgetRef.current;
        if (latestWidget && widgetIdRef.current === capturedWidgetId) {
          onUpdateRef.current(capturedWidgetId, { ...latestWidget, data: newData, _loading: false });
        }
        setStatus({ type: 'ok', message: maxReached ? `1,000,000 rows (limit reached)` : `${rows.length} rows` });
      } catch (err) {
        if (cancelled) return;
        const ew = widgetRef.current;
        if (ew && widgetIdRef.current === capturedWidgetId) {
          onUpdateRef.current(capturedWidgetId, { ...ew, _loading: false });
        }
        setStatus({ type: 'error', message: err.response?.data?.error || err.message });
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
        <div style={sectionTitle}>Data — {model.name}</div>
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
          <div style={{ padding: 6, background: '#f5f3ff', borderRadius: 4, marginBottom: 4, border: '1px solid #ddd6fe' }}>
            <input type="text" placeholder="Label" value={calcLabel}
              onChange={(e) => setCalcLabel(e.target.value)}
              style={{ ...calcInputStyle, marginBottom: 4 }} />
            <SqlExpressionInput value={calcExpr} onChange={setCalcExpr} model={model} />
            <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
              <button onClick={() => { setShowCalcForm(false); setCalcLabel(''); setCalcExpr(''); }}
                style={{ fontSize: 11, padding: '2px 8px', border: '1px solid #e2e8f0', borderRadius: 3, background: '#fff', cursor: 'pointer', color: '#64748b' }}>Cancel</button>
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
                style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', border: 'none', borderRadius: 3, background: '#8b5cf6', color: '#fff', cursor: 'pointer' }}>
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
                  backgroundColor: editingField === m.name ? '#f5f3ff' : selectedMeass.includes(m.name) ? '#f0fdf4' : 'transparent',
                  borderLeft: editingField === m.name ? '3px solid #8b5cf6' : selectedMeass.includes(m.name) ? '3px solid #16a34a' : '3px solid transparent',
                }}
              >
                <span style={dragHandle}>⠿</span>
                <span style={{ flex: 1, fontSize: 12 }}>{m.label || m.column}</span>
                <span style={m.aggregation === 'custom' ? customTag : measTag}>
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
            <div style={{ fontSize: 11, fontWeight: 600, color: '#8b5cf6', marginBottom: 6 }}>
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

      {/* Dimensions grouped by table — 75% */}
      {model.dimensions?.length > 0 && (
        <FieldSection label="Dimensions" style={{ flex: '1 1 75%' }}>
          <div style={listBoxLarge}>
            {(() => {
              // Group dimensions by table
              const groups = {};
              for (const d of model.dimensions) {
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
                          setDimEditForm({ label: d.label || d.column });
                          setEditingField(null); // close measure edit if open
                        }
                      }}
                      title={`${d.table}.${d.column}`}
                      style={{
                        ...dragItem,
                        paddingLeft: 12,
                        backgroundColor: editingDim === d.name ? '#eff6ff' : selectedDims.includes(d.name) ? '#eff6ff' : 'transparent',
                        borderLeft: editingDim === d.name ? '3px solid #3b82f6' : selectedDims.includes(d.name) ? '3px solid #3b82f6' : '3px solid transparent',
                      }}
                    >
                      <span style={dragHandle}>⠿</span>
                      <span style={{ flex: 1, fontSize: 12 }}>{d.label || d.column}</span>
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
            <div style={{ fontSize: 11, fontWeight: 600, color: '#3b82f6', marginBottom: 6 }}>
              Edit: {d.label || d.column}
            </div>
            <div style={editRow}>
              <span style={editLabel}>Label</span>
              <input type="text" value={dimEditForm.label}
                onChange={(e) => setDimEditForm({ ...dimEditForm, label: e.target.value })}
                style={editInput} />
            </div>
            <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', marginTop: 6 }}>
              <button onClick={() => setEditingDim(null)} style={editCancelBtn}>Close</button>
              <button onClick={async () => {
                try {
                  const newDimensions = (model.dimensions || []).map((x) => x.name === d.name
                    ? { ...x, label: dimEditForm.label }
                    : x);
                  await api.put(`/models/${model.id}`, { dimensions: newDimensions });
                  if (onModelUpdate) onModelUpdate();
                  setEditingDim(null);
                } catch (err) { console.error(err); }
              }} style={{ ...editSaveBtn, background: '#3b82f6' }}>Save</button>
            </div>
          </div>
        );
      })()}

      {model.dimensions?.length === 0 && model.measures?.length === 0 && (
        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
          This model has no dimensions or measures defined yet.
        </div>
      )}

      {status && (
        <div style={{ fontSize: 11, marginTop: 4, color: status.type === 'error' ? '#dc2626' : '#16a34a' }}>
          {status.type === 'error' ? `Error: ${status.message}` : status.message}
        </div>
      )}

      {!widgetId && (
        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 8 }}>Drag fields onto the widget config panel.</div>
      )}
    </div>
  );
}

function FieldSection({ label, children, style }) {
  return (
    <div style={{ marginBottom: 8, display: 'flex', flexDirection: 'column', minHeight: 0, ...style }}>
      <label style={{ display: 'block', fontSize: 12, color: '#64748b', marginBottom: 3, fontWeight: 500, flexShrink: 0 }}>{label}</label>
      {children}
    </div>
  );
}

const sectionTitle = {
  fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 0,
};
const loadingDot = {
  width: 8, height: 8, borderRadius: '50%', background: '#3b82f6',
  animation: 'pulse 1s infinite',
};
const listBox = {
  flex: 1, overflow: 'auto', border: '1px solid #e2e8f0', borderRadius: 4, minHeight: 0,
};
const listBoxLarge = {
  flex: 1, overflow: 'auto', border: '1px solid #e2e8f0', borderRadius: 4, minHeight: 0,
};
const tableGroupHeader = {
  fontSize: 10, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase',
  padding: '5px 6px 2px', backgroundColor: '#f8fafc', borderBottom: '1px solid #f1f5f9',
  position: 'sticky', top: 0, zIndex: 1,
};
const dragItem = {
  display: 'flex', alignItems: 'center', gap: 4, padding: '4px 6px',
  cursor: 'grab', userSelect: 'none', borderBottom: '1px solid #f8fafc',
};
const dragHandle = {
  fontSize: 10, color: '#cbd5e1', cursor: 'grab',
};
const dimTag = {
  fontSize: 9, padding: '1px 5px', borderRadius: 3, background: '#eff6ff', color: '#3b82f6', fontWeight: 600,
};
const measTag = {
  fontSize: 9, padding: '1px 5px', borderRadius: 3, background: '#f0fdf4', color: '#16a34a', fontWeight: 600,
};
const customTag = {
  fontSize: 9, padding: '1px 5px', borderRadius: 3, background: '#f5f3ff', color: '#8b5cf6', fontWeight: 700,
};
const editPanelStyle = {
  padding: 8, background: '#fafafe', borderBottom: '1px solid #e2e8f0',
};
const editRow = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5,
};
const editLabel = {
  fontSize: 10, color: '#64748b', fontWeight: 500,
};
const editInput = {
  padding: '3px 6px', border: '1px solid #e2e8f0', borderRadius: 3,
  fontSize: 11, outline: 'none', boxSizing: 'border-box',
};
const editCancelBtn = {
  fontSize: 10, padding: '2px 8px', border: '1px solid #e2e8f0', borderRadius: 3,
  background: '#fff', cursor: 'pointer', color: '#64748b',
};
const editSaveBtn = {
  fontSize: 10, fontWeight: 600, padding: '2px 8px', border: 'none', borderRadius: 3,
  background: '#8b5cf6', color: '#fff', cursor: 'pointer',
};
const addCalcBtnSmall = {
  fontSize: 10, fontWeight: 600, padding: '1px 6px', border: '1px solid #8b5cf6',
  borderRadius: 3, background: '#f5f3ff', color: '#8b5cf6', cursor: 'pointer',
};
const calcInputStyle = {
  width: '100%', padding: '4px 6px', border: '1px solid #ddd6fe', borderRadius: 3,
  fontSize: 11, outline: 'none', boxSizing: 'border-box',
};
