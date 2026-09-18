// Controls every section of the widget config panel shares: the one
// number-format list, the direction picker, and the font triplet — so a
// label or an option list changes in one place. (Type predicates and the
// direction tables are plain data, in visualTypes.js.)
import { TbChartBar } from 'react-icons/tb';
import { Field, ColorInput } from '../controls';
import FontPicker from '../../FontPicker/FontPicker';
import { parseIntOrNull } from '../../../utils/input';

// One list for every "how big a number prints" control — chart values,
// data labels, table cells and pivot measures used to each carry their own.
const NUMBER_FORMATS = [
  ['none', 'Full'],
  ['auto', 'Auto (K / M)'],
  ['K', 'Thousands (K)'],
  ['M', 'Millions (M)'],
  ['B', 'Billions (B)'],
];

export function NumberFormatSelect({ value, onChange, inputStyle, style }) {
  return (
    <select value={value || 'none'} onChange={(e) => onChange(e.target.value)}
      style={{ ...inputStyle, marginBottom: 0, ...style }}>
      {NUMBER_FORMATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

const directionRow = { display: 'flex', gap: 2 };

// Four rotated bar glyphs: bottom-to-top, top-to-bottom, left-to-right,
// right-to-left. `options` maps each glyph to the value the widget stores.
export function DirectionButtons({ value, options, onChange }) {
  return (
    <div style={directionRow}>
      {options.map((d) => {
        const active = value === d.value;
        return (
          <button key={d.value} type="button" title={d.title}
            onClick={() => onChange(d.value)}
            style={{
              padding: '4px 6px', border: '1px solid',
              borderColor: active ? 'var(--accent-primary)' : 'var(--border-default)',
              borderRadius: 4, cursor: 'pointer',
              background: active ? 'var(--bg-active)' : 'var(--bg-panel)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <TbChartBar size={14} style={{ transform: `rotate(${d.rotate}deg)`, color: active ? 'var(--accent-primary)' : 'var(--text-disabled)' }} />
          </button>
        );
      })}
    </div>
  );
}

// "Font size / Font color / Font" — the three fields every piece of text in
// a visual gets, always in this order and under these names.
export function FontFields({ size, color, family, inputStyle }) {
  return (
    <>
      {size && (
        <Field label="Font size">
          <input type="number" min={size.min ?? 6} max={size.max ?? 72}
            value={size.value ?? ''} placeholder={size.placeholder}
            onChange={(e) => size.onChange(parseIntOrNull(e.target.value))}
            style={{ ...inputStyle, width: 55, marginBottom: 0 }} />
        </Field>
      )}
      {color && (
        <Field label="Font color">
          <ColorInput value={color.value || color.fallback} onChange={color.onChange}
            allowTransparent={color.allowTransparent} />
        </Field>
      )}
      {family && (
        <Field label="Font">
          <FontPicker value={family.value} onChange={family.onChange} />
        </Field>
      )}
    </>
  );
}
