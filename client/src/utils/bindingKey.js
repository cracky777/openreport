// Stable identifier for a widget's data binding. Used as a cache key by both
// fetchers (DataPanel for binding-driven fetches, Editor for filter/refresh
// fetches) so they don't refire on each other's heels — selecting a widget
// after an Editor-driven refetch should not trigger a DataPanel refetch when
// the binding hasn't actually moved.

export function computeBindingKey({ widget, model, reportFilters, settings, cacheBuiltAt }) {
  if (!widget) return '';
  const binding = widget.dataBinding || {};

  const selectedDims = binding.selectedDimensions || [];
  const groupBy = binding.groupBy || [];
  const columnDims = binding.columnDimensions || [];

  const isScatter = widget.type === 'scatter';
  const isCombo = widget.type === 'combo';
  const isGauge = widget.type === 'gauge';
  const isFilterWidget = widget.type === 'filter';

  const scatterMeas = binding.scatterMeasures || {};
  const comboBarMeas = binding.comboBarMeasures || [];
  const comboLineMeas = binding.comboLineMeasures || [];
  const gaugeThresholdMeasure = binding.gaugeThresholdMeasure;
  const gaugeMaxMeasure = binding.gaugeMaxMeasure;

  const selectedMeass = isScatter
    ? [scatterMeas.x, scatterMeas.y, scatterMeas.size].filter(Boolean)
    : isCombo
      ? [...new Set([...comboBarMeas, ...comboLineMeas])]
      : isGauge
        ? [...new Set([...(binding.selectedMeasures || []), gaugeThresholdMeasure, gaugeMaxMeasure].filter(Boolean))]
        : (binding.selectedMeasures || []);

  const modelVersion = (model?.measures?.length || 0) + ':' + (model?.dimensions?.length || 0);
  const filtersKey = !isFilterWidget && reportFilters ? JSON.stringify(reportFilters) : '';

  const scatterKey = isScatter ? `${scatterMeas.x || ''}:${scatterMeas.y || ''}:${scatterMeas.size || ''}` : '';
  const comboKey = isCombo ? `bar:${comboBarMeas.join(',')}|line:${comboLineMeas.join(',')}` : '';
  const gaugeKey = isGauge ? `threshold:${gaugeThresholdMeasure || ''}|max:${gaugeMaxMeasure || ''}` : '';

  const aggOverrides = binding.measureAggOverrides || {};
  const aggKey = Object.keys(aggOverrides).length > 0 ? JSON.stringify(aggOverrides) : '';

  const typeKey = widget.type || '';

  const colorEnabled = widget?.config?.colorCondition?.enabled === true;
  const colorMeasure = colorEnabled ? (binding.colorMeasure || '') : '';
  const colorKey = `cm:${colorMeasure}`;

  const widgetFilters = Array.isArray(binding.widgetFilters) ? binding.widgetFilters : [];
  const widgetFiltersKey = widgetFilters.length > 0 ? `wf:${JSON.stringify(widgetFilters)}` : '';

  const topNKey = `tn:${widget?.config?.topNEnabled === true ? (widget.config?.topN ?? 20) : '0'}`;

  // N-1 comparison binding (scorecards). The compareDateDim drives a
  // parallel fetch path — if it changes, both fetchers must invalidate
  // their cached results. Without this in the key, dropping a dim into
  // the "Compare with" zone wouldn't trigger the N-1 query because the
  // cache check would short-circuit on identical bindingKey.
  const compareDateDim = binding.compareDateDim || '';
  const compareKey = compareDateDim ? `cd:${compareDateDim}` : '';

  // Time-intelligence preset — resolves to a between filter at fetch time,
  // so picking/changing/clearing it must invalidate cached widget data.
  const tp = binding.timePeriod;
  const timePeriodKey = (tp && tp.dim && tp.preset) ? `tp:${tp.dim}|${tp.preset}` : '';

  // Drill state — different drill levels are different bindings as far as the
  // cache is concerned (the active dimension and filter set differ).
  const drillPath = Array.isArray(widget.drillPath) ? widget.drillPath : [];
  const drillKey = drillPath.length > 0 ? `dp:${JSON.stringify(drillPath)}` : '';

  // Report-scoped definitions/overrides that change the server response
  // shape/alias OR the effectiveModel labels the widget renders:
  //   - measureOverrides / dimensionOverrides: label/type/format of a
  //     model field (drives response alias + scorecard data.label,
  //     table headers, _measures, _durationColumns…).
  //   - extraMeasures / extraDimensions: report-only fields. Editing a
  //     report measure's expression/label/format does NOT change its
  //     name (so selectedMeass is unchanged) — without this term the
  //     cached widget.data is reused stale (same class as the label bug).
  // Any edit here must invalidate BOTH fetchers' caches so the canvas
  // rebuilds from the fresh effectiveModel rather than show pre-edit data.
  const overridesKey = settings
    ? `ov:${JSON.stringify({
        m: settings.measureOverrides || {},
        d: settings.dimensionOverrides || {},
        em: settings.extraMeasures || [],
        ed: settings.extraDimensions || [],
      })}`
    : '';

  // Per-widget row cap. It is sent as the SQL `limit`, so changing it
  // requires a refetch (more/fewer rows) — it was not reflected in the
  // key, so editing the data limit left the widget showing the old
  // row count until an unrelated refetch (same staleness class).
  const limitKey = `lim:${widget?.config?.dataLimit || 1000}`;

  // Report-level rollup-cache rebuild timestamp (cacheSchedules run-now
  // stamps reports.cache_built_at on success). Folding it in here makes
  // the saved `_fetchedBinding` on every widget invalidate the next
  // time the report opens after a rebuild from the workspace card —
  // the Editor's skip-fetch then misses, fetches fresh data from the
  // freshly-built rollups. Pre-rebuild reports (NULL column) fall back
  // to '' so the key is stable for never-rebuilt reports.
  const cacheKey = cacheBuiltAt ? `cb:${cacheBuiltAt}` : '';

  return [
    selectedDims.join(','),
    selectedMeass.join(','),
    groupBy.join(','),
    columnDims.join(','),
    scatterKey, comboKey, gaugeKey,
    aggKey, colorKey, widgetFiltersKey,
    modelVersion, filtersKey, typeKey, topNKey, drillKey, compareKey,
    timePeriodKey, overridesKey, limitKey, cacheKey,
  ].join(':');
}

// Config fields that take part in computeBindingKey — a change to any of them
// changes the SQL, everything else on `config` is presentation.
const QUERY_CONFIG_KEYS = ['topNEnabled', 'topN', 'dataLimit'];

/**
 * One string that moves when ANY widget's query-relevant binding moves, and
 * stays put otherwise.
 *
 * The editor's fetch loop watches the report filters and the refresh counter;
 * it had no way to notice that a widget's own binding had changed, so that job
 * fell entirely to the data panel — and travelled with it when the panel was
 * collapsed or the widget deselected. This is what wakes the loop instead.
 *
 * Deliberately NOT the full binding key: it must not move for a colour or a
 * font, or every restyle would wake the loop and abort its in-flight queries.
 */
export function computeBindingsSignature(widgets) {
  const per = computeBindingSignatures(widgets);
  return JSON.stringify(Object.keys(per).sort().map((id) => [id, per[id]]));
}

/**
 * The same thing, kept per widget, so a wake-up can tell WHICH binding moved.
 *
 * Refetching every stale widget because one of them changed is what made a
 * filter edit repaint the visual next door — and the neighbours are usually
 * stale for reasons of their own, so it was not a rare case.
 */
export function computeBindingSignatures(widgets) {
  const out = {};
  for (const id of Object.keys(widgets || {})) {
    const w = widgets[id];
    const cfg = w?.config || {};
    out[id] = JSON.stringify([
      w?.type || '',
      w?.dataBinding || null,
      QUERY_CONFIG_KEYS.map((k) => cfg[k] ?? null),
      cfg.colorCondition?.enabled === true,
      w?.drillPath || null,
    ]);
  }
  return out;
}
