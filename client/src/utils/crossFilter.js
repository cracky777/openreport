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

function findSourceForDim(dim, currentWidgets, crossHighlight) {
  // Cross-highlight wins when active for that dim
  if (crossHighlight?.dim === dim && crossHighlight?.widgetId) return crossHighlight.widgetId;
  // Otherwise look for a filter widget bound to that dim (slicer)
  for (const [wId, w] of Object.entries(currentWidgets || {})) {
    if (w?.type === 'filter' && w.dataBinding?.selectedDimensions?.[0] === dim) return wId;
  }
  return null;
}

export function filterForTarget(targetId, baseFilters, currentWidgets, crossHighlight) {
  if (!baseFilters || typeof baseFilters !== 'object') return baseFilters;
  const out = { ...baseFilters };
  for (const dim of Object.keys(out)) {
    const sourceId = findSourceForDim(dim, currentWidgets, crossHighlight);
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
