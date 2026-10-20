// The sources a model reads. Its own (models.datasource_id) serves the tables
// named plainly; each LINKED source serves tables named `alias__table`, so two
// files that both hold a Feuil1 sheet never collide and nothing existing is
// renamed. Only imported files can be combined: they are DuckDB files, opened
// read-only by as many instances as needed, and one model instance attaches
// them all (utils/dbConnector.js combinedDuckDB).
const db = require('../db');
const { createModelConnection } = require('./dbConnector');

const isFileSource = (ds) => !!ds && ds.db_type === 'duckdb' && String(ds.extra_config || '').includes('sourceFile');

// What a source is, in words the assistant can repeat to a business user:
// 'imported files', 'the PostgreSQL database "shop"', 'the BigQuery dataset "x.y"'.
// Never the host nor the credentials.
const KINDS = { postgres: 'PostgreSQL', mysql: 'MySQL', mssql: 'SQL Server', bigquery: 'BigQuery', databricks: 'Databricks', snowflake: 'Snowflake' };
function describeSource(ds) {
  if (!ds) return 'its data source';
  if (isFileSource(ds)) return 'imported files';
  let extra = {};
  try { extra = JSON.parse(ds.extra_config || '{}'); } catch { /* an old row: the kind alone */ }
  const kind = KINDS[ds.db_type] || ds.db_type || 'a';
  if (ds.db_type === 'bigquery') return extra.dataset ? `the BigQuery dataset "${extra.dataset}"` : 'a BigQuery dataset';
  return ds.db_name ? `the ${kind} database "${ds.db_name}"` : `a ${kind} database`;
}

// [{ datasource_id, alias, name, db_name }] in the order they were linked.
function linkedSourcesOf(modelId) {
  return db.prepare(`
    SELECT md.datasource_id, md.alias, d.name, d.db_name FROM model_datasources md
    JOIN datasources d ON d.id = md.datasource_id
    WHERE md.model_id = ? ORDER BY md.created_at, md.alias
  `).all(modelId);
}

// Every model reading the source, as its own or as a linked one.
function modelIdsUsing(datasourceId) {
  return db.prepare(`
    SELECT id FROM models WHERE datasource_id = ?
    UNION SELECT model_id FROM model_datasources WHERE datasource_id = ?
  `).all(datasourceId, datasourceId).map((r) => r.id);
}

// Catalog names DuckDB keeps for itself: an alias there would shadow them.
const RESERVED_ALIASES = new Set(['main', 'temp', 'system', 'memory', 'information_schema', 'pg_catalog']);

// A free alias for `name` in the model: lowercase letters, digits and single
// underscores, starting with a letter. It prefixes table names before "__",
// which therefore must never appear in it.
function aliasFor(modelId, name) {
  let base = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30).replace(/_+$/, '');
  if (!/^[a-z]/.test(base)) base = `s_${base}`.replace(/_+$/, '');
  const taken = new Set(linkedSourcesOf(modelId).map((l) => l.alias));
  let alias = base, i = 2;
  while (taken.has(alias) || RESERVED_ALIASES.has(alias)) alias = `${base}_${i++}`;
  return alias;
}

// Every source a model's rows come from: its own first, then the linked ones.
function sourceIdsOf(model) {
  return [model.datasource_id, ...linkedSourcesOf(model.id).map((l) => l.datasource_id)];
}

// The connection a model's queries run on: its source's own, or — when it
// links other files — one instance over all of them.
function connectionForModel(model, datasource) {
  return createModelConnection(datasource, linkedSourcesOf(model.id));
}

module.exports = { isFileSource, describeSource, linkedSourcesOf, modelIdsUsing, aliasFor, sourceIdsOf, connectionForModel };
