import { useState, useRef } from 'react';
import { TbArrowsSort, TbSortAscending, TbSortDescending, TbClock } from 'react-icons/tb';
import { TIME_PRESETS, TP_SHORT, parseTimeVariant } from '../../utils/timeIntelligence';

const _hs0 = { marginBottom: 10 };
const _hs1 = { fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 };
const _hs2 = { height: 2, background: 'var(--accent-primary)', borderRadius: 1, marginBottom: 2 };
const _hs3 = { fontSize: 9, color: 'var(--text-disabled)', marginRight: 2 };
const _hs4 = {
                      fontSize: 8, fontWeight: 700, textTransform: 'uppercase',
                      color: 'var(--state-success)', cursor: 'pointer', marginRight: 2,
                      padding: '0 3px', borderRadius: 2, background: 'var(--state-success-soft)',
                      flexShrink: 0, lineHeight: '14px', position: 'relative',
                    };
const _hs5 = { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const _hs6 = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 14, height: 14, borderRadius: '50%', background: 'var(--state-danger)', color: 'var(--bg-panel)', fontSize: 9, fontWeight: 700, flexShrink: 0 };
const _hs7 = {
                  display: 'flex', flexWrap: 'wrap', gap: 2, padding: '3px 4px', background: 'var(--bg-subtle)',
                  borderRadius: 4, border: '1px solid var(--border-default)', marginTop: 2,
                };
const _hs8 = { height: 2, background: 'var(--accent-primary)', borderRadius: 1 };
const _hs9 = { fontSize: 11, color: 'var(--text-disabled)', padding: '4px 6px', pointerEvents: 'none' };
const _hs10 = {
            display: 'flex', justifyContent: 'flex-end', gap: 2,
            marginTop: 4, paddingTop: 4, borderTop: '1px dashed var(--border-default)',
          };
const _hs11 = { fontSize: 9, color: 'var(--text-disabled)', alignSelf: 'center', marginRight: 4, textTransform: 'uppercase', fontWeight: 600 };

// Time-variant badges: preset tag on variant chips, clock affordance on
// base measure chips.
const _tpBadge = {
  fontSize: 8, fontWeight: 700, textTransform: 'uppercase',
  color: 'var(--accent-primary)', cursor: 'pointer', marginRight: 2,
  padding: '0 3px', borderRadius: 2, background: 'var(--accent-primary-soft)',
  flexShrink: 0, lineHeight: '14px',
};
const _tpAdd = {
  display: 'inline-flex', alignItems: 'center', color: 'var(--text-disabled)',
  cursor: 'pointer', marginRight: 2, flexShrink: 0,
};

const AGG_OPTIONS = [
  { value: 'sum', label: 'Sum' },
  { value: 'avg', label: 'Avg' },
  { value: 'count', label: 'Count' },
  { value: 'min', label: 'Min' },
  { value: 'max', label: 'Max' },
];

const SORT_OPTIONS = [
  { value: 'none', icon: TbArrowsSort, title: 'No sort' },
  { value: 'asc', icon: TbSortAscending, title: 'Ascending' },
  { value: 'desc', icon: TbSortDescending, title: 'Descending' },
];

export default function DropZone({ label, accepts, fields, onDrop, onRemove, onReorder, multiple = false, fieldInfos = {}, dimensionNames, zoneName, measureInfos, onAggChange, onTimeVariant, sort, onSortChange }) {
  const [dragIdx, setDragIdx] = useState(null);
  const [dropIdx, setDropIdx] = useState(null);
  const dropIdxRef = useRef(null);
  const [aggMenuField, setAggMenuField] = useState(null);
  const [tpMenuField, setTpMenuField] = useState(null);

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

  // A time-variant chip ("<base>@@tp:<preset>") borrows its base measure's
  // info — the preset badge is what tells them apart.
  const infoFor = (f) => {
    if (fieldInfos[f]) return fieldInfos[f];
    const v = parseTimeVariant(f);
    return v ? fieldInfos[v.base] : undefined;
  };

  const getDisplayName = (f) => {
    // Prefer the dim/measure's user-facing label when it's set — date-part
    // siblings (Month Name vs Month Number, etc.) share the same parent
    // column so falling back to "table.column" would make them look
    // identical in the dropped pill. Labels disambiguate them clearly.
    const info = infoFor(f);
    if (info?.label) return info.label;
    const v = parseTimeVariant(f);
    const p = (v ? v.base : f).split('.');
    return p[p.length - 1].replace(/_sum$|_avg$|_count$|_min$|_max$/, '');
  };

  const getTooltip = (f) => {
    const info = infoFor(f);
    if (!info) return f;
    // Show both the human label (when present) and the underlying
    // qualified column so the user can distinguish siblings even on hover.
    const qualified = `${info.table}.${info.column}`;
    return info.label && info.label !== qualified ? `${info.label} — ${qualified}` : qualified;
  };

  const draggedField = dragIdx != null ? fields[dragIdx] : null;

  // Single-field zone already occupied → any external drop is a replace, not an insert.
  // Suppress position bars and highlight the whole zone instead.
  const isReplaceMode = !multiple && fields.length > 0;
  const isHovering = dropIdx != null;

  return (
    <div style={_hs0}>
      <div style={_hs1}>{label}</div>
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
          border: isHovering ? '2px dashed var(--accent-primary)' : '1px dashed var(--border-strong)',
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
          const variant = !isDim ? parseTimeVariant(field) : null;
          const missing = Object.keys(fieldInfos).length > 0 && !infoFor(field);
          const isDragging = draggedField === field;
          const showBar = !isReplaceMode && dropIdx === i && !(isDragging && (dragIdx === i || dragIdx === i - 1));
          const willBeReplaced = isReplaceMode && isHovering;
          return (
            <div key={field} draggable
              onDragStart={(e) => startItemDrag(e, i)}
              onDragEnd={endItemDrag}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDrop(i); }}
            >
              {showBar && <div style={_hs2} />}
              <span title={missing ? undefined : getTooltip(field)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 3,
                  fontSize: 11, padding: '3px 6px', borderRadius: 4,
                  background: missing ? 'var(--state-danger-soft)' : isDim ? 'var(--bg-active)' : 'var(--state-success-soft)',
                  color: missing ? 'var(--state-danger)' : isDim ? 'var(--accent-primary)' : 'var(--state-success)',
                  fontWeight: 500, opacity: isDragging ? 0.4 : willBeReplaced ? 0.45 : 1,
                  cursor: 'grab', userSelect: 'none',
                  textDecoration: willBeReplaced ? 'line-through' : 'none',
                }}
              >
                <span style={_hs3}>⠿</span>
                {/* Aggregation badge for measures (variants inherit the base's) */}
                {!isDim && !variant && measureInfos?.[field] && measureInfos[field].aggregation !== 'custom' && onAggChange && (
                  <span
                    onClick={(e) => { e.stopPropagation(); setAggMenuField(aggMenuField === field ? null : field); }}
                    style={_hs4}
                    title="Click to change aggregation"
                  >
                    {measureInfos[field].aggregation || 'sum'}
                  </span>
                )}
                {/* Time-variant badge: the preset on variant chips, a clock
                    on base measures to spawn a windowed copy. */}
                {!isDim && variant && onTimeVariant && (
                  <span
                    onClick={(e) => { e.stopPropagation(); setTpMenuField(tpMenuField === field ? null : field); }}
                    style={_tpBadge}
                    title="Time period of this copy — click to change or remove"
                  >
                    {TP_SHORT[variant.preset] || variant.preset}
                  </span>
                )}
                {!isDim && !variant && !missing && onTimeVariant && (
                  <span
                    onClick={(e) => { e.stopPropagation(); setTpMenuField(tpMenuField === field ? null : field); }}
                    style={_tpAdd}
                    title="Add a time-windowed copy (YTD, last 30 days...)"
                  >
                    <TbClock size={10} />
                  </span>
                )}
                <span style={_hs5}>{getDisplayName(field)}</span>
                {missing && <span title="This field no longer exists in the data model" style={_hs6}>!</span>}
                <button onClick={() => onRemove(field)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: missing ? 'var(--state-danger)' : 'var(--text-disabled)', fontSize: 12, padding: 0, lineHeight: 1, flexShrink: 0 }}>×</button>
              </span>
              {/* Time-period preset menu (add on base / retarget on variant) */}
              {tpMenuField === field && (
                <div style={_hs7}>
                  {TIME_PRESETS.map((pz) => (
                    <button key={pz.key}
                      onClick={(e) => { e.stopPropagation(); onTimeVariant(field, pz.key); setTpMenuField(null); }}
                      title={pz.label}
                      style={{
                        fontSize: 9, fontWeight: 600, padding: '2px 6px', borderRadius: 3,
                        border: 'none', cursor: 'pointer',
                        background: variant?.preset === pz.key ? 'var(--accent-primary)' : 'var(--bg-panel)',
                        color: variant?.preset === pz.key ? '#fff' : 'var(--text-secondary)',
                      }}
                    >{TP_SHORT[pz.key] || pz.key}</button>
                  ))}
                  {variant && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onTimeVariant(field, null); setTpMenuField(null); }}
                      style={{
                        fontSize: 9, fontWeight: 600, padding: '2px 6px', borderRadius: 3,
                        border: 'none', cursor: 'pointer',
                        background: 'var(--state-danger-soft)', color: 'var(--state-danger)',
                      }}
                    >Remove</button>
                  )}
                </div>
              )}
              {/* Aggregation dropdown menu */}
              {aggMenuField === field && (
                <div style={_hs7}>
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
          <div style={_hs8} />
        )}
        {/* Empty zone placeholder */}
        {fields.length === 0 && dropIdx == null && (
          <span style={_hs9}>
            Drop {accepts?.includes('dimension') && accepts?.includes('measure') ? 'fields' : accepts?.includes('dimension') ? 'dimension' : 'measure'} here
          </span>
        )}
        {/* Per-zone sort controls. Only rendered when the parent provides a
            handler — this keeps non-sortable zones (filters, etc.) clean. */}
        {typeof onSortChange === 'function' && fields.length > 0 && (
          <div style={_hs10}>
            <span style={_hs11}>Sort</span>
            {SORT_OPTIONS.map((opt) => {
              const Icon = opt.icon;
              const active = (sort || 'none') === opt.value;
              return (
                <button key={opt.value} type="button" title={opt.title}
                  onClick={() => onSortChange(opt.value)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    width: 20, height: 18, padding: 0, border: 'none', borderRadius: 3, cursor: 'pointer',
                    background: active ? 'var(--accent-primary)' : 'transparent',
                    color: active ? '#fff' : 'var(--text-muted)',
                  }}>
                  <Icon size={12} />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
