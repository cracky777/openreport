// The metadata API (routes/v1.js, scope `metadata`): what describes reports and
// their semantic models, for a catalog such as OpenMetadata. Metadata only —
// no row of data, no connection to a source, no credential, no RLS rule.
//
// What the caller sees is decided twice: first the workspaces they are a
// member of (an account dedicated to the catalog, member of the workspaces to
// catalog), then `?workspace=` — and inside those, the browser's own checks
// (canAccessModel, canAccessReport, canReadDatasource) for every object.

const crypto = require('crypto');
const db = require('../../db');
const { parseModel } = require('../../db/modelRow');
const wsAccess = require('../workspaceAccess');
const { linkedSourcesOf } = require('../modelSources');
const lineage = require('./lineage');
const { compileMeasure } = require('./compile');

const METADATA_FORMAT = 1;
const DECOR = new Set(['shape', 'image']);

const parse = (text, fallback) => {
  try { return text ? JSON.parse(text) : fallback; } catch { return fallback; }
};

// Keys sorted at every level: the same content always hashes the same.
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical(value[k])]));
  }
  return value;
}
const hashOf = (value) => crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

// ------------------------------------------------------------------- scope

// The workspaces the caller is a member of (or owns), in their organization.
function memberWorkspaces(user, actor) {
  const rows = db.prepare(`
    SELECT w.* FROM workspaces w
    WHERE w.owner_id = ? OR EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = w.id AND m.user_id = ?)
    ORDER BY w.id
  `).all(user.id, user.id);
  return rows.filter((w) => wsAccess.inScope('workspaces', w, actor));
}

// `?workspace=` narrows the scope: ids or names, repeated or comma-separated.
function wantedWorkspaces(query) {
  const raw = query && query.workspace;
  const list = (Array.isArray(raw) ? raw : raw ? [raw] : []).flatMap((v) => String(v).split(',')).map((v) => v.trim()).filter(Boolean);
  return list.length ? new Set(list) : null;
}

/**
 * The caller's catalog scope: its workspaces, and the access checks the
 * browser applies, bound to the request.
 */
function scopeFor(req, access) {
  const actor = wsAccess.actorOf(req);
  const wanted = wantedWorkspaces(req.query);
  const workspaces = memberWorkspaces(req.user, actor).filter((w) => !wanted || wanted.has(w.id) || wanted.has(w.name));
  return { req, user: req.user, actor, access, workspaces, ids: new Set(workspaces.map((w) => w.id)) };
}

const sharesOf = (table, column, id) => db.prepare(`SELECT workspace_id FROM ${table} WHERE ${column} = ?`).all(id).map((r) => r.workspace_id);

function inWorkspaces(scope, homeId, sharedIds) {
  return (homeId && scope.ids.has(homeId)) || sharedIds.some((id) => scope.ids.has(id));
}

function scopedReports(scope) {
  return db.prepare('SELECT * FROM reports WHERE draft = 0 ORDER BY id').all()
    .filter((r) => inWorkspaces(scope, r.workspace_id, sharesOf('workspace_reports', 'report_id', r.id))
      && scope.access.canAccessReport(r, scope.user, scope.req));
}

// Models homed or shared in the scope's workspaces, and those its reports are built on.
function scopedModels(scope) {
  const behindReports = new Set(scopedReports(scope).map((r) => r.model_id).filter(Boolean));
  return db.prepare('SELECT * FROM models ORDER BY id').all()
    .filter((m) => (behindReports.has(m.id) || inWorkspaces(scope, wsAccess.modelHome(m), wsAccess.sharedWorkspaceIdsOf(m.id)))
      && scope.access.canAccessModel(m, scope.user, scope.req));
}

// The sources behind the scope's models, and those homed in its workspaces,
// that the caller may read the structure of (as in the browser).
function scopedDatasources(scope) {
  const wanted = new Set();
  for (const m of scopedModels(scope)) {
    wanted.add(m.datasource_id);
    for (const l of linkedSourcesOf(m.id)) wanted.add(l.datasource_id);
  }
  return db.prepare('SELECT * FROM datasources ORDER BY id').all()
    .filter((ds) => (wanted.has(ds.id) || scope.ids.has(wsAccess.datasourceHome(ds))) && wsAccess.canReadDatasource(ds, scope.actor));
}

// ----------------------------------------------------------------- objects

function workspaceOut(w) {
  const body = { id: w.id, name: w.name, description: w.description || '', is_personal: !!w.is_personal };
  return { ...body, updated_at: w.updated_at || w.created_at || null, hash: hashOf(body) };
}

// Where a source is, never how to log in: only these keys of extra_config
// ever leave (credentials, key files and connect strings stay).
const PUBLIC_EXTRA = ['projectId', 'dataset', 'location', 'schema', 'catalog', 'instanceName', 'account', 'warehouse'];
const DEFAULT_SCHEMA = { postgres: 'public', azure_postgres: 'public', redshift: 'public', mssql: 'dbo' };

function datasourceOut(ds) {
  const extra = parse(ds.extra_config, {});
  const file = ds.db_type === 'duckdb';
  const body = file
    ? {
      id: ds.id,
      name: ds.name,
      workspace_id: wsAccess.datasourceHome(ds),
      type: 'file',
      db_type: ds.db_type,
      default_schema: 'main',
      files: (Array.isArray(extra.files) && extra.files.length ? extra.files : [extra]).map((f) => f && f.sourceFile).filter(Boolean),
    }
    : {
      id: ds.id,
      name: ds.name,
      workspace_id: wsAccess.datasourceHome(ds),
      type: 'database',
      db_type: ds.db_type,
      host: ds.host || null,
      port: ds.port || null,
      db_name: ds.db_name || null,
      default_schema: extra.schema || (ds.db_type === 'bigquery' ? extra.dataset || null : DEFAULT_SCHEMA[ds.db_type] || null),
      ...Object.fromEntries(PUBLIC_EXTRA.filter((k) => k !== 'schema' && typeof extra[k] === 'string' && extra[k]).map((k) => [k, extra[k]])),
    };
  // A source row has no modification date: the hash says when it changed.
  return { ...body, updated_at: ds.created_at || null, hash: hashOf(body) };
}

function sourcesOf(model) {
  const linked = linkedSourcesOf(model.id);
  const ids = [model.datasource_id, ...linked.map((l) => l.datasource_id)];
  const sources = new Map(ids.map((id) => [id, db.prepare('SELECT id, db_type, name FROM datasources WHERE id = ?').get(id)]).filter(([, v]) => v));
  return { primary: sources.get(model.datasource_id) || null, linked, sources };
}

const filtersOut = (rules) => (Array.isArray(rules) ? rules : []).filter((r) => r && r.field).map((r) => ({
  field: r.field,
  ...(r.isMeasure ? { is_measure: true } : {}),
  op: r.op,
  ...(Array.isArray(r.values) && r.values.length ? { values: r.values } : r.value !== undefined && r.value !== '' ? { value: r.value } : {}),
}));

const OPTIONS = ['runningTotal', 'periodShift', 'lastValue', 'perPeriod', 'since', 'times', 'overrideFilters'];

// A measure's definition, as written in the model or the report.
function measureDefinition(m, ctx) {
  return {
    name: m.name,
    label: m.label || m.name,
    description: m.description || '',
    synonyms: Array.isArray(m.synonyms) ? m.synonyms : [],
    glossary_updated_at: m.glossaryUpdatedAt || null,
    role: m.role || null,
    format: m.format || null,
    aggregation: m.aggregation || null,
    table: m.table || null,
    column: m.column || null,
    filters: filtersOut(m.filterRules),
    expression: m.aggregation === 'custom' ? m.expression || '' : null,
    ...Object.fromEntries(OPTIONS.filter((k) => m[k] !== undefined && m[k] !== false && m[k] !== null).map((k) => [k, m[k]])),
    depends_on: lineage.dependsOn(m, ctx.measures),
    source_columns: lineage.sourceColumns(m, ctx),
  };
}

function dimensionOut(d) {
  return {
    name: d.name,
    label: d.label || d.name,
    description: d.description || '',
    synonyms: Array.isArray(d.synonyms) ? d.synonyms : [],
    glossary_updated_at: d.glossaryUpdatedAt || null,
    role: d.role || null,
    table: d.table || null,
    column: d.column || null,
    expression: d.expression || null,
    type: d.type || null,
    ...(d.datePart ? { date_part: d.datePart, date_part_of: d.datePartOf || null } : {}),
  };
}

const joinOut = (j) => ({
  from_table: j.from_table,
  from_column: j.from_column,
  to_table: j.to_table,
  to_column: j.to_column,
  join_type: j.join_type || j.type || null,
  cardinality: j.cardinality || null,
});

// A model's definition (everything but compiled SQL): what its hash covers.
function modelDefinition(row) {
  const model = parseModel(row);
  const { primary, linked, sources } = sourcesOf(model);
  const ctx = lineage.lineageContext({ model, primary, linked, sources });
  const body = {
    id: model.id,
    name: model.name,
    description: model.description || '',
    workspace_id: wsAccess.modelHome(row),
    shared_in: wsAccess.sharedWorkspaceIdsOf(model.id),
    domains: Array.isArray(model.domains) ? model.domains : [],
    datasources: [
      { datasource_id: model.datasource_id, alias: null, primary: true },
      ...linked.map((l) => ({ datasource_id: l.datasource_id, alias: l.alias, primary: false })),
    ],
    tables: lineage.modelTables(ctx, model),
    joins: (model.joins || []).map(joinOut),
    dimensions: (model.dimensions || []).map(dimensionOut),
    measures: (model.measures || []).map((m) => measureDefinition(m, ctx)),
    rls: { has_rls: !!(model.rls && model.rls.enabled) },
  };
  return { model, ctx, body, hash: hashOf(body), dbType: primary ? primary.db_type : null };
}

function modelSummary(row) {
  const { body, hash } = modelDefinition(row);
  return { id: body.id, name: body.name, description: body.description, workspace_id: body.workspace_id, domains: body.domains, updated_at: row.updated_at, hash };
}

const canCompileReportSql = (scope, row) => scope.user.role === 'admin' || scope.user.id === row.user_id || scope.access.canWriteModel(row, scope.user, scope.req);

async function compiled(scope, def, m, report, deps) {
  const refs = lineage.dependsOn(m, def.ctx.measures).map((n) => def.ctx.measures.find((x) => x.name === n)).filter(Boolean);
  return compileMeasure({
    user: scope.user,
    orgId: scope.req.organizationId || null,
    model: def.model,
    measure: m,
    refs,
    dbType: def.dbType,
    report,
    canCompileReportSql: canCompileReportSql(scope, def.model),
    version: report ? `${def.hash}:${report.hash}` : def.hash,
  }, deps);
}

// The full model: its definition, each measure with the SQL the compiler writes.
async function modelOut(scope, row, deps = {}) {
  const def = modelDefinition(row);
  const measures = [];
  for (const m of def.model.measures || []) {
    measures.push({ ...measureDefinition(m, def.ctx), ...(await compiled(scope, def, m, null, deps)) });
  }
  return { ...def.body, measures, updated_at: row.updated_at, hash: def.hash };
}

// ----------------------------------------------------------------- reports

const MEASURE_KEYS = ['selectedMeasures', 'comboBarMeasures', 'comboLineMeasures'];
const DIMENSION_KEYS = ['selectedDimensions', 'groupBy', 'columnDimensions'];
// A field bound as a variant ("x@@agg:max", "x@@tp:ytd") reads the field x.
const fieldOf = (name) => String(name).split('@@')[0];
const uniq = (list) => [...new Set(list.filter(Boolean))];

// A widget's id is unique within its report only: an imported or duplicated
// report keeps its source's widget ids. A catalog names charts across reports,
// so `id` is the report's id and the widget's; `widget_id` is the report's own.
function widgetOut(reportId, id, w, dimensionNames) {
  const b = w.dataBinding || {};
  const scatter = b.scatterMeasures || {};
  const measures = [...MEASURE_KEYS.flatMap((k) => b[k] || []), scatter.x, scatter.y, scatter.size, b.colorMeasure];
  const dims = [...DIMENSION_KEYS.flatMap((k) => b[k] || []), b.compareDateDim];
  // A dimension read as a measure ("x@@agg:max") is still the dimension x.
  return {
    id: `${reportId}:${id}`,
    widget_id: id,
    title: (w.config && w.config.title) || '',
    type: w.type,
    measures: uniq(measures.filter((n) => n && !dimensionNames.has(fieldOf(n))).map(fieldOf)),
    dimensions: uniq([...dims, ...measures.filter((n) => n && dimensionNames.has(fieldOf(n)))].filter(Boolean).map(fieldOf)),
    filters: filtersOut(b.widgetFilters),
  };
}

function reportPages(settings, report) {
  const pages = Array.isArray(settings.pages) && settings.pages.length
    ? settings.pages
    : [{ id: 'page-1', name: 'Page 1', widgets: parse(report.widgets, {}) }];
  return pages;
}

const reportExtrasOf = (settings) => ({
  extraMeasures: Array.isArray(settings.extraMeasures) ? settings.extraMeasures : [],
  extraDimensions: Array.isArray(settings.extraDimensions) ? settings.extraDimensions : [],
  measureOverrides: settings.measureOverrides && typeof settings.measureOverrides === 'object' ? settings.measureOverrides : {},
  dimensionOverrides: settings.dimensionOverrides && typeof settings.dimensionOverrides === 'object' ? settings.dimensionOverrides : {},
});

// A report's definition: its pages and widgets, its own measures and dimensions.
function reportDefinition(r, baseUrl) {
  const settings = parse(r.settings, {});
  const extras = reportExtrasOf(settings);
  const modelRow = r.model_id ? db.prepare('SELECT * FROM models WHERE id = ?').get(r.model_id) : null;
  const model = modelRow ? parseModel(modelRow) : null;
  const dimensionNames = new Set([...(model ? model.dimensions : []), ...extras.extraDimensions].map((d) => d && d.name));
  let ctx = null;
  if (model) {
    const { primary, linked, sources } = sourcesOf(model);
    const tagged = extras.extraMeasures.map((m) => ({ ...m, _source: 'report' }));
    // The report's overrides rename or re-type the model's fields, as /query applies them.
    const over = (list, ov) => list.map((f) => (ov[f.name] ? { ...f, ...ov[f.name] } : f));
    const seen = { ...model, measures: over(model.measures, extras.measureOverrides), dimensions: over(model.dimensions, extras.dimensionOverrides) };
    ctx = lineage.lineageContext({ model: seen, primary, linked, sources, extraMeasures: tagged, extraDimensions: extras.extraDimensions });
  }
  const owner = db.prepare('SELECT email FROM users WHERE id = ?').get(r.user_id);
  const body = {
    id: r.id,
    title: r.title,
    workspace_id: r.workspace_id || null,
    shared_in: sharesOf('workspace_reports', 'report_id', r.id),
    model_id: r.model_id || null,
    url: `${baseUrl}/view/${r.id}`,
    owner: owner ? owner.email : null,
    pages: reportPages(settings, r).map((p) => ({
      id: p.id,
      name: p.name || '',
      widgets: Object.entries(p.widgets || {}).filter(([, w]) => w && !DECOR.has(w.type)).map(([id, w]) => widgetOut(r.id, id, w, dimensionNames)),
    })),
    dimensions: extras.extraDimensions.filter((d) => d && d.name).map(dimensionOut),
    measures: ctx ? extras.extraMeasures.filter((m) => m && m.name).map((m) => measureDefinition({ ...m, _source: 'report' }, ctx)) : [],
  };
  return { body, hash: hashOf(body), extras, ctx, modelRow };
}

async function reportOut(scope, r, baseUrl, deps = {}) {
  const def = reportDefinition(r, baseUrl);
  if (def.modelRow && def.ctx) {
    const modelDef = { ...modelDefinition(def.modelRow), ctx: def.ctx };
    const report = { id: r.id, hash: def.hash, extras: def.extras };
    const measures = [];
    for (const m of def.ctx.measures.filter((x) => x._source === 'report')) {
      measures.push({ ...def.body.measures.find((x) => x.name === m.name), ...(await compiled(scope, modelDef, m, report, deps)) });
    }
    def.body.measures = measures;
  }
  return { ...def.body, updated_at: r.updated_at, hash: def.hash };
}

// -------------------------------------------------------------- explain

/**
 * How a measure is computed, for a person or an AI: what it is made of down to
 * the columns, the filters on the way, its compiled SQL, and whether the rows
 * read depend on who reads them (RLS) — never the rules themselves.
 */
async function explainMeasure(scope, { modelRow, report = null, name }, deps = {}) {
  const def = modelDefinition(modelRow);
  let ctx = def.ctx;
  let reportCtx = null;
  if (report) {
    const rdef = reportDefinition(report, '');
    ctx = rdef.ctx;
    reportCtx = { id: report.id, hash: rdef.hash, extras: rdef.extras };
  }
  const m = ctx.measures.find((x) => x.name === name) || ctx.measures.find((x) => x.label === name);
  if (!m) return null;
  const definition = measureDefinition(m, ctx);
  const sql = await compiled(scope, { ...def, ctx }, m, m._source === 'report' ? reportCtx : null, deps);
  const node = (x) => ({
    name: x.name,
    label: x.label || x.name,
    defined_in: x._source === 'report' ? 'report' : 'model',
    aggregation: x.aggregation || null,
    expression: x.aggregation === 'custom' ? x.expression || '' : null,
    column: x.aggregation !== 'custom' && x.table && x.column ? { ...lineage.physicalTable(x.table, ctx), column: x.column } : null,
    filters: filtersOut(x.filterRules),
  });
  const tree = (x, path) => ({
    ...node(x),
    references: lineage.directRefs(x, ctx.measures)
      .filter((n) => !path.includes(n))
      .map((n) => ctx.measures.find((y) => y.name === n))
      .filter(Boolean)
      .map((y) => tree(y, [...path, y.name])),
  });
  const hasRls = !!(def.model.rls && def.model.rls.enabled);
  return {
    metadata_format: METADATA_FORMAT,
    model: { id: def.model.id, name: def.model.name },
    ...(report ? { report: { id: report.id, title: report.title } } : {}),
    measure: { ...definition, ...sql },
    tree: tree(m, [m.name]),
    filters_applied: [m, ...definition.depends_on.map((n) => ctx.measures.find((y) => y.name === n)).filter(Boolean)]
      .flatMap((x) => filtersOut(x.filterRules).map((f) => ({ measure: x.name, ...f }))),
    rls: {
      has_rls: hasRls,
      ...(hasRls ? { note: 'Row-level security applies: each reader sees the figure over the rows they are allowed. The rules are not exposed.' } : {}),
    },
    summary: summaryOf(m, ctx, definition, sql),
  };
}

// One paragraph a person (or an agent quoting it) can read.
function summaryOf(m, ctx, definition, sql) {
  const label = m.label || m.name;
  const what = m.aggregation === 'custom'
    ? `computed as ${m.expression}`
    : `${String(m.aggregation || 'sum').toUpperCase()} of ${m.table}.${m.column}`;
  const refs = definition.depends_on.map((n) => {
    const x = ctx.measures.find((y) => y.name === n);
    return x ? `${x.label || x.name} (${x.aggregation === 'custom' ? x.expression : `${String(x.aggregation || 'sum').toUpperCase()} of ${x.table}.${x.column}`})` : n;
  });
  const cols = definition.source_columns.map((c) => [c.schema, c.table, c.column].filter(Boolean).join('.'));
  return [
    `"${label}" is ${what}.`,
    refs.length ? `It uses ${refs.join('; ')}.` : '',
    definition.filters.length ? `Filtered on ${definition.filters.map((f) => `${f.field} ${f.op} ${JSON.stringify(f.values || f.value)}`).join(', ')}.` : '',
    cols.length ? `It reads ${cols.join(', ')}.` : '',
    sql.compiled_sql ? `SQL: ${sql.compiled_sql}` : sql.compiled_sql_note || '',
  ].filter(Boolean).join(' ');
}

module.exports = {
  METADATA_FORMAT,
  hashOf,
  scopeFor,
  scopedModels,
  scopedReports,
  scopedDatasources,
  workspaceOut,
  datasourceOut,
  modelSummary,
  modelOut,
  reportOut,
  explainMeasure,
};
