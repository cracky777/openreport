// A filtered measure on a dimension the visual groups by.
//
// "Lost calls" = COUNT(id) restricted to status = 'lost'. Shown per agent, the
// intersection CASE WHEN is right. Shown per STATUS — status on the axis or in
// the legend — the intersection gives "lost among the lost" on one row and
// nothing on the others, where the author meant the same figure on every
// row: the rule replaces the grouping on that column, it does not narrow it
// (Power BI's CALCULATE). That figure is the aggregate over the rows of the
// partition formed by the OTHER grouped dimensions:
//
//   SUM(SUM(CASE WHEN status = 'lost' THEN x END)) OVER (PARTITION BY agent)
//
// A window runs after GROUP BY, on the rows the visual shows, so it reads
// the slicers the WHERE already applied. It is never additive: the rollup
// planner keeps such queries live, and a HAVING or Top N ranks on the plain
// aggregate (SQL allows no window there).

const { buildMeasureAggExpr, dialectNumericCast } = require('./measureAgg');
const { quoteCol, normalizeAggregation } = require('../sqlDialect');

const WINDOW_FNS = new Set(['SUM', 'COUNT', 'MIN', 'MAX', 'AVG']);

// Names of the grouped dimensions a measure's own rules point at.
function groupedRuleFields(rules, selectedDimensions) {
  const grouped = new Set((selectedDimensions || []).map((d) => d && d.name).filter(Boolean));
  const out = new Set();
  for (const r of rules || []) {
    // A period rule (periodShift.js) picks the rows of one period; it never
    // replaces a grouping.
    if (r && !r.isMeasure && !r._period && r.field && grouped.has(r.field)) out.add(r.field);
  }
  return out;
}

// The GROUP BY expressions of every grouped dimension the rules do not
// replace: the partition the figure is spread over.
function partitionExprs(selectedDimensions, groupByParts, ruleFields) {
  const out = [];
  (selectedDimensions || []).forEach((d, i) => {
    if (d && !ruleFields.has(d.name) && groupByParts[i]) out.push(groupByParts[i]);
  });
  return out;
}

// `fn(arg)` computed per group, then spread over the partition. AVG cannot
// be averaged again: it is rebuilt from the summed sums and counts.
function windowAgg(fn, arg, partition) {
  const f = String(fn || '').toUpperCase();
  const over = partition.length ? `OVER (PARTITION BY ${partition.join(', ')})` : 'OVER ()';
  if (f === 'AVG') return `(SUM(SUM(${arg})) ${over} / NULLIF(SUM(COUNT(${arg})) ${over}, 0))`;
  if (f === 'MIN' || f === 'MAX') return `${f}(${f}(${arg})) ${over}`;
  return `SUM(${f}(${arg})) ${over}`;
}

// COUNT(DISTINCT …) has no window form on most databases: such an aggregate
// keeps the intersection.
function canWindow(fn, arg) {
  return WINDOW_FNS.has(String(fn || '').toUpperCase()) && !/^\s*DISTINCT\b/i.test(String(arg || ''));
}

// A column measure, filtered and spread over the partition; null when the
// aggregate has no window form (distinct count, average of an interval),
// in which case the caller keeps the intersection.
function windowedColumnAgg(m, whenSql, partition, { dbType, columnTypes }) {
  const agg = normalizeAggregation(m.aggregation);
  if (agg === 'count_distinct') return null;
  const over = partition.length ? `OVER (PARTITION BY ${partition.join(', ')})` : 'OVER ()';
  if (agg === 'avg') {
    if (String(m.dataType || '').toLowerCase() === 'interval') return null;
    const arg = `CASE WHEN ${whenSql} THEN ${dialectNumericCast(quoteCol(m.table, m.column, dbType), dbType)} END`;
    return `(SUM(SUM(${arg})) ${over} / NULLIF(SUM(COUNT(${arg})) ${over}, 0))`;
  }
  const inner = buildMeasureAggExpr(m, { dbType, columnTypes, caseWhenSql: whenSql });
  const outer = agg === 'min' || agg === 'max' ? agg.toUpperCase() : 'SUM';
  return `${outer}(${inner}) ${over}`;
}

module.exports = { groupedRuleFields, partitionExprs, windowAgg, canWindow, windowedColumnAgg };
