import DimensionMultiSelect from '../PropertyPanel/DimensionMultiSelect';

const VALUELESS_OPS = new Set(['is_empty', 'is_not_empty']);
const LIST_OPS = new Set(['in', 'not_in']);

function fieldType(model, f) {
  if (f.isMeasure) return 'number';
  const d = (model?.dimensions || []).find((dim) => dim.name === f.field);
  return d?.type || 'string';
}

function opsForType(t, isMeasure) {
  if (t === 'string') return [
    { v: 'in', l: 'is in' }, { v: 'not_in', l: 'is not in' },
    { v: 'contains', l: 'contains' }, { v: 'not_contains', l: 'does not contain' },
    { v: 'starts_with', l: 'starts with' }, { v: 'ends_with', l: 'ends with' },
    { v: 'is_empty', l: 'is empty' }, { v: 'is_not_empty', l: 'is not empty' },
  ];
  if (t === 'date') return [
    { v: 'between', l: 'between' },
    { v: 'gte', l: 'on or after' }, { v: 'lte', l: 'on or before' },
  ];
  // number / measure
  const numericOps = [
    { v: 'gt', l: '>' }, { v: 'gte', l: '≥' },
    { v: 'lt', l: '<' }, { v: 'lte', l: '≤' },
    { v: 'between', l: 'between' },
  ];
  if (isMeasure) {
    numericOps.push({ v: 'top_n', l: 'Top N' });
    numericOps.push({ v: 'bottom_n', l: 'Bottom N' });
  }
  return numericOps;
}

/**
 * Renders the list of filter rule cards used by both the per-widget Filters
 * section and the Settings report-level filters section. Behaviour is
 * identical — only the storage location differs.
 */
export default function FilterRulesEditor({ model, modelId, rules, onChange, styles }) {
  const wf = Array.isArray(rules) ? rules : [];
  const updateRule = (idx, patch) => {
    const next = [...wf];
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  };
  const removeRule = (idx) => onChange(wf.filter((_, i) => i !== idx));

  const inputStyle = styles?.inputStyle || {
    width: '100%', padding: '8px 10px', border: '1px solid var(--border-default)',
    borderRadius: 6, fontSize: 14, outline: 'none', boxSizing: 'border-box',
  };
  const cardStyle = styles?.cardStyle || {
    padding: '8px', marginBottom: 6,
    border: '1px solid var(--border-default)', borderRadius: 6,
    background: 'var(--bg-panel)',
  };
  const labelStyle = styles?.labelStyle || {
    fontSize: 11, color: 'var(--text-secondary)', fontWeight: 500,
  };

  if (wf.length === 0) {
    return (
      <div style={{ fontSize: 11, color: 'var(--text-disabled)', fontStyle: 'italic', marginTop: 6 }}>
        No filter yet — drop a dimension or measure above.
      </div>
    );
  }

  return (
    <div>
      {wf.map((f, i) => {
        const t = fieldType(model, f);
        const ops = opsForType(t, !!f.isMeasure);
        const isBetween = f.op === 'between';
        const isTopBottom = f.op === 'top_n' || f.op === 'bottom_n';
        const inputType = (t === 'date') ? 'date' : (t === 'number' ? 'number' : 'text');
        return (
          <div key={i} style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
                {f.field}
              </span>
              <span style={{ fontSize: 9, color: 'var(--text-disabled)', textTransform: 'uppercase' }}>
                {f.isMeasure ? 'measure' : t}
              </span>
              <button onClick={() => removeRule(i)} title="Remove filter"
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '0 4px', color: 'var(--text-disabled)', fontSize: 14, lineHeight: 1 }}
                onMouseEnter={(e) => e.currentTarget.style.color = 'var(--state-danger)'}
                onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-disabled)'}>
                ×
              </button>
            </div>
            <select value={f.op} onChange={(e) => updateRule(i, { op: e.target.value })}
              style={{ ...inputStyle, marginBottom: 4, padding: '4px 6px' }}>
              {ops.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
            </select>
            {!VALUELESS_OPS.has(f.op) && !LIST_OPS.has(f.op) && !isBetween && !isTopBottom && (
              <input type={inputType} value={f.value ?? ''}
                onChange={(e) => updateRule(i, { value: e.target.value })}
                style={{ ...inputStyle, marginBottom: 0 }} placeholder="Value" />
            )}
            {isTopBottom && (
              <input type="number" min={1} value={f.value ?? ''}
                onChange={(e) => updateRule(i, { value: e.target.value })}
                style={{ ...inputStyle, marginBottom: 0 }} placeholder="N (e.g. 10)" />
            )}
            {LIST_OPS.has(f.op) && (
              <DimensionMultiSelect
                modelId={modelId}
                fieldName={f.field}
                selectedValues={f.values || []}
                onChange={(values) => updateRule(i, { values })}
              />
            )}
            {isBetween && (
              <div style={{ display: 'flex', gap: 4 }}>
                <input type={inputType} value={(f.values || [])[0] ?? ''}
                  onChange={(e) => updateRule(i, { values: [e.target.value, (f.values || [])[1] ?? ''] })}
                  style={{ ...inputStyle, marginBottom: 0, flex: 1, minWidth: 0 }} placeholder="From" />
                <input type={inputType} value={(f.values || [])[1] ?? ''}
                  onChange={(e) => updateRule(i, { values: [(f.values || [])[0] ?? '', e.target.value] })}
                  style={{ ...inputStyle, marginBottom: 0, flex: 1, minWidth: 0 }} placeholder="To" />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function buildDefaultFilterRule(model, fieldName, isMeasure) {
  const fType = isMeasure ? 'number'
    : (model?.dimensions || []).find((d) => d.name === fieldName)?.type || 'string';
  const defaultOp = (fType === 'string') ? 'in' : (fType === 'date') ? 'between' : 'gt';
  return { field: fieldName, isMeasure, op: defaultOp, value: '', values: [] };
}
