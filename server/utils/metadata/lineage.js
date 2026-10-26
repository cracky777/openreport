// What a measure is made of, read from the model alone (the metadata API,
// routes/v1.js): the measures it references, and the physical columns it reads
// in the end — references followed all the way down. Pure: no database, no
// request. The SQL itself is the compiler's (compile.js), never rebuilt here.

const { extractColumnRefsFromExpression } = require('../columnTypeResolver');

// Linked file sources name their tables `alias__table` (utils/modelSources.js);
// imported names never contain `__`.
const ALIAS_SEP = '__';
const DEFAULT_SCHEMA = { postgres: 'public', azure_postgres: 'public', redshift: 'public', duckdb: 'main', mssql: 'dbo' };

const REF = /\$\{\s*([^}]+?)\s*\}/g;

// The names inside `${…}`, in order of first appearance.
function refsIn(expression) {
  const out = [];
  for (const m of String(expression || '').matchAll(REF)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

// A `${ref}` resolves as /query resolves it: by name first, then by label.
function findMeasure(ref, measures) {
  return measures.find((m) => m.name === ref) || measures.find((m) => m.label === ref) || null;
}

// The measures a measure names directly: its expression's references, and a
// measure its filter rules compare on.
function directRefs(m, measures) {
  const names = [];
  const add = (target) => { if (target && target.name !== m.name && !names.includes(target.name)) names.push(target.name); };
  if (m.aggregation === 'custom') for (const r of refsIn(m.expression)) add(findMeasure(r, measures));
  for (const rule of Array.isArray(m.filterRules) ? m.filterRules : []) {
    if (rule && rule.isMeasure) add(findMeasure(rule.field, measures));
  }
  return names;
}

// Every measure reached through references, depth first; a cycle stops where
// it closes (the compiler refuses it with its own error).
function dependsOn(m, measures) {
  const out = [];
  const walk = (cur, path) => {
    for (const name of directRefs(cur, measures)) {
      if (path.includes(name)) continue;
      if (!out.includes(name)) out.push(name);
      const next = measures.find((x) => x.name === name);
      if (next) walk(next, [...path, name]);
    }
  };
  walk(m, [m.name]);
  return out;
}

// The reference tree, for a reader: each measure with what it is made of.
function refTree(m, measures, path = []) {
  return directRefs(m, measures).map((name) => {
    const child = measures.find((x) => x.name === name);
    if (!child || path.includes(name)) return { name, cycle: path.includes(name) || undefined };
    return { name, label: child.label || child.name, aggregation: child.aggregation, refs: refTree(child, measures, [...path, m.name]) };
  });
}

// Columns a dimension reads: its own, or those of its SQL expression.
function dimensionColumns(d, tables) {
  if (!d) return [];
  if (d.expression) return extractColumnRefsFromExpression(d.expression).filter((c) => tables.has(c.table));
  return d.table && d.column ? [{ table: d.table, column: d.column }] : [];
}

// The model-level columns one measure reads itself (references excluded).
function ownColumns(m, ctx) {
  const { dimensions, tables } = ctx;
  const out = [];
  const dimNamed = (name) => dimensions.find((d) => d.name === name);
  if (m.aggregation === 'custom') {
    out.push(...extractColumnRefsFromExpression(m.expression).filter((c) => tables.has(c.table)));
  } else if (m.table && m.column && m.column !== '*') {
    out.push({ table: m.table, column: m.column });
  }
  if (m.table && m.since) out.push({ table: m.table, column: m.since });
  if (m.table && m.times) out.push({ table: m.table, column: m.times });
  for (const rule of Array.isArray(m.filterRules) ? m.filterRules : []) {
    if (rule && !rule.isMeasure) out.push(...dimensionColumns(dimNamed(rule.field), tables));
  }
  for (const key of ['periodShift', 'lastValue', 'perPeriod']) {
    if (m[key] && m[key].dim) out.push(...dimensionColumns(dimNamed(m[key].dim), tables));
  }
  return out;
}

/**
 * Where a model table physically lives: the source that serves it (a linked
 * file by its alias, the model's own source otherwise), its schema and name.
 */
function physicalTable(table, ctx) {
  const name = String(table);
  const at = name.indexOf(ALIAS_SEP);
  const linked = at > 0 ? ctx.linked.find((l) => l.alias === name.slice(0, at)) : null;
  const source = linked ? ctx.sources.get(linked.datasource_id) : ctx.primary;
  const local = linked ? name.slice(at + ALIAS_SEP.length) : name;
  const dot = local.lastIndexOf('.');
  return {
    datasource_id: source ? source.id : null,
    schema: dot > 0 ? local.slice(0, dot) : (source && DEFAULT_SCHEMA[source.db_type]) || null,
    table: dot > 0 ? local.slice(dot + 1) : local,
  };
}

const columnKey = (c) => `${c.table}\u0000${c.column}`;

// The physical columns behind a measure, references followed: what a column
// lineage in a catalog is drawn from.
function sourceColumns(m, ctx) {
  const seen = new Map();
  const visit = (cur, path) => {
    for (const c of ownColumns(cur, ctx)) if (!seen.has(columnKey(c))) seen.set(columnKey(c), c);
    for (const name of directRefs(cur, ctx.measures)) {
      if (path.includes(name)) continue;
      const next = ctx.measures.find((x) => x.name === name);
      if (next) visit(next, [...path, name]);
    }
  };
  visit(m, [m.name]);
  return [...seen.values()].map((c) => ({ ...physicalTable(c.table, ctx), column: c.column }));
}

// The model's tables with the columns the model reads, typed: the override of
// `column_types` first, then the type of a dimension on it. Columns the model
// never names are not listed — reading them would mean asking the source.
function modelTables(ctx, model) {
  const used = new Map();
  const use = (table, column, type) => {
    if (!table || !column || column === '*') return;
    if (!used.has(table)) used.set(table, new Map());
    const cols = used.get(table);
    if (!cols.has(column) || (!cols.get(column) && type)) cols.set(column, type || null);
  };
  for (const [key, ov] of Object.entries(model.column_types || {})) {
    const dot = key.lastIndexOf('.');
    if (dot > 0) use(key.slice(0, dot), key.slice(dot + 1), typeof ov === 'string' ? ov : ov && ov.type);
  }
  for (const d of ctx.dimensions) {
    if (!d.datePart) for (const c of dimensionColumns(d, ctx.tables)) use(c.table, c.column, d.expression ? null : d.type);
  }
  for (const m of ctx.measures) for (const c of ownColumns(m, ctx)) use(c.table, c.column, null);
  for (const j of model.joins || []) {
    use(j.from_table, j.from_column, null);
    use(j.to_table, j.to_column, null);
  }
  return (model.selected_tables || []).map((t) => ({
    ...physicalTable(t, ctx),
    alias_in_model: t,
    columns: [...(used.get(t) || new Map()).entries()].map(([name, type]) => ({ name, type })),
  }));
}

/**
 * The context lineage reads: the model's fields (with a report's own when
 * given), its tables, and the sources that serve them.
 */
function lineageContext({ model, primary, linked = [], sources = new Map(), extraMeasures = [], extraDimensions = [] }) {
  const measures = [...(model.measures || []), ...extraMeasures.filter((m) => m && m.name && !(model.measures || []).some((x) => x.name === m.name))];
  const dimensions = [...(model.dimensions || []), ...extraDimensions.filter((d) => d && d.name && !(model.dimensions || []).some((x) => x.name === d.name))];
  return { measures, dimensions, tables: new Set(model.selected_tables || []), primary, linked, sources };
}

module.exports = { refsIn, findMeasure, directRefs, dependsOn, refTree, sourceColumns, physicalTable, modelTables, lineageContext };
