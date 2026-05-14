/**
 * Proactive cache warming (Phase 4: display-grain coalesced GROUPING SETS).
 *
 * For each report we want to issue **as few SQL queries as possible** —
 * ideally one per report. The path here:
 *
 *   1. Walk all widgets on the report and bucket them by their effective
 *      `widgetFilters` JSON (= same WHERE clause). All widgets that
 *      share a bucket can be served by a single coalesced SQL:
 *        SELECT <union of every widget's dims AND measures>,
 *               GROUPING_ID(<union of dims>) AS _grain
 *        FROM   <model>
 *        WHERE  <bucket's widgetFilters>
 *        GROUP BY GROUPING SETS (
 *          <union of every widget's grouping sets>
 *        )
 *
 *   2. Widgets that resist coalescing (= widgets with a measure-level
 *      filter / HAVING clause) get their own SQL. Same shape, just a
 *      single-widget bucket.
 *
 *   3. The response is stored once per bucket in `displayCache` under a
 *      key keyed on the bucket's widgetFilters identity. At runtime each
 *      widget hits the bucket entry shared by its filter neighbours,
 *      filters rows by `_grain` matching its current display grain, and
 *      projects only its own measures.
 *
 * Trade-off:
 *   - One SQL per bucket → typically 1–3 SQL per report (most widgets
 *     share the global filter bar's widgetFilters, so they coalesce).
 *   - Each row carries every coalesced widget's measure columns, which
 *     means slightly fatter rows but a much smaller number of DB calls.
 *   - No runtime aggregation: every cached row is at the SQL-computed
 *     display grain. Works for AVG, ratios, COUNT(DISTINCT), MEDIAN,
 *     arbitrary custom — anything the DB can compute.
 *
 * MySQL < 8.0 can't run GROUPING SETS at all; the connector layer
 * surfaces a warning and warm skips those datasources entirely.
 */

const internalToken = require('./internalToken');
const displayCache = require('./displayCache');
const { sanitizeWidgetFilters } = require('./widgetFilters');
const { prepareGlobalRulesForWidget } = require('./reportFilterRules');
const { shiftWidgetFiltersForN1, hasShiftableFilterForN1 } = require('./comparePeriod');
const db = require('../db');

function appBase() {
  if (process.env.INTERNAL_APP_URL) return process.env.INTERNAL_APP_URL.replace(/\/+$/, '');
  const port = process.env.PORT || '3001';
  return `http://127.0.0.1:${port}`;
}

// Per-widget cross-filter dim collection — respects each source's
// `crossFilterExclusions`. A widget marked as excluded from a slicer
// (or from a chart used as a cross-filter source) will never receive
// that source's dim at runtime, so the warmer must not add it to this
// widget's grouping sets either.
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
    if (w.type === 'filter') {
      for (const d of (b.selectedDimensions || [])) out.add(d);
      continue;
    }
    for (const d of (b.selectedDimensions || [])) out.add(d);
    for (const d of (b.groupBy || [])) out.add(d);
    for (const d of (b.columnDimensions || [])) out.add(d);
  }
  return [...out];
}

// Power set of a list. For a k-dim list this yields 2^k subsets,
// including the empty one. Used to enumerate cross-filter dim
// combinations — option Y in the design: full subset coverage so
// multi-source cross-filter scenarios still cache-hit at runtime.
function powerSet(arr) {
  const result = [[]];
  for (const item of arr) {
    const len = result.length;
    for (let i = 0; i < len; i++) {
      result.push([...result[i], item]);
    }
  }
  return result;
}

// Build a widget's grouping sets. "Base grains" = drill-hierarchy
// prefixes for drillable widgets, or just baseDims for non-drillable
// ones. Each base grain is crossed with every subset of the widget's
// cross-filter dims so any combination the user reaches at runtime
// (single drill, single cross-filter, multi-cross-filter) lands in
// `_grain`-tagged rows.
function groupingSetsForWidget(w, baseDims, crossFilterDims) {
  const b = w.dataBinding || {};
  const dims = b.selectedDimensions || [];
  const grpBy = b.groupBy || [];
  const colDims = b.columnDimensions || [];

  const DRILLABLE = ['bar', 'line', 'combo', 'pie', 'treemap'];
  const isDrillable = DRILLABLE.includes(w.type) && dims.length > 1;
  const baseGrains = isDrillable
    ? dims.map((_, i) => {
        // Drill level i = first i+1 dims of the hierarchy, plus the
        // static groupBy / columnDimensions that stay displayed at
        // every drill level.
        const prefix = dims.slice(0, i + 1);
        return [...new Set([...prefix, ...grpBy, ...colDims])];
      })
    // Scorecards and other widgets with measures but no display dims
    // need the EMPTY base grain — they display a single aggregate
    // ("grand total" in SQL terms). Without this entry the warmer's
    // grouping sets list ends up empty for them and the widget gets
    // skipped, so every runtime query falls through to the DB. SQL
    // emits `GROUP BY GROUPING SETS ((), (year), …)` and the empty
    // tuple `()` is the row whose measures are aggregated over the
    // entire (RLS-filtered) result set.
    : (baseDims.length > 0 ? [baseDims] : [[]]);

  const xfSubsets = powerSet(crossFilterDims);
  const sets = [];
  const seen = new Set();
  for (const grain of baseGrains) {
    for (const xf of xfSubsets) {
      const combined = [...new Set([...grain, ...xf])];
      // Empty combined = the SQL "grand total" set `()` — only emit
      // it for widgets that genuinely render a grand total (scorecards
      // and other no-dim widgets, signalled by baseDims.length === 0).
      // For dim-bearing widgets, an empty grouping set never matches
      // any runtime query so we'd just be paying for a useless extra
      // aggregate per warm SQL.
      if (combined.length === 0 && baseDims.length > 0) continue;
      const key = combined.slice().sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      sets.push(combined);
    }
  }
  return sets;
}

// Stable identity of a widget filter set, used as the bucket key.
// Two widgets with byte-identical `widgetFilters` can share a SQL.
function bucketKey(widgetFilters) {
  return JSON.stringify(widgetFilters || []);
}

// Build the report's warm plan: one item per bucket of widgets sharing
// `widgetFilters`. Each item drives a single SQL and yields one cache
// entry per widget in the bucket (demuxed by `_grain` + projected to
// each widget's own measures).
function planForReport(report, settings, opts = {}) {
  const widgets = report.widgets || {};
  const dimensionsForN1 = opts.dimensions || [];

  // First pass: build per-widget specs (dims, measures, grouping sets,
  // effective widgetFilters). Skip widgets that don't query at all
  // (filter/text/shape) and widgets with measure-level filters (we'll
  // fire those individually, they don't coalesce safely with peers).
  const widgetSpecs = [];
  for (const [wId, w] of Object.entries(widgets)) {
    if (!w || !w.dataBinding) continue;
    // text/shape widgets never fetch — skip. Filter widgets DO fetch
    // (distinct values, possibly cross-filtered) so they must be warmed
    // too; without them every cross-filter click triggers a fresh
    // DISTINCT query at the DB.
    if (w.type === 'text' || w.type === 'shape') continue;
    const b = w.dataBinding;
    const dims = b.selectedDimensions || [];
    const sm = b.scatterMeasures || {};
    const cbm = b.comboBarMeasures || [];
    const clm = b.comboLineMeasures || [];
    const meass = w.type === 'scatter'
      ? [sm.x, sm.y, sm.size].filter(Boolean)
      : w.type === 'combo'
        ? [...cbm, ...clm]
        : (b.selectedMeasures || []);
    const grpBy = b.groupBy || [];
    const colDims = b.columnDimensions || [];
    const baseDims = [...new Set([...dims, ...grpBy, ...colDims])];
    const uniqueMeas = [...new Set(meass)];
    if (baseDims.length === 0 && uniqueMeas.length === 0) continue;
    const crossFilterDims = crossFilterDimsForWidget(widgets, wId);
    const sets = groupingSetsForWidget(w, baseDims, crossFilterDims);
    if (sets.length === 0) continue;

    const reportLevelFilters = prepareGlobalRulesForWidget(settings?.reportFilters, wId);
    const widgetOwnFilters = Array.isArray(b.widgetFilters) ? b.widgetFilters : [];
    const widgetFilters = sanitizeWidgetFilters([...reportLevelFilters, ...widgetOwnFilters]);

    // Measure-level filters compile to HAVING, which doesn't compose
    // cleanly across coalesced widgets (each widget has its own measure
    // identity). Tag the spec so the planner fires this widget alone.
    const standalone = widgetOwnFilters.some((f) => f && f.isMeasure);

    widgetSpecs.push({
      wId, w, uniqueMeas, baseDims, sets, widgetFilters, standalone,
    });

    // Combo widgets with both groupBy AND line measures fire a SECOND
    // runtime query at axis-only grain (drops the groupBy from the
    // dimensionNames), with the line measure subset only. The /query
    // route hashes the cache key by `measures + widgetFilters + extras`
    // so this second query has a DIFFERENT shape — it would miss the
    // main spec's entry. Add a sibling spec under the same widgetFilters
    // bucket so the comboLine variant lands in the cache too. Both
    // specs share the SAME SQL roundtrip (their grouping sets union
    // into a single coalesced query).
    if (w.type === 'combo' && grpBy.length > 0 && Array.isArray(clm) && clm.length > 0) {
      const lineMeas = [...new Set(clm)];
      const lineBaseDims = [...new Set(dims)];
      const isDrillLine = dims.length > 1;
      const lineBaseGrains = isDrillLine
        ? dims.map((_, i) => dims.slice(0, i + 1))
        : (lineBaseDims.length > 0 ? [lineBaseDims] : []);
      const xfSubsetsLine = powerSet(crossFilterDims);
      const lineSets = [];
      const lineSeen = new Set();
      for (const grain of lineBaseGrains) {
        for (const xf of xfSubsetsLine) {
          const combined = [...new Set([...grain, ...xf])];
          if (combined.length === 0) continue;
          const key = combined.slice().sort().join('|');
          if (lineSeen.has(key)) continue;
          lineSeen.add(key);
          lineSets.push(combined);
        }
      }
      if (lineSets.length > 0) {
        widgetSpecs.push({
          wId: `${wId}#comboLine`,
          w,
          uniqueMeas: lineMeas,
          baseDims: lineBaseDims,
          sets: lineSets,
          widgetFilters,
          standalone,
        });
      }
    }
  }

  if (widgetSpecs.length === 0) return [];

  // Second pass: bucket by widgetFilters. Standalone widgets live in
  // their own single-widget bucket regardless of widgetFilters match.
  const buckets = new Map();
  for (const spec of widgetSpecs) {
    const key = spec.standalone ? `standalone:${spec.wId}` : bucketKey(spec.widgetFilters);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        bucketKey: key,
        widgetFilters: spec.widgetFilters,
        specs: [],
      };
      buckets.set(key, bucket);
    }
    bucket.specs.push(spec);
  }

  const reportExtras = {
    extraDimensions: settings?.extraDimensions || [],
    extraMeasures: settings?.extraMeasures || [],
    dimensionOverrides: settings?.dimensionOverrides || {},
    measureOverrides: settings?.measureOverrides || {},
  };

  // Third pass: materialise each bucket into a coalesced plan item.
  const out = [];
  for (const bucket of buckets.values()) {
    const allDims = [];
    const allMeas = [];
    const seenDim = new Set();
    const seenMeas = new Set();
    const allSets = [];
    const seenSet = new Set();
    for (const spec of bucket.specs) {
      for (const d of spec.baseDims) if (!seenDim.has(d)) { seenDim.add(d); allDims.push(d); }
      for (const s of spec.sets) {
        for (const d of s) if (!seenDim.has(d)) { seenDim.add(d); allDims.push(d); }
        const k = s.slice().sort().join('|');
        if (!seenSet.has(k)) { seenSet.add(k); allSets.push(s); }
      }
      for (const m of spec.uniqueMeas) if (!seenMeas.has(m)) { seenMeas.add(m); allMeas.push(m); }
    }
    out.push({
      bucketKey: bucket.bucketKey,
      modelId: report.model_id,
      widgetFilters: bucket.widgetFilters,
      reportExtras,
      // Ordered dim list — both SQL's GROUPING_ID args and the cache's
      // grain bitmask use this exact order. Don't sort or reorder.
      allDims,
      // The widgets this bucket serves (with their own measure / grouping
      // set / shape) — used at demux time to populate per-widget cache
      // entries.
      specs: bucket.specs,
      body: {
        dimensionNames: allDims,
        measureNames: allMeas,
        groupingSets: allSets,
        // Coalesced widgets share their widgetFilters (= the bucket key).
        // Standalone widgets carry their own here.
        widgetFilters: bucket.widgetFilters,
        // Generous safety cap for the GROUPING SETS result. Row count
        // is bounded by the cartesian product of grain dim cardinality
        // summed across all grouping sets.
        limit: 100000,
        filters: {},
        reportId: report.id,
        bypassCache: true,
        // The coalesced result lands in displayCache; skip the SQL-
        // keyed queryCache write to avoid double storage.
        skipCacheSet: true,
        extraDimensions: reportExtras.extraDimensions,
        extraMeasures: reportExtras.extraMeasures,
        dimensionOverrides: reportExtras.dimensionOverrides,
        measureOverrides: reportExtras.measureOverrides,
      },
    });
  }

  // Scorecard N-1 siblings — handled as their own standalone bucket
  // because the shifted widgetFilters won't match the original bucket
  // anyway.
  for (const spec of widgetSpecs) {
    if (spec.w.type !== 'scorecard') continue;
    const b = spec.w.dataBinding || {};
    if (!b.compareDateDim) continue;
    const shiftedWidgetFilters = sanitizeWidgetFilters(
      shiftWidgetFiltersForN1(spec.widgetFilters, dimensionsForN1)
    );
    if (JSON.stringify(shiftedWidgetFilters) === JSON.stringify(spec.widgetFilters)) continue;
    if (!hasShiftableFilterForN1({}, spec.widgetFilters, dimensionsForN1)) continue;
    out.push({
      bucketKey: `n1:${spec.wId}`,
      modelId: report.model_id,
      widgetFilters: shiftedWidgetFilters,
      reportExtras,
      allDims: [...spec.baseDims, ...new Set(spec.sets.flat())].filter((d, i, a) => a.indexOf(d) === i),
      // Suffix the wId with `#n1` so the displayCache entry is tagged
      // distinctly from the main scorecard's entry (same numeric ID but
      // different widgetFilters → different cache key). Without the
      // suffix the inspect endpoint's `entryByWidgetId` map collides:
      // one entry surfaces twice (once per spec lookup), the other
      // appears as an orphan of identical size.
      specs: [{ ...spec, wId: `${spec.wId}#n1`, widgetFilters: shiftedWidgetFilters, n1: true }],
      body: {
        dimensionNames: [...spec.baseDims, ...new Set(spec.sets.flat())].filter((d, i, a) => a.indexOf(d) === i),
        measureNames: spec.uniqueMeas,
        groupingSets: spec.sets,
        widgetFilters: shiftedWidgetFilters,
        limit: 100000,
        filters: {},
        reportId: report.id,
        bypassCache: true,
        skipCacheSet: true,
        extraDimensions: reportExtras.extraDimensions,
        extraMeasures: reportExtras.extraMeasures,
        dimensionOverrides: reportExtras.dimensionOverrides,
        measureOverrides: reportExtras.measureOverrides,
      },
    });
  }

  return out;
}

const _warmingReports = new Set();
function isWarming(reportId) { return _warmingReports.has(String(reportId)); }
function warmingReportIds() { return [..._warmingReports]; }

async function warmReport({ scheduleId, reportId, userId }) {
  const trackKey = String(reportId);
  _warmingReports.add(trackKey);
  try {
    return await _warmReportInner({ scheduleId, reportId, userId });
  } finally {
    _warmingReports.delete(trackKey);
  }
}

async function _warmReportInner({ scheduleId, reportId, userId }) {
  const row = db.prepare('SELECT * FROM reports WHERE id = ?').get(reportId);
  if (!row) return { skipped: true, reason: 'report-missing' };

  let widgets = {};
  let settings = {};
  try { widgets = JSON.parse(row.widgets || '{}'); } catch { /* malformed */ }
  try { settings = JSON.parse(row.settings || '{}'); } catch { /* malformed */ }
  const report = { ...row, widgets, settings };

  const modelRow = db.prepare(
    'SELECT id, datasource_id, dimensions, measures FROM models WHERE id = ?'
  ).get(report.model_id);
  let modelDimensions = [];
  try { modelDimensions = JSON.parse(modelRow?.dimensions || '[]'); } catch { /* malformed */ }
  const reportExtraDimensions = settings?.extraDimensions || [];
  const allDimensions = [...modelDimensions, ...reportExtraDimensions];

  const plan = planForReport(report, settings, { dimensions: allDimensions });
  if (plan.length === 0) {
    return { fired: 0, ok: 0, failed: 0, warmed: 0, reason: 'no-widgets' };
  }

  const token = internalToken.sign({ userId, organizationId: row.organization_id || null });
  const base = appBase();
  let ok = 0;
  let failed = 0;
  let stored = 0;
  const errors = [];
  // Temporary diagnostic — surfaces each bucket's effective
  // widgetFilters before firing so a "no WHERE clause" surprise on a
  // bucket the user expected to be filtered is visible at warm time.
  // Remove once the global-filter-bar regression is sorted out.
  if (process.env.WARM_LOG !== '0') {
    console.log(`[warm] report=${reportId} buckets=${plan.length}`);
    for (const item of plan) {
      const wIds = (item.specs || []).map((s) => s.wId).join(',');
      const wf = JSON.stringify(item.widgetFilters || []);
      console.log(`[warm] bucket "${item.bucketKey.slice(0, 60)}" widgets=[${wIds}] widgetFilters=${wf.slice(0, 200)}`);
    }
  }
  // Chunk size for the GROUPING SETS split — a bucket with > N sets
  // gets fired as multiple smaller POSTs whose result rows are merged
  // before storing. Each PG query scans the filtered table once per
  // grouping set, so splitting 60 sets into 6×10 turns one ~120s query
  // into six ~20s queries that don't trip the nginx 5min wall.
  // `WARM_CHUNK_SIZE=0` (or invalid) disables chunking — one big SQL.
  const chunkSize = Math.max(0, Number(process.env.WARM_CHUNK_SIZE ?? 10));

  for (const item of plan) {
    try {
      const allSets = Array.isArray(item.body.groupingSets) ? item.body.groupingSets : [];
      const chunks = (chunkSize > 0 && allSets.length > chunkSize)
        ? Array.from(
            { length: Math.ceil(allSets.length / chunkSize) },
            (_, i) => allSets.slice(i * chunkSize, (i + 1) * chunkSize),
          )
        : [allSets];
      if (process.env.WARM_LOG !== '0' && chunks.length > 1) {
        console.log(`[warm] bucket "${item.bucketKey.slice(0, 60)}" → ${chunks.length} chunks (${allSets.length} sets / ${chunkSize})`);
      }
      // Accumulate rows from every chunk before storing — the rows
      // across chunks are at non-overlapping grains (each chunk's
      // grouping sets are disjoint), so concatenation is correct.
      const allRows = [];
      let rlsContext = null;
      let chunkFailed = false;
      for (let cIdx = 0; cIdx < chunks.length; cIdx++) {
        const chunkBody = chunks.length > 1
          ? { ...item.body, groupingSets: chunks[cIdx] }
          : item.body;
        const r = await fetch(`${base}/api/models/${item.modelId}/query`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            [internalToken.HEADER]: token,
          },
          body: JSON.stringify(chunkBody),
        });
        if (!r.ok) {
          failed++;
          const text = await r.text().catch(() => '');
          const chunkLabel = chunks.length > 1 ? ` chunk ${cIdx + 1}/${chunks.length}` : '';
          errors.push(`${item.bucketKey}${chunkLabel} → ${r.status}: ${text.slice(0, 200)}`);
          chunkFailed = true;
          break;
        }
        const payload = await r.json();
        const rows = Array.isArray(payload?.rows) ? payload.rows : [];
        for (const row of rows) allRows.push(row);
        if (!rlsContext) {
          rlsContext = {
            bypass: payload?._rls?.bypass || null,
            allowed: payload?._rls?.allowedKeys || null,
          };
        }
      }
      if (chunkFailed) continue;
      ok++;
      // SQL aliases dims/measures by `label || name`. Build the alias
      // map so the displayCache lookup can resolve a runtime dim name
      // back to the cached row key.
      const dimLookup = (name) => allDimensions.find((d) => d.name === name) || null;
      const rowKeys = {};
      for (const dimName of item.allDims) {
        const d = dimLookup(dimName);
        const alias = d ? (d.label || d.name) : dimName;
        if (alias !== dimName) rowKeys[dimName] = alias;
      }
      // Build the columnar dataset ONCE per bucket from the merged
      // rows. Every spec in the bucket references the same dataset
      // (Phase 4-v2 dedup) so 1× RAM regardless of widget count.
      const sharedDataset = displayCache.buildSharedDataset({
        dims: item.allDims,
        rowKeys,
        rows: allRows,
      });
      for (const spec of item.specs) {
        const status = displayCache.set(
          {
            datasourceId: modelRow?.datasource_id,
            modelId: item.modelId,
            shape: displayCache.stableShape({
              measures: spec.uniqueMeas,
              widgetFilters: spec.widgetFilters,
              reportExtras: item.reportExtras,
            }),
            rlsContext: rlsContext || { bypass: null, allowed: null },
            orgId: row.organization_id || null,
            widgetId: spec.wId,
          },
          sharedDataset
        );
        if (status && status.stored) {
          stored++;
        } else {
          const reason = (status && status.reason) || 'unknown';
          errors.push(`${item.bucketKey}#${spec.wId} displayCache.set skipped: ${reason} (rows=${allRows.length})`);
        }
      }
    } catch (err) {
      failed++;
      errors.push(`${item.bucketKey} → ${err.message}`);
    }
  }
  return {
    fired: plan.length,
    ok,
    failed,
    warmed: ok,
    stored,
    errors: errors.length > 0 ? errors.slice(0, 5) : undefined,
  };
}

module.exports = {
  warmReport,
  planForReport,
  isWarming,
  warmingReportIds,
  crossFilterDimsForWidget,
  groupingSetsForWidget,
  powerSet,
};
