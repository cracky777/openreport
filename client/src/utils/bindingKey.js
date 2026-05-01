// Stable identifier for a widget's data binding. Used as a cache key by both
// fetchers (DataPanel for binding-driven fetches, Editor for filter/refresh
// fetches) so they don't refire on each other's heels — selecting a widget
// after an Editor-driven refetch should not trigger a DataPanel refetch when
// the binding hasn't actually moved.

export function computeBindingKey({ widget, model, reportFilters }) {
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

  // Drill state — different drill levels are different bindings as far as the
  // cache is concerned (the active dimension and filter set differ).
  const drillPath = Array.isArray(widget.drillPath) ? widget.drillPath : [];
  const drillKey = drillPath.length > 0 ? `dp:${JSON.stringify(drillPath)}` : '';

  return [
    selectedDims.join(','),
    selectedMeass.join(','),
    groupBy.join(','),
    columnDims.join(','),
    scatterKey, comboKey, gaugeKey,
    aggKey, colorKey, widgetFiltersKey,
    modelVersion, filtersKey, typeKey, topNKey, drillKey,
  ].join(':');
}
