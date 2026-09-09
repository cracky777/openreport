// The aggregations a measure can be flipped to on a widget, in the order they
// are offered. Shared by the field-well chip menu and the measure filter card:
// both drive the same per-widget override (`measureAggOverrides`), so an
// aggregation offered by one and not the other would be a trap.
export const AGG_OPTIONS = [
  { value: 'sum', label: 'Sum' },
  { value: 'avg', label: 'Avg' },
  { value: 'count', label: 'Count' },
  { value: 'min', label: 'Min' },
  { value: 'max', label: 'Max' },
];
