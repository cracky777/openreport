/**
 * Rollup builder — materialises pre-aggregated tables per (model, grain)
 * and maintains the `rollups` manifest. Replaces the GROUPING SETS warmer.
 *
 * Pipeline per grain:
 *   1. POST /api/models/:modelId/query over loopback with
 *      { dimensionNames: grain, measureNames: union, limit: MAX_ROWS }.
 *      This reuses the full SQL builder (joins, dialect quoting, RLS,
 *      measure decomposition) for free.
 *   2. The response rows are already aggregated at the requested grain.
 *      Land them in the storage backend:
 *        - storage_mode='duckdb' (default): write into the embedded
 *          rollups.duckdb file.
 *        - storage_mode='source'  (opt-in): not implemented in v1; we
 *          surface a typed error so the route handler can return 501.
 *   3. Upsert the `rollups` row with built_at, row_count, bytes.
 */

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const db = require('../db');
const internalToken = require('./internalToken');
const rollupDuckDB = require('./rollupDuckDB');
const { prepareGlobalRulesForWidget } = require('./reportFilterRules');
const { componentPlanForMeasures } = require('./measureType');

const MAX_ROLLUP_ROWS = Number(process.env.ROLLUP_MAX_ROWS || 1_000_000);

// Model ids whose rollups are currently being (re)built. The cache
// dashboard polls this so a spinner survives an F5 mid-build.
const _building = new Set();
function buildingModelIds() {
  return [..._building];
}

function appBase() {
  if (process.env.INTERNAL_APP_URL) return process.env.INTERNAL_APP_URL.replace(/\/+$/, '');
  const port = process.env.PORT || '3001';
  return `http://127.0.0.1:${port}`;
}

// SHA-256 truncated to 16 hex chars — enough collision resistance for a
// per-model grain set (we'd need to enumerate billions of distinct grain
// tuples on the same model to risk a clash). Truncating keeps physical
// table names under PG's 63-byte identifier limit.
function grainHashOf(dimNames) {
  const sorted = [...dimNames].sort();
  return crypto.createHash('sha256').update(sorted.join('|')).digest('hex').slice(0, 16);
}

function shortHash(value, len = 8) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, len);
}

// Canonical form of a global-filter rule set, so the same selection
// hashes identically at build and at runtime regardless of array order.
// `exclusions` is already applied upstream (prepareGlobalRulesForWidget /
// the client mirror) so it's not part of the identity. Values are sorted
// because IN-list order is semantically irrelevant.
function normalizeFilterRules(rules) {
  if (!Array.isArray(rules)) return [];
  return rules
    .filter((r) => r && !r.isMeasure && typeof r.field === 'string' && r.field && r.op)
    .map((r) => {
      const vals = Array.isArray(r.values) ? r.values
        : (Array.isArray(r.value) ? r.value : (r.value !== undefined ? [r.value] : []));
      return {
        field: r.field,
        op: r.op,
        values: vals.map((v) => (v === null || v === undefined ? null : String(v))).sort(),
      };
    })
    .sort((a, b) => (a.field + a.op).localeCompare(b.field + b.op));
}

function baseFilterHashOf(rules) {
  const norm = normalizeFilterRules(rules);
  if (norm.length === 0) return '0';
  return crypto.createHash('sha256').update(JSON.stringify(norm)).digest('hex').slice(0, 16);
}

// Physical rollup table name. Embeds short hashes of model + grain +
// baked-global-filter (and org on cloud) so a hostile model id can't
// collide with another tenant's rollup, and so the same grain under two
// different global-filter selections gets two distinct tables. All
// tables share the `or_rollup_` prefix so they're easy to spot in a
// shared DB and never collide with user tables.
function rollupTableName({ modelId, grainHash, baseFilterHash, orgId }) {
  const parts = ['or_rollup'];
  if (orgId) parts.push(shortHash(orgId));
  parts.push(shortHash(modelId));
  parts.push(grainHash.slice(0, 8));
  parts.push((baseFilterHash || '0').slice(0, 8));
  return parts.join('_');
}

// ─── Grain enumeration ────────────────────────────────────────────────────
//
// Walk every report attached to the model, collect the set of distinct
// grain tuples we want to be able to serve from a rollup. A grain tuple
// is the set of dimensions a runtime query might GROUP BY:
//   - widget.dataBinding.selectedDimensions  (drill prefixes for drillable
//     widget types)
//   - widget.dataBinding.groupBy
//   - widget.dataBinding.columnDimensions
//   - cross-filter dims contributed by sibling widgets (per subset)
//   - widgetOwnFilters dim names with fixed values (so a single rollup
//     covers the WHERE for that widget at runtime — per user decision)
//
// The union of measures across every walked widget becomes the rollup's
// measure column set: each rollup stores every measure the model needs.

function powerSet(arr) {
  const result = [[]];
  for (const item of arr) {
    const len = result.length;
    for (let i = 0; i < len; i++) result.push([...result[i], item]);
  }
  return result;
}

function crossFilterDimsForWidget(widgets, targetWId) {
  const out = new Set();
  for (const [sourceWId, w] of Object.entries(widgets || {})) {
    if (!w || !w.dataBinding) continue;
    if (sourceWId === targetWId) continue;
    const exclusions = Array.isArray(w.config?.crossFilterExclusions)
      ? w.config.crossFilterExclusions
      : [];
    if (exclusions.includes(targetWId)) continue;
    const b = w.dataBinding;
    for (const d of (b.selectedDimensions || [])) out.add(d);
    if (w.type !== 'filter') {
      for (const d of (b.groupBy || [])) out.add(d);
      for (const d of (b.columnDimensions || [])) out.add(d);
    }
  }
  return [...out];
}

// Per the architecture decision, widget-level filters with a fixed value
// fold INTO the grain — the planner re-applies the WHERE at query time.
// Measure-level filters (HAVING) don't compose this way and are ignored
// here; widgets that rely on them fall through to the live SQL path.
function fixedFilterDims(widgetFilters) {
  if (!Array.isArray(widgetFilters)) return [];
  const out = new Set();
  for (const f of widgetFilters) {
    if (!f || f.isMeasure) continue;
    if (typeof f.field !== 'string' || !f.field) continue;
    out.add(f.field);
  }
  return [...out];
}

function grainsForWidget(w, widgetId, allWidgets) {
  const b = w.dataBinding || {};
  const dims = b.selectedDimensions || [];
  const grpBy = b.groupBy || [];
  const colDims = b.columnDimensions || [];
  const baseDims = [...new Set([...dims, ...grpBy, ...colDims])];

  const DRILLABLE = ['bar', 'line', 'combo', 'pie', 'treemap'];
  const isDrillable = DRILLABLE.includes(w.type) && dims.length > 1;
  const baseGrains = isDrillable
    ? dims.map((_, i) => {
        const prefix = dims.slice(0, i + 1);
        return [...new Set([...prefix, ...grpBy, ...colDims])];
      })
    : (baseDims.length > 0 ? [baseDims] : [[]]);

  const xfDims = crossFilterDimsForWidget(allWidgets, widgetId);
  const xfSubsets = powerSet(xfDims);
  // Only the widget's OWN fixed filters fold into the grain (so the
  // planner can re-apply them at runtime). The report's GLOBAL filter
  // bar is NOT in the grain — it's baked into the rollup at build time
  // (see planRollupsForModel / fetchRollupRows). Cross-filter dims are
  // covered by the xf subsets above.
  const filterDims = fixedFilterDims(b.widgetFilters);

  const out = [];
  const seen = new Set();
  for (const grain of baseGrains) {
    for (const xf of xfSubsets) {
      const combined = [...new Set([...grain, ...xf, ...filterDims])];
      // Empty combined = a pure scorecard (no display/drill/xf/own-filter
      // dims). We DO materialise it as a grand-total rollup (1 row =
      // the aggregate over the baked-global-filter slice) so the planner
      // serves it exact instead of falling through to Postgres on every
      // drill / cross-filter refresh.
      const key = combined.slice().sort().join('|'); // '' for the empty grain
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(combined);
    }
  }
  return out;
}

function measureNamesForWidget(w) {
  const b = w.dataBinding || {};
  if (w.type === 'scatter') {
    const sm = b.scatterMeasures || {};
    return [sm.x, sm.y, sm.size].filter(Boolean);
  }
  if (w.type === 'combo') {
    return [...(b.comboBarMeasures || []), ...(b.comboLineMeasures || [])];
  }
  return b.selectedMeasures || [];
}

// Pull a report's report-scoped extension context out of settings. Dims
// and measures in a widget binding can reference these (e.g. a date-part
// dim `_date.month_name` or a calculated measure `_calc.%`) — they're
// NOT on the model, so the /query build must receive them or it 400s
// with "Missing in model".
function reportExtras(settings) {
  const s = settings || {};
  return {
    extraDimensions: Array.isArray(s.extraDimensions) ? s.extraDimensions : [],
    extraMeasures: Array.isArray(s.extraMeasures) ? s.extraMeasures : [],
    dimensionOverrides: (s.dimensionOverrides && typeof s.dimensionOverrides === 'object') ? s.dimensionOverrides : {},
    measureOverrides: (s.measureOverrides && typeof s.measureOverrides === 'object') ? s.measureOverrides : {},
  };
}

// Plan is per-(report, grain, baked-global-filter). Each widget's grain
// (display + drill + cross-filter + widget-own fixed-filter dims — NOT
// the global filter bar) is materialised under the slice defined by that
// widget's effective global-filter rules (`prepareGlobalRulesForWidget`,
// which already drops the widget's exclusions). Two widgets at the same
// grain but different global-filter selections / exclusion sets produce
// two plan items with distinct physical tables (the base_filter_hash
// segment). Two reports on the same model that collide on
// (grain, base_filter) overwrite — last build wins (v1 limitation).
function planRollupsForModel(modelId) {
  const reports = db.prepare(
    'SELECT id, widgets, settings FROM reports WHERE model_id = ?'
  ).all(modelId);

  const plan = [];
  const seen = new Set();        // `${hash}::${baseFilterHash}` dedupe
  const allMeasures = new Set();

  for (const r of reports) {
    let widgets = {};
    let settings = {};
    try { widgets = JSON.parse(r.widgets || '{}'); } catch { /* malformed */ }
    try { settings = JSON.parse(r.settings || '{}'); } catch { /* malformed */ }
    const extras = reportExtras(settings);
    const reportFilters = Array.isArray(settings.reportFilters) ? settings.reportFilters : [];

    // Every measure this report's widgets reference — resolvable under
    // this report's extras context. Each of the report's rollups carries
    // the full set so any drill level can be served from one table.
    const reportMeasures = new Set();
    for (const w of Object.values(widgets)) {
      if (!w || !w.dataBinding) continue;
      if (w.type === 'text' || w.type === 'shape') continue;
      for (const m of measureNamesForWidget(w)) {
        reportMeasures.add(m);
        allMeasures.add(m);
      }
    }
    const measures = [...reportMeasures];

    for (const [wId, w] of Object.entries(widgets)) {
      if (!w || !w.dataBinding) continue;
      if (w.type === 'text' || w.type === 'shape') continue;
      // Effective global filter for THIS widget — the same set the
      // client merges into its widgetFilters at runtime (exclusions
      // already applied). Baked into the rollup; NOT in the grain.
      const baseFilters = prepareGlobalRulesForWidget(reportFilters, wId)
        .filter((rule) => rule && !rule.isMeasure && typeof rule.field === 'string' && rule.field && rule.op);
      const baseFilterHash = baseFilterHashOf(baseFilters);
      for (const grain of grainsForWidget(w, wId, widgets)) {
        const hash = grainHashOf(grain);
        const key = `${hash}::${baseFilterHash}`;
        if (seen.has(key)) continue;
        seen.add(key);
        plan.push({ grain, hash, measures, reportId: r.id, extras, baseFilters, baseFilterHash });
      }
    }
  }

  // Larger grains build first — if a run is interrupted, the broad
  // covers (which serve the most runtime requests) are the ones kept.
  plan.sort((a, b) => b.grain.length - a.grain.length);
  return { plan, measures: [...allMeasures] };
}

// ─── Build a single rollup ────────────────────────────────────────────────

async function fetchRollupRows({
  modelId, grain, fireNames, syntheticExtras, internalUserId, orgId, reportId, extras, baseFilters,
}) {
  const token = internalToken.sign({ userId: internalUserId, organizationId: orgId || null });
  const url = `${appBase()}/api/models/${modelId}/query`;
  const ex = extras || {};
  // We materialise additive COMPONENTS, not final non-additive values:
  // `fireNames` = the named base measures (simple measures + ratio /
  // expression refs); `syntheticExtras` = AVG SUM/COUNT components
  // injected as inline extraMeasures. The planner recomposes ratios /
  // AVG / expressions from these at any grain.
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [internalToken.HEADER]: token,
    },
    body: JSON.stringify({
      dimensionNames: grain,
      measureNames: fireNames,
      // Bake the report's global filter bar into the rollup: /query
      // applies these via the model join graph exactly as it would at
      // runtime (a filter with no join relation to the widget is
      // ignored identically here and at runtime). The grain carries
      // ONLY display/drill/cross-filter/widget-own dims, so the rollup
      // is the already-filtered slice.
      widgetFilters: Array.isArray(baseFilters) ? baseFilters : [],
      limit: MAX_ROLLUP_ROWS,
      bypassCache: true,
      _rollupBuilder: true,
      // Report-scoped context so /query can resolve report extras
      // (calc measures, date-part dims, label overrides). reportId is
      // the persisted-extras fallback for non-owner internal callers;
      // the explicit extra* arrays cover the owner/admin path.
      reportId,
      extraDimensions: ex.extraDimensions || [],
      extraMeasures: [...(ex.extraMeasures || []), ...(syntheticExtras || [])],
      dimensionOverrides: ex.dimensionOverrides || {},
      measureOverrides: ex.measureOverrides || {},
    }),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`/query failed (${r.status}): ${text.slice(0, 200)}`);
  }
  const payload = await r.json();
  return Array.isArray(payload?.rows) ? payload.rows : [];
}

// Load the model's dim + measure definitions and build name→outputKey
// maps. The /query route aliases each column by `label || name`, so the
// rows we get back are keyed by label. The rollup table stores columns
// by NAME (stable, dialect-friendly) — this map drives the translation
// at INSERT time and the reverse lookup at planner time.
function buildNameLabelMaps(modelId, extras) {
  const model = db.prepare('SELECT dimensions, measures FROM models WHERE id = ?').get(modelId);
  let dims = [];
  let meas = [];
  if (model) {
    try { dims = JSON.parse(model.dimensions || '[]'); } catch { /* malformed */ }
    try { meas = JSON.parse(model.measures || '[]'); } catch { /* malformed */ }
  }
  const ex = extras || {};
  // Report extras participate in the /query SELECT aliasing exactly like
  // model fields, so the label map must cover them too — otherwise the
  // INSERT remap can't find the row key for an extra dim/measure.
  dims = [...dims, ...(ex.extraDimensions || [])];
  meas = [...meas, ...(ex.extraMeasures || [])];
  const dimLabel = {};
  const measureLabel = {};
  for (const d of dims) if (d && d.name) dimLabel[d.name] = d.label || d.name;
  for (const m of meas) if (m && m.name) measureLabel[m.name] = m.label || m.name;
  // Overrides can rename a model field per-report (changes its alias).
  for (const [name, ov] of Object.entries(ex.dimensionOverrides || {})) {
    if (ov && ov.label) dimLabel[name] = ov.label;
  }
  for (const [name, ov] of Object.entries(ex.measureOverrides || {})) {
    if (ov && ov.label) measureLabel[name] = ov.label;
  }
  return { dimLabel, measureLabel };
}

// Merged measure DEF pool for a report context (model.measures +
// report extraMeasures, with measureOverrides shallow-merged) — the
// same set /query resolves. Used to decompose each output measure into
// its additive component columns.
function loadMeasureDefs(modelId, extras) {
  const model = db.prepare('SELECT measures FROM models WHERE id = ?').get(modelId);
  let defs = [];
  if (model) { try { defs = JSON.parse(model.measures || '[]'); } catch { /* malformed */ } }
  defs = Array.isArray(defs) ? defs.slice() : [];
  const ex = extras || {};
  const ov = ex.measureOverrides || {};
  defs = defs.map((m) => (m && m.name && ov[m.name]) ? { ...m, ...ov[m.name] } : m);
  for (const m of (ex.extraMeasures || [])) {
    if (m && m.name && !defs.find((x) => x && x.name === m.name)) defs.push(m);
  }
  const byName = new Map();
  for (const m of defs) if (m && m.name) byName.set(m.name, m);
  return { defs, byName };
}

function inferColumnType(rows, col) {
  for (const row of rows) {
    const v = row[col];
    if (v === null || v === undefined) continue;
    if (typeof v === 'number') {
      return Number.isInteger(v) ? 'BIGINT' : 'DOUBLE';
    }
    if (typeof v === 'boolean') return 'BOOLEAN';
    if (v instanceof Date) return 'TIMESTAMP';
    if (typeof v === 'string') {
      // ISO date heuristic — keeps date-typed dims as DATE so range
      // filters in the planner emit correctly.
      if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return 'DATE';
      if (/^\d{4}-\d{2}-\d{2}T/.test(v)) return 'TIMESTAMP';
      return 'VARCHAR';
    }
    return 'VARCHAR';
  }
  return 'VARCHAR'; // all-null column — VARCHAR is the safe default
}

async function buildRollupToDuckDB({ tableName, grain, atomCols, rows, dimLabel, measureLabel }) {
  // DuckDB column name = the dim NAME / atom column id (stable). The
  // matching /query row key is the LABEL (or NAME when no label). For
  // synthetic AVG components the /query alias == the atom id (no label),
  // so the `|| n` fallback resolves them correctly.
  const columns = [...grain, ...atomCols];
  const atomSet = new Set(atomCols);
  const nameToRowKey = {};
  for (const n of grain) nameToRowKey[n] = dimLabel[n] || n;
  for (const n of atomCols) nameToRowKey[n] = measureLabel[n] || n;
  const toNum = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const remapped = rows.map((row) => {
    const out = {};
    for (const col of columns) {
      const v = row[nameToRowKey[col]];
      // Atom columns are always numeric aggregates. node-postgres returns
      // NUMERIC/BIGINT as STRINGS — without coercion inferColumnType sees
      // a string and types the column VARCHAR, then SUM(VARCHAR) fails at
      // query time. Force them to numbers (non-numeric → null).
      out[col] = atomSet.has(col) ? toNum(v) : v;
    }
    return out;
  });
  const colSpecs = columns.map((c) => {
    const t = atomSet.has(c) ? 'DOUBLE' : inferColumnType(remapped, c);
    return `"${c.replace(/"/g, '""')}" ${t}`;
  });
  await rollupDuckDB.dropTable(tableName);
  await rollupDuckDB.run(`CREATE TABLE "${tableName}" (${colSpecs.join(', ')})`);
  await rollupDuckDB.insertRows(tableName, columns, remapped);
  // Per-grain volumetry estimate. DuckDB exposes no clean per-table
  // byte size (`duckdb_tables().estimated_size` is row cardinality), so
  // we estimate row width from the materialised data: 8 B per numeric/
  // atom/date cell, sampled average string length (+1) per VARCHAR cell.
  // Good enough to compare which grains are heavy.
  const sample = remapped.slice(0, 200);
  let rowWidth = 0;
  for (const c of columns) {
    if (atomSet.has(c)) { rowWidth += 8; continue; }
    let isNumeric = true;
    let lenSum = 0;
    let lenN = 0;
    for (const r of sample) {
      const v = r[c];
      if (v === null || v === undefined) continue;
      if (typeof v === 'number') { lenSum += 8; lenN++; continue; }
      isNumeric = false;
      lenSum += String(v).length + 1;
      lenN++;
    }
    rowWidth += lenN === 0 ? 8 : (isNumeric ? 8 : Math.ceil(lenSum / lenN));
  }
  const bytes = remapped.length * rowWidth;
  return { rowCount: remapped.length, bytes };
}

async function buildRollup({
  modelId,
  grain,
  measures,
  storageMode = 'duckdb',
  internalUserId,
  orgId,
  reportId,
  extras,
  baseFilters = [],
  baseFilterHash,
}) {
  const hash = grainHashOf(grain);
  const bfHash = baseFilterHash || baseFilterHashOf(baseFilters);
  const tableName = rollupTableName({ modelId, grainHash: hash, baseFilterHash: bfHash, orgId });

  // Decompose every output measure into its additive component columns.
  const { byName: measureByName, defs: allMeasureDefs } = loadMeasureDefs(modelId, extras);
  const outputDefs = measures
    .map((n) => measureByName.get(n))
    .filter(Boolean);
  const plan = componentPlanForMeasures(outputDefs, allMeasureDefs);

  const rows = await fetchRollupRows({
    modelId, grain,
    fireNames: plan.fireNames,
    syntheticExtras: plan.extraMeasures,
    internalUserId, orgId, reportId, extras, baseFilters,
  });
  const maps = buildNameLabelMaps(modelId, extras);
  const atomCols = plan.atoms.map((a) => a.col);

  let rowCount = 0;
  let bytes = 0;
  if (storageMode === 'duckdb') {
    const result = await buildRollupToDuckDB({
      tableName, grain, atomCols, rows,
      dimLabel: maps.dimLabel,
      measureLabel: maps.measureLabel,
    });
    rowCount = result.rowCount;
    bytes = result.bytes;
  } else if (storageMode === 'source') {
    const err = new Error('Source-DB rollup storage is not yet supported (v1 = duckdb only)');
    err.code = 'ROLLUP_STORAGE_UNSUPPORTED';
    throw err;
  } else {
    throw new Error(`Unknown rollup storage mode: ${storageMode}`);
  }

  // Upsert manifest keyed by (model, grain, base_filter, org). Keeping
  // the row id stable across rebuilds protects any future FKs.
  const existing = db.prepare(
    `SELECT id FROM rollups
     WHERE model_id = ? AND grain_hash = ? AND base_filter_hash = ?
       AND (organization_id IS ? OR organization_id = ?)`
  ).get(modelId, hash, bfHash, orgId || null, orgId || null);

  const builtAt = new Date().toISOString();
  const baseFiltersJson = JSON.stringify(normalizeFilterRules(baseFilters));
  // `measures` JSON now carries the recompose recipe: per-output spec +
  // the physical atom columns with their re-agg fn.
  const measuresJson = JSON.stringify({ outputs: plan.outputs, atoms: plan.atoms });
  if (existing) {
    db.prepare(
      `UPDATE rollups SET storage_mode = ?, grain_dims = ?, measures = ?,
                          base_filters = ?, table_name = ?, built_at = ?,
                          row_count = ?, bytes = ?
       WHERE id = ?`
    ).run(
      storageMode,
      JSON.stringify(grain),
      measuresJson,
      baseFiltersJson,
      tableName,
      builtAt,
      rowCount,
      bytes,
      existing.id,
    );
    return { id: existing.id, tableName, rowCount, bytes, builtAt, rebuilt: true };
  }

  const id = uuidv4();
  db.prepare(
    `INSERT INTO rollups
       (id, model_id, organization_id, storage_mode, grain_hash, grain_dims,
        measures, base_filters, base_filter_hash, table_name, built_at,
        row_count, bytes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    modelId,
    orgId || null,
    storageMode,
    hash,
    JSON.stringify(grain),
    measuresJson,
    baseFiltersJson,
    bfHash,
    tableName,
    builtAt,
    rowCount,
    bytes,
  );
  return { id, tableName, rowCount, bytes, builtAt, rebuilt: false };
}

// ─── Orchestrators ────────────────────────────────────────────────────────

async function buildRollupsForModel(opts) {
  _building.add(opts.modelId);
  try {
    return await _buildRollupsForModelInner(opts);
  } finally {
    _building.delete(opts.modelId);
  }
}

async function _buildRollupsForModelInner({ modelId, internalUserId, orgId, log = false }) {
  const model = db.prepare('SELECT * FROM models WHERE id = ?').get(modelId);
  if (!model) throw new Error(`Model not found: ${modelId}`);
  const datasource = db.prepare('SELECT * FROM datasources WHERE id = ?').get(model.datasource_id);
  if (!datasource) throw new Error(`Datasource not found for model: ${modelId}`);

  const storageMode = datasource.rollup_storage === 'source' ? 'source' : 'duckdb';

  const { plan, measures } = planRollupsForModel(modelId);
  if (plan.length === 0) {
    return { fired: 0, built: 0, errors: [], measures };
  }
  if (log) {
    console.log(`[rollup] model=${modelId} grains=${plan.length} measures=${measures.length} storage=${storageMode}`);
  }

  let built = 0;
  const errors = [];
  const builtIds = new Set();
  for (const item of plan) {
    try {
      const r = await buildRollup({
        modelId,
        grain: item.grain,
        measures: item.measures,
        storageMode,
        internalUserId,
        orgId,
        reportId: item.reportId,
        extras: item.extras,
        baseFilters: item.baseFilters,
        baseFilterHash: item.baseFilterHash,
      });
      built++;
      builtIds.add(r.id);
      if (log) console.log(`[rollup] built ${r.tableName} rows=${r.rowCount} bytes=${r.bytes}`);
    } catch (err) {
      errors.push(`grain=[${item.grain.join(',')}] bf=${item.baseFilterHash} → ${err.message}`);
      if (log) console.warn(`[rollup] FAILED grain=[${item.grain.join(',')}] bf=${item.baseFilterHash} ${err.message}`);
    }
  }

  // Garbage collect rollups no widget needs anymore — keyed by
  // (grain_hash, base_filter_hash). Only prune when at least one rollup
  // built, so a transient DB failure can't wipe the whole manifest.
  if (built > 0) {
    const existing = db.prepare(
      `SELECT id, grain_hash, base_filter_hash, table_name FROM rollups
       WHERE model_id = ? AND (organization_id IS ? OR organization_id = ?)`
    ).all(modelId, orgId || null, orgId || null);
    const wanted = new Set(plan.map((p) => `${p.hash}::${p.baseFilterHash}`));
    for (const row of existing) {
      if (!wanted.has(`${row.grain_hash}::${row.base_filter_hash}`)) {
        try { await rollupDuckDB.dropTable(row.table_name); } catch { /* best-effort */ }
        db.prepare('DELETE FROM rollups WHERE id = ?').run(row.id);
        if (log) console.log(`[rollup] gc dropped ${row.table_name}`);
      }
    }

    // Physical-orphan sweep. The manifest GC above only knows about its
    // own rows — physical `or_rollup_*` tables left over from older
    // table-naming schemes (or other deleted models) are invisible to
    // it and would accumulate forever, since DuckDB never shrinks its
    // file. Drop every physical table NOT referenced by ANY manifest
    // row (manifest is the source of truth; rollups are regenerable),
    // then CHECKPOINT so the freed blocks are actually reclaimed.
    try {
      const live = new Set(
        db.prepare('SELECT table_name FROM rollups').all().map((r) => r.table_name)
      );
      const physical = await rollupDuckDB.listRollupTables();
      let swept = 0;
      for (const t of physical) {
        if (!live.has(t)) {
          try { await rollupDuckDB.dropTable(t); swept++; } catch { /* best-effort */ }
        }
      }
      await rollupDuckDB.checkpoint();
      if (log && swept > 0) console.log(`[rollup] orphan sweep dropped ${swept} stale table(s) + checkpoint`);
    } catch (err) {
      if (log) console.warn(`[rollup] orphan sweep failed: ${err.message}`);
    }
  }

  return { fired: plan.length, built, errors, measures };
}

// ─── Manifest CRUD ────────────────────────────────────────────────────────

function getManifest({ modelId, orgId }) {
  const rows = db.prepare(
    `SELECT id, model_id, organization_id, storage_mode, grain_hash, grain_dims,
            measures, base_filters, base_filter_hash, table_name, built_at,
            row_count, bytes
     FROM rollups
     WHERE model_id = ? AND (organization_id IS ? OR organization_id = ?)
     ORDER BY built_at DESC NULLS LAST`
  ).all(modelId, orgId || null, orgId || null);
  return rows.map((r) => ({
    id: r.id,
    modelId: r.model_id,
    organizationId: r.organization_id,
    storageMode: r.storage_mode,
    grainHash: r.grain_hash,
    grainDims: safeJSON(r.grain_dims, []),
    measures: safeJSON(r.measures, { outputs: [], atoms: [] }),
    measureNames: (safeJSON(r.measures, { outputs: [] }).outputs || []).map((o) => o.name),
    baseFilters: safeJSON(r.base_filters, []),
    baseFilterHash: r.base_filter_hash,
    tableName: r.table_name,
    builtAt: r.built_at,
    rowCount: r.row_count,
    bytes: r.bytes,
  }));
}

// Drops every base-filter variant of a grain (the HTTP route is keyed by
// grainHash only; a grain can now have multiple baked-filter slices).
async function dropRollup({ modelId, grainHash, orgId }) {
  const rows = db.prepare(
    `SELECT id, table_name, storage_mode FROM rollups
     WHERE model_id = ? AND grain_hash = ?
       AND (organization_id IS ? OR organization_id = ?)`
  ).all(modelId, grainHash, orgId || null, orgId || null);
  if (rows.length === 0) return { dropped: false };
  for (const row of rows) {
    if (row.storage_mode === 'duckdb') {
      try { await rollupDuckDB.dropTable(row.table_name); } catch { /* best-effort */ }
    }
    db.prepare('DELETE FROM rollups WHERE id = ?').run(row.id);
  }
  return { dropped: true, count: rows.length, tableNames: rows.map((r) => r.table_name) };
}

// Drop every rollup for a given model — called on model edit (schema
// change invalidates the materialised rows).
async function dropAllRollups({ modelId, orgId }) {
  const rows = db.prepare(
    `SELECT id, table_name FROM rollups
     WHERE model_id = ? AND (organization_id IS ? OR organization_id = ?)`
  ).all(modelId, orgId || null, orgId || null);
  for (const row of rows) {
    try { await rollupDuckDB.dropTable(row.table_name); } catch { /* best-effort */ }
  }
  db.prepare(
    `DELETE FROM rollups WHERE model_id = ? AND (organization_id IS ? OR organization_id = ?)`
  ).run(modelId, orgId || null, orgId || null);
  return { droppedCount: rows.length };
}

// Drop every rollup for every model on a datasource — called when the
// datasource connection params change (the materialised data may now
// point at a different DB / schema).
async function dropAllRollupsForDatasource({ datasourceId, orgId }) {
  const models = db.prepare('SELECT id FROM models WHERE datasource_id = ?').all(datasourceId);
  let total = 0;
  for (const m of models) {
    const r = await dropAllRollups({ modelId: m.id, orgId });
    total += r.droppedCount;
  }
  return { droppedCount: total };
}

// ─── Aggregate-aware planner helper ───────────────────────────────────────
//
// Picks the smallest rollup whose grain ⊇ requested grain. Used by the
// runtime /query route (Phase B) before SQL assembly.

// Smallest rollup whose grain ⊇ requested grain AND whose baked global
// filter matches the request's global-filter signature. `baseFilterHash`
// is mandatory: a rollup baked under filter A must never serve a request
// under filter B (it's a different data slice). `match` is 'exact' when
// the rollup grain == requested grain (no aggregation collapses rows —
// safe for non-additive measures), else 'superset'.
function findBestRollup({ modelId, grainDims, baseFilterHash, orgId }) {
  const wanted = new Set(grainDims);
  const wantedHash = grainHashOf(grainDims);
  const bf = baseFilterHash || '0';
  const candidates = db.prepare(
    `SELECT id, grain_hash, grain_dims, measures, table_name, storage_mode, row_count
     FROM rollups
     WHERE model_id = ? AND base_filter_hash = ?
       AND (organization_id IS ? OR organization_id = ?)`
  ).all(modelId, bf, orgId || null, orgId || null);

  let best = null;
  let bestRowCount = Infinity;
  for (const row of candidates) {
    if (row.grain_hash === wantedHash) {
      return {
        id: row.id,
        tableName: row.table_name,
        storageMode: row.storage_mode,
        grainDims: safeJSON(row.grain_dims, []),
        measures: safeJSON(row.measures, { outputs: [], atoms: [] }),
        match: 'exact',
      };
    }
    const grainDimsArr = safeJSON(row.grain_dims, []);
    const grainSet = new Set(grainDimsArr);
    let superset = true;
    for (const d of wanted) {
      if (!grainSet.has(d)) { superset = false; break; }
    }
    if (!superset) continue;
    const rc = row.row_count ?? Infinity;
    if (rc < bestRowCount) {
      best = {
        id: row.id,
        tableName: row.table_name,
        storageMode: row.storage_mode,
        grainDims: grainDimsArr,
        measures: safeJSON(row.measures, { outputs: [], atoms: [] }),
        match: 'superset',
      };
      bestRowCount = rc;
    }
  }
  return best;
}

function safeJSON(s, fallback) {
  try { return JSON.parse(s); } catch { return fallback; }
}

module.exports = {
  grainHashOf,
  baseFilterHashOf,
  normalizeFilterRules,
  rollupTableName,
  planRollupsForModel,
  buildRollup,
  buildRollupsForModel,
  buildingModelIds,
  getManifest,
  dropRollup,
  dropAllRollups,
  dropAllRollupsForDatasource,
  findBestRollup,
};
