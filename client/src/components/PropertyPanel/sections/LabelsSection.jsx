// Section 6 — Labels. Every piece of text drawn inside the visual: data
// labels on a chart, the figure and its caption on a scorecard or a gauge,
// headers and cells of a grid, the text widget's own type. Number format
// lives here too, since a format is how a value is written.
import { Section, SubSection, Field, RangeInput, ColorInput, CompareLineEditor } from '../controls';
import { parseIntOrNull } from '../../../utils/input';
import { NumberFormatSelect, FontFields } from './shared';
import { isChart } from './visualTypes';
import { TableHeadersPart, TableCellsPart, TableDecimalsField } from './tableParts';

const compareList = { display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4, fontSize: 11, color: 'var(--text-secondary)' };

function DataLabelsPart({ widget, updateConfig, inputStyle }) {
  const cfg = widget.config || {};
  const t = widget.type;
  const on = cfg.showDataLabels ?? false;
  const canContent = t === 'bar' || t === 'line' || t === 'pie' || t === 'treemap';
  const canPosition = t === 'bar' || t === 'line' || t === 'pie';
  const canColor = t !== 'scatter'; // scatter draws its labels in a fixed colour
  const canBg = t === 'bar' || t === 'line' || t === 'pie';
  return (
    <SubSection label="Data labels">
      <Field label="Show data labels">
        <input type="checkbox" checked={on} onChange={(e) => updateConfig('showDataLabels', e.target.checked)} />
      </Field>
      {on && (
        <>
          {canContent && (
            <Field label="Content">
              <select value={cfg.dataLabelContent || 'value'} onChange={(e) => updateConfig('dataLabelContent', e.target.value)} style={{ ...inputStyle, marginBottom: 0 }}>
                <option value="value">Value</option>
                <option value="name">Name</option>
                <option value="percent">Percent</option>
                <option value="nameValue">Name + value</option>
              </select>
            </Field>
          )}
          {canPosition && (
            <Field label="Position">
              {t === 'pie' ? (
                <select value={cfg.dataLabelPosition || 'outside'} onChange={(e) => updateConfig('dataLabelPosition', e.target.value)} style={{ ...inputStyle, marginBottom: 0 }}>
                  <option value="outside">Outside</option>
                  <option value="inside">Inside</option>
                </select>
              ) : (
                <select value={cfg.dataLabelPosition || 'top'} onChange={(e) => updateConfig('dataLabelPosition', e.target.value)} style={{ ...inputStyle, marginBottom: 0 }}>
                  <option value="top">Above</option>
                  <option value="inside">Inside, middle</option>
                  <option value="insideTop">Inside, top</option>
                  <option value="insideBottom">Inside, bottom</option>
                </select>
              )}
            </Field>
          )}
          <Field label="Angle" vertical>
            <RangeInput min={-90} max={90} value={cfg.dataLabelRotate ?? 0} suffix="°"
              onChange={(e) => updateConfig('dataLabelRotate', parseIntOrNull(e.target.value))} />
          </Field>
          <FontFields inputStyle={inputStyle}
            size={{ value: cfg.dataLabelFontSize, min: 6, max: 36, placeholder: '10', onChange: (v) => updateConfig('dataLabelFontSize', v) }}
            color={canColor ? { value: cfg.dataLabelColor, fallback: '#475569', onChange: (v) => updateConfig('dataLabelColor', v) } : null}
            family={canColor ? { value: cfg.dataLabelFontFamily, onChange: (v) => updateConfig('dataLabelFontFamily', v) } : null} />
          {canBg && (
            <>
              <Field label="Background">
                <ColorInput value={cfg.dataLabelBgColor || '#ffffff'} onChange={(v) => updateConfig('dataLabelBgColor', v)} />
              </Field>
              <Field label="Background opacity" vertical>
                <RangeInput min={0} max={100} value={cfg.dataLabelBgOpacity ?? 0} suffix="%"
                  onChange={(e) => updateConfig('dataLabelBgOpacity', parseIntOrNull(e.target.value))} />
              </Field>
            </>
          )}
        </>
      )}
    </SubSection>
  );
}

export default function LabelsSection({ ctx }) {
  const { widget, widgetId, onUpdate, binding, updateConfig, inputStyle, sections, table, pivot } = ctx;
  const type = widget.type;
  const cfg = widget.config || {};
  let body = null;

  if (isChart(type)) {
    const axisFormat = type === 'bar' || type === 'line' || type === 'combo';
    const labelFormat = type === 'bar' || type === 'line' || type === 'pie' || type === 'treemap';
    body = (
      <>
        <DataLabelsPart widget={widget} updateConfig={updateConfig} inputStyle={inputStyle} />
        {(type === 'bar' || type === 'line') && (
          <Field label="Show column names">
            <input type="checkbox" checked={cfg.showColumnNames ?? true} onChange={(e) => updateConfig('showColumnNames', e.target.checked)} />
          </Field>
        )}
        {(axisFormat || labelFormat) && (
          <SubSection label="Number format">
            {axisFormat && (
              <Field label="Values">
                <NumberFormatSelect value={cfg.valueAbbreviation} onChange={(v) => updateConfig('valueAbbreviation', v)} inputStyle={inputStyle} />
              </Field>
            )}
            {labelFormat && (
              <Field label="Data labels">
                <NumberFormatSelect value={cfg.dataLabelAbbr} onChange={(v) => updateConfig('dataLabelAbbr', v)} inputStyle={inputStyle} />
              </Field>
            )}
          </SubSection>
        )}
      </>
    );
  } else if (type === 'scorecard') {
    const toggleCompareCfg = (key, val) => onUpdate(widgetId, { ...widget, config: { ...cfg, [key]: val } });
    body = (
      <>
        <SubSection label="Value">
          <FontFields inputStyle={inputStyle}
            size={{ value: cfg.valueSize, min: 16, max: 72, placeholder: '36', onChange: (v) => updateConfig('valueSize', v) }}
            color={{ value: cfg.valueColor, fallback: '#0f172a', onChange: (v) => updateConfig('valueColor', v) }}
            family={{ value: cfg.valueFontFamily, onChange: (v) => updateConfig('valueFontFamily', v) }} />
        </SubSection>
        <SubSection label="Label">
          <FontFields inputStyle={inputStyle}
            size={{ value: cfg.labelSize, min: 8, max: 32, placeholder: '14', onChange: (v) => updateConfig('labelSize', v) }}
            color={{ value: cfg.labelColor, fallback: '#64748b', onChange: (v) => updateConfig('labelColor', v) }}
            family={{ value: cfg.labelFontFamily, onChange: (v) => updateConfig('labelFontFamily', v) }} />
        </SubSection>
        {binding.compareDateDim && (
          <SubSection label="Comparison">
            <div style={compareList}>
              <CompareLineEditor title="N-1 value" checked={cfg.showN1Value === true}
                onToggle={(v) => toggleCompareCfg('showN1Value', v)}
                style={cfg.n1ValueStyle} defaultLabel="N-1"
                onStyleChange={(next) => toggleCompareCfg('n1ValueStyle', next)} hasSign={false} />
              <CompareLineEditor title="N vs N-1" checked={cfg.showN1Difference === true}
                onToggle={(v) => toggleCompareCfg('showN1Difference', v)}
                style={cfg.n1DifferenceStyle} defaultLabel="vs N-1"
                onStyleChange={(next) => toggleCompareCfg('n1DifferenceStyle', next)} hasSign />
              <CompareLineEditor title="% evolution" checked={cfg.showN1Percent === true}
                onToggle={(v) => toggleCompareCfg('showN1Percent', v)}
                style={cfg.n1PercentStyle} defaultLabel="vs N-1"
                onStyleChange={(next) => toggleCompareCfg('n1PercentStyle', next)} hasSign />
            </div>
          </SubSection>
        )}
      </>
    );
  } else if (type === 'gauge') {
    const column = cfg.subType === 'column';
    const showMinMax = cfg.gaugeShowMinMax ?? false;
    body = (
      <>
        <SubSection label="Value">
          <Field label="Show value">
            <input type="checkbox" checked={cfg.gaugeShowValue ?? true} onChange={(e) => updateConfig('gaugeShowValue', e.target.checked)} />
          </Field>
          {(cfg.gaugeShowValue ?? true) && (
            <>
              <Field label="Font size" vertical>
                <RangeInput min={10} max={60} value={cfg.gaugeValueSize ?? (column ? 20 : 24)}
                  onChange={(e) => updateConfig('gaugeValueSize', parseIntOrNull(e.target.value))} suffix="px" />
              </Field>
              <FontFields inputStyle={inputStyle}
                color={{ value: cfg.gaugeValueColor, fallback: '#0f172a', allowTransparent: false, onChange: (v) => updateConfig('gaugeValueColor', v) }}
                family={{ value: cfg.gaugeValueFontFamily, onChange: (v) => updateConfig('gaugeValueFontFamily', v) }} />
            </>
          )}
        </SubSection>
        <SubSection label="Label">
          <Field label="Show label">
            <input type="checkbox" checked={cfg.gaugeShowLabel ?? true} onChange={(e) => updateConfig('gaugeShowLabel', e.target.checked)} />
          </Field>
          {(cfg.gaugeShowLabel ?? true) && (
            <>
              <Field label="Font size" vertical>
                <RangeInput min={8} max={30} value={cfg.gaugeLabelSize ?? 12}
                  onChange={(e) => updateConfig('gaugeLabelSize', parseIntOrNull(e.target.value))} suffix="px" />
              </Field>
              <FontFields inputStyle={inputStyle}
                color={{ value: cfg.gaugeLabelColor, fallback: '#64748b', allowTransparent: false, onChange: (v) => updateConfig('gaugeLabelColor', v) }}
                family={{ value: cfg.gaugeLabelFontFamily, onChange: (v) => updateConfig('gaugeLabelFontFamily', v) }} />
            </>
          )}
        </SubSection>
        <SubSection label="Min / max">
          <Field label="Show min / max">
            <input type="checkbox" checked={showMinMax} onChange={(e) => updateConfig('gaugeShowMinMax', e.target.checked)} />
          </Field>
          {showMinMax && (
            <>
              <Field label="Font size" vertical>
                <RangeInput min={8} max={24} value={cfg.gaugeAxisSize ?? (column ? 10 : 11)}
                  onChange={(e) => updateConfig('gaugeAxisSize', parseIntOrNull(e.target.value))} suffix="px" />
              </Field>
              <FontFields inputStyle={inputStyle}
                color={{ value: cfg.gaugeAxisColor, fallback: '#94a3b8', allowTransparent: false, onChange: (v) => updateConfig('gaugeAxisColor', v) }} />
              {!column && (
                <>
                  <Field label="Distance from arc" vertical>
                    <RangeInput min={-20} max={80} value={cfg.gaugeAxisOutset ?? 25}
                      onChange={(e) => updateConfig('gaugeAxisOutset', parseIntOrNull(e.target.value))} suffix="px" />
                  </Field>
                  <Field label="Pull to center" vertical>
                    <RangeInput min={0} max={200} value={cfg.gaugeAxisCenterPull ?? 15}
                      onChange={(e) => updateConfig('gaugeAxisCenterPull', parseIntOrNull(e.target.value))} suffix="px" />
                  </Field>
                </>
              )}
            </>
          )}
        </SubSection>
      </>
    );
  } else if (type === 'table' || type === 'pivotTable') {
    body = (
      <>
        {table.colSelect}
        <TableHeadersPart t={table} />
        <TableCellsPart t={table} />
        <SubSection label="Number format">
          {type === 'pivotTable' ? (
            <>
              {pivot.measureSelect}
              <Field label="Values">
                <NumberFormatSelect value={pivot.getVal('valueAbbreviation', 'none')} onChange={(v) => pivot.setVal('valueAbbreviation', v)} inputStyle={inputStyle} />
              </Field>
            </>
          ) : (
            <Field label="Values">
              <NumberFormatSelect value={table.get('values', 'numberFormat', {}).abbreviation}
                onChange={(v) => table.update('values.numberFormat.abbreviation', v)} inputStyle={inputStyle} style={{ width: 110 }} />
            </Field>
          )}
          <TableDecimalsField t={table} />
        </SubSection>
      </>
    );
  } else if (type === 'filter') {
    // No Labels for the Text visual: its font, size, colour and emphasis are
    // set on the canvas, on the selection, by the editor's own toolbar.
    body = (
      <FontFields inputStyle={inputStyle}
        size={{ value: cfg.slicerFontSize, min: 8, max: 24, placeholder: '12', onChange: (v) => updateConfig('slicerFontSize', v) }}
        color={{ value: cfg.slicerFontColor, fallback: '#0f172a', onChange: (v) => updateConfig('slicerFontColor', v) }}
        family={{ value: cfg.slicerFontFamily, onChange: (v) => updateConfig('slicerFontFamily', v) }} />
    );
  }

  if (!body) return null;
  return (
    <Section id="labels" title="Labels" sectionState={sections}>
      {body}
    </Section>
  );
}
