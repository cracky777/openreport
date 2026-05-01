// Top-N grouping for high-cardinality charts (pie, treemap, single-series bar).
// Sorts by value desc, keeps the first N, and folds the rest into a single
// "Others" bucket. Returns the original array unchanged when grouping is
// disabled or unnecessary.
//
// `items` is an array of `{ name, value, ... }` (extra fields are dropped from
// the Others entry). The relative order of the kept items is preserved when
// `keepOriginalOrder` is true, otherwise the result is sorted desc by value.

export const OTHERS_NAME = 'Others';

export function applyTopN(items, options = {}) {
  if (!Array.isArray(items) || items.length === 0) return items;
  const { n, enabled, label = OTHERS_NAME, keepOriginalOrder = false } = options;
  if (!enabled) return items;
  const limit = Math.max(1, Math.floor(Number(n) || 0));
  if (!Number.isFinite(limit) || limit >= items.length) return items;

  // Sort indices by value desc to find the top N
  const indexed = items.map((it, i) => ({ idx: i, value: Number(it?.value) || 0 }));
  indexed.sort((a, b) => b.value - a.value);
  const keepSet = new Set(indexed.slice(0, limit).map((x) => x.idx));

  let othersValue = 0;
  let othersCount = 0;
  for (const { idx, value } of indexed) {
    if (!keepSet.has(idx)) {
      othersValue += value;
      othersCount += 1;
    }
  }

  let kept;
  if (keepOriginalOrder) {
    kept = items.filter((_, i) => keepSet.has(i));
  } else {
    kept = indexed
      .slice(0, limit)
      .map(({ idx }) => items[idx]);
  }

  if (othersCount === 0) return kept;
  return [...kept, { name: label, value: othersValue, _isOthers: true, _othersCount: othersCount }];
}

// Apply Top-N to a {labels, values} pair (used by single-series bar charts
// without `series`). Keeps `labels` and `values` aligned.
export function applyTopNToLabelsValues(labels, values, options = {}) {
  if (!Array.isArray(labels) || !Array.isArray(values)) return { labels, values };
  const { enabled, n, label = OTHERS_NAME } = options;
  if (!enabled) return { labels, values };
  const limit = Math.max(1, Math.floor(Number(n) || 0));
  if (!Number.isFinite(limit) || limit >= labels.length) return { labels, values };

  const indexed = labels.map((lbl, i) => ({ idx: i, lbl, val: Number(values[i]) || 0 }));
  indexed.sort((a, b) => b.val - a.val);
  const top = indexed.slice(0, limit);
  const rest = indexed.slice(limit);
  if (rest.length === 0) return { labels, values };

  const othersSum = rest.reduce((s, x) => s + x.val, 0);
  const newLabels = [...top.map((x) => x.lbl), label];
  const newValues = [...top.map((x) => x.val), othersSum];
  return { labels: newLabels, values: newValues };
}
