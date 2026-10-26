// What stands out from the rest — a bar, a point of a line, a slice, a tile
// (the June spike of Mutuelle Horizon's claims): which ones, by a rule RELATIVE to the bars shown — so it holds
// whatever the filters or the months — or by naming them.
//   top     the n largest           bottom  the n smallest
//   above   more than `above` % over the average of the bars shown
//   values  the categories named in `values`
//   over    those over `threshold`         under   those under `threshold`
//           (a value set by the reader: "the bars over 2 million", Jonathan)
// `config.highlight = { enabled, mode, n, above, values, threshold, color, label }`;
// `label` prints the value of the bars it marks, and only theirs.

export const HIGHLIGHT_MODES = ['top', 'bottom', 'above', 'values', 'over', 'under'];

/** The indices of the bars the rule marks. */
export function highlightedIndices(values, labels, rule) {
  if (!rule?.enabled || !Array.isArray(values) || !values.length) return new Set();
  const nums = values.map((v) => Number(v) || 0);
  const n = Math.max(1, Math.min(Number(rule.n) || 1, nums.length));
  const order = nums.map((v, i) => i);
  if (rule.mode === 'bottom') return new Set(order.sort((a, b) => nums[a] - nums[b]).slice(0, n));
  if (rule.mode === 'above') {
    const avg = nums.reduce((s, v) => s + v, 0) / nums.length;
    const factor = 1 + (Number(rule.above) || 50) / 100;
    return new Set(order.filter((i) => nums[i] > avg * factor));
  }
  if (rule.mode === 'over' || rule.mode === 'under') {
    const t = Number(rule.threshold);
    if (!Number.isFinite(t)) return new Set();
    return new Set(order.filter((i) => values[i] != null && (rule.mode === 'over' ? nums[i] > t : nums[i] < t)));
  }
  if (rule.mode === 'values') {
    const named = new Set((rule.values || []).map(String));
    return new Set(order.filter((i) => named.has(String(labels?.[i]))));
  }
  return new Set(order.sort((a, b) => nums[b] - nums[a]).slice(0, n));
}

/** The highlight of a widget's bars: per index, its color (or null) and whether its value is printed. */
export function barHighlight(config, values, labels) {
  const rule = config?.highlight;
  const marked = highlightedIndices(values, labels, rule);
  const color = rule?.color || '#e11d48';
  return {
    any: marked.size > 0,
    colorAt: (i) => (marked.has(i) ? color : null),
    labelAt: (i) => marked.has(i) && rule?.label === true,
  };
}

/**
 * The points of a line that stand out: drawn over it as ECharts mark points
 * (larger, in the highlight's color), their value printed when asked.
 * @param {(v: number) => string} write  the value as the chart writes it
 * @returns {object|undefined}  a series `markPoint`, or nothing to mark
 */
export function markPointOf(config, values, labels, write) {
  const rule = config?.highlight;
  const marked = [...highlightedIndices(values, labels, rule)];
  if (!marked.length) return undefined;
  const color = rule.color || '#e11d48';
  return {
    symbol: 'circle',
    symbolSize: 12,
    animation: false,
    itemStyle: { color, borderColor: '#ffffff', borderWidth: 2 },
    label: { show: rule.label === true, position: 'top', color, fontWeight: 600, formatter: (p) => write(p.value) },
    data: marked.map((i) => ({ coord: [i, Number(values[i]) || 0], value: Number(values[i]) || 0 })),
  };
}

/**
 * What the highlight's color means, when the chart cannot say it alone: bars
 * over or under a value, or well above the average, in green with no word
 * for it read as decoration (Jonathan: a meaning the legend does not show). A
 * legend entry of its own, fixed (no series behind it to hide).
 * @param {(v: number) => string} write  a value as the chart writes it
 * @returns {{ name: string, color: string, fixed: true }|null}
 */
export function highlightLegendItem(config, write) {
  const rule = config?.highlight;
  if (!rule?.enabled) return null;
  const color = rule.color || '#e11d48';
  const t = Number(rule.threshold);
  if ((rule.mode === 'over' || rule.mode === 'under') && Number.isFinite(t)) return { name: `${rule.mode === 'over' ? '>' : '<'} ${write(t)}`, color, fixed: true };
  if (rule.mode === 'above') return { name: `+${Number(rule.above) || 50} % vs average`, color, fixed: true };
  return null;
}

/** The legend a chart shows: its series when it has a legend, and the highlight's meaning either way. */
export function legendWithHighlight(items, showLegend, config, write) {
  const rule = highlightLegendItem(config, write);
  const shown = showLegend ? [...(items || [])] : [];
  if (rule) shown.push(rule);
  return shown;
}
