// Section 5 — Colors. What colour the data is: the series palette, the
// value gradient, the rules that colour by a measure, and the visual's own
// fills. One home, whatever the visual.
import { Section, SubSection, Field, ColorInput } from '../controls';
import DropZone from '../../DropZone/DropZone';
import { hasData, isChart } from './visualTypes';
import { TableConditionalPart } from './tableParts';

const seriesList = { display: 'flex', flexDirection: 'column', gap: 8 };
const seriesRow = { borderBottom: '1px solid var(--border-subtle)', paddingBottom: 6 };
const seriesName = { fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const seriesControls = { display: 'flex', alignItems: 'center', gap: 6 };
const seriesImageRow = { display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 };
const clearBtn = { background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-disabled)', fontSize: 12, padding: 0 };
const hint = { fontSize: 10, color: 'var(--text-disabled)', marginTop: 4 };
const emptyHint = { fontSize: 11, color: 'var(--text-disabled)', fontStyle: 'italic' };
const rulesBox = { marginTop: 6 };
const ruleHead = { display: 'flex', alignItems: 'center', gap: 4 };
const ruleDelete = { marginLeft: 'auto', background: 'transparent', border: 'none', cursor: 'pointer', padding: '0 4px', color: 'var(--text-disabled)', fontSize: 14, lineHeight: 1 };
const ruleInputs = { display: 'flex', gap: 4, marginTop: 4 };
const ruleColorRow = { display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 };
const addRuleBtn = { marginTop: 6, padding: '5px 10px', fontSize: 11, background: 'var(--bg-subtle)', border: '1px dashed var(--border-default)', borderRadius: 6, color: 'var(--text-secondary)', cursor: 'pointer', width: '100%' };
const defaultColorRow = { marginTop: 10 };

const SERIES_COLORS = ['#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de', '#3ba272', '#fc8452', '#9a60b4', '#ea7ccc', '#5ab1ef'];
const SCATTER_SYMBOLS = [
  { value: 'circle', label: 'Circle' },
  { value: 'rect', label: 'Square' },
  { value: 'roundRect', label: 'Rounded square' },
  { value: 'triangle', label: 'Triangle' },
  { value: 'diamond', label: 'Diamond' },
  { value: 'pin', label: 'Pin' },
  { value: 'arrow', label: 'Arrow' },
  { value: 'star', label: 'Star' },
];

// Legend values as the fetched data names them — the palette is keyed by
// those names, so the list is empty until the visual has run once.
function legendValuesOf(data) {
  if (!data) return [];
  if (data.barSeries || data.lineSeries) return [...(data.barSeries || []), ...(data.lineSeries || [])].map((s) => s.name);
  if (data.series) return data.series.map((s) => s.name);
  if (data.items) return data.items.map((it) => it.name);
  if (data.seriesGroups) return data.seriesGroups.map((g) => g.name);
  return [];
}

function GradientPart({ widget, updateConfig }) {
  const cfg = widget.config || {};
  const type = widget.type;
  const grad = cfg.valueGradient || {};
  const setGrad = (patch) => updateConfig('valueGradient', { ...grad, ...patch });
  const isStackedBar = type === 'bar' && (cfg.subType === 'stacked' || cfg.subType === 'stacked100');
  const isStackedCombo = type === 'combo' && (cfg.subType ?? 'stackedCombo') === 'stackedCombo';
  return (
    <SubSection label="Gradient">
      {/* Min→max colouring by value; overrides the series palette (and the
          gauge fill / threshold colour) while on. */}
      <Field label="Color by value">
        <input type="checkbox" checked={grad.enabled === true} onChange={(e) => setGrad({ enabled: e.target.checked })} />
      </Field>
      {grad.enabled && (
        <>
          <Field label="Min color">
            <ColorInput value={grad.minColor || '#dcfce7'} onChange={(v) => setGrad({ minColor: v })} />
          </Field>
          <Field label="Max color">
            <ColorInput value={grad.maxColor || '#7c3aed'} onChange={(v) => setGrad({ maxColor: v })} />
          </Field>
          {isStackedBar && <div style={hint}>Disabled on stacked bars — switch to Clustered or 100% to use the gradient.</div>}
          {isStackedCombo && <div style={hint}>Disabled on Stacked Combo — switch to Clustered Combo to use the gradient.</div>}
          {type === 'scatter' && <div style={hint}>Coloured by the Size measure if bound, otherwise by Y.</div>}
          {type === 'combo' && !isStackedCombo && <div style={hint}>Applied to bar segments only — line series keep their own colour.</div>}
        </>
      )}
    </SubSection>
  );
}

function SeriesPart({ widget, updateConfig, inputStyle }) {
  const cfg = widget.config || {};
  const names = legendValuesOf(widget.data);
  const customColors = cfg.legendColors || {};
  const customSymbols = cfg.legendSymbols || {};
  const customImages = cfg.legendImages || {};
  const scatter = widget.type === 'scatter';
  return (
    <SubSection label="Series">
      {names.length === 0 && <div style={emptyHint}>Series appear once the visual has data.</div>}
      <div style={seriesList}>
        {names.map((name, i) => (
          <div key={name} style={seriesRow}>
            <div style={seriesName}>{name}</div>
            <div style={seriesControls}>
              <ColorInput value={customColors[name] || SERIES_COLORS[i % SERIES_COLORS.length]}
                onChange={(v) => updateConfig('legendColors', { ...customColors, [name]: v })} />
              {scatter && (
                <select value={customSymbols[name] || 'circle'}
                  onChange={(e) => updateConfig('legendSymbols', { ...customSymbols, [name]: e.target.value })}
                  style={{ ...inputStyle, marginBottom: 0, fontSize: 10, padding: '2px 4px', flex: 1 }}>
                  {SCATTER_SYMBOLS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              )}
            </div>
            {scatter && (
              <div style={seriesImageRow}>
                <input type="text" placeholder="Image URL" value={customImages[name] || ''}
                  onChange={(e) => updateConfig('legendImages', { ...customImages, [name]: e.target.value })}
                  style={{ ...inputStyle, flex: 1, fontSize: 10, marginBottom: 0, padding: '2px 4px' }} />
                {customImages[name] && (
                  <button type="button" style={clearBtn}
                    onClick={() => { const next = { ...customImages }; delete next[name]; updateConfig('legendImages', next); }}>×</button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </SubSection>
  );
}

// Widget-level colour rules on a measure of the report — the frame (or the
// figure, per visual) takes the colour of the first rule the value meets.
function ConditionalPart({ ctx }) {
  const { widget, widgetId, onUpdate, binding, updateBinding, updateConfig, fieldInfos, measureInfos, handleAggChange, inputStyle, styles } = ctx;
  const cfg = widget.config || {};
  const cc = cfg.colorCondition || {};
  const rules = Array.isArray(cc.rules) ? cc.rules : [];
  const setCC = (patch) => updateConfig('colorCondition', { ...cc, ...patch });
  const updateRule = (idx, patch) => { const next = [...rules]; next[idx] = { ...next[idx], ...patch }; setCC({ rules: next }); };
  const addRule = () => setCC({ rules: [...rules, { op: '<', value: 0, color: '#dc2626' }] });
  const removeRule = (idx) => setCC({ rules: rules.filter((_, i) => i !== idx) });
  return (
    <SubSection label="Conditional">
      <Field label="Color by rule">
        <input type="checkbox" checked={cc.enabled === true} onChange={(e) => setCC({ enabled: e.target.checked })} />
      </Field>
      {cc.enabled && (
        <>
          <DropZone label="Color value" accepts={['measure']} measureInfos={measureInfos} onAggChange={handleAggChange}
            fields={binding.colorMeasure ? [binding.colorMeasure] : []} zoneName="colorMeasure"
            onDrop={(name) => updateBinding({ colorMeasure: name })}
            onRemove={() => {
              const next = { ...binding };
              delete next.colorMeasure;
              onUpdate(widgetId, { ...widget, dataBinding: next, data: { ...(widget.data || {}), _colorValue: undefined } });
            }}
            fieldInfos={fieldInfos} />
          {binding.colorMeasure && (
            <div style={rulesBox}>
              {rules.length === 0 && <div style={emptyHint}>No rule yet</div>}
              {rules.map((r, i) => (
                <div key={i} style={styles.ruleCardStyle}>
                  <div style={ruleHead}>
                    <span style={styles.ruleLabelStyle}>If value</span>
                    <button type="button" onClick={() => removeRule(i)} title="Delete rule" style={ruleDelete}
                      onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--state-danger)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-disabled)'; }}>×</button>
                  </div>
                  <div style={ruleInputs}>
                    <select value={r.op || '<'} onChange={(e) => updateRule(i, { op: e.target.value })}
                      style={{ ...inputStyle, marginBottom: 0, width: 52, padding: '4px 4px' }}>
                      <option value="<">&lt;</option>
                      <option value="<=">≤</option>
                      <option value="=">=</option>
                      <option value="!=">≠</option>
                      <option value=">=">≥</option>
                      <option value=">">&gt;</option>
                    </select>
                    <input type="number" value={r.value ?? ''}
                      onChange={(e) => updateRule(i, { value: e.target.value === '' ? '' : Number(e.target.value) })}
                      style={{ ...inputStyle, marginBottom: 0, flex: 1, minWidth: 0 }} />
                  </div>
                  <div style={ruleColorRow}>
                    <span style={styles.ruleLabelStyle}>Color</span>
                    <ColorInput value={r.color || '#7c3aed'} onChange={(v) => updateRule(i, { color: v })} />
                  </div>
                </div>
              ))}
              <button type="button" onClick={addRule} style={addRuleBtn}>+ Add rule</button>
              <div style={defaultColorRow}>
                <Field label="Default color">
                  <ColorInput value={cc.defaultColor || ''} onChange={(v) => setCC({ defaultColor: v })} />
                </Field>
              </div>
              {widget.data?._colorValue != null && <div style={hint}>Current value: {widget.data._colorValue}</div>}
            </div>
          )}
        </>
      )}
    </SubSection>
  );
}

export default function ColorsSection({ ctx }) {
  const { widget, updateConfig, inputStyle, sections, table } = ctx;
  const type = widget.type;
  const cfg = widget.config || {};
  let body = null;

  if (isChart(type)) {
    body = (
      <>
        {(type === 'bar' || type === 'line' || type === 'scatter') && (
          <Field label="Color">
            <ColorInput value={cfg.color || '#5470c6'} onChange={(v) => updateConfig('color', v)} />
          </Field>
        )}
        <SeriesPart widget={widget} updateConfig={updateConfig} inputStyle={inputStyle} />
        {type !== 'line' && <GradientPart widget={widget} updateConfig={updateConfig} />}
        <ConditionalPart ctx={ctx} />
      </>
    );
  } else if (type === 'gauge') {
    body = (
      <>
        <Field label="Fill color">
          <ColorInput value={cfg.gaugeColor || '#7c3aed'} onChange={(v) => updateConfig('gaugeColor', v)} allowTransparent={false} />
        </Field>
        <Field label="Track color">
          <ColorInput value={cfg.gaugeTrackColor || '#e2e8f0'} onChange={(v) => updateConfig('gaugeTrackColor', v)} allowTransparent={false} />
        </Field>
        <GradientPart widget={widget} updateConfig={updateConfig} />
        <SubSection label="Threshold">
          <Field label="Threshold color">
            <ColorInput value={cfg.gaugeThresholdColor || '#dc2626'} onChange={(v) => updateConfig('gaugeThresholdColor', v)} allowTransparent={false} />
          </Field>
          <Field label="Color over threshold">
            <input type="checkbox" checked={cfg.gaugeConditionalColor || false} onChange={(e) => updateConfig('gaugeConditionalColor', e.target.checked)} />
          </Field>
          {cfg.gaugeConditionalColor && (
            <Field label="Over color">
              <ColorInput value={cfg.gaugeOverColor || '#dc2626'} onChange={(v) => updateConfig('gaugeOverColor', v)} allowTransparent={false} />
            </Field>
          )}
        </SubSection>
        <ConditionalPart ctx={ctx} />
      </>
    );
  } else if (type === 'table' || type === 'pivotTable') {
    body = (
      <>
        {table.colSelect}
        <TableConditionalPart t={table} />
        <ConditionalPart ctx={ctx} />
      </>
    );
  } else if (type === 'filter') {
    body = (
      <>
        <SubSection label="Selected item">
          <Field label="Text color">
            <ColorInput value={cfg.slicerSelectedColor || '#7c3aed'} onChange={(v) => updateConfig('slicerSelectedColor', v)} />
          </Field>
          <Field label="Background">
            <ColorInput value={cfg.slicerSelectedBg || '#f5f3ff'} onChange={(v) => updateConfig('slicerSelectedBg', v)} />
          </Field>
        </SubSection>
        <ConditionalPart ctx={ctx} />
      </>
    );
  } else if (type === 'shape') {
    if (cfg.shape === 'line') {
      body = (
        <Field label="Color">
          <ColorInput value={cfg.lineColor || '#6d28d9'} onChange={(v) => updateConfig('lineColor', v)} />
        </Field>
      );
    } else if (cfg.shape === 'arrow') {
      body = (
        <>
          <Field label="Fill">
            <ColorInput value={cfg.shapeFill || '#7c3aed'} onChange={(v) => updateConfig('shapeFill', v)} />
          </Field>
          <Field label="Stroke">
            <ColorInput value={cfg.shapeStroke || '#6d28d9'} onChange={(v) => updateConfig('shapeStroke', v)} />
          </Field>
        </>
      );
    }
  } else if (hasData(type)) {
    body = <ConditionalPart ctx={ctx} />;
  }

  if (!body) return null;
  return (
    <Section id="colors" title="Colors" sectionState={sections}>
      {body}
    </Section>
  );
}
