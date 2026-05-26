import { lerpColor } from './tableConfigHelpers';

// Build the value-to-color resolver for a widget's optional value-based
// gradient. Five widgets used to inline 12-line copies of the same min/max
// scan + lerp closure, differing only in WHERE the values lived
// (data.series[*].values / data.values / data.barSeries[*].values /
// data.items[*].value). Caller pre-extracts the flat numeric array; this
// helper does the min/max + lerp.
//
// `useGradient` (the "should we colour by value at all?" gate) stays in
// the caller because each widget has its own veto rules — Bar disables
// gradient on stacked subtypes (segments coloured by value would mislead
// the eye), Combo disables when its bars are stacked, etc. So the caller
// passes the gate result explicitly via the surrounding `if (useGradient)`
// — this helper assumes you've already decided you want the gradient.
//
// Returns `(val) => cssColor` ready to drop into ECharts' `itemStyle.color`.
// Falls back to `minColor` when the value is missing OR every value in
// the input array was missing (so the chart paints something instead of
// throwing).
//
// Defaults `#dcfce7` (green-50) → `#7c3aed` (violet-600) match the
// PropertyPanel's color-picker preview.
export function buildValueGradient(gradient, values) {
  let gMin = Infinity, gMax = -Infinity;
  for (const v of values) {
    if (v == null || isNaN(v)) continue;
    if (v < gMin) gMin = v;
    if (v > gMax) gMax = v;
  }
  const minColor = gradient?.minColor || '#dcfce7';
  const maxColor = gradient?.maxColor || '#7c3aed';
  return (val) => {
    if (val == null || isNaN(val) || gMin === Infinity) return minColor;
    const pct = gMax > gMin ? Math.max(0, Math.min(1, (val - gMin) / (gMax - gMin))) : 0;
    return lerpColor(minColor, maxColor, pct);
  };
}
