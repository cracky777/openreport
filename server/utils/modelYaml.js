/**
 * Models-as-code: YAML serialisation of the semantic layer.
 *
 * The document is a faithful round-trip of the model row's semantic
 * fields — dimensions, measures, joins, RLS, column type overrides,
 * date column, incremental window, canvas layout — plus the datasource
 * NAME as a portable reference (credentials never leave the instance;
 * import resolves the name against the caller's accessible datasources,
 * or takes an explicit datasourceId). `openreport_model: 1` versions the
 * format so later shapes can migrate old files instead of guessing.
 */
const yaml = require('js-yaml');

const FORMAT_KEY = 'openreport_model';
const FORMAT_VERSION = 1;

// 1 MB of YAML is far beyond any real model — reject early so a hostile
// upload can't stall the parser.
const MAX_YAML_BYTES = 1024 * 1024;

function modelToYaml(model, datasourceName) {
  const doc = {
    [FORMAT_KEY]: FORMAT_VERSION,
    name: model.name,
    description: model.description || '',
    datasource: datasourceName || null,
    date_column: model.date_column || null,
    incremental_months: model.incremental_months || null,
    tables: model.selected_tables || [],
    dimensions: model.dimensions || [],
    measures: model.measures || [],
    joins: model.joins || [],
    rls: model.rls && Object.keys(model.rls).length > 0 ? model.rls : null,
    column_types: model.column_types && Object.keys(model.column_types).length > 0 ? model.column_types : null,
    table_positions: model.table_positions && Object.keys(model.table_positions).length > 0 ? model.table_positions : null,
  };
  // noRefs: repeated sub-objects must stay inline — YAML anchors would
  // round-trip fine but read terribly in a diff.
  return yaml.dump(doc, { noRefs: true, lineWidth: 100, quotingType: '"' });
}

const isPlainObject = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const arrayOfObjects = (v) => Array.isArray(v) && v.every(isPlainObject);

// Largest number of nodes an imported document may expand to. A real model is
// a few thousand; the cap only ever fires on a hostile one.
const MAX_EXPANDED_NODES = 50000;

/**
 * Refuse a document whose EXPANDED size is unreasonable.
 *
 * YAML aliases (`*x`) are shared references, so a few hundred bytes of anchors
 * can parse fine, slip under the byte cap, and only explode when the model is
 * re-serialised for storage ("billion laughs"). Walking the tree counts each
 * visit, so an alias reused a thousand times costs a thousand nodes here —
 * exactly what JSON.stringify would have to write. The budget also terminates
 * the walk on a cyclic document, which anchors can produce.
 */
function assertExpansionWithinBudget(doc) {
  let budget = MAX_EXPANDED_NODES;
  const walk = (node) => {
    if (--budget < 0) throw new Error('YAML document expands too far — remove anchors and aliases');
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
    } else if (node && typeof node === 'object') {
      for (const value of Object.values(node)) walk(value);
    }
  };
  walk(doc);
}

/**
 * Parse + validate a YAML document into the field set the model INSERT /
 * UPDATE consumes. Throws with a user-facing message on anything off.
 * Validation is structural (shapes, sizes) — semantic checks (does the
 * datasource have these tables?) stay with the editor, same as a model
 * built through the UI.
 */
function yamlToModelFields(text) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('Empty YAML document');
  if (Buffer.byteLength(text, 'utf8') > MAX_YAML_BYTES) throw new Error('YAML document too large (max 1 MB)');
  let doc;
  try {
    // Default schema only (no custom types) — js-yaml v4+ is safe-load by default.
    doc = yaml.load(text);
  } catch (e) {
    throw new Error(`Invalid YAML: ${e.message}`);
  }
  assertExpansionWithinBudget(doc);
  if (!isPlainObject(doc)) throw new Error('The document must be a YAML mapping');
  if (doc[FORMAT_KEY] !== FORMAT_VERSION) {
    throw new Error(`Missing or unsupported "${FORMAT_KEY}" version (expected ${FORMAT_VERSION})`);
  }
  if (typeof doc.name !== 'string' || !doc.name.trim()) throw new Error('"name" is required');
  if (doc.name.length > 200) throw new Error('"name" is too long (max 200)');
  if (doc.tables != null && !(Array.isArray(doc.tables) && doc.tables.every((t) => typeof t === 'string'))) {
    throw new Error('"tables" must be a list of table names');
  }
  for (const key of ['dimensions', 'measures', 'joins']) {
    if (doc[key] != null && !arrayOfObjects(doc[key])) {
      throw new Error(`"${key}" must be a list of mappings`);
    }
  }
  for (const [key, list] of [['dimensions', doc.dimensions], ['measures', doc.measures]]) {
    for (const item of list || []) {
      if (typeof item.name !== 'string' || !item.name.trim()) {
        throw new Error(`Every entry in "${key}" needs a "name"`);
      }
    }
  }
  for (const key of ['rls', 'column_types', 'table_positions']) {
    if (doc[key] != null && !isPlainObject(doc[key])) {
      throw new Error(`"${key}" must be a mapping`);
    }
  }
  const months = doc.incremental_months;
  if (months != null && !(Number.isInteger(months) && months >= 1 && months <= 60)) {
    throw new Error('"incremental_months" must be an integer between 1 and 60');
  }
  if (doc.date_column != null && typeof doc.date_column !== 'string') {
    throw new Error('"date_column" must be a string');
  }
  return {
    name: doc.name.trim(),
    description: typeof doc.description === 'string' ? doc.description : '',
    datasourceName: typeof doc.datasource === 'string' ? doc.datasource : null,
    selected_tables: doc.tables || [],
    dimensions: doc.dimensions || [],
    measures: doc.measures || [],
    joins: doc.joins || [],
    rls: doc.rls || {},
    column_types: doc.column_types || {},
    table_positions: doc.table_positions || {},
    date_column: doc.date_column || null,
    incremental_months: months || null,
  };
}

module.exports = { modelToYaml, yamlToModelFields, FORMAT_VERSION };
