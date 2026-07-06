import { useRef } from 'react';
import DimensionMultiSelect from '../PropertyPanel/DimensionMultiSelect';

const _hs0 = { display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 };
const _hs1 = { background: 'transparent', border: 'none', cursor: 'pointer', padding: '0 4px', color: 'var(--text-disabled)', fontSize: 14, lineHeight: 1 };
const _hs2 = { display: 'flex', flexDirection: 'column', gap: 4 };
const _hs3 = { display: 'flex', gap: 4 };

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
  const numericOps = [];
  // is in / is not in only for numeric dimensions — measures are aggregates,
  // and DimensionMultiSelect can't enumerate their possible values.
  if (!isMeasure) {
    numericOps.push({ v: 'in', l: 'is in' }, { v: 'not_in', l: 'is not in' });
  }
  numericOps.push(
    { v: 'gt', l: '>' }, { v: 'gte', l: '≥' },
    { v: 'lt', l: '<' }, { v: 'lte', l: '≤' },
    { v: 'between', l: 'between' },
  );
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
  // Ref mirror of the latest rules array. Lets updateRule read the CURRENT
  // rule slot at call time rather than the snapshot the inline handler closed
  // over at render. Matters for between-date inputs: picking From then To
  // before the parent re-renders would otherwise have the second update
  // clobber the first (each call computing its patch from the same stale wf).
  const wfRef = useRef(wf);
  wfRef.current = wf;
  // updateRule accepts either an object patch or a function `(currentRule)
  // => patch`. The function form is what the between-date inputs use so each
  // input can compute its patch from the LATEST sibling slot value rather
  // than a closure-captured one.
  const updateRule = (idx, patchOrFn) => {
    const arr = wfRef.current;
    const next = [...arr];
    const cur = next[idx] || {};
    const patch = typeof patchOrFn === 'function' ? patchOrFn(cur) : patchOrFn;
    next[idx] = { ...cur, ...patch };
    onChange(next);
  };
  const removeRule = (idx) => onChange(wfRef.current.filter((_, i) => i !== idx));

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

  if (wf.length === 0) return null;

  return (
    <div>
      {wf.map((f, i) => {
        const t = fieldType(model, f);
        const ops = opsForType(t, !!f.isMeasure);
        const isBetween = f.op === 'between';
        const isTopBottom = f.op === 'top_n' || f.op === 'bottom_n';
        const inputType = (t === 'date') ? 'date' : (t === 'number' ? 'number' : 'text');
        // Prefer the human label (model.dimensions[].label / measures[].label)
        // when defined; otherwise fall back to the last dotted segment of the
        // canonical field id ("schema.table.column" → "column"). The full id
        // is kept in the `title` so a hover reveals the path. Avoids the
        // truncated "nyukom_app…" the user couldn't read in the narrow card.
        const def = f.isMeasure
          ? (model?.measures || []).find((m) => m.name === f.field)
          : (model?.dimensions || []).find((d) => d.name === f.field);
        const displayName = def?.label
          || (typeof f.field === 'string' ? f.field.split('.').pop() : String(f.field));
        // Same colour key as the DropZone chips so the field stays visually
        // tied to its kind in every panel: measures green (#16a34a), dims
        // accent-primary. The "measure" / "dimension" word becomes redundant
        // once the colour carries that signal, so it goes — the field name
        // gets the full row width back.
        const fieldColor = f.isMeasure ? '#16a34a' : 'var(--accent-primary)';
        return (
          <div key={i} style={cardStyle}>
            <div style={_hs0}>
              <span
                title={f.field}
                style={{ fontSize: 12, fontWeight: 600, color: fieldColor, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}
              >
                {displayName}
              </span>
              <button onClick={() => removeRule(i)} title="Remove filter"
                style={_hs1}
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
            {isBetween && t === 'date' && (
              // Native <input type="date"> ignores `placeholder` and has a
              // ~150 px minimum usable width (the calendar icon needs room).
              // Two side-by-side flex inputs in the narrow PropertyPanel get
              // squeezed below that threshold → the calendar widget renders
              // broken. Stack vertically with visible From / To labels.
              //
              // Each handler uses the FUNCTION form of updateRule so it reads
              // the sibling slot from the LATEST committed rule (via wfRef)
              // rather than a stale closure — picking From then To in quick
              // succession otherwise risks the To onChange clobbering the
              // From update because both handlers captured the same `f`.
              <div style={_hs2}>
                <div>
                  <div style={{ ...labelStyle, marginBottom: 2 }}>From</div>
                  <input type="date" value={(f.values || [])[0] ?? ''}
                    onChange={(e) => {
                      const v = e.target.value;
                      updateRule(i, (cur) => ({ values: [v, (cur?.values || [])[1] ?? ''] }));
                    }}
                    style={{ ...inputStyle, marginBottom: 0 }} />
                </div>
                <div>
                  <div style={{ ...labelStyle, marginBottom: 2 }}>To</div>
                  <input type="date" value={(f.values || [])[1] ?? ''}
                    onChange={(e) => {
                      const v = e.target.value;
                      updateRule(i, (cur) => ({ values: [(cur?.values || [])[0] ?? '', v] }));
                    }}
                    style={{ ...inputStyle, marginBottom: 0 }} />
                </div>
              </div>
            )}
            {isBetween && t !== 'date' && (
              <div style={_hs3}>
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
