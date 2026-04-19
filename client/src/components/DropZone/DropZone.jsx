import { useState, useRef } from 'react';

export default function DropZone({ label, accepts, fields, onDrop, onRemove, onReorder, multiple = false, fieldInfos = {}, dimensionNames, zoneName }) {
  const [dragIdx, setDragIdx] = useState(null);
  const [dropIdx, setDropIdx] = useState(null);
  const dropIdxRef = useRef(null);

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
    onDrop(fieldName, fieldType, sourceZone || null, idx);
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

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, marginBottom: 4 }}>{label}</div>
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
          border: dropIdx != null ? '2px dashed #3b82f6' : '1px dashed #cbd5e1',
          borderRadius: 6,
          padding: 4,
          backgroundColor: dropIdx != null ? '#eff6ff' : '#fafafa',
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}
      >
        {fields.map((field, i) => {
          const isDim = dimensionNames ? dimensionNames.has(field) : accepts?.includes('dimension');
          const missing = Object.keys(fieldInfos).length > 0 && !fieldInfos[field];
          const isDragging = draggedField === field;
          const showBar = dropIdx === i && !(isDragging && (dragIdx === i || dragIdx === i - 1));
          return (
            <div key={field} draggable
              onDragStart={(e) => startItemDrag(e, i)}
              onDragEnd={endItemDrag}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDrop(i); }}
            >
              {showBar && <div style={{ height: 2, background: '#3b82f6', borderRadius: 1, marginBottom: 2 }} />}
              <span title={missing ? undefined : getTooltip(field)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 3,
                  fontSize: 11, padding: '3px 6px', borderRadius: 4,
                  background: missing ? '#fef2f2' : isDim ? '#eff6ff' : '#f0fdf4',
                  color: missing ? '#dc2626' : isDim ? '#3b82f6' : '#16a34a',
                  fontWeight: 500, opacity: isDragging ? 0.4 : 1,
                  cursor: 'grab', userSelect: 'none',
                }}
              >
                <span style={{ fontSize: 9, color: '#94a3b8', marginRight: 2 }}>⠿</span>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{getDisplayName(field)}</span>
                {missing && <span title="This field no longer exists in the data model" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 14, height: 14, borderRadius: '50%', background: '#dc2626', color: '#fff', fontSize: 9, fontWeight: 700, flexShrink: 0 }}>!</span>}
                <button onClick={() => onRemove(field)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: missing ? '#dc2626' : '#94a3b8', fontSize: 12, padding: 0, lineHeight: 1, flexShrink: 0 }}>×</button>
              </span>
            </div>
          );
        })}
        {/* Drop indicator at end */}
        {dropIdx === fields.length && !(draggedField && dragIdx === fields.length - 1) && (
          <div style={{ height: 2, background: '#3b82f6', borderRadius: 1 }} />
        )}
        {/* Empty zone placeholder */}
        {fields.length === 0 && dropIdx == null && (
          <span style={{ fontSize: 11, color: '#94a3b8', padding: '4px 6px', pointerEvents: 'none' }}>
            Drop {accepts?.includes('dimension') && accepts?.includes('measure') ? 'fields' : accepts?.includes('dimension') ? 'dimension' : 'measure'} here
          </span>
        )}
      </div>
    </div>
  );
}
