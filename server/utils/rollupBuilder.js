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
const { shiftWidgetFiltersForN1 } = require('./comparePeriod');
const { componentPlanForMeasures, factsForMeasure, effectiveMeasureName } = require('./measureType');

const MAX_ROLLUP_ROWS = Number(process.env.ROLLUP_MAX_ROWS || 1_000_000);

// Model ids whose rollups are currently being (re)built. The cache
// dashboard polls this so a spinner survives an F5 mid-build.
const _building = new Set();
function buildingModelIds() {
  return [..._building];
}

// Per-model build progress for the dashboard bar: modelId →
// { done, total }. `done` counts processed plan items (built OR failed)
// so the bar always reaches 100%. Set/cleared by the orchestrator.
const _progress = new Map();
function buildProgress() {
  const out = {};
  for (const [k, v] of _progress) out[k] = { ...v };
  return out;
}

// The builder calls the app's own /query route over loopback. A server
// calling ITSELF must use the in-container loopback, NOT a public URL —
// a public INTERNAL_APP_URL (https, behind nginx/Cloudflare) makes the
// self-call leave the container and fail with a generic "fetch failed"
// (TLS/DNS/redirect). Default to 127.0.0.1:PORT; allow an explicit
// ROLLUP_INTERNAL_URL escape hatch for split-container deployments.
function appBase() {
  if (process.env.ROLLUP_INTERNAL_URL) return process.env.ROLLUP_INTERNAL_URL.replace(/\/+$/, '');
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
//
// `gen` is a per-build-run token. It makes each rebuild write to a NEW
// physical table while the previous one keeps serving (blue-green): the
// manifest row only flips to the new name AFTER the new table is fully
// built, and the old (now-unreferenced) table is dropped by the post-
// build sweep. A failed build never touches the live table → no cache
// loss on a transient source error.
function rollupTableName({ modelId, grainHash, baseFilterHash, factTable, orgId, gen }) {
  const parts = ['or_rollup'];
  if (orgId) parts.push(shortHash(orgId));
  parts.push(shortHash(modelId));
  parts.push(grainHash.slice(0, 8));
  parts.push((baseFilterHash || '0').slice(0, 8));
  parts.push(shortHash(factTable || '_'));
  if (gen) parts.push(`g${gen}`);
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

// Plan is per-(report, baked-global-filter, FACT TABLE). Global filter
// VALUES are baked (small rollups: one slice per selection). The grain
// per baked filter = union of every widget's grains under it. The
// runtime planner re-aggregates that base grain down to each widget's
// coarser grain via `findBestRollup`'s superset match + GROUP BY
// (additive atoms; non-additive measures recomposed from their additive
// components, so coarsening stays correct). N-1 / period-comparison
// widgets get an extra baked rollup at the year-shifted slice so the
// YoY query HITs with a correct value (see the byFilter loop). Changing
// the global bar to an unbaked selection → MISS → live query until the
// next rebuild bakes that slice (accepted tradeoff).
//
// A constellation model has several fact tables sharing conformed
// dimensions. Aggregating measures from >1 fact in a single query fans
// out into a cartesian product (f1 × f2 × f3 on the shared dim) — so we
// partition the report's measures BY FACT and materialise one base
// rollup per fact. Each build query then joins exactly ONE fact (+
// conformed dims) → no fan-out. The runtime planner FULL OUTER JOINs the
// per-fact rollups on the grain dims.
//
// Cross-fact measures (a ratio/expression whose refs span facts) and
// measures with no resolvable fact table are NOT rolled up in v1 — the
// planner falls through to the live query for requests using them.

// Per-fact CONFORMED dimension tables, from the model join graph. A
// fact's rollup grain MUST be restricted to dims actually joined to that
// fact (directly, or via dim→dim snowflake hops) — never reachable only
// THROUGH another fact. Forcing a non-conformed dim into a fact's build
// query makes `/query` find no join path and comma-cross-join the bare
// tables → cartesian → the source query times out (observed: 600s ×N on
// `f_appel_entrant_agg` grouped by `d_destinataire`, a dim of
// `f_appel_entrant_fin` only). Returns { facts:Set, conformed:Map<fact,
// Set<dimTable>> }. Joins are dim(1)→fact(*); the `*` end is the fact.
function factConformedDimTables(joins) {
  const list = Array.isArray(joins) ? joins : [];

  // Cardinality of `node`'s endpoint in join `j` ('1' | '*'). Legacy
  // joins with no cardinality are the dim(from,1)→fact(to,*) convention.
  const cardOf = (node, j) => {
    const c = j.cardinality;
    if (!c || (!c.from && !c.to)) return node === j.to_table ? '*' : '1';
    return node === j.to_table ? (c.to || '*') : (c.from || '*');
  };

  // Directed adjacency: from `a`, list reachable `nb` WITH whether `nb`
  // is the "1" (or 1:1) side of that join. Traversing TOWARD a `*` side
  // while moving away from the fact fans the fact rows out (cartesian) —
  // so we only ever step toward a `1` side.
  const adj = new Map();
  const link = (a, b, j) => {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push([b, cardOf(b, j) === '1']);
    adj.get(b).push([a, cardOf(a, j) === '1']);
  };
  // A FACT is the "many" endpoint of a join AND is never a `from_table`
  // (nothing is parented BY a fact). This distinguishes a real fact from
  // a snowflake CHILD dim, which is also a `*` side (`d_client(1) →
  // d_destinataire(*)`) but additionally parents the fact
  // (`d_destinataire(1) → f_fin(*)`) so it appears as a from_table.
  const fromTables = new Set();
  const manyTables = new Set();
  for (const j of list) {
    if (!j || !j.from_table || !j.to_table) continue;
    link(j.from_table, j.to_table, j);
    fromTables.add(j.from_table);
    const c = j.cardinality || {};
    if (c.to === '*' || (!c.from && !c.to)) manyTables.add(j.to_table); // dim→fact
    if (c.from === '*') manyTables.add(j.from_table);                    // reverse-declared
  }
  const facts = new Set([...manyTables].filter((t) => !fromTables.has(t)));
  const conformed = new Map();
  for (const f of facts) {
    const dims = new Set();
    const visited = new Set([f]);
    const queue = [f];
    while (queue.length) {
      const cur = queue.shift();
      for (const [nb, nbIsOne] of adj.get(cur) || []) {
        if (visited.has(nb) || facts.has(nb)) continue; // never via another fact
        // Only step toward a `1`/1:1 side. A `d_client(1)→d_destinataire(*)`
        // hop reached FROM d_client would fan f_agg's rows out by every
        // destinataire of the client → d_destinataire is NOT conformed to
        // f_agg (it stays conformed to f_fin via its DIRECT join, where it
        // IS the `1` side). This is what stops the cartesian.
        if (!nbIsOne) continue;
        visited.add(nb);
        dims.add(nb);
        queue.push(nb);
      }
    }
    conformed.set(f, dims);
  }
  return { facts, conformed };
}

// Table a grain dim name belongs to: a model/extra dim → its `.table`;
// a `_date.*` date-part extra → the model's date dimension table; else
// null (unknown → keep, never silently drop a dim we can't place).
function dimTableOf(name, dimsByName, dateTable) {
  const d = dimsByName.get(name);
  if (d && d.table) return d.table;
  if (typeof name === 'string' && name.startsWith('_date.')) return dateTable || null;
  return null;
}

function planRollupsForModel(modelId) {
  const reports = db.prepare(
    'SELECT id, widgets, settings FROM reports WHERE model_id = ?'
  ).all(modelId);

  const plan = [];
  const seen = new Set(); // `${hash}::${baseFilterHash}::${factTable}` dedupe
  const allMeasures = new Set();

  // Model-level join graph → conformed dims per fact. Each fact's rollup
  // grain is restricted to dims joined to THAT fact, so a build query
  // never cross-joins a non-conformed dim (the 600s-timeout cause).
  let modelRowDims = [];
  let modelJoins = [];
  let dateColumn = '';
  try {
    const mr = db.prepare('SELECT dimensions, joins, date_column FROM models WHERE id = ?').get(modelId);
    if (mr) {
      try { modelRowDims = JSON.parse(mr.dimensions || '[]'); } catch { /* malformed */ }
      try { modelJoins = JSON.parse(mr.joins || '[]'); } catch { /* malformed */ }
      dateColumn = mr.date_column || '';
    }
  } catch { /* model row missing */ }
  const { conformed: factConformed } = factConformedDimTables(modelJoins);
  // `_date.*` date-part extras live on the model's date table.
  const dateTable = dateColumn ? dateColumn.split('.').slice(0, -1).join('.') : '';

  for (const r of reports) {
    let widgets = {};
    let settings = {};
    try { widgets = JSON.parse(r.widgets || '{}'); } catch { /* malformed */ }
    try { settings = JSON.parse(r.settings || '{}'); } catch { /* malformed */ }
    const extras = reportExtras(settings);
    const reportFilters = Array.isArray(settings.reportFilters) ? settings.reportFilters : [];
    const { defs: measureDefs, byName: measureByName } = loadMeasureDefs(modelId, extras);
    // Model + report dimension defs — comparePeriod needs them (N-1
    // detection) and dimTableOf needs them (conformed-grain filtering).
    const modelDims = [...modelRowDims, ...(extras.extraDimensions || [])];
    const dimsByName = new Map(
      modelDims.filter((d) => d && d.name).map((d) => [d.name, d])
    );

    // Every measure this report's widgets reference, under its EFFECTIVE
    // name. A per-widget aggregation override (`measureAggOverrides`)
    // synthesises `<name>@@<agg>` (effectiveMeasureName) so the rollup
    // materialises that aggregation's atoms and the planner can recompose
    // it — the override stays CACHED, not bypassed. Generic for every
    // aggregation type (sum/count/min/max → that additive atom; avg →
    // _avg_*_sum/_count via the existing decompose path).
    const reportMeasures = new Set();
    const synthByName = new Map(); // effName -> synthetic measure def
    for (const w of Object.values(widgets)) {
      if (!w || !w.dataBinding) continue;
      if (w.type === 'text' || w.type === 'shape') continue;
      const aggOv = (w.dataBinding.measureAggOverrides && typeof w.dataBinding.measureAggOverrides === 'object')
        ? w.dataBinding.measureAggOverrides : {};
      for (const m of measureNamesForWidget(w)) {
        const baseDef = measureByName.get(m);
        const effName = baseDef
          ? effectiveMeasureName(m, baseDef.aggregation, aggOv[m])
          : m;
        if (effName !== m && baseDef && !synthByName.has(effName)) {
          synthByName.set(effName, {
            ...baseDef,
            name: effName,
            // Unique label = the synthetic key itself. The base measure
            // keeps its own label, so when BOTH are materialised in one
            // build /query there is no duplicate SELECT alias. The planner
            // re-keys the response to the base measure's label (respKey),
            // so the client never sees this synthetic name.
            label: effName,
            aggregation: aggOv[m],
          });
        }
        reportMeasures.add(effName);
        allMeasures.add(effName);
      }
    }
    // Make synthetics resolvable downstream: loadMeasureDefs merges
    // extras.extraMeasures into the def pool, and the build /query
    // resolves measureNames against extraMeasures too.
    const extrasWithSynth = synthByName.size > 0
      ? { ...extras, extraMeasures: [...(extras.extraMeasures || []), ...synthByName.values()] }
      : extras;
    const measureByNameEff = synthByName.size > 0
      ? new Map([...measureByName, ...synthByName])
      : measureByName;
    const measureDefsEff = synthByName.size > 0
      ? [...measureDefs, ...synthByName.values()]
      : measureDefs;
    // Partition the report's measures by their fact table. Single-fact
    // measures group under that fact; 0- or multi-fact measures are
    // dropped from rollups (fallback to live query at runtime).
    const factGroups = new Map(); // factTable -> [effective measure names]
    for (const mn of reportMeasures) {
      const def = measureByNameEff.get(mn);
      if (!def) continue;
      const facts = factsForMeasure(def, measureDefsEff);
      if (facts.length !== 1) continue; // cross-fact / unresolved → not rolled up
      const f = facts[0];
      if (!factGroups.has(f)) factGroups.set(f, []);
      factGroups.get(f).push(mn);
    }
    if (factGroups.size === 0) continue;

    // Global filter VALUES are baked (keeps rollups small — one slice per
    // selection). Per widget: its effective global rule set (per-widget
    // exclusions already applied) is baked; the grain excludes global
    // dims. The consolidated grain per baked-filter = union of every
    // widget's grains under that filter.
    //
    // N-1 / period comparison: a YoY widget fires a SECOND runtime query
    // with the year-like / full-date filter shifted -1
    // (comparePeriod.shiftWidgetFiltersForN1). That shifted globalPart
    // hashes differently, so we ALSO bake the shifted slice — otherwise
    // the N-1 query MISSes, and for an override / filter-ignoring measure
    // a MISS→live still returns a value, but a baked rollup that lacks the
    // shifted period would yield a WRONG number. One extra rollup per
    // baked filter that carries a shiftable filter.
    const byFilter = new Map(); // baseFilterHash -> { baseFilters, dims:Set }
    const slotFor = (baseFilters) => {
      const bfh = baseFilterHashOf(baseFilters);
      let slot = byFilter.get(bfh);
      if (!slot) { slot = { baseFilters, dims: new Set() }; byFilter.set(bfh, slot); }
      return slot;
    };
    const onlyRules = (arr) => (Array.isArray(arr) ? arr : []).filter(
      (rule) => rule && !rule.isMeasure && typeof rule.field === 'string' && rule.field && rule.op
    );
    for (const [wId, w] of Object.entries(widgets)) {
      if (!w || !w.dataBinding) continue;
      if (w.type === 'text' || w.type === 'shape') continue;
      const baseFilters = onlyRules(prepareGlobalRulesForWidget(reportFilters, wId));
      const grains = grainsForWidget(w, wId, widgets);
      const slot = slotFor(baseFilters);
      for (const grain of grains) for (const d of grain) slot.dims.add(d);
      // Bake the N-1 (year shifted -1) slice too, if this widget's baked
      // filter has a year-like / full-date rule.
      const shifted = onlyRules(shiftWidgetFiltersForN1(baseFilters, modelDims));
      if (baseFilterHashOf(shifted) !== baseFilterHashOf(baseFilters)) {
        const n1 = slotFor(shifted);
        for (const grain of grains) for (const d of grain) n1.dims.add(d);
      }
    }

    for (const [baseFilterHash, slot] of byFilter) {
      const unionDims = [...slot.dims];
      for (const [factTable, factMeasures] of factGroups) {
        // Restrict the consolidated grain to dims CONFORMED to this fact
        // (joined to it directly or via a dim→dim chain — never only
        // through another fact). A non-conformed dim has no join path
        // from this fact, so /query would comma-cross-join it → cartesian
        // → source-query timeout. Unknown-table dims are kept (never
        // silently drop a dim we can't place). An empty result is fine —
        // it's a valid grand-total rollup for that fact.
        const allow = factConformed.get(factTable);
        const grain = (allow
          ? unionDims.filter((dn) => {
              const t = dimTableOf(dn, dimsByName, dateTable);
              return t == null || t === factTable || allow.has(t);
            })
          : unionDims.slice()
        ).sort();
        const hash = grainHashOf(grain);
        const key = `${hash}::${baseFilterHash}::${factTable}`;
        if (seen.has(key)) continue;
        seen.add(key);
        plan.push({
          grain, hash, measures: factMeasures, factTable,
          reportId: r.id, extras: extrasWithSynth,
          baseFilters: slot.baseFilters, baseFilterHash,
        });
      }
    }
  }

  // Larger grains build first — if a run is interrupted, the broad
  // covers (which serve the most runtime requests) are the ones kept.
  plan.sort((a, b) => b.grain.length - a.grain.length);
  return { plan, measures: [...allMeasures] };
}

// ─── Build a single rollup ────────────────────────────────────────────────

// Default loopback build-fetch deadline. MUST exceed the server-side
// per-grain query timeout (models.js bumps it to ≥10 min for
// `_rollupBuilder` requests) so the SERVER decides the timeout and
// returns a clean HTTP error, rather than the client aborting first.
const FETCH_TIMEOUT_MS = Number(process.env.ROLLUP_FETCH_TIMEOUT_MS) || 15 * 60 * 1000;

// Uses the Node core http/https client, NOT global fetch. undici (Node
// fetch) has a hidden 300s `headersTimeout` that is NOT settable via the
// standard fetch options — a heavy grain whose aggregation runs longer
// than 5 min was being killed with an opaque "fetch failed"
// (UND_ERR_HEADERS_TIMEOUT) regardless of the server-side budget. The
// core client lets us set an explicit overall deadline.
function fetchRollupRows({
  modelId, grain, fireNames, syntheticExtras, internalUserId, orgId, reportId, extras,
  baseFilters,
}) {
  const token = internalToken.sign({ userId: internalUserId, organizationId: orgId || null });
  const ex = extras || {};
  // We materialise additive COMPONENTS, not final non-additive values:
  // `fireNames` = the named base measures (simple measures + ratio /
  // expression refs); `syntheticExtras` = AVG SUM/COUNT components
  // injected as inline extraMeasures. The planner recomposes ratios /
  // AVG / expressions from these at any grain.
  const bodyStr = JSON.stringify({
    dimensionNames: grain,
    // The synthetic AVG/ratio/expression components (`syntheticExtras`,
    // e.g. `_avg_<t>_<c>_sum` / `_count`) MUST be in measureNames, not
    // only in extraMeasures: models.js builds the SELECT from
    // `selectedMeasures` (= measureNames resolved against the measure
    // pool) — extraMeasures are added to the resolution pool but are
    // never SELECTed on their own. Without this, an AVG-only fact group
    // (empty fireNames) materialised ZERO atom values → every `_avg_*`
    // column NULL → recompose `count ? sum/count : null` → AVG always
    // null. They stay in extraMeasures below so the names resolve.
    measureNames: [...new Set([
      ...(fireNames || []),
      ...((syntheticExtras || []).map((s) => s.name)),
    ])],
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
  });

  const u = new URL(`${appBase()}/api/models/${modelId}/query`);
  const client = u.protocol === 'https:' ? require('https') : require('http');

  return new Promise((resolve, reject) => {
    const req = client.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(bodyStr),
        [internalToken.HEADER]: token,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        clearTimeout(timer);
        const text = Buffer.concat(chunks).toString('utf8');
        const sc = res.statusCode || 0;
        if (sc < 200 || sc >= 300) {
          return reject(new Error(`/query failed (${sc}): ${text.slice(0, 200)}`));
        }
        try {
          const p = JSON.parse(text);
          resolve(Array.isArray(p && p.rows) ? p.rows : []);
        } catch (e) {
          reject(new Error(`/query returned non-JSON: ${e.message}`));
        }
      });
    });
    // Overall deadline (not a socket-idle timeout — a long aggregation
    // legitimately sends no bytes for minutes). The server's own query
    // timeout should fire first and return a clean error.
    const timer = setTimeout(() => {
      req.destroy(new Error(`/query exceeded builder deadline ${FETCH_TIMEOUT_MS}ms`));
    }, FETCH_TIMEOUT_MS);
    req.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`/query unreachable at ${u.href} → ${err.code || err.message}`));
    });
    req.write(bodyStr);
    req.end();
  });
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

async function buildRollupToDuckDB({ modelId, orgId, gen, tableName, grain, atoms, rows, dimLabel, measureLabel }) {
  // DuckDB column name = the dim NAME / atom column id (stable). The
  // matching /query row key is the LABEL (or NAME when no label). For
  // synthetic AVG components the /query alias == the atom id (no label),
  // so the `|| n` fallback resolves them correctly.
  const atomCols = atoms.map((a) => a.col);
  const hllAtoms = atoms.filter((a) => a.agg === 'HLL_UNION');
  const additiveAtoms = atoms.filter((a) => a.agg !== 'HLL_UNION');
  const additiveSet = new Set(additiveAtoms.map((a) => a.col));
  const hllSet = new Set(hllAtoms.map((a) => a.col));
  const columns = [...grain, ...atomCols];
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
      // Additive atoms are numeric aggregates → coerce. HLL columns
      // arrive raw (no aggregate function applied at source) — keep
      // them as-is so DuckDB sees the native source type. Grain dim
      // columns also stay untouched.
      out[col] = additiveSet.has(col) ? toNum(v) : v;
    }
    return out;
  });

  // ─── No HLL atoms: direct CREATE TABLE + INSERT path ─────────────────
  if (hllAtoms.length === 0) {
    const colSpecs = columns.map((c) => {
      const t = additiveSet.has(c) ? 'DOUBLE' : inferColumnType(remapped, c);
      return `"${c.replace(/"/g, '""')}" ${t}`;
    });
    // Fresh gen file → the table can't pre-exist; no DROP needed.
    await rollupDuckDB.run(modelId, gen, `CREATE TABLE "${tableName}" (${colSpecs.join(', ')})`, orgId);
    await rollupDuckDB.insertRows(modelId, gen, tableName, columns, remapped, orgId);
    const bytes = estimateRowBytes(remapped, columns, additiveSet, hllSet);
    return { rowCount: remapped.length, bytes };
  }

  // ─── HLL path: staging table + final GROUP-BY-aggregated rollup ──────
  // The fetch already widened the grain to (grain ∪ hll_cols) at /query
  // time (routes/models.js's `aggregation: 'hll'` branch emits the raw
  // column in SELECT + GROUP BY). Additive atoms in the same query are
  // therefore aggregated at THIS finer grain — mathematically the same
  // total at the requested grain since SUM/MIN/MAX/COUNT are additive,
  // we just re-aggregate them in DuckDB alongside the HLL sketches.
  //
  // Staging layout: every column we received in `remapped`. Additive
  // atoms typed DOUBLE; HLL raw columns + grain dims inferred from the
  // values themselves (could be VARCHAR / BIGINT / DOUBLE / DATE depending
  // on the source column type). DataSketches' `datasketch_hll(lgK, x)`
  // accepts any of those.
  const stagingName = `${tableName}__stg`;
  const stagingSpecs = columns.map((c) => {
    if (additiveSet.has(c)) return `"${c.replace(/"/g, '""')}" DOUBLE`;
    return `"${c.replace(/"/g, '""')}" ${inferColumnType(remapped, c)}`;
  });
  await rollupDuckDB.run(modelId, gen, `CREATE TABLE "${stagingName}" (${stagingSpecs.join(', ')})`, orgId);
  await rollupDuckDB.insertRows(modelId, gen, stagingName, columns, remapped, orgId);

  // Final rollup: re-aggregate additive atoms with their own SQL agg
  // (SUM/MIN/MAX — same agg the planner emits at query time) and emit a
  // DataSketches HLL sketch per HLL column. GROUP BY the grain dims —
  // the result is exactly one row per grain bucket. All sibling additive
  // atoms collapse correctly from the finer (grain ∪ col) cardinality.
  const grainCols = grain.map((g) => `"${g.replace(/"/g, '""')}"`);
  const finalSelects = [
    ...grainCols,
    ...additiveAtoms.map((a) => `${a.agg}("${a.col.replace(/"/g, '""')}") AS "${a.col.replace(/"/g, '""')}"`),
    ...hllAtoms.map((a) => {
      const lgK = a.lgK || 12;
      return `datasketch_hll(${lgK}, "${a.col.replace(/"/g, '""')}") AS "${a.col.replace(/"/g, '""')}"`;
    }),
  ];
  const groupClause = grainCols.length ? ` GROUP BY ${grainCols.join(', ')}` : '';
  const finalSql = `CREATE TABLE "${tableName}" AS SELECT ${finalSelects.join(', ')} FROM "${stagingName}"${groupClause}`;
  try {
    await rollupDuckDB.run(modelId, gen, finalSql, orgId);
  } finally {
    // Always drop staging — keeps the gen file tight even when the
    // CREATE TABLE failed (DROP IF EXISTS is a no-op then).
    try { await rollupDuckDB.run(modelId, gen, `DROP TABLE IF EXISTS "${stagingName}"`, orgId); } catch { /* best-effort */ }
  }

  // For the row-count + bytes report we read the final table's
  // cardinality from DuckDB (the staging row count is the wider grain).
  // Sketches don't have a clean "average BLOB size" knob — use the
  // canonical 4 KB at lg_k=12 (≈ what Query.farm publishes); other
  // lg_k's scale 2^k bytes per sketch.
  const finalRows = await rollupDuckDB.query(modelId, gen, `SELECT COUNT(*) AS n FROM "${tableName}"`, orgId);
  const finalRowCount = Number((finalRows[0] && finalRows[0].n) || 0);
  // Sum per-row width: grain dims by inferred type (using the staging
  // sample), additive atoms = 8 B, HLL sketches = ~2^lgK bytes.
  const sample = remapped.slice(0, 200);
  let rowWidth = 0;
  for (const c of grain) rowWidth += dimWidth(sample, c);
  for (const _ of additiveAtoms) rowWidth += 8;
  for (const a of hllAtoms) rowWidth += Math.pow(2, a.lgK || 12);
  const bytes = finalRowCount * rowWidth;
  return { rowCount: finalRowCount, bytes };
}

// Sampled per-column width for dim cells — same heuristic the old direct
// path used inline, factored out so the HLL branch can reuse it.
function dimWidth(sample, col) {
  let isNumeric = true;
  let lenSum = 0;
  let lenN = 0;
  for (const r of sample) {
    const v = r[col];
    if (v === null || v === undefined) continue;
    if (typeof v === 'number') { lenSum += 8; lenN++; continue; }
    isNumeric = false;
    lenSum += String(v).length + 1;
    lenN++;
  }
  return lenN === 0 ? 8 : (isNumeric ? 8 : Math.ceil(lenSum / lenN));
}

// Row-width / total-bytes estimate for the direct (no-HLL) path. Same
// 8 B per additive cell + sampled string length for dim cells.
function estimateRowBytes(remapped, columns, additiveSet, hllSet) {
  const sample = remapped.slice(0, 200);
  let rowWidth = 0;
  for (const c of columns) {
    if (additiveSet.has(c)) { rowWidth += 8; continue; }
    if (hllSet.has(c)) { rowWidth += 4096; continue; } // unused in this path
    rowWidth += dimWidth(sample, c);
  }
  return remapped.length * rowWidth;
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
  factTable = '',
  gen,
}) {
  const hash = grainHashOf(grain);
  const bfHash = baseFilterHash || baseFilterHashOf(baseFilters);
  // Blue-green: build into a generation-stamped physical table. The
  // manifest row keeps pointing at the PREVIOUS table (still serving
  // queries) until the upsert below flips it — only reached if the
  // fetch + DuckDB write succeed. A transient source error throws before
  // that flip, leaving the live table + manifest row untouched.
  const tableName = rollupTableName({
    modelId, grainHash: hash, baseFilterHash: bfHash, factTable, orgId, gen,
  });

  // Decompose every output measure into its additive component columns.
  // For DISTINCT measures we need the DataSketches DuckDB extension to be
  // loadable — pre-warm the destination gen file and read the readiness
  // flag so the planner can decide between an HLL atom (cached) and a
  // `supported:false` output (live fallback) BEFORE the source SELECT
  // runs. The connection stays open and is reused by buildRollupToDuckDB
  // below; opening it twice is a no-op (Map-cached per absolute path).
  const { byName: measureByName, defs: allMeasureDefs } = loadMeasureDefs(modelId, extras);
  const outputDefs = measures
    .map((n) => measureByName.get(n))
    .filter(Boolean);
  let hllReady = false;
  if (storageMode === 'duckdb') {
    try {
      const _db = await rollupDuckDB.getDb(modelId, orgId, gen);
      hllReady = rollupDuckDB.isHllReady(_db);
    } catch { /* getDb failed; leave hllReady false → live fallback */ }
  }
  const plan = componentPlanForMeasures(outputDefs, allMeasureDefs, { hllReady });

  // No materialisable component columns for this fact group — every
  // measure is override-tainted / non-decomposable. Firing /query with
  // zero measures would leave it no fact to anchor the join graph, so it
  // would comma-cross-join the bare dimension tables (cartesian). Skip
  // cleanly: no rollup for this (grain, fact); the planner MISSes those
  // measures → live query, which is the correct path for them anyway.
  // (AVG-only groups have empty fireNames but non-empty atoms via the
  // synthetic sum/count components — `atoms` is the precise signal.)
  if (plan.atoms.length === 0) {
    return { skipped: true, reason: 'no-materialisable-measures' };
  }

  // Detect spec drift against the existing manifest row (if any). When
  // a measure's decomposition changes — typical example: a DISTINCT
  // measure that was `supported:false` pre-Phase D and is now
  // `supported:true` after the HLL pipeline landed — the OLD row still
  // points at an OLD physical table whose schema cannot serve the new
  // spec. If the new build then FAILS for any reason (source timeout,
  // dialect mismatch, …), the blue-green design keeps the OLD row
  // serving — which means the planner returns `non-decomposable` for
  // an output that's actually decomposable now, and the visual stays
  // on live SQL forever. Worse: a manifest row with stale supported
  // flags can shadow the next successful build's row if both share the
  // (model, grain, base_filter, fact) key (upsert overwrites — but
  // until the upsert lands, planner serves stale).
  //
  // Cleanup contract: when the EXISTING outputs differ from what the
  // CURRENT plan would emit, the row is "incompatible" — if the new
  // build then fails, delete it. The next successful build will
  // recreate it. Same-shape drift (e.g. row count changed) keeps the
  // row → blue-green still wins for transient infra failures on
  // unchanged specs.
  const existingPreBuild = db.prepare(
    `SELECT id, measures FROM rollups
     WHERE model_id = ? AND grain_hash = ? AND base_filter_hash = ? AND fact_table = ?
       AND (organization_id IS ? OR organization_id = ?)`
  ).get(modelId, hash, bfHash, factTable || '', orgId || null, orgId || null);
  let staleIfBuildFails = null;
  if (existingPreBuild) {
    try {
      const oldOutputs = JSON.parse(existingPreBuild.measures || '{}').outputs || [];
      // Stringify-compare: the outputs array is JSON-serialisable and
      // the plan generates it deterministically, so a key-order or
      // type-coercion mismatch will never produce a false-positive.
      const drifted = JSON.stringify(oldOutputs) !== JSON.stringify(plan.outputs);
      if (drifted) staleIfBuildFails = existingPreBuild.id;
    } catch { staleIfBuildFails = existingPreBuild.id; }
  }

  let rows;
  let rowCount = 0;
  let bytes = 0;
  try {
    rows = await fetchRollupRows({
      modelId, grain,
      fireNames: plan.fireNames,
      syntheticExtras: plan.extraMeasures,
      internalUserId, orgId, reportId, extras, baseFilters,
    });
    const maps = buildNameLabelMaps(modelId, extras);

    if (storageMode === 'duckdb') {
      const result = await buildRollupToDuckDB({
        modelId, orgId, gen, tableName, grain, atoms: plan.atoms, rows,
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
  } catch (err) {
    // Build failed (source timeout, dialect mismatch, …). If the
    // existing manifest row was incompatible with the current spec,
    // delete it so the planner emits `no-rollup` → live SQL (always
    // correct) instead of `non-decomposable` shadowing the stale row.
    if (staleIfBuildFails) {
      try {
        db.prepare('DELETE FROM rollups WHERE id = ?').run(staleIfBuildFails);
        console.log(`[rollup] cleaned stale manifest row id=${staleIfBuildFails} after failed build (spec drift)`);
      } catch (delErr) {
        console.warn(`[rollup] stale-row cleanup failed for id=${staleIfBuildFails}: ${delErr.message}`);
      }
    }
    throw err;
  }

  // Upsert manifest keyed by (model, grain, base_filter, fact, org).
  // Keeping the row id stable across rebuilds protects any future FKs.
  const existing = db.prepare(
    `SELECT id FROM rollups
     WHERE model_id = ? AND grain_hash = ? AND base_filter_hash = ? AND fact_table = ?
       AND (organization_id IS ? OR organization_id = ?)`
  ).get(modelId, hash, bfHash, factTable || '', orgId || null, orgId || null);

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
        measures, base_filters, base_filter_hash, fact_table, table_name,
        built_at, row_count, bytes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
    factTable || '',
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
    _progress.delete(opts.modelId);
  }
}

async function _buildRollupsForModelInner({ modelId, internalUserId, orgId, log = false }) {
  const model = db.prepare('SELECT * FROM models WHERE id = ?').get(modelId);
  if (!model) throw new Error(`Model not found: ${modelId}`);
  // Build /query calls MUST run AS THE MODEL OWNER. models.js strips the
  // request's extraMeasures (→ the synthetic AVG/ratio/expr decomposition
  // components) for any caller that isn't the model owner/admin, keeping
  // only the report's PERSISTED extras — which never contain the
  // build-time synthetics. So if the warm was triggered by anyone other
  // than the owner (a schedule's user, an admin, a different account),
  // every `_avg_*` atom is silently never SELECTed → materialised NULL →
  // AVG/ratio rollups always null. Running as the owner (server-internal,
  // signed token, the model's own data) makes it deterministic.
  const ownerUserId = model.user_id || internalUserId;
  // Normalise orgId to the MODEL's org for the WHOLE build (token AND
  // storage/checkpoint/prune), so everything stays consistent and the
  // cloud shadow gate (which also requires model.organization_id ===
  // req.organizationId on top of the owner match) is satisfied
  // deterministically regardless of who/what triggered the warm. OSS
  // models have no organization_id → falls back to the passed orgId
  // (null) → no behaviour change.
  orgId = model.organization_id || orgId || null;
  const datasource = db.prepare('SELECT * FROM datasources WHERE id = ?').get(model.datasource_id);
  if (!datasource) throw new Error(`Datasource not found for model: ${modelId}`);

  const storageMode = datasource.rollup_storage === 'source' ? 'source' : 'duckdb';

  const { plan, measures } = planRollupsForModel(modelId);
  if (plan.length === 0) {
    return { fired: 0, built: 0, errors: [], measures };
  }
  _progress.set(modelId, { done: 0, total: plan.length });
  if (log) {
    console.log(`[rollup] model=${modelId} grains=${plan.length} measures=${measures.length} storage=${storageMode}`);
  }

  // Blue-green rebuild: every rollup this run writes goes to a fresh
  // generation-stamped physical table while the PREVIOUS generation keeps
  // serving queries. Each rollup's manifest row only flips to the new
  // table after that table is fully built; the now-unreferenced old table
  // is dropped by the post-build sweep. A transient source error therefore
  // never wrecks the cache — the live tables + manifest are untouched and
  // keep serving until a rebuild actually succeeds. (We deliberately do
  // NOT delete the store up-front: that turned a source timeout into total
  // cache loss. A full file delete is only safe in dropAllRollups, where
  // the model schema changed and the rows are invalid regardless.)
  const gen = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  let built = 0;
  let skipped = 0;
  const errors = [];
  const builtIds = new Set();
  for (const item of plan) {
    try {
      const r = await buildRollup({
        modelId,
        grain: item.grain,
        measures: item.measures,
        storageMode,
        internalUserId: ownerUserId,
        orgId,
        reportId: item.reportId,
        extras: item.extras,
        baseFilters: item.baseFilters,
        baseFilterHash: item.baseFilterHash,
        factTable: item.factTable,
        gen,
      });
      if (r && r.skipped) {
        skipped++;
        if (log) console.log(`[rollup] skip grain=[${item.grain.join(',')}] fact=${item.factTable} (${r.reason})`);
      } else {
        built++;
        builtIds.add(r.id);
        if (log) console.log(`[rollup] built ${r.tableName} fact=${item.factTable} rows=${r.rowCount} bytes=${r.bytes}`);
      }
    } catch (err) {
      errors.push(`grain=[${item.grain.join(',')}] fact=${item.factTable} → ${err.message}`);
      if (log) console.warn(`[rollup] FAILED grain=[${item.grain.join(',')}] fact=${item.factTable} ${err.message}`);
    }
    _progress.set(modelId, { done: built + skipped + errors.length, total: plan.length });
  }

  // Fold this gen file's WAL into its .duckdb. The connection stays open
  // to serve queries so DuckDB never auto-checkpoints — without this the
  // gen .duckdb is a ~12 KB header and all the data sits in a sibling
  // .wal (durable but the reported size is wrong + not self-contained).
  if (storageMode === 'duckdb' && built > 0) {
    try { await rollupDuckDB.checkpoint(modelId, gen, orgId); } catch { /* best-effort */ }
  }

  // Prune manifest rows no widget needs anymore (keyed by
  // grain_hash::base_filter_hash::fact_table). Only when ≥1 rollup built,
  // so a transient failure can't wipe the manifest. No DROP TABLE — each
  // row's table lives in a gen file the file-prune below removes wholesale
  // once unreferenced.
  if (built > 0) {
    const existing = db.prepare(
      `SELECT id, grain_hash, base_filter_hash, fact_table FROM rollups
       WHERE model_id = ? AND (organization_id IS ? OR organization_id = ?)`
    ).all(modelId, orgId || null, orgId || null);
    const wanted = new Set(plan.map((p) => `${p.hash}::${p.baseFilterHash}::${p.factTable}`));
    for (const row of existing) {
      if (!wanted.has(`${row.grain_hash}::${row.base_filter_hash}::${row.fact_table}`)) {
        db.prepare('DELETE FROM rollups WHERE id = ?').run(row.id);
      }
    }

    // Per-generation files: delete every gen file no surviving manifest
    // row references. This build's successful rollups flipped their
    // manifest rows to the NEW gen, so the OLD gen is now unreferenced —
    // its file is opened by nobody (the planner only opens the gen the
    // manifest points at) → deletable on ANY OS, no handle fight, and we
    // never touch the file that's actively serving. A fact whose build
    // FAILED keeps its old-gen manifest row → that gen stays referenced
    // → its file is kept (zero cache loss). Legacy single file removed.
    if (storageMode === 'duckdb') {
      try {
        const referenced = new Set(
          db.prepare(
            `SELECT table_name FROM rollups
             WHERE model_id = ? AND (organization_id IS ? OR organization_id = ?)`
          ).all(modelId, orgId || null, orgId || null)
            .map((r) => rollupDuckDB.genOfTableName(r.table_name))
            .filter(Boolean)
        );
        const before = rollupDuckDB.modelStoreBytes(modelId, orgId);
        await rollupDuckDB.pruneGenFiles(modelId, orgId, [...referenced]);
        if (log) {
          const after = rollupDuckDB.modelStoreBytes(modelId, orgId);
          console.log(`[rollup] gen-file prune: kept gen[${[...referenced].join(',')}] ` +
            `store ${(before / 1048576).toFixed(2)}MB → ${(after / 1048576).toFixed(2)}MB`);
        }
      } catch (err) {
        if (log) console.warn(`[rollup] gen-file prune failed: ${err.message}`);
      }
    }
  }

  return { fired: plan.length, built, errors, measures };
}

// ─── Manifest CRUD ────────────────────────────────────────────────────────

function getManifest({ modelId, orgId }) {
  const rows = db.prepare(
    `SELECT id, model_id, organization_id, storage_mode, grain_hash, grain_dims,
            measures, base_filters, base_filter_hash, fact_table, table_name,
            built_at, row_count, bytes
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
    factTable: r.fact_table,
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
    `SELECT id, table_name FROM rollups
     WHERE model_id = ? AND grain_hash = ?
       AND (organization_id IS ? OR organization_id = ?)`
  ).all(modelId, grainHash, orgId || null, orgId || null);
  if (rows.length === 0) return { dropped: false };
  for (const row of rows) {
    db.prepare('DELETE FROM rollups WHERE id = ?').run(row.id);
  }
  // Drop any gen file no surviving manifest row still references.
  try {
    const referenced = new Set(
      db.prepare(
        `SELECT table_name FROM rollups
         WHERE model_id = ? AND (organization_id IS ? OR organization_id = ?)`
      ).all(modelId, orgId || null, orgId || null)
        .map((r) => rollupDuckDB.genOfTableName(r.table_name))
        .filter(Boolean)
    );
    await rollupDuckDB.pruneGenFiles(modelId, orgId, [...referenced]);
  } catch { /* best-effort */ }
  return { dropped: true, count: rows.length, tableNames: rows.map((r) => r.table_name) };
}

// Drop every rollup for a given model — called on model edit (schema
// change invalidates the materialised rows).
async function dropAllRollups({ modelId, orgId }) {
  const rows = db.prepare(
    `SELECT id FROM rollups
     WHERE model_id = ? AND (organization_id IS ? OR organization_id = ?)`
  ).all(modelId, orgId || null, orgId || null);
  // A model edit invalidates every materialised row, so blow away the
  // whole store file (real OS reclaim, not just internal block-free).
  try { await rollupDuckDB.destroyModelStore(modelId, orgId); } catch { /* best-effort */ }
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
function findBestRollup({ modelId, grainDims, baseFilterHash, factTable, orgId }) {
  const wanted = new Set(grainDims);
  const wantedHash = grainHashOf(grainDims);
  const bf = baseFilterHash || '0';
  const candidates = db.prepare(
    `SELECT id, grain_hash, grain_dims, measures, fact_table, table_name,
            storage_mode, row_count
     FROM rollups
     WHERE model_id = ? AND base_filter_hash = ? AND fact_table = ?
       AND (organization_id IS ? OR organization_id = ?)`
  ).all(modelId, bf, factTable || '', orgId || null, orgId || null);

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
        factTable: row.fact_table,
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
        factTable: row.fact_table,
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
  buildProgress,
  getManifest,
  dropRollup,
  dropAllRollups,
  dropAllRollupsForDatasource,
  findBestRollup,
};
