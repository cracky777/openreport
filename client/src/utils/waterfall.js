import { compareAxisValues } from './axisSort';

export const WATERFALL_COLORS = { increase: '#16a34a', decrease: '#dc2626', total: '#5470c6' };

// The bars of a waterfall: each category moves the running total by its
// value; a subtotal shows the running total where it is placed, and the total
// closes the chart. `subtotals` are `{ after, label }`: the subtotal sits after
// the category named `after` — or, when that category has no value in the
// data (filtered out, absent from these books), where it would have sorted.
// That is what lets "Gross margin, after the cost of goods sold" stay in place
// for a company that sells no goods. A subtotal with no category since the
// previous one would only repeat it, and is left out.
//
// Returns `{ name, value, start, end, kind }` per bar, kind being 'increase',
// 'decrease' or 'total'.
export function waterfallSteps(items, { subtotals = [], showTotal = true, totalLabel = 'Total', axisDimDef = null } = {}) {
  const cats = (items || []).filter((it) => it && it.name != null);
  const positionOf = (after) => {
    const exact = cats.findIndex((it) => String(it.name) === String(after));
    if (exact >= 0) return exact + 1;
    let pos = 0;
    cats.forEach((it, i) => { if (compareAxisValues(it.name, after, axisDimDef, 'asc') <= 0) pos = i + 1; });
    return pos;
  };
  const placed = (subtotals || [])
    .filter((s) => s && s.after != null && s.label)
    .map((s, order) => ({ label: s.label, pos: positionOf(s.after), order }))
    .sort((a, b) => a.pos - b.pos || a.order - b.order);

  const steps = [];
  let running = 0;
  let lastTotalPos = 0;
  let next = 0;
  const closeAt = (pos) => {
    while (next < placed.length && placed[next].pos <= pos) {
      const s = placed[next++];
      if (s.pos > lastTotalPos) {
        steps.push({ name: s.label, value: running, start: 0, end: running, kind: 'total' });
        lastTotalPos = s.pos;
      }
    }
  };
  cats.forEach((it, i) => {
    closeAt(i);
    const v = Number(it.value) || 0;
    steps.push({ name: String(it.name), value: v, start: running, end: running + v, kind: v < 0 ? 'decrease' : 'increase' });
    running += v;
  });
  // After the last category a subtotal would only repeat the closing total.
  if (!showTotal) closeAt(cats.length);
  if (showTotal && cats.length > 0) steps.push({ name: totalLabel || 'Total', value: running, start: 0, end: running, kind: 'total' });
  return steps;
}
