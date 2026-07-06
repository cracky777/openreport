import { sanitizeWidgetFilters } from './widgetFilters';
import { filterForTarget } from './crossFilter';
import { prepareGlobalRulesForWidget } from './reportFilterRules';
import {
  hasShiftableFilterForN1,
  shiftFiltersForN1,
  shiftWidgetFiltersForN1,
} from './comparePeriod';

// Build the assembled query bodies + the resolved metadata needed by the
// response handler for one widget. Pure function — no React, no axios,
// no refs. The caller is responsible for firing the actual HTTP calls and
// for registering cancel handles (Editor uses an AbortController + a
// per-query id in activeQueryIdsRef; Viewer fires plain promises).
//
// Was inlined in both Editor.jsx (lines 1167-1394) and Viewer.jsx
// (lines 437-608). The two copies differed in 5 places, each of which is
// covered here by an option:
//
//   bypassCache         — Editor passes `manualRefresh` (state-driven),
//                         Viewer passes `!!report?.live_mode`. Just a flag.
//   reportLevelFilters  — Editor reads `settings?.reportFilters`, Viewer
//                         reads `report?.settings?.reportFilters`. Caller
//                         passes the resolved list (already through
//                         prepareGlobalRulesForWidget).
//   reportExtras        — same story: Editor reads `settings.extra*`,
//                         Viewer reads `report.settings.extra*`. Caller
//                         passes the resolved object.
//   generateQueryId     — Editor generates a uuid + tracks it for cancel;
//                         Viewer doesn't track in-flight queries at all.
//                         Pass `() => crypto.randomUUID()` to enable,
//                         omit to skip.
//   dedupMeasures       — Editor wraps `measureNames` in `new Set(...)`,
//                         Viewer doesn't. Defaults to true (Editor); pass
//                         false for the Viewer call site.
//   filterWidgetMode    — 'skip' (Editor — filter widgets are excluded
//                         from `toFetch` upstream so the option never
//                         fires) | 'distinct' (Viewer — filter widgets
//                         fetch a distinct value list for their dim).
//                         Drives `queryFilters`, `queryLimit`, `distinct`.
//
// Returns:
//   {
//     meta: {  // everything the response handler needs that's not in the bodies
//       dims, allDims, meass, grpBy, colDimsB, cbm, clm, sm,
//       fullHierarchy, isDrillable, drillPath,
//       isFilterWidget, hasMainBinding,
//       targetFilters, mergedFilters, queryFilters,
//       colorMeasure, compareDateDim, comboLineApplies,
//       topN: { applies, value, measure },
//       n1: { shouldFetch },
//       mainQueryId,    // null when generateQueryId not provided
//     },
//     bodies: {
//       main,      // null when !hasMainBinding (caller still kicks an empty-rows promise)
//       color,     // null when no colorMeasure
//       total,     // null when no topN
//       n1,        // null when no N-1 fetch
//       comboLine, // null when not a combo+groupBy+lineMeasures widget
//       sqlOnly,   // null when !hasMainBinding (Editor-only fire-and-forget)
//     },
//   }
export function buildWidgetQueryPayload(widget, wId, ctx) {
  const {
    effectiveModel,
    reportFilters,
    currentWidgets,
    crossHighlight,
    reportId,
    reportLevelFilters,
    reportExtras,
    bypassCache,
    generateQueryId,
    filterWidgetMode = 'skip',
    dedupMeasures = true,
  } = ctx;

  const binding = widget.dataBinding || {};
  let dims = binding.selectedDimensions || [];
  const fullHierarchy = [...dims];
  const sm = binding.scatterMeasures || {};
  const cbm = binding.comboBarMeasures || [];
  const clm = binding.comboLineMeasures || [];
  const meass = widget.type === 'scatter'
    ? [sm.x, sm.y, sm.size].filter(Boolean)
    : widget.type === 'combo'
      ? [...new Set([...cbm, ...clm])]
      : widget.type === 'gauge'
        ? [...new Set([...(binding.selectedMeasures || []), binding.gaugeThresholdMeasure, binding.gaugeMaxMeasure].filter(Boolean))]
        : (binding.selectedMeasures || []);
  const grpBy = binding.groupBy || [];
  const colDimsB = binding.columnDimensions || [];

  // Drill-down support. Drillable widgets (bar/line/combo/pie/treemap)
  // with >1 dim follow a hierarchy: each drill click pushes one
  // {dim, value} pair onto `widget.drillPath`. The fetch uses only the
  // currently-active dim level and filters by the ancestor pinned values.
  const DRILLABLE = ['bar', 'line', 'combo', 'pie', 'treemap'];
  const isDrillable = DRILLABLE.includes(widget.type) && fullHierarchy.length > 1;
  const drillPath = [];
  if (isDrillable) {
    const raw = Array.isArray(widget.drillPath) ? widget.drillPath : [];
    for (let i = 0; i < raw.length && i < fullHierarchy.length - 1; i++) {
      if (raw[i]?.dim === fullHierarchy[i]) drillPath.push(raw[i]);
      else break;
    }
  }
  const drillFilters = {};
  if (isDrillable) {
    drillPath.forEach(({ dim, value }) => { if (dim && value != null) drillFilters[dim] = [String(value)]; });
    const activeDim = fullHierarchy[drillPath.length] || fullHierarchy[0];
    dims = [activeDim];
  }

  const allDims = [
    ...dims,
    ...grpBy.filter((g) => !dims.includes(g)),
    ...colDimsB.filter((g) => !dims.includes(g) && !grpBy.includes(g)),
  ];

  // Apply cross-filter exclusions per target before merging drill filters.
  // filterForTarget identifies the target via its widget id — which is the
  // Object.entries key in the caller's iteration, NOT a field on the widget
  // object — so the caller passes it through `wId`.
  const baseFilters = { ...(reportFilters || {}) };
  const targetFilters = filterForTarget(wId, baseFilters, currentWidgets, crossHighlight);
  const mergedFilters = { ...targetFilters, ...drillFilters };

  // Range-type date slicers (`dateRange`, `dateBetween`, and `dateCalendar`
  // with `dateCalendarMode === 'between'`) materialise their picked range
  // into the discrete list of dates that actually exist in the data — so
  // the server sees a giant `WHERE date IN ('2026-04-01', '2026-04-02', …)`
  // even when the user expressed an interval. Rewrite those entries to
  // the range shape `{ op: 'between', value: [min, max] }` so the server
  // emits a clean BETWEEN clause instead. We touch only `mergedFilters`
  // — the upstream `reportFilters` map keeps its array form so other
  // consumers (slicer `activeSelection`, snapshot diff, …) keep working.
  const rangeSlicerDims = new Set();
  for (const w of Object.values(currentWidgets || {})) {
    if (w?.type !== 'filter') continue;
    const dim = w.dataBinding?.selectedDimensions?.[0];
    if (!dim) continue;
    const style = w.config?.slicerStyle;
    const isBetweenStyle = style === 'dateRange'
      || style === 'dateBetween'
      || (style === 'dateCalendar' && w.config?.dateCalendarMode === 'between');
    if (isBetweenStyle) rangeSlicerDims.add(dim);
  }
  if (rangeSlicerDims.size > 0) {
    for (const k of Object.keys(mergedFilters)) {
      if (!rangeSlicerDims.has(k)) continue;
      const arr = mergedFilters[k];
      if (!Array.isArray(arr) || arr.length === 0) continue;
      // ISO date strings sort lexically the same as chronologically.
      // Non-ISO date formats would need Date-coerced comparison, but
      // every date slicer in this codebase emits ISO via toLocalInputDate.
      const sorted = [...arr].map((x) => String(x)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      mergedFilters[k] = { op: 'between', value: [sorted[0], sorted[sorted.length - 1]] };
    }
  }

  // Filter widget handling. In Viewer ('distinct' mode) filter widgets
  // fetch a distinct values list for their bound dim, ignoring report
  // filters (so the slicer doesn't filter itself) and capped at 1000.
  // In Editor ('skip' mode) filter widgets never reach here — they're
  // excluded by the caller's toFetch filter.
  const isFilterWidget = widget.type === 'filter';
  const useFilterWidgetDistinct = isFilterWidget && filterWidgetMode === 'distinct';
  const queryFilters = useFilterWidgetDistinct ? {} : mergedFilters;
  const queryLimit = useFilterWidgetDistinct ? 1000 : (widget.config?.dataLimit || 1000);

  const colorMeasure = (widget.config?.colorCondition?.enabled === true)
    ? binding.colorMeasure
    : undefined;
  const widgetOwnFilters = Array.isArray(binding.widgetFilters) ? binding.widgetFilters : [];
  const widgetFilters = [...reportLevelFilters, ...widgetOwnFilters];
  const hasMainBinding = (allDims.length > 0 || meass.length > 0);

  // Server-side Top N — push the limit into the SQL via a synthetic
  // top_n widget filter. Restricted to a single displayed dimension
  // (multi-dim queries would pick top axis×group pairs, not top axis
  // values — meaningless for a bar/pie cluster).
  const TOP_N_TYPES = ['bar', 'pie', 'treemap'];
  const topNApplies = TOP_N_TYPES.includes(widget.type)
    && widget.config?.topNEnabled === true
    && meass.length > 0
    && allDims.length === 1
    && !isFilterWidget;
  const topNValue = topNApplies ? Math.max(1, Math.floor(widget.config?.topN ?? 20)) : 0;
  const topNMeasure = topNApplies ? meass[0] : null;
  const widgetFiltersWithTopN = topNApplies
    ? [...widgetFilters, { field: topNMeasure, op: 'top_n', value: topNValue, isMeasure: true }]
    : widgetFilters;

  // Per-widget aggregation overrides (user flipped a SUM measure to AVG
  // via PropertyPanel). EVERY auxiliary query must forward it or the
  // server falls back to the model's default agg.
  const aggOverrides = binding.measureAggOverrides || {};
  const aggOverridesPayload = Object.keys(aggOverrides).length > 0 ? aggOverrides : undefined;

  const mainQueryId = generateQueryId ? generateQueryId() : null;
  const measureNames = dedupMeasures ? [...new Set(meass)] : meass;

  // N-1 comparison query (scorecards only). Same SQL shape as the main
  // fetch but every filter on a year-like / full-date dim is shifted -1.
  const compareDateDim = widget.type === 'scorecard' ? (binding.compareDateDim || null) : null;
  const dimsForN1 = effectiveModel?.dimensions;
  const shouldFetchN1 = !!compareDateDim
    && hasShiftableFilterForN1(queryFilters, widgetFilters, dimsForN1);
  const n1Filters = shouldFetchN1 ? shiftFiltersForN1(queryFilters, dimsForN1) : null;
  const n1WidgetFilters = shouldFetchN1 ? shiftWidgetFiltersForN1(widgetFilters, dimsForN1) : null;

  // Combo + groupBy + line measures: line gets its own (dim, lineMeasures)
  // query so it's aggregated at the right level — summing client-side
  // breaks for ratios/averages and propagates per-row div-by-zero errors.
  const comboLineApplies = widget.type === 'combo' && grpBy.length > 0 && clm.length > 0;

  const commonExtras = {
    reportId,
    bypassCache,
    ...reportExtras,
  };

  // X-grain HAVING — when the visual has a legend/groupBy dimension AND
  // at least one widget-level measure filter, the user-intended filter
  // is "keep the X-axis values whose AGGREGATE (across all legend slices)
  // passes the predicate", not "keep each (X × legend) cell that passes
  // independently". Pass the X-axis dims (post drill) to the server so
  // it can route those filters through an IN-subquery aggregated at the
  // X grain instead of a HAVING at the full (X × legend) grain.
  //
  // Restricted to bar / line / combo / area for now — pie and treemap
  // don't expose a separate legend axis in this codebase (their grpBy
  // is the only dim), so the X-grain and legend grain are identical.
  // Drillable widgets work transparently: `dims` is already the active
  // drill level (set above), so the IN-subquery aggregates at exactly
  // the level the visual currently shows.
  const X_GRAIN_HAVING_TYPES = ['bar', 'line', 'combo', 'area'];
  // Op aliases match buildScalarClause in server/routes/models.js
  // (eq/neq/gt/gte/lt/lte) — NOT the human-readable symbols (=/!=/>/etc.).
  // Missing this mapping was why an early version of this check silently
  // never set havingGrainDims.
  const HAVING_OPS = new Set([
    'top_n', 'bottom_n',
    'eq', 'neq', 'gt', 'gte', 'lt', 'lte',
    'between', 'is_null', 'is_not_null',
  ]);
  // Look at BOTH widget-own filters AND report-level rules — a measure
  // filter set in the global Settings filter bar arrives via
  // `reportLevelFilters`, NOT `binding.widgetFilters`, and should still
  // trigger x-grain routing for the bar/line/combo widget it applies to.
  const allMeasureFilterSources = [
    ...(Array.isArray(reportLevelFilters) ? reportLevelFilters : []),
    ...(Array.isArray(binding.widgetFilters) ? binding.widgetFilters : []),
  ];
  const havingFiltersPresent = allMeasureFilterSources.some(
    (f) => f && f.isMeasure && HAVING_OPS.has(f.op)
  );
  const havingGrainDims = (
    X_GRAIN_HAVING_TYPES.includes(widget.type)
    && grpBy.length > 0
    && dims.length > 0
    && havingFiltersPresent
  ) ? dims : undefined;

  const mainQueryBody = hasMainBinding ? {
    dimensionNames: allDims,
    measureNames,
    measureAggOverrides: aggOverridesPayload,
    limit: queryLimit,
    filters: queryFilters,
    widgetFilters: sanitizeWidgetFilters(widgetFiltersWithTopN),
    ...(havingGrainDims ? { havingGrainDims } : {}),
    ...(useFilterWidgetDistinct ? { distinct: true } : {}),
    ...(mainQueryId ? { queryId: mainQueryId } : {}),
    ...commonExtras,
  } : null;

  const colorQueryBody = colorMeasure ? {
    dimensionNames: [],
    measureNames: [colorMeasure],
    measureAggOverrides: aggOverridesPayload,
    limit: 1,
    filters: queryFilters,
    // Drop the synthetic top_n filter for the color aggregate — it
    // doesn't apply when there's no GROUP BY.
    widgetFilters: sanitizeWidgetFilters([...reportLevelFilters, ...widgetOwnFilters]),
    ...commonExtras,
  } : null;

  const totalQueryBody = topNApplies ? {
    dimensionNames: [],
    measureNames: [topNMeasure],
    measureAggOverrides: aggOverridesPayload,
    limit: 1,
    filters: queryFilters,
    // Top_n filter dropped here — we want the grand total, not truncated.
    widgetFilters: sanitizeWidgetFilters([...reportLevelFilters, ...widgetOwnFilters]),
    ...commonExtras,
  } : null;

  const n1QueryBody = shouldFetchN1 ? {
    dimensionNames: allDims,
    measureNames,
    measureAggOverrides: aggOverridesPayload,
    limit: 1,
    filters: n1Filters,
    widgetFilters: sanitizeWidgetFilters(n1WidgetFilters),
    ...commonExtras,
  } : null;

  const comboLineQueryBody = comboLineApplies ? {
    dimensionNames: dims,
    measureNames: [...new Set(clm)],
    measureAggOverrides: aggOverridesPayload,
    limit: widget.config?.dataLimit || 1000,
    filters: queryFilters,
    widgetFilters: sanitizeWidgetFilters(widgetFilters),
    ...commonExtras,
  } : null;

  const sqlOnlyQueryBody = hasMainBinding ? { ...mainQueryBody, sqlOnly: true } : null;

  return {
    meta: {
      dims, allDims, meass, grpBy, colDimsB, cbm, clm, sm,
      fullHierarchy, isDrillable, drillPath,
      isFilterWidget, hasMainBinding,
      targetFilters, mergedFilters, queryFilters,
      colorMeasure, compareDateDim, comboLineApplies,
      topN: { applies: topNApplies, value: topNValue, measure: topNMeasure },
      n1: { shouldFetch: shouldFetchN1 },
      mainQueryId,
    },
    bodies: {
      main: mainQueryBody,
      color: colorQueryBody,
      total: totalQueryBody,
      n1: n1QueryBody,
      comboLine: comboLineQueryBody,
      sqlOnly: sqlOnlyQueryBody,
    },
  };
}
