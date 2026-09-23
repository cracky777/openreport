// Section 3 — Data. The window the visual reads: a time period, a row
// limit, the period a scorecard compares against, and what it says when
// nothing comes back.
import { Section, SubSection, Field, CompareLineEditor } from '../controls';
import { parseIntOrNull } from '../../../utils/input';
import { TIME_PRESETS } from '../../../utils/timeIntelligence';

const compareList = { display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4, fontSize: 11, color: 'var(--text-secondary)' };

export default function DataSection({ ctx }) {
  const { widget, model, binding, updateBinding, updateConfig, inputStyle, sections } = ctx;
  const type = widget.type;
  const cfg = widget.config || {};

  // Only offered when the model has a date-typed dimension to anchor it on.
  const effType = (d) => {
    const ov = d.table && d.column && model?.column_types && model.column_types[`${d.table}.${d.column}`];
    return !ov ? d.type : (typeof ov === 'string' ? ov : ov.type);
  };
  const dateDims = type === 'filter' ? [] : (model?.dimensions || []).filter((d) => effType(d) === 'date');
  const tp = (binding.timePeriod && typeof binding.timePeriod === 'object') ? binding.timePeriod : {};
  const setTP = (patch) => {
    // A dim without a preset (or the reverse) is kept: the filter only
    // activates once both halves are set. Clearing both drops the key.
    const next = { ...tp, ...patch };
    if (!next.dim && !next.preset) updateBinding({ timePeriod: undefined });
    else updateBinding({ timePeriod: { dim: next.dim || null, preset: next.preset || null } });
  };

  return (
    <Section id="data" title="Data" sectionState={sections}>
      {dateDims.length > 0 && (
        <SubSection label="Time period">
          <Field label="Date dimension">
            <select value={tp.dim || ''} onChange={(e) => setTP({ dim: e.target.value || null })}
              style={{ ...inputStyle, marginBottom: 0 }}>
              <option value="">— none —</option>
              {dateDims.map((d) => <option key={d.name} value={d.name}>{d.label || d.name}</option>)}
            </select>
          </Field>
          <Field label="Period">
            <select value={tp.preset || ''} onChange={(e) => setTP({ preset: e.target.value || null })}
              disabled={!tp.dim}
              style={{ ...inputStyle, marginBottom: 0 }}>
              <option value="">— none —</option>
              {TIME_PRESETS.map((pz) => <option key={pz.key} value={pz.key}>{pz.label}</option>)}
            </select>
          </Field>
        </SubSection>
      )}
      {/* Scorecard: the lines that read the period before this one. Which
          periods are compared is data; how they are drawn stays here too,
          next to the choice, rather than three sections away. */}
      {binding.compareDateDim && (
        <SubSection label="Comparison">
          <div style={compareList}>
            <CompareLineEditor title="N-1 value" checked={cfg.showN1Value === true}
              onToggle={(v) => updateConfig('showN1Value', v)}
              style={cfg.n1ValueStyle} defaultLabel="N-1"
              onStyleChange={(next) => updateConfig('n1ValueStyle', next)} hasSign={false} />
            <CompareLineEditor title="N vs N-1" checked={cfg.showN1Difference === true}
              onToggle={(v) => updateConfig('showN1Difference', v)}
              style={cfg.n1DifferenceStyle} defaultLabel="vs N-1"
              onStyleChange={(next) => updateConfig('n1DifferenceStyle', next)} hasSign />
            <CompareLineEditor title="% evolution" checked={cfg.showN1Percent === true}
              onToggle={(v) => updateConfig('showN1Percent', v)}
              style={cfg.n1PercentStyle} defaultLabel="vs N-1"
              onStyleChange={(next) => updateConfig('n1PercentStyle', next)} hasSign>
              {/* (N − N-1) ÷ base. The previous period is the usual reading of
                  "evolution"; some reports (Power BI's DIVIDE(N − N-1, N)) read
                  it against the period on screen. */}
              <Field label="Divide by">
                <select value={cfg.n1PercentStyle?.base || 'previous'}
                  onChange={(e) => updateConfig('n1PercentStyle', { ...(cfg.n1PercentStyle || {}), base: e.target.value })}
                  style={{ ...inputStyle, width: '100%' }}>
                  <option value="previous">Previous period (N-1)</option>
                  <option value="current">Selected period (N)</option>
                </select>
              </Field>
            </CompareLineEditor>
          </div>
        </SubSection>
      )}
      {type !== 'scorecard' && (
        <Field label="Row limit">
          <input type="number" min={1} max={10000} value={cfg.dataLimit ?? ''} placeholder="1000"
            onChange={(e) => updateConfig('dataLimit', parseIntOrNull(e.target.value))}
            style={{ ...inputStyle, marginBottom: 0 }} />
        </Field>
      )}
      {type !== 'filter' && (
        <SubSection label="When empty">
          {/* Stored as `hideEmptyMessage`; the box reads the positive way. */}
          <Field label="Show message">
            <input type="checkbox" checked={!(cfg.hideEmptyMessage || false)}
              onChange={(e) => updateConfig('hideEmptyMessage', !e.target.checked)} />
          </Field>
          {!(cfg.hideEmptyMessage || false) && (
            <Field label="Message">
              <input type="text" value={cfg.emptyMessage ?? ''}
                onChange={(e) => updateConfig('emptyMessage', e.target.value)}
                placeholder="No values"
                style={{ ...inputStyle, marginBottom: 0 }} />
            </Field>
          )}
        </SubSection>
      )}
    </Section>
  );
}
