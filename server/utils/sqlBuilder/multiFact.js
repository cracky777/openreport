// Multi-fact fan-out avoidance for the /query SQL compiler — extracted verbatim
// from routes/models.js. When a visual combines measures from ≥2 different fact
// tables, joining the raw facts to a shared dimension fans out rows (each f1 row
// × each matching f2 row) and inflates the SUMs. The rollup cache already avoids
// this — one pre-aggregated subquery per fact, then FULL JOIN USING the grain
// (see rollupPlanner.js `subFor`). Mirror that on the live path: aggregate each
// fact independently at the requested grain, then FULL JOIN the per-fact results
// on the dimension aliases (CROSS JOIN for a grainless scorecard).
//
// Pure: reads only its inputs, returns `{ sql, orderByAlias }` or null. Strictly
// gated to the clean common case; anything exotic (custom/HLL/override/filtered
// measures, x-grain HAVING, measure HAVING/TopN, RLS, distinct, or a dim/filter
// not conformed to every fact) returns null → the caller's single-query path
// runs unchanged. Covered by tests/sqlSnapshotJoins (multi-fact).
const { quoteIdent, quoteCol, quoteTable } = require('../sqlDialect');
const { deriveJoinKeyword } = require('./joins');
const { buildMeasureAggExpr } = require('./measureAgg');
const { buildDimensionExpr } = require('./datePart');

function buildMultiFactBody({
  selectedMeasures, selectedDimensions, realFacts, whereParts,
  allDimensions, allJoins, dbType, columnTypes,
  rlsApplies, distinct, topNOverride, havingParts,
  measureFiltersDeferred, havingGrainDims, dimOnlyMeasureInfos,
}) {
  const SIMPLE_AGGS = new Set(['sum', 'avg', 'min', 'max', 'count']);
  const factsInvolved = [...new Set(
    selectedMeasures.filter((m) => m.table && realFacts.has(m.table)).map((m) => m.table),
  )];
  const allMeasuresSimpleFact = selectedMeasures.length > 0 && selectedMeasures.every((m) =>
    m.table && realFacts.has(m.table)
    && SIMPLE_AGGS.has(String(m.aggregation || '').toLowerCase())
    && !m.expression
    && !(Array.isArray(m.filterRules) && m.filterRules.length > 0)
    && !m.overrideFilters);
  const eligible = factsInvolved.length >= 2
    && allMeasuresSimpleFact
    && !rlsApplies
    && !distinct
    && !topNOverride
    && havingParts.length === 0
    && measureFiltersDeferred.length === 0
    && (!Array.isArray(havingGrainDims) || havingGrainDims.length === 0)
    && dimOnlyMeasureInfos.length === 0;
  if (!eligible) return null;

  const dimInfoOf = (d) => ({
    expr: buildDimensionExpr(d, dbType, columnTypes),
    alias: quoteIdent(d.label || d.name, dbType),
  });
  const dimInfos = selectedDimensions.map(dimInfoOf);
  const dimSelects = dimInfos.map((x) => `${x.expr} AS ${x.alias}`);
  const dimExprs = dimInfos.map((x) => x.expr);
  const dimAliases = dimInfos.map((x) => x.alias);
  // Per-fact aggregate select — mirrors the normal-aggregation branch of
  // the SELECT loop above (CAST override + interval EXTRACT EPOCH).
  const measureSelectOf = (m) => {
    const alias = quoteIdent(m.label || m.name, dbType);
    const rawCol = quoteCol(m.table, m.column, dbType);
    const agg = String(m.aggregation || '').toLowerCase();
    if (agg === 'count') {
      const e = (m.table && m.column && m.column !== '*') ? `COUNT(${rawCol})` : 'COUNT(*)';
      return { sql: `${e} AS ${alias}`, alias };
    }
    const finalExpr = buildMeasureAggExpr(m, { dbType, columnTypes });
    return { sql: `${finalExpr} AS ${alias}`, alias };
  };
  // Every per-fact subquery must join the grain dims AND any dim
  // referenced by a WHERE filter (report / widget / cross-filter), so
  // the filters apply inside each fact's aggregation.
  const filterDimTables = whereParts
    .filter((w) => w.field)
    .map((w) => { const d = allDimensions.find((x) => x.name === w.field); return d ? d.table : null; })
    .filter(Boolean);
  const neededDimTables = [...new Set([...selectedDimensions.map((d) => d.table), ...filterDimTables])];
  // FROM <fact> JOIN <needed dims…>, rooted at the fact (mirrors the main
  // traversal). Returns null if a needed table can't be connected to this
  // fact → the fact isn't conformed to that dim → fall back entirely.
  const buildFactFrom = (fact) => {
    let from = quoteTable(fact, dbType);
    const added = new Set([fact]);
    const remaining = neededDimTables.filter((t) => t !== fact);
    while (remaining.length > 0) {
      let pickedIdx = -1; let pickedJoin = null;
      for (let i = 0; i < remaining.length; i++) {
        const t = remaining[i];
        const j = allJoins.find((jj) => (jj.from_table === t && added.has(jj.to_table))
          || (jj.to_table === t && added.has(jj.from_table)));
        if (j) { pickedIdx = i; pickedJoin = j; break; }
      }
      if (pickedIdx < 0) return null;
      const t = remaining.splice(pickedIdx, 1)[0];
      const jt = deriveJoinKeyword(pickedJoin);
      from += ` ${jt} JOIN ${quoteTable(t, dbType)} ON ${quoteCol(pickedJoin.from_table, pickedJoin.from_column, dbType)} = ${quoteCol(pickedJoin.to_table, pickedJoin.to_column, dbType)}`;
      added.add(t);
    }
    return from;
  };
  const whereSql = whereParts.length > 0 ? ` WHERE ${whereParts.map((w) => w.sql).join(' AND ')}` : '';
  const groupSql = dimExprs.length > 0 ? ` GROUP BY ${dimExprs.join(', ')}` : '';
  const subs = [];
  const measureAliases = [];
  let ok = true;
  for (const fact of factsInvolved) {
    const from = buildFactFrom(fact);
    if (!from) { ok = false; break; }
    const fMeasures = selectedMeasures.filter((m) => m.table === fact);
    const mSel = fMeasures.map(measureSelectOf);
    mSel.forEach((x) => measureAliases.push(x.alias));
    subs.push(`SELECT ${[...dimSelects, ...mSel.map((x) => x.sql)].join(', ')} FROM ${from}${whereSql}${groupSql}`);
  }
  if (ok && subs.length >= 2) {
    const wrapped = subs.map((s, i) => `(${s}) g${i}`);
    const joiner = dimAliases.length > 0
      ? (acc, cur) => `${acc} FULL JOIN ${cur} USING (${dimAliases.join(', ')})`
      : (acc, cur) => `${acc} CROSS JOIN ${cur}`;
    const joined = wrapped.reduce((acc, cur, i) => (i === 0 ? cur : joiner(acc, cur)));
    return {
      sql: `SELECT ${[...dimAliases, ...measureAliases].join(', ')} FROM ${joined}`,
      orderByAlias: dimAliases.length > 0 ? dimAliases[0] : null,
    };
  }
  return null;
}

module.exports = { buildMultiFactBody };
