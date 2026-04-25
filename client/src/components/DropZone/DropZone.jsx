import { useState, useRef } from 'react';

const AGG_OPTIONS = [
  { value: 'sum', label: 'Sum' },
  { value: 'avg', label: 'Avg' },
  { value: 'count', label: 'Count' },
  { value: 'min', label: 'Min' },
  { value: 'max', label: 'Max' },
];

export default function DropZone({ label, accepts, fields, onDrop, onRemove, onReorder, multiple = false, fieldInfos = {}, dimensionNames, zoneName, measureInfos, onAggChange }) {
  const [dragIdx, setDragIdx] = useState(null);
  const [dropIdx, setDropIdx] = useState(null);
  const dropIdxRef = useRef(null);
  const [aggMenuField, setAggMenuField] = useState(null);

  const setDrop = (v) => { setDropIdx(v); dropIdxRef.current = v; };

  const handleDrop = (e) => {
    e.preventDefault();
    const idx = dropIdxRef.current;
    setDrop(null);
    setDragIdx(null);

    const fieldName = e.dataTransfer.getData('application/field-name');
    const fieldType = e.dataTransfer.getData('application/field-type');
    const sourceZone = e.dataTransfer.getData('application/source-zone');
    if (!fieldName) return;

    // Internal reorder: source zone is this zone
    if (sourceZone === zoneName && fields.includes(fieldName) && onReorder) {
      const from = fields.indexOf(fieldName);
      const to = idx != null ? idx : fields.length;
      if (from !== to && from !== to - 1) {
        const arr = [...fields];
        const [moved] = arr.splice(from, 1);
        arr.splice(to > from ? to - 1 : to, 0, moved);
        onReorder(arr);
      }
      return;
    }

    // External / cross-zone drop
    if (fields.includes(fieldName)) return;
    if (accepts && !accepts.includes(fieldType)) return;
    // Single-field zone with an existing field: signal "replace" so the parent does an atomic swap
    // (calling onRemove + onDrop separately would race because both updates read stale React state).
    const replace = !multiple && fields.length > 0;
    onDrop(fieldName, fieldType, sourceZone || null, idx, replace);
  };

  const startItemDrag = (e, i) => {
    e.stopPropagation();
    setDragIdx(i);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', '');
    const field = fields[i];
    const isDim = dimensionNames ? dimensionNames.has(field) : accepts?.includes('dimension');
    e.dataTransfer.setData('application/field-name', field);
    e.dataTransfer.setData('application/field-type', isDim ? 'dimension' : 'measure');
    if (zoneName) e.dataTransfer.setData('application/source-zone', zoneName);
  };

  const endItemDrag = () => {
    setDragIdx(null);
    setDrop(null);
  };

  const getDisplayName = (f) => {
    const p = f.split('.');
    return p[p.length - 1].replace(/_sum$|_avg$|_count$|_min$|_max$/, '');
  };

  const getTooltip = (f) => {
    const info = fieldInfos[f];
    return info ? `${info.table}.${info.column}` : f;
  };

  // Detect if the current drag is from this zone (for visual only)
  const draggedField = dragIdx != null ? fields[dragIdx] : null;

  // Single-field zone already occupied → any external drop is a replace, not an insert.
  // Suppress position bars and highlight the whole zone instead.
  const isReplaceMode = !multiple && fields.length > 0;
  const isHovering = dropIdx != null;

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>{label}</div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          setDrop(fields.length);
        }}
        onDragLeave={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          if (e.clientX <= rect.left || e.clientX >= rect.right || e.clientY <= rect.top || e.clientY >= rect.bottom) {
            setDrop(null);
          }
        }}
        onDrop={handleDrop}
        style={{
          minHeight: 36,
          border: isHovering ? '2px dashed #7c3aed' : '1px dashed #cbd5e1',
          borderRadius: 6,
          padding: 4,
          backgroundColor: isHovering ? 'var(--bg-active)' : 'var(--bg-subtle)',
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}
      >
        {fields.map((field, i) => {
          const isDim = dimensionNames ? dimensionNames.has(field) : accepts?.includes('dimension');
          const missing = Object.keys(fieldInfos).length > 0 && !fieldInfos[field];
          const isDragging = draggedField === field;
          const showBar = !isReplaceMode && dropIdx === i && !(isDragging && (dragIdx === i || dragIdx === i - 1));
          const willBeReplaced = isReplaceMode && isHovering;
          return (
            <div key={field} draggable
              onDragStart={(e) => startItemDrag(e, i)}
              onDragEnd={endItemDrag}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDrop(i); }}
            >
              {showBar && <div style={{ height: 2, background: 'var(--accent-primary)', borderRadius: 1, marginBottom: 2 }} />}
              <span title={missing ? undefined : getTooltip(field)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 3,
                  fontSize: 11, padding: '3px 6px', borderRadius: 4,
                  background: missing ? 'var(--state-danger-soft)' : isDim ? 'var(--bg-active)' : 'var(--state-success-soft)',
                  color: missing ? 'var(--state-danger)' : isDim ? 'var(--accent-primary)' : '#16a34a',
                  fontWeight: 500, opacity: isDragging ? 0.4 : willBeReplaced ? 0.45 : 1,
                  cursor: 'grab', userSelect: 'none',
                  textDecoration: willBeReplaced ? 'line-through' : 'none',
                }}
              >
                <span style={{ fontSize: 9, color: 'var(--text-disabled)', marginRight: 2 }}>⠿</span>
                {/* Aggregation badge for measures */}
                {!isDim && measureInfos?.[field] && measureInfos[field].aggregation !== 'custom' && onAggChange && (
                  <span
                    onClick={(e) => { e.stopPropagation(); setAggMenuField(aggMenuField === field ? null : field); }}
                    style={{
                      fontSize: 8, fontWeight: 700, textTransform: 'uppercase',
                      color: 'var(--state-success)', cursor: 'pointer', marginRight: 2,
                      padding: '0 3px', borderRadius: 2, background: 'var(--state-success-soft)',
                      flexShrink: 0, lineHeight: '14px', position: 'relative',
                    }}
                    title="Click to change aggregation"
                  >
                    {measureInfos[field].aggregation || 'sum'}
                  </span>
                )}
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{getDisplayName(field)}</span>
                {missing && <span title="This field no longer exists in the data model" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 14, height: 14, borderRadius: '50%', background: 'var(--state-danger)', color: 'var(--bg-panel)', fontSize: 9, fontWeight: 700, flexShrink: 0 }}>!</span>}
                <button onClick={() => onRemove(field)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: missing ? 'var(--state-danger)' : 'var(--text-disabled)', fontSize: 12, padding: 0, lineHeight: 1, flexShrink: 0 }}>×</button>
              </span>
              {/* Aggregation dropdown menu */}
              {aggMenuField === field && (
                <div style={{
                  display: 'flex', flexWrap: 'wrap', gap: 2, padding: '3px 4px', background: 'var(--bg-subtle)',
                  borderRadius: 4, border: '1px solid var(--border-default)', marginTop: 2,
                }}>
                  {AGG_OPTIONS.map((opt) => (
                    <button key={opt.value}
                      onClick={(e) => { e.stopPropagation(); onAggChange(field, opt.value); setAggMenuField(null); }}
                      style={{
                        fontSize: 9, fontWeight: 600, padding: '2px 6px', borderRadius: 3,
                        border: 'none', cursor: 'pointer',
                        background: measureInfos[field]?.aggregation === opt.value ? 'var(--accent-primary)' : 'var(--bg-panel)',
                        color: measureInfos[field]?.aggregation === opt.value ? '#fff' : 'var(--text-secondary)',
                      }}
                    >{opt.label}</button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {/* Drop indicator at end */}
        {!isReplaceMode && dropIdx === fields.length && !(draggedField && dragIdx === fields.length - 1) && (
          <div style={{ height: 2, background: 'var(--accent-primary)', borderRadius: 1 }} />
        )}
        {/* Empty zone placeholder */}
        {fields.length === 0 && dropIdx == null && (
          <span style={{ fontSize: 11, color: 'var(--text-disabled)', padding: '4px 6px', pointerEvents: 'none' }}>
            Drop {accepts?.includes('dimension') && accepts?.includes('measure') ? 'fields' : accepts?.includes('dimension') ? 'dimension' : 'measure'} here
          </span>
        )}
      </div>
    </div>
  );
}
