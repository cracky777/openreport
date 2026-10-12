// The waterfall's own settings: its closing total and the subtotals placed
// along the way (Visual section), and the colours of its three kinds of bar
// (Colors section).
import { SubSection, Field, ColorInput } from '../controls';
import { WATERFALL_COLORS } from '../../../utils/waterfall';

const rowStyle = { display: 'flex', flexDirection: 'column', gap: 4, borderBottom: '1px solid var(--border-subtle)', paddingBottom: 6, marginBottom: 6 };
const rowHead = { display: 'flex', alignItems: 'center', gap: 4 };
const smallLabel = { fontSize: 10, color: 'var(--text-disabled)' };
const deleteBtn = { marginLeft: 'auto', background: 'transparent', border: 'none', cursor: 'pointer', padding: '0 4px', color: 'var(--text-disabled)', fontSize: 14, lineHeight: 1 };
const addBtn = { marginTop: 2, padding: '5px 10px', fontSize: 11, background: 'var(--bg-subtle)', border: '1px dashed var(--border-default)', borderRadius: 6, color: 'var(--text-secondary)', cursor: 'pointer', width: '100%' };
const hint = { fontSize: 10, color: 'var(--text-disabled)', marginBottom: 6 };

// `categories`: the values the chart shows now — what a subtotal can follow.
// A subtotal kept on a category the current data lacks stays listed: it still
// places itself where that category would sort.
export function WaterfallVisualPart({ cfg, updateConfig, inputStyle, categories }) {
  const subtotals = Array.isArray(cfg.subtotals) ? cfg.subtotals : [];
  const setSubtotals = (next) => updateConfig('subtotals', next);
  const patch = (i, p) => setSubtotals(subtotals.map((s, k) => (k === i ? { ...s, ...p } : s)));
  const showTotal = cfg.showTotal ?? true;
  return (
    <>
      <Field label="Show total">
        <input type="checkbox" checked={showTotal} onChange={(e) => updateConfig('showTotal', e.target.checked)} />
      </Field>
      {showTotal && (
        <Field label="Total label" vertical>
          <input type="text" value={cfg.totalLabel ?? 'Total'} onChange={(e) => updateConfig('totalLabel', e.target.value)} style={{ ...inputStyle, marginBottom: 0 }} />
        </Field>
      )}
      <SubSection label="Subtotals">
        <div style={hint}>A bar showing the running total, placed after a category.</div>
        {subtotals.map((s, i) => {
          const options = categories.includes(s.after) || s.after == null ? categories : [s.after, ...categories];
          return (
            <div key={i} style={rowStyle}>
              <div style={rowHead}>
                <span style={smallLabel}>After</span>
                <button type="button" style={deleteBtn} title="Remove this subtotal" onClick={() => setSubtotals(subtotals.filter((_, k) => k !== i))}>×</button>
              </div>
              <select value={s.after ?? ''} onChange={(e) => patch(i, { after: e.target.value })} style={{ ...inputStyle, marginBottom: 0 }}>
                {options.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <input type="text" value={s.label || ''} placeholder="Subtotal label" onChange={(e) => patch(i, { label: e.target.value })} style={{ ...inputStyle, marginBottom: 0 }} />
            </div>
          );
        })}
        <button type="button" style={addBtn} disabled={!categories.length}
          onClick={() => setSubtotals([...subtotals, { after: categories[0], label: 'Subtotal' }])}>
          + Add subtotal
        </button>
      </SubSection>
    </>
  );
}

export function WaterfallColorsPart({ cfg, updateConfig }) {
  return (
    <>
      <Field label="Increase">
        <ColorInput value={cfg.increaseColor || WATERFALL_COLORS.increase} onChange={(v) => updateConfig('increaseColor', v)} allowTransparent={false} />
      </Field>
      <Field label="Decrease">
        <ColorInput value={cfg.decreaseColor || WATERFALL_COLORS.decrease} onChange={(v) => updateConfig('decreaseColor', v)} allowTransparent={false} />
      </Field>
      <Field label="Totals">
        <ColorInput value={cfg.totalColor || WATERFALL_COLORS.total} onChange={(v) => updateConfig('totalColor', v)} allowTransparent={false} />
      </Field>
    </>
  );
}
