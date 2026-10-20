// A stock, a balance, a headcount: summed over the days it means nothing
// (Karim's 16 million pallets were every day's stock added up). Such a
// measure carries `lastValue = { dim }`, a date dimension of the model, and
// reads its aggregate on the LAST date the visual's rows hold:
//
//   SUM(CASE WHEN <date> IN (SELECT MAX(<date>) FROM <same FROM> WHERE <same WHERE>
//                            [GROUP BY <the periods the visual groups by>]) THEN x END)
//
// Grouped by a period (a month, a year: a date part, a calendar's column),
// each period reads its own last date — the closing stock of every month, the
// current month at its latest day. Otherwise the last date of everything the
// slicers keep: per warehouse, every warehouse on that day. A date belongs to
// one period only, so the last date of another period never lands in this one.
//
// The subquery needs the finished FROM: the measure SQL holds a marker
// (`__LAST_DATE_n__`) the handler replaces once the query is assembled.
// Never served by a rollup, never in the drill-across (the handler keeps such
// queries on the single-query path). Covered by tests/lastValueMeasure.test.js.

const { isPeriodDim } = require('./windowMeasure');

const MARKER = /__LAST_DATE_(\d+)__/g;
const marker = (i) => `__LAST_DATE_${i}__`;

// The date dimension a measure is read on, or null: a plain column of the
// model typed as a date (a calculated dimension or a part of a date is not one).
function lastDateDim(m, allDimensions) {
  const name = m && m.lastValue && m.lastValue.dim;
  if (!name) return null;
  const d = (allDimensions || []).find((x) => x && x.name === name);
  if (!d || d.expression || d.datePart || !d.table || !d.column || !/date|time/i.test(String(d.type || ''))) return null;
  return d;
}

// Every measure the names reach through `${…}` references, the names included.
function reachedMeasures(names, allMeasures) {
  const byName = new Map((allMeasures || []).filter(Boolean).map((m) => [m.name, m]));
  const byLabel = new Map((allMeasures || []).filter(Boolean).map((m) => [m.label, m]));
  const seen = new Set();
  const out = [];
  const visit = (m) => {
    if (!m || seen.has(m.name)) return;
    seen.add(m.name);
    out.push(m);
    for (const ref of String(m.expression || '').matchAll(/\$\{\s*([^}]+?)\s*\}/g)) visit(byName.get(ref[1]) || byLabel.get(ref[1]));
  };
  for (const n of names || []) visit(byName.get(n));
  return out;
}

const reachesLastValue = (names, allMeasures) => reachedMeasures(names, allMeasures).some((m) => m.lastValue);

// The GROUP BY expressions of the periods among the grouped dimensions.
function periodGroups(selectedDimensions, groupByParts) {
  const out = [];
  (selectedDimensions || []).forEach((d, i) => { if (groupByParts[i] && isPeriodDim(d)) out.push(groupByParts[i]); });
  return out;
}

/**
 * The condition that keeps the rows of the last date.
 * @param {string} dateExpr   the date column, quoted
 * @param {{ fromClause: string, where: string[], periods: string[] }} q  the query as assembled
 */
function lastDateCondition(dateExpr, { fromClause, where, periods }) {
  const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const groupSql = periods.length ? ` GROUP BY ${periods.join(', ')}` : '';
  return `${dateExpr} IN (SELECT MAX(${dateExpr}) FROM ${fromClause}${whereSql}${groupSql})`;
}

function spliceLastDates(sql, dateExprs, q) {
  if (!dateExprs.length) return sql;
  return sql.replace(MARKER, (_, i) => (dateExprs[Number(i)] ? lastDateCondition(dateExprs[Number(i)], q) : '1 = 0'));
}

module.exports = { lastDateDim, reachesLastValue, reachedMeasures, periodGroups, lastDateCondition, spliceLastDates, marker };
