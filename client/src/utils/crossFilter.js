/**
 * Power BI–style "Edit interactions" support.
 *
 * The source widget stores a list of target widget ids it should NOT
 * filter:
 *
 *   widget.config.crossFilterExclusions = ['widgetIdB', 'widgetIdC']
 *
 * Two source kinds are tracked:
 *   - Cross-highlight   (a chart click sets `crossHighlight = { widgetId, dim, value }`)
 *   - Slicer            (a filter widget bound to a dimension)
 *
 * `filterForTarget` returns the merged filters object with any dim removed
 * that originates from a source widget which excludes the given target.
 */

export function filterForTarget(targetId, baseFilters, currentWidgets, crossHighlight) {
  if (!baseFilters || typeof baseFilters !== 'object') return baseFilters;
  const out = { ...baseFilters };
  // Index slicer widgets by their bound dim once, instead of re-scanning every
  // widget for each filter dim. Cross-highlight still wins over a slicer.
  const slicerByDim = {};
  for (const [wId, w] of Object.entries(currentWidgets || {})) {
    const dim = w?.type === 'filter' ? w.dataBinding?.selectedDimensions?.[0] : null;
    if (dim && !(dim in slicerByDim)) slicerByDim[dim] = wId;
  }
  for (const dim of Object.keys(out)) {
    const sourceId = (crossHighlight?.dim === dim && crossHighlight?.widgetId)
      ? crossHighlight.widgetId
      : (slicerByDim[dim] || null);
    if (!sourceId) continue;
    if (sourceId === targetId) {
      // The widget that PROVIDES the filter doesn't apply it to itself.
      // Cross-highlight source: it stays unfiltered so the user keeps the
      // full chart with the clicked value highlighted (Power BI / Looker
      // semantics). Slicer self-fetch already bypasses filters in DataPanel
      // — including the dim here would still be wrong if the source ever
      // fell back to this code path.
      delete out[dim];
      continue;
    }
    const exclusions = currentWidgets?.[sourceId]?.config?.crossFilterExclusions || [];
    if (exclusions.includes(targetId)) delete out[dim];
  }
  return out;
}

export function isExcluded(sourceId, targetId, currentWidgets) {
  if (!sourceId || !targetId || sourceId === targetId) return false;
  const exclusions = currentWidgets?.[sourceId]?.config?.crossFilterExclusions || [];
  return exclusions.includes(targetId);
}
