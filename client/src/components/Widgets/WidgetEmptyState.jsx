import { memo } from 'react';

// Shared empty-state placeholder for every widget. Caller invokes it as
// a typical early-return when its own `hasData` gate fires false — i.e.
// the component itself doesn't need to know what counts as "has data"
// for a given widget (Bar = labels.length, Pie = items.length, Scatter
// = points.length, Combo = labels + bar/line series, etc.); the widget
// has already decided.
//
// Two states it distinguishes:
//   1. binding is configured AND a fetch returned (data._rowCount === 0)
//      → show the user's custom emptyMessage (or "No values"), unless
//        they've ticked hideEmptyMessage in PropertyPanel (returns an
//        empty div so the widget background still paints).
//   2. binding is NOT configured (no data, no fields dropped on the
//      drop-zones yet) → show the chart-type-specific hint passed in
//      via `unboundHint` ("Select dimensions & measures to display a
//      bar chart" / "Drop measures on X and Y axes to create a scatter
//      chart" / etc).
//
// Style preserved verbatim from the per-widget `emptyStyle` const that
// lived at the bottom of every widget file (byte-identical across 12
// widgets) so this is a strict mechanical extraction.
export default memo(function WidgetEmptyState({ data, config, unboundHint }) {
  if (data?._rowCount === 0) {
    if (config?.hideEmptyMessage) return <div style={emptyStyle} />;
    return <div style={emptyStyle}>{config?.emptyMessage || 'No values'}</div>;
  }
  return <div style={emptyStyle}>{unboundHint}</div>;
});

const emptyStyle = {
  height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
  color: 'var(--text-disabled)', fontSize: 12, textAlign: 'center', padding: 16,
};
