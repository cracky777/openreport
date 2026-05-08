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
const { additiveTypeForMeasure } = require('./measureType');
const { sanitizeWidgetFilters } = require('./widgetFilters');
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

// Build the per-widget plan. For visuals whose measures are all additive
// AND the report has at least one slicer, fire an expanded query (dims +
// slicerDims in GROUP BY) and tag it `preAgg: true` so the warmer stores
// the result in preAggCache. Other visuals fall back to a baseline warm
// of just the SQL-keyed cache.
function planForReport(report, settings, opts = {}) {
  const widgets = report.widgets || {};
  const slicerDims = opts.slicerDims || [];
  // Returns the full measure object so additiveTypeForMeasure can also
  // promote trivial custom expressions (`COUNT(col)`, `SUM(col)`, …).
  const measureLookup = opts.measureLookup || (() => null);
  // Optional list of dim defs — used by the N-1 shifter to detect
  // year-like and full-date columns when generating the comparison
  // variant of a scorecard's plan.
  const dimensionsForN1 = opts.dimensions || [];
  // Report-level filter rules (settings.reportFilters) — Editor.jsx
  // concatenates these with each visual's own widgetFilters before
  // hitting /query. The warmer must do the same so the body it POSTs
  // (and the shape it stores under) matches what the runtime computes.
  const reportLevelFilters = Array.isArray(settings?.reportFilters) ? settings.reportFilters : [];
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
    const measureTypes = uniqueMeas.map((name) => additiveTypeForMeasure(measureLookup(name)));
    const allAdditive = uniqueMeas.length > 0 && measureTypes.every((t) => t !== null);
    const preAggExtraDims = slicerDims.filter((d) => !baseDims.includes(d));
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
    const preAgg = allAdditive && expandedDims.length > 0 && !hasMeasureFilter;
    // Same composition Editor.jsx does for the runtime body — report-level
    // filters first, then the widget's own. Sanitised through the same
    // helper the client uses so the resulting array (and therefore the
    // pre-agg shape key) is byte-identical between warm and runtime.
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
      uniqueMeas,
      measureTypes: preAgg
        ? Object.fromEntries(uniqueMeas.map((name, i) => [name, measureTypes[i]]))
        : null,
      widgetFilters,
      reportExtras,
      body: {
        dimensionNames: expandedDims,
        measureNames: uniqueMeas,
        measureAggOverrides: b.measureAggOverrides || undefined,
        limit: w.config?.dataLimit || 1000,
        filters: {},
        widgetFilters,
        reportId: report.id,
        bypassCache: true,
        extraDimensions: reportExtras.extraDimensions,
        extraMeasures: reportExtras.extraMeasures,
        dimensionOverrides: reportExtras.dimensionOverrides,
        measureOverrides: reportExtras.measureOverrides,
      },
    };
    out.push(baseItem);
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
  const row = db.prepare(
    'SELECT id, title, model_id, widgets, settings FROM reports WHERE id = ?'
  ).get(reportId);
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
    // Year-shift detection in the N-1 plan needs dim-type metadata.
    dimensions: allDimensions,
  });
  if (plan.length === 0) {
    return { fired: 0, ok: 0, failed: 0, warmed: 0, reason: 'no-widgets' };
  }

  const token = internalToken.sign({ userId });
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
          const rowKeys = {};
          for (const dimName of item.expandedDims) {
            const d = dimensionLookup(dimName);
            const alias = d ? (d.label || d.name) : dimName;
            if (alias !== dimName) rowKeys[dimName] = alias;
          }
          for (const measName of item.uniqueMeas) {
            const m = measureLookup(measName);
            const alias = m ? (m.label || m.name) : measName;
            if (alias !== measName) rowKeys[measName] = alias;
          }
          preAggCache.set(
            {
              datasourceId: modelRow?.datasource_id,
              modelId: item.modelId,
              shape: preAggCache.stableShape({
                dims: item.baseDims,
                measures: item.uniqueMeas,
                widgetFilters: item.widgetFilters,
                reportExtras: item.reportExtras,
              }),
              rlsContext,
            },
            {
              dims: item.expandedDims,
              measures: Object.fromEntries(
                Object.entries(item.measureTypes).map(([name, type]) => [name, { type }])
              ),
              rowKeys,
              rows,
            }
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
