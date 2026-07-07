/* Grain planning + rollup naming helpers for rollupBuilder.js.
 * Pure, stateless functions (no DB, no module state) split out of the former
 * single-file rollupBuilder.js (pure relocation, no logic change). The rollup
 * grain math is documented in ROLLUP-CACHE.md.
 */

const crypto = require('crypto');

// SHA-256 truncated to 16 hex chars — enough collision resistance for a
// per-model grain set (we'd need to enumerate billions of distinct grain
// tuples on the same model to risk a clash). Truncating keeps physical
// table names under PG's 63-byte identifier limit.
function grainHashOf(dimNames) {
  // Explicit comparator identical to the default lexicographic order — keeps the
  // grain hash stable (a different order would invalidate every persisted rollup).
  const sorted = [...dimNames].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
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
      const key = combined.slice().sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).join('|'); // '' for the empty grain
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

module.exports = {
  grainHashOf,
  normalizeFilterRules,
  baseFilterHashOf,
  rollupTableName,
  grainsForWidget,
  measureNamesForWidget,
  reportExtras,
  factConformedDimTables,
  dimTableOf,
};
