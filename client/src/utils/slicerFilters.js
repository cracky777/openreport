// The report filters a page's slicers stand for, read straight from the
// widgets: one entry per slicer with a selection, keyed by its dimension.
// `managedDims` lists every slicer-bound dimension, selection or not, so a
// cleared slicer drops its dimension instead of leaving a stale value behind.
//
// Derived synchronously wherever a page's widgets are put in place (report
// open, page switch), so the first fetch pass already runs with the right
// filters: rebuilding them one render later made that pass query every
// visual unfiltered, then again filtered.
export function slicerFilters(widgets) {
  const managedDims = new Set();
  const fromWidgets = {};
  for (const w of Object.values(widgets || {})) {
    if (w?.type !== 'filter') continue;
    const dim = w.dataBinding?.selectedDimensions?.[0];
    if (!dim) continue;
    managedDims.add(dim);
    const vals = w.config?.selectedValues;
    if (Array.isArray(vals) && vals.length > 0) fromWidgets[dim] = vals;
  }
  return { fromWidgets, managedDims };
}

// Same selections, value for value.
export function sameSelections(a, b) {
  const aK = Object.keys(a || {});
  const bK = Object.keys(b || {});
  if (aK.length !== bK.length) return false;
  for (const k of aK) {
    if (!b[k] || a[k].length !== b[k].length) return false;
    for (let i = 0; i < a[k].length; i++) if (a[k][i] !== b[k][i]) return false;
  }
  return true;
}
