// A measure on a dimension table (a product's reorder threshold, read by
// product or by warehouse) in a visual grouped by other tables' fields. The
// dim-only scalar subquery read it as ONE total over the whole table: every
// row showed the average threshold of the file (Karim's 60.22 next to each
// product). Summed through the fact join instead, it would count the product
// once per stock movement. So each group reads the DISTINCT dimension rows its
// fact rows reach:
//
//   LEFT JOIN (SELECT g0, g1, AGG(v) AS v
//              FROM (SELECT DISTINCT <dims> AS g0.., <dim keys> AS k0.., <column> AS v
//                    FROM <the query's FROM + the dim table> WHERE <the query's WHERE>) dd
//              GROUP BY g0, g1) dmN ON <dims> = dmN.g0 AND ..
//
// and the outer SELECT takes MAX(dmN.v): one dmN row per group, nothing fans
// out. A group whose dimension value is NULL finds no dmN row (as in the
// drill-across, multiFact.js). Pure; covered by tests/dimTableMeasure.test.js.
//
// A value given PER PERIOD (a branch's monthly production target) carries
// `perPeriod = { dim }`, a period of the facts (a month): the distinct rows
// then hold that period too, so the total over several months adds each
// month's targets of the items present that month — never one month's target
// set against nine months of production (Crédit Ardent: 875 % of target).
// Grouped by the month itself, nothing changes. Never served by a rollup,
// never in the drill-across (the handler keeps such queries on one query).
//
// Read as a thing of its own (`direct`): grouped only by the table's own
// fields, filtered only on them or on a period, the measure reads the WHOLE
// table in each group — an insurer's premiums by product are those of every
// contract, not only of the contracts that had a claim (a loss ratio of 471 %
// instead of 57 %). A period selects events, never the items. Filtered on a
// fact's other fields (a warehouse), the items are those the facts reach.
const { quoteAlias, quoteCol, quoteIdent, quoteTable } = require('../sqlDialect');
const { buildMeasureAggExpr, measureColumnSql } = require('./measureAgg');
const { buildDimensionExpr } = require('./datePart');
const { buildFromClause } = require('./fromClause');
const { reachedMeasures } = require('./lastValue');

// The dimension a per-period measure is counted on, or null.
function periodDimOf(m, allDimensions) {
  const name = m && m.perPeriod && m.perPeriod.dim;
  return name ? (allDimensions || []).find((d) => d && d.name === name) || null : null;
}

// Whether the names reach a per-period measure through `${…}` references.
const reachesPerPeriod = (names, allMeasures) => reachedMeasures(names, allMeasures).some((m) => m.perPeriod);

// The columns that identify a row of `table`: its side of the joins that
// DECLARE it the `1` side. A join with no cardinality says nothing of it (the
// legacy convention may call a fact's foreign key a `1`), and distinct rows
// on a column that is not a key would merge two orders of one customer.
function keyColumns(table, allJoins) {
  const keys = new Set();
  for (const j of allJoins || []) {
    const c = j && j.cardinality;
    if (!c) continue;
    if (j.from_table === table && c.from === '1' && j.from_column) keys.add(j.from_column);
    if (j.to_table === table && c.to === '1' && j.to_column) keys.add(j.to_column);
  }
  return [...keys];
}

/** Whether the measure can be read on distinct rows: a column of a table some join declares a `1` side. */
function readsDistinctRows(m, primaryTable, allJoins) {
  return !!(m.table && m.column && m.column !== '*' && m.aggregation !== 'custom' && !m.expression
    && keyColumns(primaryTable, allJoins).length);
}

/**
 * `{ join, select }` for the measure read per group, or null when it cannot
 * be (a custom expression, a table with no join key): the caller keeps the
 * scalar total. With no grouping (a row-level-secured reader: the rows their
 * rule lets them reach, never the whole table) it is one scalar subquery on
 * those rows, `join` empty.
 */
function groupedDimMeasure({
  m, primaryTable, n, label, allJoins, tablesUsed, selectedDimensions, selectedMeasures, whereSql, dbType, columnTypes, allDimensions = [], direct = null,
}) {
  if (!readsDistinctRows(m, primaryTable, allJoins)) return null;
  const keys = keyColumns(primaryTable, allJoins);
  const q = (s) => quoteIdent(s, dbType);
  const dm = q(`__dm${n}`);
  const dims = selectedDimensions.map((d) => buildDimensionExpr(d, dbType, columnTypes));
  const grain = dims.map((_, i) => q(`__g${i}`));
  const period = periodDimOf(m, allDimensions);
  const own = !period && direct && selectedDimensions.every((d) => d.table === primaryTable) ? direct : null;
  const { fromClause } = own ? { fromClause: quoteTable(primaryTable, dbType) } : buildFromClause({
    tablesUsed: new Set([...tablesUsed, primaryTable, ...(period && period.table ? [period.table] : [])]),
    allJoins, selectedDimensions: period ? [...selectedDimensions, period] : selectedDimensions, selectedMeasures, dbType,
  });
  const rows = [
    ...dims.map((e, i) => `${e} AS ${grain[i]}`),
    ...(period ? [`${buildDimensionExpr(period, dbType, columnTypes)} AS ${q('__p')}`] : []),
    ...keys.map((k, i) => `${quoteCol(primaryTable, k, dbType)} AS ${q(`__k${i}`)}`),
    `${measureColumnSql(m, { dbType, columnTypes })} AS ${q('__v')}`,
  ];
  // Rows outside any period (an application not decided yet) carry no target of a month.
  const where = [own ? own.whereSql : whereSql, period ? `${buildDimensionExpr(period, dbType, columnTypes)} IS NOT NULL` : ''].filter(Boolean).join(' AND ');
  const distinctRows = `SELECT DISTINCT ${rows.join(', ')} FROM ${fromClause}${where ? ` WHERE ${where}` : ''}`;
  const agg = buildMeasureAggExpr(m, { dbType, columnTypes, columnSql: q('__v') });
  // `value`: the figure alone, for an expression that references the measure.
  if (!dims.length) {
    const value = `(SELECT ${agg} FROM (${distinctRows}) ${q(`__dd${n}`)})`;
    return { join: '', value, select: `${value} AS ${quoteAlias(label, dbType)}` };
  }
  const perGroup = `SELECT ${grain.join(', ')}, ${agg} AS ${q('__v')} FROM (${distinctRows}) ${q(`__dd${n}`)} GROUP BY ${grain.join(', ')}`;
  const value = `MAX(${dm}.${q('__v')})`;
  return {
    join: ` LEFT JOIN (${perGroup}) ${dm} ON ${dims.map((e, i) => `${e} = ${dm}.${grain[i]}`).join(' AND ')}`,
    value,
    select: `${value} AS ${quoteAlias(label, dbType)}`,
  };
}

module.exports = { groupedDimMeasure, readsDistinctRows, reachesPerPeriod };
