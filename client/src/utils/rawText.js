/**
 * The author's own string for a point, when their measure returned one.
 *
 * A custom measure can build its value as text in SQL — a formatted duration,
 * a label. The number its expression aggregates travels alongside and is what
 * positions the point; this is what gets PRINTED next to it.
 *
 * `series` is the series name, which is the measure's label on a chart without
 * a legend and the group's value on one with. So when a single measure came
 * back as text, its map answers whatever the series is called — that is the
 * fallback, and it is what makes a legend-split chart work too.
 */
export function rawTextFor(data, series, axisValue) {
  const all = data?._rawText;
  if (!all) return null;
  const key = axisValue == null ? '' : String(axisValue);
  const bySeries = all[series];
  if (bySeries && bySeries[key] != null) return bySeries[key];
  const names = Object.keys(all);
  if (names.length === 1 && all[names[0]][key] != null) return all[names[0]][key];
  return null;
}
