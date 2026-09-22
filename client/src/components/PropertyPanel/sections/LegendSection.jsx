// Section 8 — Legend. The key drawn next to the chart: whether, where, in
// what type. The series palette is under Colors, the Legend drop zone under
// Fields — this section is only the drawn legend.
import { Section, Field, ColorInput } from '../controls';
import FontPicker from '../../FontPicker/FontPicker';
import { isChart } from './visualTypes';

export default function LegendSection({ ctx }) {
  const { widget, updateConfig, inputStyle, sections } = ctx;
  const type = widget.type;
  if (!isChart(type) || type === 'treemap') return null;
  const cfg = widget.config || {};
  const shown = cfg.showLegend ?? false;
  return (
    <Section id="legend" title="Legend" sectionState={sections}>
      <Field label="Show legend">
        <input type="checkbox" checked={shown} onChange={(e) => updateConfig('showLegend', e.target.checked)} />
      </Field>
      {shown && (
        <>
          <Field label="Position">
            <select value={cfg.legendPosition || 'top'} onChange={(e) => updateConfig('legendPosition', e.target.value)} style={{ ...inputStyle, marginBottom: 0 }}>
              <option value="top">Top</option>
              <option value="bottom">Bottom</option>
              <option value="left">Left</option>
              <option value="right">Right</option>
            </select>
          </Field>
          <Field label="Font">
            <FontPicker value={cfg.legendFontFamily} onChange={(v) => updateConfig('legendFontFamily', v)} />
          </Field>
          <Field label="Text color">
            <ColorInput value={cfg.legendTextColor || '#475569'} onChange={(v) => updateConfig('legendTextColor', v)} />
          </Field>
        </>
      )}
    </Section>
  );
}
