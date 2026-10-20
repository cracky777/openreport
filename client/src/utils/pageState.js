// What a report page's widgets need from the Viewer's fetch loop, and whether
// a page left earlier can be shown again as it was (pages/Viewer.jsx).

/** Whether a widget reads rows: what the fetch loop queries. */
export function queriesData(w) {
  const b = w.dataBinding || {};
  const hasMeas = w.type === 'scatter' ? !!(b.scatterMeasures?.x && b.scatterMeasures?.y)
    : w.type === 'combo' ? ((b.comboBarMeasures?.length > 0) || (b.comboLineMeasures?.length > 0))
    : (b.selectedMeasures?.length > 0);
  const hasMainBinding = (b.selectedDimensions?.length > 0 || hasMeas);
  // Conditional formatting may need fetching even on a widget that has
  // only a colour-measure binding (e.g. shapes).
  const hasColorMeas = !!b.colorMeasure && w.config?.colorCondition?.enabled === true;
  // Filter widgets always fetch — they need RLS-filtered distinct values
  // for their bound dimension.
  if (w.type === 'filter') return hasMainBinding;
  // A text queries the measures bound to it (printed where it says #tag).
  if (w.type === 'text') return hasColorMeas || hasMeas;
  return hasMainBinding || hasColorMeas;
}

/**
 * A page left before its rows came back is no state to restore: shown as is,
 * its visuals stayed empty for good (Karim's overview, twice — the studio
 * turned to the page a card created while the one shown was still fetching).
 * A card's new visuals arrive with `data: {}`: no rows either.
 * @param {object} widgets  the page's widgets as they were left
 */
export function restorable(widgets) {
  const rowless = (w) => !w.data || !Object.keys(w.data).length || w._loading;
  return !Object.values(widgets || {}).some((w) => w && queriesData(w) && rowless(w));
}
