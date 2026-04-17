/**
 * Pivot engine — transforms flat rows into a cross-tab structure.
 */

export function compositeKey(row, fields) {
  return fields.map((f) => row[f] ?? '(blank)').join('\x00');
}

export function resolveCell(acc, fn) {
  if (!acc) return null;
  switch (fn) {
    case 'sum': return acc.sum;
    case 'avg': return acc.count ? acc.sum / acc.count : 0;
    case 'count': return acc.count;
    case 'min': return acc.min === Infinity ? null : acc.min;
    case 'max': return acc.max === -Infinity ? null : acc.max;
    default: return acc.sum;
  }
}

function accumulate(target, measures, row) {
  for (const m of measures) {
    if (!target[m]) target[m] = { sum: 0, count: 0, min: Infinity, max: -Infinity };
    const v = Number(row[m]) || 0;
    const a = target[m];
    a.sum += v; a.count += 1;
    a.min = Math.min(a.min, v);
    a.max = Math.max(a.max, v);
  }
}

/**
 * Build a header tree for multi-level dimensions.
 * Returns [{ value, children, leafCount }]
 */
export function buildHeaderTree(keys) {
  const root = [];
  for (const [, vals] of keys) {
    let level = root;
    for (let d = 0; d < vals.length; d++) {
      const v = String(vals[d] ?? '(blank)');
      let node = level.find((n) => n.value === v);
      if (!node) {
        node = { value: v, children: [], leafCount: 0 };
        level.push(node);
      }
      if (d === vals.length - 1) node.leafCount = 1;
      level = node.children;
    }
  }
  function computeSpan(node) {
    if (node.children.length === 0) return node.leafCount || 1;
    node.leafCount = node.children.reduce((s, c) => s + computeSpan(c), 0);
    return node.leafCount;
  }
  root.forEach(computeSpan);
  return root;
}

/**
 * Flatten a header tree into rows for rendering (one row per level).
 * Returns array of arrays: [[{ value, span }], ...]
 */
export function flattenHeaderLevels(tree, depth) {
  const levels = Array.from({ length: depth }, () => []);
  function walk(nodes, level) {
    for (const node of nodes) {
      levels[level].push({ value: node.value, span: node.leafCount || 1 });
      if (node.children.length > 0) walk(node.children, level + 1);
    }
  }
  walk(tree, 0);
  return levels;
}

/**
 * Main pivot function.
 */
export function pivotData({ rawRows, rowDims, colDims, measures, aggregationFns = {}, defaultAggregation = 'sum' }) {
  if (!rawRows || rawRows.length === 0 || measures.length === 0) {
    return null;
  }

  const defaultFn = defaultAggregation;

  // Collect unique keys in order
  const rowKeyMap = new Map();
  const colKeyMap = new Map();
  for (const row of rawRows) {
    const rk = rowDims.length > 0 ? compositeKey(row, rowDims) : '__all__';
    if (!rowKeyMap.has(rk)) rowKeyMap.set(rk, rowDims.map((d) => row[d]));
    const ck = colDims.length > 0 ? compositeKey(row, colDims) : '__all__';
    if (!colKeyMap.has(ck)) colKeyMap.set(ck, colDims.map((d) => row[d]));
  }
  const rowKeys = [...rowKeyMap.entries()];
  const colKeys = [...colKeyMap.entries()];

  // Cell map
  const cellMap = {};
  const rowTotals = {};
  const colTotals = {};
  const grandTotal = {};

  for (const row of rawRows) {
    const rk = rowDims.length > 0 ? compositeKey(row, rowDims) : '__all__';
    const ck = colDims.length > 0 ? compositeKey(row, colDims) : '__all__';

    if (!cellMap[rk]) cellMap[rk] = {};
    if (!cellMap[rk][ck]) cellMap[rk][ck] = {};
    accumulate(cellMap[rk][ck], measures, row);

    // Row totals
    if (!rowTotals[rk]) rowTotals[rk] = {};
    accumulate(rowTotals[rk], measures, row);

    // Col totals
    if (!colTotals[ck]) colTotals[ck] = {};
    accumulate(colTotals[ck], measures, row);

    // Grand total
    accumulate(grandTotal, measures, row);
  }

  // Sub-totals for multi-level row dims
  const subTotals = {};
  if (rowDims.length > 1) {
    for (const row of rawRows) {
      for (let d = 0; d < rowDims.length - 1; d++) {
        const parentKey = rowDims.slice(0, d + 1).map((f) => row[f] ?? '(blank)').join('\x00');
        const ck = colDims.length > 0 ? compositeKey(row, colDims) : '__all__';
        if (!subTotals[parentKey]) subTotals[parentKey] = {};
        if (!subTotals[parentKey][ck]) subTotals[parentKey][ck] = {};
        accumulate(subTotals[parentKey][ck], measures, row);
        // Sub-total row total
        if (!subTotals[parentKey].__rowTotal__) subTotals[parentKey].__rowTotal__ = {};
        accumulate(subTotals[parentKey].__rowTotal__, measures, row);
      }
    }
  }

  const rowTree = buildHeaderTree(rowKeys);
  const colTree = buildHeaderTree(colKeys);

  return {
    rowTree, colTree, rowKeys, colKeys,
    cellMap, measures, rowTotals, colTotals, grandTotal, subTotals,
    rowDims, colDims,
    getFn: (measure) => aggregationFns[measure] || defaultFn,
  };
}
