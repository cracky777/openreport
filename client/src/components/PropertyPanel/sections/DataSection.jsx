// Section 3 — Data. The window the visual reads: a time period, a row
// limit, and what it says when nothing comes back.
import { Section, SubSection, Field } from '../controls';
import { parseIntOrNull } from '../../../utils/input';
import { TIME_PRESETS } from '../../../utils/timeIntelligence';

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
