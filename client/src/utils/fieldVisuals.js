import { isDateDim } from './widgetFieldDrop';

// A field dropped on an empty spot of the page becomes a visual right there.
// Which one is decided here, instantly and without the AI: a measure is a
// figure (a scorecard), a dimension the list of its values (a table) — the
// two shapes a single field has. A second field dropped on it does the rest
// (utils/widgetFieldDrop: a dimension turns the figure into a chart of it).

/** The visual a lone field becomes: { type, binding } — null for anything else. */
export function visualForField({ fieldName, fieldType }) {
  if (!fieldName) return null;
  if (fieldType === 'measure') return { type: 'scorecard', binding: { selectedMeasures: [fieldName] } };
  if (fieldType === 'dimension') return { type: 'table', binding: { selectedDimensions: [fieldName], columnOrder: [fieldName] } };
  return null;
}

const LABELS = {
  bar: 'Bar', line: 'Line', pie: 'Pie', treemap: 'Treemap', table: 'Table',
  scorecard: 'Card', gauge: 'Gauge', filter: 'Slicer',
};

/**
 * The types a visual could be shown as, for its fields, the likeliest first
 * (the "Show as" bar of a visual just made from a field): [{ type, label }].
 * A date on the axis reads as a trend first; a figure alone, as a card.
 */
export function showAsChoices({ widget, model }) {
  const binding = widget?.dataBinding || {};
  const dims = binding.selectedDimensions || [];
  const meas = binding.selectedMeasures || [];
  let types;
  if (dims.length && meas.length) {
    types = isDateDim(model, dims[0]) ? ['line', 'bar', 'table'] : ['bar', 'pie', 'treemap', 'line', 'table'];
  } else if (meas.length) {
    types = ['scorecard', 'gauge', 'table'];
  } else if (dims.length) {
    types = ['table', 'filter'];
  } else {
    return [];
  }
  return types.map((type) => ({ type, label: LABELS[type] }));
}
