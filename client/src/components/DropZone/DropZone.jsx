import { useState } from 'react';

export default function DropZone({ label, accepts, fields, onDrop, onRemove, multiple = false, fieldInfos = {} }) {
  const [dragOver, setDragOver] = useState(false);

  const handleDragOver = (e) => {
    e.preventDefault();
    const fieldType = e.dataTransfer.types.includes('application/field-type') ? 'ok' : null;
    if (fieldType) {
      e.dataTransfer.dropEffect = 'copy';
      setDragOver(true);
    }
  };

  const handleDragLeave = () => setDragOver(false);

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const fieldName = e.dataTransfer.getData('application/field-name');
    const fieldType = e.dataTransfer.getData('application/field-type');

    if (!fieldName) return;
    if (accepts && !accepts.includes(fieldType)) return;
    if (fields.includes(fieldName)) return;

    onDrop(fieldName, fieldType);
  };

  // Get display name from field name (remove table prefix)
  const getDisplayName = (field) => {
    const parts = field.split('.');
    const col = parts[parts.length - 1].replace(/_sum$|_avg$|_count$|_min$|_max$/, '');
    return col;
  };

  // Get tooltip from fieldInfos or field name
  const getTooltip = (field) => {
    const info = fieldInfos[field];
    if (info) return `${info.table}.${info.column}`;
    return field;
  };

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, marginBottom: 4 }}>{label}</div>
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        style={{
          minHeight: 32,
          border: dragOver ? '2px dashed #3b82f6' : '1px dashed #cbd5e1',
          borderRadius: 6,
          padding: 4,
          backgroundColor: dragOver ? '#eff6ff' : '#fafafa',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 4,
          alignItems: 'center',
          transition: 'all 0.15s',
        }}
      >
        {fields.length === 0 && (
          <span style={{ fontSize: 11, color: '#94a3b8', padding: '2px 6px' }}>
            Drop {accepts?.includes('dimension') && accepts?.includes('measure') ? 'fields' : accepts?.includes('dimension') ? 'dimension' : 'measure'} here
          </span>
        )}
        {fields.map((field) => {
          const isDim = accepts?.includes('dimension');
          const missing = Object.keys(fieldInfos).length > 0 && !fieldInfos[field];
          return (
            <span
              key={field}
              title={missing ? undefined : getTooltip(field)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 3,
                fontSize: 11, padding: '2px 6px', borderRadius: 4,
                background: missing ? '#fef2f2' : isDim ? '#eff6ff' : '#f0fdf4',
                color: missing ? '#dc2626' : isDim ? '#3b82f6' : '#16a34a',
                fontWeight: 500,
              }}
            >
              {getDisplayName(field)}
              {missing && (
                <span
                  title="Ce champ n'existe plus dans le modèle de données"
                  style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    width: 14, height: 14, borderRadius: '50%',
                    background: '#dc2626', color: '#fff',
                    fontSize: 9, fontWeight: 700, cursor: 'help',
                  }}
                >!</span>
              )}
              <button
                onClick={() => onRemove(field)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: missing ? '#dc2626' : '#94a3b8', fontSize: 12, padding: 0, lineHeight: 1,
                }}
              >
                ×
              </button>
            </span>
          );
        })}
      </div>
    </div>
  );
}
