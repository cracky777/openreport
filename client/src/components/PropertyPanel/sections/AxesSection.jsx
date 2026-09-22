// Section 7 — Axes. X, Y, the combo's right Y, the grid behind them, and
// on a scatter the style of the axis titles. Charts with axes only.
import { Section, SubSection, Field, RangeInput, ColorInput } from '../controls';
import { parseFloatOrNull, parseIntOrNull } from '../../../utils/input';
import { FontFields } from './shared';
import { hasAxes } from './visualTypes';

// One axis: its visibility, its title, its tick labels — and its step for
// the value axes. `keys` names the config keys of that axis.
function AxisPart({ label, keys, cfg, updateConfig, inputStyle, titlePlaceholder, showDefault = true }) {
  const shown = cfg[keys.show] ?? showDefault;
  const titleShown = cfg[keys.showTitle] ?? true;
  return (
    <SubSection label={label}>
      <Field label="Show axis">
        <input type="checkbox" checked={shown} onChange={(e) => updateConfig(keys.show, e.target.checked)} />
      </Field>
      {shown && (
        <>
          {keys.step && (
            <Field label="Step">
              <input type="number" min={0} step={1} value={cfg[keys.step] ?? ''} placeholder="Auto"
                onChange={(e) => updateConfig(keys.step, e.target.value ? parseFloat(e.target.value) : null)}
                style={{ ...inputStyle, marginBottom: 0 }} />
            </Field>
          )}
          <Field label="Show title">
            <input type="checkbox" checked={titleShown} onChange={(e) => updateConfig(keys.showTitle, e.target.checked)} />
          </Field>
          {titleShown && (
            <Field label="Title">
              <input type="text" value={cfg[keys.title] ?? ''} placeholder={titlePlaceholder || 'Auto'}
                onChange={(e) => updateConfig(keys.title, e.target.value)} style={{ ...inputStyle, marginBottom: 0 }} />
            </Field>
          )}
          {/* Unset, the axis line keeps the chart's default (a value axis
              draws none); the swatch shows that default grey. */}
          <Field label="Line color">
            <ColorInput value={cfg[keys.lineColor] || '#6e7079'} onChange={(v) => updateConfig(keys.lineColor, v)} />
          </Field>
          {keys.rotate && (
            // No value stored = the chart picks the tilt that fits its width.
            // Same slider as every other angle in the panel once pinned.
            <>
              <Field label="Auto angle">
                <input type="checkbox" checked={cfg[keys.rotate] == null}
                  onChange={(e) => updateConfig(keys.rotate, e.target.checked ? null : 0)} />
              </Field>
              {cfg[keys.rotate] != null && (
                <Field label="Angle" vertical>
                  <RangeInput min={-90} max={90} value={cfg[keys.rotate]} suffix="°"
                    onChange={(e) => updateConfig(keys.rotate, parseIntOrNull(e.target.value) ?? 0)} />
                </Field>
              )}
            </>
          )}
          <FontFields inputStyle={inputStyle}
            size={{ value: cfg[keys.fontSize], min: 6, max: 24, placeholder: '11', onChange: (v) => updateConfig(keys.fontSize, v) }}
            color={{ value: cfg[keys.color], fallback: '#64748b', onChange: (v) => updateConfig(keys.color, v) }}
            family={{ value: cfg[keys.fontFamily], onChange: (v) => updateConfig(keys.fontFamily, v) }} />
        </>
      )}
    </SubSection>
  );
}

export default function AxesSection({ ctx }) {
  const { widget, updateConfig, inputStyle, sections } = ctx;
  const type = widget.type;
  if (!hasAxes(type)) return null;
  const cfg = widget.config || {};
  return (
    <Section id="axes" title="Axes" sectionState={sections}>
      <AxisPart label="X axis" cfg={cfg} updateConfig={updateConfig} inputStyle={inputStyle}
        titlePlaceholder={widget.data?._xLabel || widget.data?._dimLabel || 'Auto'}
        keys={{ show: 'showXAxis', showTitle: 'showXAxisTitle', title: 'xAxisTitle', lineColor: 'xAxisLineColor', rotate: 'xAxisLabelRotate', fontSize: 'xAxisLabelFontSize', color: 'xAxisLabelColor', fontFamily: 'xAxisLabelFontFamily' }} />
      <AxisPart label="Y axis" cfg={cfg} updateConfig={updateConfig} inputStyle={inputStyle}
        titlePlaceholder={widget.data?._yLabel || widget.data?._measureLabel || 'Auto'}
        keys={{ show: 'showYAxis', step: 'yAxisInterval', lineColor: 'yAxisLineColor', showTitle: 'showYAxisTitle', title: 'yAxisTitle', fontSize: 'yAxisLabelFontSize', color: 'yAxisLabelColor', fontFamily: 'yAxisLabelFontFamily' }} />
      {type === 'combo' && (
        <AxisPart label="Right Y axis" cfg={cfg} updateConfig={updateConfig} inputStyle={inputStyle}
          keys={{ show: 'showSecondaryAxis', step: 'secondaryYAxisInterval', lineColor: 'secondaryYAxisLineColor', showTitle: 'showSecondaryYAxisTitle', title: 'secondaryYAxisTitle', fontSize: 'secondaryYAxisLabelFontSize', color: 'secondaryYAxisLabelColor', fontFamily: 'secondaryYAxisLabelFontFamily' }} />
      )}
      {type === 'scatter' && (
        <SubSection label="Axis titles">
          <FontFields inputStyle={inputStyle}
            size={{ value: cfg.headerFontSize, min: 8, max: 24, placeholder: '12', onChange: (v) => updateConfig('headerFontSize', v) }}
            color={{ value: cfg.headerColor, fallback: '#475569', onChange: (v) => updateConfig('headerColor', v) }}
            family={{ value: cfg.headerFontFamily, onChange: (v) => updateConfig('headerFontFamily', v) }} />
          <Field label="Bold">
            <input type="checkbox" checked={cfg.headerBold ?? false} onChange={(e) => updateConfig('headerBold', e.target.checked)} />
          </Field>
        </SubSection>
      )}
      <SubSection label="Grid">
        <Field label="Line style">
          <select value={cfg.gridLineStyle || 'solid'} onChange={(e) => updateConfig('gridLineStyle', e.target.value)} style={{ ...inputStyle, marginBottom: 0 }}>
            <option value="solid">Solid</option>
            <option value="dashed">Dashed</option>
            <option value="dotted">Dotted</option>
          </select>
        </Field>
        <Field label="Line width" vertical>
          <RangeInput min={0} max={5} step={0.5} value={cfg.gridLineWidth ?? 1}
            onChange={(e) => updateConfig('gridLineWidth', parseFloatOrNull(e.target.value))} />
        </Field>
        {/* Unset, the grid follows the report theme (useChartTheme); the
            swatch shows the light-theme default until a colour is picked. */}
        <Field label="Line color">
          <ColorInput value={cfg.gridLineColor || '#e2e8f0'} onChange={(v) => updateConfig('gridLineColor', v)} />
        </Field>
      </SubSection>
    </Section>
  );
}
