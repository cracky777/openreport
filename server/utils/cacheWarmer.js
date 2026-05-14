/**
 * Proactive cache warming for OSS.
 *
 * Same idea as the cloud variant (cloud/cacheWarmer.js): walk the report's
 * widgets, fire a query per visual to populate queryCache, and for visuals
 * with additive measures fire an EXPANDED query (slicer dims added to the
 * GROUP BY) so the result lands in preAggCache and serves any filter
 * combination from memory.
 *
 * Authenticated via the same in-process JWT pattern: sign a short-lived
 * scope=cache_warm token for the schedule's owner, plant it as a header
 * on the localhost call, let `internalToken.middleware` promote the
 * request. No HTTP cookies, no session fixation surface.
 */

const internalToken = require('./internalToken');
const preAggCache = require('./preAggCache');
const { toColumnarDataset } = require('./inMemoryAgg');
const { additiveTypeForMeasure, decomposeMeasure } = require('./measureType');
const { sanitizeWidgetFilters } = require('./widgetFilters');
const { prepareGlobalRulesForWidget } = require('./reportFilterRules');
const { shiftWidgetFiltersForN1, hasShiftableFilterForN1 } = require('./comparePeriod');
const db = require('../db');

function appBase() {
  if (process.env.INTERNAL_APP_URL) return process.env.INTERNAL_APP_URL.replace(/\/+$/, '');
  const port = process.env.PORT || '3001';
  return `http://127.0.0.1:${port}`;
}

// Walk the report's widgets and pull every dimension a runtime filter
// could land on. Those are the dims we add to GROUP BY at warm time so
// the pre-agg can serve any filter combination from cache, including
// drill-down clicks and cross-filter from other widgets.
//
// Sources:
//   1. Filter (slicer) widgets — their `selectedDimensions` are direct
//      user-controlled filters.
//   2. Other visuals' axis / group-by / column dims (and drill
//      hierarchies, which live in `selectedDimensions`) — clicking a
//      bar / segment cross-filters every other widget on that dim.
//
// Yes, this can grow the cardinality fast on a wide report. The
// trade-off is that EVERY click-through becomes a cache hit, which is
// the whole point of the pre-agg path. If a deployment ever needs a
// cap we can expose a per-report setting; the default bias is towards
// instant interactions.
function collectFilterableDims(widgets) {
  const out = new Set();
  for (const w of Object.values(widgets || {})) {
    if (!w || !w.dataBinding) continue;
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

// Per-widget slicer-dim collection that respects each source's
// `crossFilterExclusions`. A widget marked as excluded from a slicer (or
// from a chart used as cross-filter source) will never receive that
// source's dim at runtime — so the warmer shouldn't grow this widget's
// pre-agg dataset by that dim either. Without this, the dataset cardi-
// nality blows up unnecessarily (and quickly hits the `dataLimit` cap)
// for widgets with many disabled interactions.
function slicerDimsForWidget(widgets, targetWId) {
  const out = new Set();
  for (const [sourceWId, w] of Object.entries(widgets || {})) {
    if (!w || !w.dataBinding) continue;
    if (sourceWId === targetWId) continue; // a widget's own dims come from baseDims
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

// Build the per-widget plan. For visuals whose measures are all additive
// AND the report has at least one slicer, fire an expanded query (dims +
// slicerDims in GROUP BY) and tag it `preAgg: true` so the warmer stores
// the result in preAggCache. Other visuals fall back to a baseline warm
// of just the SQL-keyed cache.
function planForReport(report, settings, opts = {}) {
  const widgets = report.widgets || {};
  // `opts.slicerDims` (the global, all-widgets slicer dim set) is kept
  // only for the warmReport return payload (telemetry). For the actual
  // dataset shape we use `slicerDimsForWidget(widgets, wId)` per visual
  // so a widget excluded from a slicer's cross-filter doesn't get its
  // pre-agg bloated with that dim's cardinality.
  // Returns the full measure object so additiveTypeForMeasure can also
  // promote trivial custom expressions (`COUNT(col)`, `SUM(col)`, …).
  const measureLookup = opts.measureLookup || (() => null);
  // Full list of measure objects (model + report extras). Needed by
  // decomposeMeasure to resolve `${ref}` chains in ratio expressions.
  const allMeasures = opts.allMeasures || [];
  // Optional list of dim defs — used by the N-1 shifter to detect
  // year-like and full-date columns when generating the comparison
  // variant of a scorecard's plan.
  const dimensionsForN1 = opts.dimensions || [];
  // Report-level filter rules (settings.reportFilters). Per-widget views
  // are computed inside the loop via `prepareGlobalRulesForWidget` so the
  // body the warmer POSTs (and therefore the preAggCache shape key) stays
  // byte-identical to what the client builds at runtime.
  const out = [];
  for (const [wId, w] of Object.entries(widgets)) {
    if (!w || !w.dataBinding) continue;
    if (w.type === 'filter' || w.type === 'text' || w.type === 'shape') continue;
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
    // Phase 3 decomposition — each visual measure is either a simple
    // additive (sum/count/min/max), or a composite that recomposes from
    // additive components (ratio of two additive measures, or AVG).
    //   - 'simple'  → fire as-is at warm; aggregate sums per its inner type.
    //   - 'ratio'   → fire the `numRef` + `denRef` named measures instead;
    //                 the dataset stores them, aggregate divides at output.
    //   - 'avg'     → would need synthetic SUM+COUNT injection; not yet
    //                 wired through the /query gate, so AVG falls through
    //                 to the SQL-keyed cache for now.
    const decompositionSpecs = uniqueMeas.map((name) => decomposeMeasure(measureLookup(name), allMeasures));
    // Build the firing list: which measure names to actually request from
    // the route. Components for ratio measures are named refs that exist
    // in the model / report extras. Visual measures themselves are NOT
    // fired when they're composite (they'd just duplicate the same data
    // through SQL twice).
    const firedSet = new Set();
    let allDecomposable = uniqueMeas.length > 0;
    for (let i = 0; i < uniqueMeas.length; i++) {
      const spec = decompositionSpecs[i];
      if (!spec) { allDecomposable = false; break; }
      if (spec.type === 'simple') { firedSet.add(uniqueMeas[i]); continue; }
      if (spec.type === 'ratio') {
        firedSet.add(spec.numRef);
        firedSet.add(spec.denRef);
        continue;
      }
      if (spec.type === 'expression') {
        // Fire each ${ref} as a named measure so the dataset stores its
        // additive sub-totals; the evaluator runs over those at output.
        for (const r of spec.refs) firedSet.add(r.name);
        continue;
      }
      // AVG decomposition requires synthetic SUM+COUNT measures that the
      // /query gate doesn't accept under an internal warm token (see
      // 0065796 extras gating). Skip preAgg for this visual.
      allDecomposable = false; break;
    }
    const firedMeasureNames = [...firedSet];
    // Per-widget slicer dims: only dims from sources that ARE allowed to
    // cross-filter this widget at runtime. Slicers whose
    // `crossFilterExclusions` lists this wId are dropped — the runtime
    // would never push their dim into baseFilters for this widget, so
    // there's no point bloating the pre-agg dataset with it.
    const slicerDimsForThisWidget = slicerDimsForWidget(widgets, wId);
    const preAggExtraDims = slicerDimsForThisWidget.filter((d) => !baseDims.includes(d));
    const expandedDims = [...baseDims, ...preAggExtraDims];
    // A measure-level filter (HAVING) targets the SUM at the visual's
    // baseDims granularity. Adding slicerDims to GROUP BY for pre-agg
    // would push that HAVING down to a finer granularity and silently
    // drop rows whose finer-grain SUM is below the threshold even when
    // their baseDims-level SUM is well above. Disable pre-agg whenever
    // a measure filter is present — the visual still warms via the
    // SQL-keyed cache.
    const widgetOwnFiltersRaw = Array.isArray(b.widgetFilters) ? b.widgetFilters : [];
    const hasMeasureFilter = widgetOwnFiltersRaw.some((f) => f && f.isMeasure);
    // Pre-agg is useful as soon as the dataset has at least one dim —
    // even when the visual's own hierarchy already covers everything we
    // could want to filter on. A drillable chart with baseDims=[month,
    // week, status] needs no slicer expansion but still benefits from
    // having its full grouped result cached: every drill level / cross-
    // filter resolves to a subset of those dims and is served via
    // inMemoryAgg without a DB round-trip.
    const preAgg = allDecomposable && expandedDims.length > 0 && !hasMeasureFilter;
    // Same composition Editor.jsx does for the runtime body — report-level
    // filters (per-widget view, with this widget's exclusions honoured and
    // the `exclusions` field stripped) first, then the widget's own.
    // Sanitised through the same helper the client uses so the resulting
    // array (and therefore the preAggCache shape key) is byte-identical
    // between warm and runtime.
    const reportLevelFilters = prepareGlobalRulesForWidget(settings?.reportFilters, wId);
    const widgetOwnFilters = Array.isArray(b.widgetFilters) ? b.widgetFilters : [];
    const widgetFilters = sanitizeWidgetFilters([...reportLevelFilters, ...widgetOwnFilters]);
    const reportExtras = {
      extraDimensions: settings?.extraDimensions || [],
      extraMeasures: settings?.extraMeasures || [],
      dimensionOverrides: settings?.dimensionOverrides || {},
      measureOverrides: settings?.measureOverrides || {},
    };
    const baseItem = {
      widgetId: wId,
      modelId: report.model_id,
      preAgg,
      baseDims,
      expandedDims,
      // What the runtime visual will request — used for the cache shape
      // key so warm and runtime lookups match.
      uniqueMeas,
      // What we actually fire at warm time. For widgets with only simple
      // measures this is the same as uniqueMeas; for ratio measures it's
      // the underlying num/den components.
      firedMeasureNames,
      // Spec per visual measure, so the cache writer can wire each
      // visual's metadata in `dataset.measures` (simple type, or composite
      // with component row keys).
      decompositionSpecs: preAgg ? decompositionSpecs : null,
      widgetFilters,
      reportExtras,
      body: {
        // preAgg items fire at the fine grain (baseDims + slicerDims) so
        // the cached dataset can re-aggregate any drill / cross-filter
        // shape in-memory. Non-preAgg items fire at the VISUAL grain
        // (baseDims only) so the SQL matches what the runtime visual
        // will actually request — otherwise queryCache stores rows the
        // runtime never reads.
        dimensionNames: preAgg ? expandedDims : baseDims,
        // Fire components when we're going to recompose later; visual
        // measures otherwise. The warmer also writes the visual measure
        // SQL into the queryCache via this same query, but only the
        // preAgg path serves drill / cross-filter from cache.
        measureNames: preAgg ? firedMeasureNames : uniqueMeas,
        measureAggOverrides: b.measureAggOverrides || undefined,
        // Warm fires at the fine grain (baseDims + slicerDims) — much
        // higher cardinality than what the visual will actually display.
        // The widget's `dataLimit` is for the runtime display; for warm
        // we want enough rows to cover every drill / cross-filter
        // combination. 10000 gives roomy coverage without bloating RAM
        // (typical row ~80B → ~800KB per widget worst-case).
        limit: 10000,
        filters: {},
        widgetFilters,
        reportId: report.id,
        bypassCache: true,
        // When we're going to store the result in preAggCache (columnar,
        // compact), skip the parallel queryCache.set — the same data
        // would otherwise live twice in RAM (raw rows-of-objects + dict-
        // encoded columnar). The route still serves preAgg → queryCache
        // → DB at runtime; if preAgg ever misses for this shape, the
        // fallback is a fresh DB hit (which then DOES cache normally).
        skipCacheSet: preAgg,
        extraDimensions: reportExtras.extraDimensions,
        extraMeasures: reportExtras.extraMeasures,
        dimensionOverrides: reportExtras.dimensionOverrides,
        measureOverrides: reportExtras.measureOverrides,
      },
    };
    out.push(baseItem);
    // Combo + groupBy + line measures variant — Editor.jsx fires a dedicated
    // `comboLine` /query that re-aggregates the line measures at the AXIS-
    // ONLY granularity (drops the groupBy from dimensionNames). The main
    // query's preAgg entry can't serve this because its shape key is the
    // UNION of bar + line measures; the comboLine query has only the line
    // subset and would always shape-miss. Warm a sibling entry under the
    // line-measures-only shape so the comboLine call hits.
    if (w.type === 'combo' && grpBy.length > 0 && clm.length > 0) {
      const lineMeass = [...new Set(clm)];
      const lineSpecs = lineMeass.map((name) => decomposeMeasure(measureLookup(name), allMeasures));
      const lineFiredSet = new Set();
      let lineDecomposable = lineMeass.length > 0;
      for (let i = 0; i < lineMeass.length; i++) {
        const spec = lineSpecs[i];
        if (!spec) { lineDecomposable = false; break; }
        if (spec.type === 'simple') { lineFiredSet.add(lineMeass[i]); continue; }
        if (spec.type === 'ratio') {
          lineFiredSet.add(spec.numRef);
          lineFiredSet.add(spec.denRef);
          continue;
        }
        if (spec.type === 'expression') {
          for (const r of spec.refs) lineFiredSet.add(r.name);
          continue;
        }
        lineDecomposable = false; break;
      }
      const lineFiredMeasureNames = [...lineFiredSet];
      // Drill hierarchy without groupBy — mirrors Editor's `dimensionNames: dims`.
      const lineBaseDims = [...new Set(dims)];
      const lineExpandedDims = [...lineBaseDims, ...slicerDimsForThisWidget.filter((d) => !lineBaseDims.includes(d))];
      const linePreAgg = lineDecomposable && lineExpandedDims.length > 0 && !hasMeasureFilter;
      if (linePreAgg) {
        out.push({
          widgetId: `${wId}#comboLine`,
          modelId: report.model_id,
          preAgg: true,
          baseDims: lineBaseDims,
          expandedDims: lineExpandedDims,
          uniqueMeas: lineMeass,
          firedMeasureNames: lineFiredMeasureNames,
          decompositionSpecs: lineSpecs,
          widgetFilters,
          reportExtras,
          body: {
            dimensionNames: lineExpandedDims,
            measureNames: lineFiredMeasureNames,
            measureAggOverrides: b.measureAggOverrides || undefined,
            // Warm fires at the fine grain (baseDims + slicerDims) — much
        // higher cardinality than what the visual will actually display.
        // The widget's `dataLimit` is for the runtime display; for warm
        // we want enough rows to cover every drill / cross-filter
        // combination. 10000 gives roomy coverage without bloating RAM
        // (typical row ~80B → ~800KB per widget worst-case).
        limit: 10000,
            filters: {},
            widgetFilters,
            reportId: report.id,
            bypassCache: true,
            // Mirror baseItem: this sibling lands in preAggCache too, so
            // don't double-store in queryCache.
            skipCacheSet: true,
            extraDimensions: reportExtras.extraDimensions,
            extraMeasures: reportExtras.extraMeasures,
            dimensionOverrides: reportExtras.dimensionOverrides,
            measureOverrides: reportExtras.measureOverrides,
          },
        });
      }
    }
    // Scorecard N-1 comparison — Editor.jsx fires a sibling /query with
    // year-shifted widgetFilters when `compareDateDim` is set and at
    // least one filter targets a year-like or full-date dim. To make
    // those queries cache-hit too, fire the shifted variant here as
    // well so the pre-agg dataset for that variant exists.
    if (w.type === 'scorecard' && b.compareDateDim) {
      const shiftedWidgetFilters = sanitizeWidgetFilters(
        shiftWidgetFiltersForN1(widgetFilters, dimensionsForN1)
      );
      // No-op when nothing actually shifted (e.g. compareDateDim set
      // but no year filter on the visual yet).
      const sameAsMain = JSON.stringify(shiftedWidgetFilters) === JSON.stringify(widgetFilters);
      if (!sameAsMain && hasShiftableFilterForN1({}, widgetFilters, dimensionsForN1)) {
        out.push({
          ...baseItem,
          widgetId: `${wId}#n1`,
          widgetFilters: shiftedWidgetFilters,
          body: {
            ...baseItem.body,
            widgetFilters: shiftedWidgetFilters,
          },
        });
      }
    }
  }
  return out;
}

// Set of reportIds whose warm pass is currently in flight. Survives the
// HTTP round-trip so a UI that polls (or reloads after F5) can show the
// spinner on the right cards. Cleared in `warmReport`'s finally block.
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
  // SELECT * so the optional cloud-only `organization_id` column is
  // surfaced when present. Falls back to undefined in OSS where the
  // column doesn't exist; the warmer then stamps no org context on the
  // internal token and the OSS routes don't care either way.
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
  let modelMeasures = [];
  try { modelDimensions = JSON.parse(modelRow?.dimensions || '[]'); } catch { /* malformed */ }
  try { modelMeasures = JSON.parse(modelRow?.measures || '[]'); } catch { /* malformed */ }
  const reportExtraDimensions = settings?.extraDimensions || [];
  const reportExtraMeasures = settings?.extraMeasures || [];
  const allDimensions = [...modelDimensions, ...reportExtraDimensions];
  const allMeasures = [...modelMeasures, ...reportExtraMeasures];
  const dimensionLookup = (name) => allDimensions.find((d) => d.name === name) || null;
  const measureLookup = (name) => allMeasures.find((mm) => mm.name === name) || null;

  const slicerDims = collectFilterableDims(widgets);
  const plan = planForReport(report, settings, {
    slicerDims, measureLookup,
    // Pool used by decomposeMeasure to resolve `${ref}` chains in ratio
    // measure expressions back to their additive components.
    allMeasures,
    // Year-shift detection in the N-1 plan needs dim-type metadata.
    dimensions: allDimensions,
  });
  if (plan.length === 0) {
    return { fired: 0, ok: 0, failed: 0, warmed: 0, reason: 'no-widgets' };
  }

  // Stamp the report's org on the token (cloud-only; harmless in OSS).
  // Lets the cloud activeOrg middleware preserve the right tenant when
  // the warmer's localhost fetch hits /api/models/:id/query.
  const token = internalToken.sign({ userId, organizationId: row.organization_id || null });
  const base = appBase();
  let ok = 0;
  let failed = 0;
  let preAggsStored = 0;
  const errors = [];
  for (const item of plan) {
    try {
      const r = await fetch(`${base}/api/models/${item.modelId}/query`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [internalToken.HEADER]: token,
        },
        body: JSON.stringify(item.body),
      });
      if (!r.ok) {
        failed++;
        const text = await r.text().catch(() => '');
        errors.push(`${item.widgetId} → ${r.status}: ${text.slice(0, 120)}`);
        continue;
      }
      ok++;
      if (item.preAgg) {
        try {
          const payload = await r.json();
          const rows = Array.isArray(payload?.rows) ? payload.rows : [];
          const rlsContext = {
            bypass: payload?._rls?.bypass || null,
            allowed: payload?._rls?.allowedKeys || null,
          };
          // SQL aliases columns by `label || name` (see the route's
          // selectParts). The dataset stores rows as-is and gives the
          // aggregator a `rowKeys: { name → alias }` map so it can look
          // up the right column without us having to rewrite every row.
          const aliasFor = (m) => (m && (m.label || m.name)) || null;
          const rowKeys = {};
          for (const dimName of item.expandedDims) {
            const d = dimensionLookup(dimName);
            const alias = d ? (d.label || d.name) : dimName;
            if (alias !== dimName) rowKeys[dimName] = alias;
          }
          // Map each fired component measure name → its SQL alias (the
          // row's column key). Visual measures that are themselves simple
          // are in this set; ratio components are too. Composite visual
          // measures (ratio) get their alias mapped separately below for
          // the output row key.
          for (const measName of item.firedMeasureNames) {
            const m = measureLookup(measName);
            const alias = aliasFor(m) || measName;
            if (alias !== measName) rowKeys[measName] = alias;
          }
          // Build dataset.measures with the metadata aggregate needs to
          // recompose at lookup time. Visual measures land here under
          // their canonical name; their components (for ratios) point at
          // the row columns we just stored.
          const measuresMeta = {};
          // Each fired component is itself a simple additive measure.
          for (const compName of item.firedMeasureNames) {
            const compM = measureLookup(compName);
            const compType = additiveTypeForMeasure(compM);
            if (compType) measuresMeta[compName] = { type: compType };
          }
          // Each visual measure's recomposition spec — only added when
          // it isn't already there (simple visual measures share their
          // entry with their fired component).
          for (let i = 0; i < item.uniqueMeas.length; i++) {
            const visualName = item.uniqueMeas[i];
            const spec = item.decompositionSpecs[i];
            if (!spec) continue;
            if (spec.type === 'simple') {
              if (!measuresMeta[visualName]) measuresMeta[visualName] = { type: spec.innerType };
              continue;
            }
            if (spec.type === 'ratio') {
              const numAlias = aliasFor(measureLookup(spec.numRef)) || spec.numRef;
              const denAlias = aliasFor(measureLookup(spec.denRef)) || spec.denRef;
              measuresMeta[visualName] = {
                type: 'ratio',
                numKey: numAlias,
                denKey: denAlias,
                hasGuard: spec.hasGuard,
                // Optional multiplier captured by detectRatio (1 = no scale).
                scale: spec.scale || 1,
              };
              // Map the visual measure's name → its display alias so the
              // aggregate output row uses the right column key.
              const visualM = measureLookup(visualName);
              const visualAlias = aliasFor(visualM) || visualName;
              if (visualAlias !== visualName) rowKeys[visualName] = visualAlias;
              continue;
            }
            if (spec.type === 'expression') {
              // Map each ref → its SQL alias so the aggregator can read
              // the right column without re-doing the alias resolution
              // at every cell lookup.
              const refKeys = {};
              for (const r of spec.refs) {
                const refM = measureLookup(r.name);
                refKeys[r.name] = aliasFor(refM) || r.name;
              }
              measuresMeta[visualName] = {
                type: 'expression',
                refs: spec.refs,
                refKeys,
                rawExpression: spec.rawExpression,
              };
              const visualM = measureLookup(visualName);
              const visualAlias = aliasFor(visualM) || visualName;
              if (visualAlias !== visualName) rowKeys[visualName] = visualAlias;
            }
          }
          preAggCache.set(
            {
              datasourceId: modelRow?.datasource_id,
              modelId: item.modelId,
              shape: preAggCache.stableShape({
                dims: item.baseDims,
                // Shape key MUST be the visual measure names (what the
                // runtime requests) — not the fired components — so warm
                // and runtime lookups produce the same hash.
                measures: item.uniqueMeas,
                widgetFilters: item.widgetFilters,
                reportExtras: item.reportExtras,
              }),
              rlsContext,
              // Tag with the report's org so the cloud's RAM quota
              // resolver can gate the write. Undefined in OSS — no-op.
              orgId: row.organization_id || null,
            },
            // Columnar conversion: drops repeated property keys, dict-
            // encodes low-cardinality string columns. Reduces JSON size
            // and V8 heap pressure without changing aggregate semantics.
            toColumnarDataset({
              dims: item.expandedDims,
              measures: measuresMeta,
              rowKeys,
              rows,
            })
          );
          preAggsStored++;
        } catch (e) {
          // Pre-agg storage failure is non-fatal — the SQL-keyed cache
          // entry was still written by the route.
          errors.push(`${item.widgetId} preAgg → ${e.message}`);
        }
      }
    } catch (err) {
      failed++;
      errors.push(`${item.widgetId} → ${err.message}`);
    }
  }
  return {
    fired: plan.length,
    ok,
    failed,
    warmed: ok,
    preAggsStored,
    slicerDims,
    errors: errors.length > 0 ? errors.slice(0, 5) : undefined,
  };
}

module.exports = { warmReport, planForReport, isWarming, warmingReportIds };
