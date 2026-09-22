// The semantic layer the assistant works with: the model's fields merged with
// the report's own overrides and extras — the same merge /query performs, so a
// name the assistant is shown is a name /query will resolve.
//
// Built from what is PERSISTED. The rollups were built from the saved report
// too, so an extra measure that only exists in the editor's unsaved state has
// no cached data to offer anyway.

const { reportExtras } = require('../rollupPlanning');

function mergeFields(base, overrides, extras) {
  const out = base.map((f) => (overrides[f.name] ? { ...f, ...overrides[f.name] } : f));
  for (const f of extras) {
    if (f && f.name && !out.find((x) => x.name === f.name)) out.push(f);
  }
  return out;
}

function buildEffectiveModel(model, reportSettings) {
  const extras = reportExtras(reportSettings);
  return {
    dimensions: mergeFields(model.dimensions || [], extras.dimensionOverrides, extras.extraDimensions),
    measures: mergeFields(model.measures || [], extras.measureOverrides, extras.extraMeasures),
  };
}

// What leaves the instance. A whitelist of the fields a model needs to pick
// the right name: never `expression` (free SQL), never table/column names,
// joins or RLS — the physical schema is none of the provider's business.
function toPromptSchema(effective) {
  return {
    dimensions: effective.dimensions.map((d) => ({ name: d.name, label: d.label || d.name, type: d.type || 'string' })),
    measures: effective.measures.map((m) => {
      const out = { name: m.name, label: m.label || m.name, aggregation: m.aggregation || null };
      if (m.format && typeof m.format === 'object') {
        const { decimals, prefix, suffix } = m.format;
        out.format = { decimals, prefix, suffix };
      }
      return out;
    }),
  };
}

module.exports = { buildEffectiveModel, toPromptSchema };
