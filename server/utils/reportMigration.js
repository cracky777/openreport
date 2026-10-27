// A report migrated onto a model takes EVERYTHING with it (Jonathan,
// 2026-10-27: « quand on migre un rapport, on migre tout »): the fields it
// defined for itself — its calculations (`settings.extraMeasures`), its Date
// table (`settings.dateColumn` and the `_date.*` parts in `extraDimensions`),
// its other own dimensions — become fields of the model it now reads. Left in
// the report, they stayed tied to the model it came from, and a catalog showed
// them as a second model beside the real one.
//
// Pure: settings and model in, the new settings and the model's new fields out.
// A field the model already has, identical, is simply dropped from the report;
// one of the same name but another definition is renamed (`_2`, `_3`…) and the
// report is rewritten to read it under its new name. Presentation overrides
// (labels, formats of the model's own fields) stay in the report: they are the
// report's look, keyed on fields the model holds.

const clean = (f) => {
  const { _source: _s, ...rest } = f || {};
  return rest;
};
const same = (a, b) => JSON.stringify(clean(a)) === JSON.stringify(clean(b));

function freeName(name, taken) {
  for (let i = 2; ; i++) if (!taken.has(`${name}_${i}`)) return `${name}_${i}`;
}

// Every string of `value` naming a renamed field: the name itself, a variant
// of it ("x@@agg:max"), or a `${x}` reference inside an expression.
function renameIn(value, renames) {
  if (!renames.size) return value;
  if (typeof value === 'string') {
    if (renames.has(value)) return renames.get(value);
    const at = value.indexOf('@@');
    if (at > 0 && renames.has(value.slice(0, at))) return renames.get(value.slice(0, at)) + value.slice(at);
    return value.replace(/\$\{\s*([^}]+?)\s*\}/g, (whole, ref) => (renames.has(ref) ? `\${${renames.get(ref)}}` : whole));
  }
  if (Array.isArray(value)) return value.map((v) => renameIn(v, renames));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [renames.has(k) ? renames.get(k) : k, renameIn(v, renames)]));
  }
  return value;
}

// Each own field of the report against the model's fields of its kind: kept
// as is, already there, or renamed.
function sortOut(own, modelFields, renames) {
  const taken = new Set(modelFields.map((f) => f.name));
  const added = [];
  for (const f of own) {
    if (!f || !f.name) continue;
    const there = modelFields.find((x) => x.name === f.name);
    if (there && same(there, f)) continue;
    const name = there ? freeName(f.name, taken) : f.name;
    if (name !== f.name) renames.set(f.name, name);
    taken.add(name);
    added.push({ ...clean(f), name });
  }
  return added;
}

/**
 * @param {object} settings  the report's settings (parsed)
 * @param {object} model     the target model, parsed (measures, dimensions, date_column)
 * @returns {{ settings, measures, dimensions, dateColumn, moved: { measures: string[], dimensions: string[] }, renamed: object }}
 *   `measures` / `dimensions` / `dateColumn`: the model's fields after the move.
 */
function moveReportFieldsToModel(settings, model) {
  const s = settings && typeof settings === 'object' ? settings : {};
  const ownMeasures = Array.isArray(s.extraMeasures) ? s.extraMeasures : [];
  const ownDimensions = Array.isArray(s.extraDimensions) ? s.extraDimensions : [];
  const modelMeasures = Array.isArray(model.measures) ? model.measures : [];
  const modelDimensions = Array.isArray(model.dimensions) ? model.dimensions : [];

  const renames = new Map();
  const addedDimensions = sortOut(ownDimensions, modelDimensions, renames);
  const addedMeasures = sortOut(ownMeasures, modelMeasures, renames);

  // An override of one of the report's own fields is part of that field: it
  // goes with it into the model. Overrides of the model's fields stay.
  const measureOverrides = { ...(s.measureOverrides || {}) };
  const dimensionOverrides = { ...(s.dimensionOverrides || {}) };
  const withOwnOverride = (fields, overrides, own) => fields.map((f) => {
    const original = own.find((o) => o.name === f.name || renames.get(o.name) === f.name);
    const ov = original && overrides[original.name];
    if (!ov) return f;
    delete overrides[original.name];
    return { ...f, ...ov, name: f.name };
  });
  const measures = renameIn(withOwnOverride(addedMeasures, measureOverrides, ownMeasures), renames);
  const dimensions = renameIn(withOwnOverride(addedDimensions, dimensionOverrides, ownDimensions), renames);

  // The report's Date table becomes the model's, when the model has none (or
  // the same); its date parts were moved above with the other dimensions.
  const dateColumn = model.date_column || s.dateColumn || '';
  const next = renameIn({ ...s, measureOverrides, dimensionOverrides }, renames);
  delete next.extraMeasures;
  delete next.extraDimensions;
  if (!s.dateColumn || s.dateColumn === dateColumn) delete next.dateColumn;
  if (!Object.keys(next.measureOverrides).length) delete next.measureOverrides;
  if (!Object.keys(next.dimensionOverrides).length) delete next.dimensionOverrides;

  return {
    settings: next,
    measures: [...modelMeasures, ...measures],
    dimensions: [...modelDimensions, ...dimensions],
    dateColumn,
    moved: { measures: ownMeasures.map((m) => renames.get(m.name) || m.name), dimensions: ownDimensions.map((d) => renames.get(d.name) || d.name) },
    renamed: Object.fromEntries(renames),
  };
}

const hasOwnFields = (settings) => !!settings && (
  (Array.isArray(settings.extraMeasures) && settings.extraMeasures.length > 0)
  || (Array.isArray(settings.extraDimensions) && settings.extraDimensions.length > 0)
  || !!settings.dateColumn
);

module.exports = { moveReportFieldsToModel, hasOwnFields, renameIn };
