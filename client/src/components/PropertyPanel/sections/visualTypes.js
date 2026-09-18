// Which widget types get which sections — plain data, shared by the sections.
export const CHART_TYPES = new Set(['bar', 'line', 'combo', 'pie', 'scatter', 'treemap']);
export const AXIS_TYPES = new Set(['bar', 'line', 'scatter', 'combo']);
// Widgets with no data binding at all: nothing to filter, limit or colour by value.
export const STATIC_TYPES = new Set(['text', 'shape', 'image']);

export const isChart = (type) => CHART_TYPES.has(type);
export const hasAxes = (type) => AXIS_TYPES.has(type);
export const hasData = (type) => !STATIC_TYPES.has(type);

// The four directions of the bar-glyph picker, per widget: the glyph's
// rotation and the value the widget stores.
export const BAR_DIRECTIONS = [
  { value: 'vertical', rotate: 0, title: 'Bottom to top' },
  { value: 'verticalInverse', rotate: 180, title: 'Top to bottom' },
  { value: 'horizontal', rotate: 90, title: 'Left to right' },
  { value: 'horizontalInverse', rotate: -90, title: 'Right to left' },
];

export const GAUGE_DIRECTIONS = [
  { value: 'up', rotate: 0, title: 'Bottom to top' },
  { value: 'down', rotate: 180, title: 'Top to bottom' },
  { value: 'right', rotate: 90, title: 'Left to right' },
  { value: 'left', rotate: -90, title: 'Right to left' },
];
