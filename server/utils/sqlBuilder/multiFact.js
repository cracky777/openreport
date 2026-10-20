// Multi-fact fan-out avoidance for the /query SQL compiler. When a visual
// combines measures from ≥2 different fact tables (sales and returns, the
// books and a budget), joining the raw facts to a shared dimension fans out
// rows (each f1 row × each matching f2 row) and inflates the SUMs. The rollup
// cache already avoids this — one pre-aggregated subquery per fact, then FULL
// JOIN USING the grain (see rollupPlanner.js `subFor`). Mirror that on the live
// path: aggregate each fact independently at the requested grain, then FULL
// JOIN the per-fact results on the dimension aliases (CROSS JOIN for a grainless
// scorecard). A drill-across, in dimensional-modelling terms.
//
// Each fact's subquery reaches its dimensions the way the rollup builder does
// (rollupPlanning.factConformedDimTables): stepping only toward a `1` side,
// never through another fact — the walk that would fan the fact out. A WHERE
// filter on a dimension a fact cannot reach is left out of that fact's
// subquery, as the planner leaves it out of that fact's rollup. A measure's
// own rules (`filterRules`, intersection mode) and a custom expression are
// computed inside their fact's subquery, with the tables they name joined
// there; a measure whose refs span two facts, a rule that replaces a grouping
// (window mode), an override-mode rule, a textual expression: not here.
//
// Pure: reads only its inputs, returns `{ sql, orderByAliases }` or null →
// the caller's single-query path runs unchanged. Covered by
// tests/sqlSnapshotJoins (multi-fact).
const { quoteAlias, quoteCol, quoteTable, capabilities } = require('../sqlDialect');
const { deriveJoinKeyword } = require('./joins');
const { buildMeasureAggExpr, transformAggregates, dialectNumericCast, applyNumericCast } = require('./measureAgg');
const { buildDimensionExpr } = require('./datePart');
const { expressionTables } = require('./dimensionTables');
const { groupedRuleFields } = require('./windowMeasure');
const { looksTextual } = require('./measureSortValue');
const { preWrapIntervalRefs } = require('../columnTypeResolver');
const { factsForMeasure } = require('../measureType/plan');
const { runningTotalOver, isPeriodDim } = require('./windowMeasure');

const SIMPLE_AGGS = new Set(['sum', 'avg', 'min', 'max', 'count']);

// Cardinality of `node`'s end of join `j`; a join with no cardinality is the
// legacy dim(from, 1) → fact(to, *) convention.
function cardOf(node, j) {
  const c = j.cardinality;
  if (!c || (!c.from && !c.to)) return node === j.to_table ? '*' : '1';
  return node === j.to_table ? (c.to || '*') : (c.from || '*');
}

// Shortest chain of joins from any table already in the FROM clause to
// `target`, as [{ join, table }] in the order the tables are joined in —
// stepping only toward a `1` side and never into another fact.
function joinPath(added, target, allJoins, { realFacts, root }) {
  const via = new Map([...added].map((t) => [t, null]));
  const queue = [...added];
  while (queue.length) {
    const cur = queue.shift();
    for (const j of allJoins) {
      if (!j || !j.from_table || !j.to_table) continue;
      const next = j.from_table === cur ? j.to_table : j.to_table === cur ? j.from_table : null;
      if (!next || via.has(next)) continue;
      if (cardOf(next, j) !== '1' || (realFacts.has(next) && next !== root)) continue;
      via.set(next, { join: j, from: cur });
      if (next === target) {
        const path = [];
        for (let t = target; via.get(t); t = via.get(t).from) path.unshift({ join: via.get(t).join, table: t });
        return path;
      }
      queue.push(next);
    }
  }
  return null;
}

function buildMultiFactBody({
  selectedMeasures, selectedDimensions, realFacts, whereParts,
  allDimensions, allJoins, dbType, columnTypes,
  rlsApplies, distinct, topNOverride, havingParts,
  measureFiltersDeferred, havingGrainDims, dimOnlyMeasureInfos,
  allMeasures = [], allFieldsForLookup = [], tablesOfDimension = (d) => (d.table ? [d.table] : []),
  inlineMeasureRefs = null, buildRuleClause = null,
}) {
  // A top / bottom N ranks the joined rows by one of the measures asked: the
  // outer query orders by its alias (seen: "the 10 accounts most over budget",
  // a variance across two facts, fell back to a flat join and came out NULL).
  const rankDef = topNOverride && topNOverride.measureName ? allMeasures.find((m) => m.name === topNOverride.measureName) : null;
  const rankShown = !!rankDef && selectedMeasures.some((m) => m.name === rankDef.name);
  const rankAlias = rankDef ? (rankShown ? quoteAlias(rankDef.label || rankDef.name, dbType) : quoteAlias('__rank', dbType)) : null;
  if (selectedMeasures.length === 0 || rlsApplies || distinct || (topNOverride && !rankAlias)
    // The rank rule itself is a deferred measure filter: any other one is a HAVING.
    || havingParts.length > 0 || measureFiltersDeferred.some((r) => r.op !== 'top_n' && r.op !== 'bottom_n')
    || (Array.isArray(havingGrainDims) && havingGrainDims.length > 0)
    || dimOnlyMeasureInfos.length > 0) return null;

  // Which fact each measure reads — exactly one, a real fact — and the SQL of
  // the measure inside that fact's subquery, with the tables it needs there.
  const dimByName = new Map(allDimensions.map((d) => [d.name, d]));
  const ruleTables = (rules) => {
    const out = [];
    for (const r of rules) {
      if (!r || r.isMeasure || !r.field) continue;
      const d = dimByName.get(r.field);
      if (!d) return null; // a rule on a field the model lacks: the main path says so
      out.push(...tablesOfDimension(d));
    }
    return out;
  };
  const dimInfos = selectedDimensions.map((d) => ({
    expr: buildDimensionExpr(d, dbType, columnTypes),
    alias: quoteAlias(d.label || d.name, dbType),
    tables: tablesOfDimension(d),
  }));
  const dimExprs = dimInfos.map((x) => x.expr);
  // A running total: summed over the periods of the query inside its own fact's subquery.
  const running = (m, expr) => (m.runningTotal ? (runningTotalOver(expr, selectedDimensions, dimExprs) || expr) : expr);
  const measureOf = (m) => {
    const facts = factsForMeasure(m, allMeasures);
    if (facts.length !== 1 || !realFacts.has(facts[0])) return null;
    const alias = quoteAlias(m.label || m.name, dbType);
    const agg = String(m.aggregation || '').toLowerCase();
    const rules = Array.isArray(m.filterRules) ? m.filterRules.filter(Boolean) : [];
    if (rules.length && (m.overrideFilters || !buildRuleClause)) return null;
    if (rules.length && groupedRuleFields(rules, selectedDimensions).size) return null;
    const tables = new Set();
    let whenSql = null;
    if (rules.length) {
      const clauses = rules.map(buildRuleClause).filter(Boolean);
      const named = ruleTables(rules);
      if (!named) return null;
      named.forEach((t) => tables.add(t));
      if (clauses.length) whenSql = clauses.join(' AND ');
    }
    if (agg === 'custom' && m.expression) {
      if (!inlineMeasureRefs) return null;
      let inlined;
      try { inlined = inlineMeasureRefs(m.expression); } catch { return null; /* the main path reports the bad ref */ }
      // A dimension-table measure inside it is read per group by the main path (dimMeasure.js).
      if (inlined.includes('__DIM_REF_')) return null;
      if (looksTextual(inlined)) return null;
      inlined = preWrapIntervalRefs(inlined, columnTypes, dbType);
      expressionTables(inlined, allFieldsForLookup).forEach((t) => tables.add(t));
      const sql = whenSql
        ? transformAggregates(inlined, ['SUM', 'AVG', 'MIN', 'MAX', 'COUNT'], (fn, arg) => {
          const cast = (fn.toUpperCase() === 'SUM' || fn.toUpperCase() === 'AVG') ? dialectNumericCast(arg, dbType) : arg;
          return `${fn}(CASE WHEN ${whenSql} THEN ${cast} END)`;
        })
        : applyNumericCast(inlined, dbType);
      return { fact: facts[0], alias, expr: running(m, `(${sql})`), tables };
    }
    if (!m.table || !SIMPLE_AGGS.has(agg) || m.expression) return null;
    tables.add(m.table);
    if (agg === 'count') {
      const col = (m.column && m.column !== '*') ? quoteCol(m.table, m.column, dbType) : null;
      const arg = whenSql ? `CASE WHEN ${whenSql} THEN ${col || 1} END` : (col || '*');
      return { fact: facts[0], alias, expr: running(m, `COUNT(${arg})`), tables };
    }
    return { fact: facts[0], alias, expr: running(m, buildMeasureAggExpr(m, { dbType, columnTypes, ...(whenSql ? { caseWhenSql: whenSql } : {}) })), tables };
  };
  // A measure computed ACROSS facts (actual minus budget): each `${ref}` is
  // aggregated in its own fact's subquery under a hidden alias, and the
  // arithmetic runs in the outer SELECT on the joined grain — a side with no
  // row counts as zero, so a variance shows where only one of them has data.
  // Refs: measures of one fact each (a nested span, a rule on the spanning
  // measure itself, a textual expression: the main path).
  const measureByName = (name) => allMeasures.find((mm) => mm.name === name) || allMeasures.find((mm) => mm.label === name);
  let hidden = 0;
  const spanOf = (m) => {
    const agg = String(m.aggregation || '').toLowerCase();
    if (agg !== 'custom' || !m.expression || (Array.isArray(m.filterRules) && m.filterRules.length)) return null;
    if (factsForMeasure(m, allMeasures).length < 2 || looksTextual(m.expression)) return null;
    const parts = [];
    let outer = String(m.expression);
    const refs = [...outer.matchAll(/\$\{\s*([^}]+?)\s*\}/g)];
    if (!refs.length) return null;
    for (const [match, name] of refs) {
      const target = measureByName(name.trim());
      const part = target && measureOf(target);
      if (!part) return null;
      const alias = `__m${hidden += 1}`;
      parts.push({ ...part, alias, hidden: true });
      outer = outer.split(match).join(`COALESCE(${alias}, 0)`);
    }
    return { alias: quoteAlias(m.label || m.name, dbType), outer: `(${outer})`, parts };
  };
  const measures = [];
  const spans = [];
  // The rank measure the visual does not show rides along under a hidden alias.
  const wanted = rankDef && !rankShown ? [...selectedMeasures, { ...rankDef, label: '__rank', hiddenRank: true }] : selectedMeasures;
  for (const m of wanted) {
    const one = measureOf(m);
    if (one) { measures.push(one); continue; }
    const span = spanOf(m);
    if (!span) return null;
    measures.push(...span.parts);
    spans.push(span);
  }
  if (!measures.length) return null;
  const factsInvolved = [...new Set(measures.map((x) => x.fact))];
  if (factsInvolved.length < 2) return null;

  const dimAliases = dimInfos.map((x) => x.alias);
  // A WHERE part and the tables its dimension reads; one with no field (an
  // RLS clause, a literal) applies to every fact.
  const wheres = whereParts.map((w) => {
    const d = w.field ? dimByName.get(w.field) : null;
    return { sql: w.sql, tables: d ? tablesOfDimension(d) : [] };
  });

  // FROM <fact> JOIN <needed tables…>, rooted at the fact. Returns null when a
  // table a measure or a grouping dimension needs cannot be reached from the
  // fact through its dimensions → the whole query falls back.
  const factFrom = (fact, needed) => {
    let from = quoteTable(fact, dbType);
    const added = new Set([fact]);
    for (const target of needed) {
      if (added.has(target)) continue;
      const path = joinPath(added, target, allJoins, { realFacts, root: fact });
      if (!path) return null;
      for (const { join, table } of path) {
        from += ` ${deriveJoinKeyword(join)} JOIN ${quoteTable(table, dbType)} ON ${quoteCol(join.from_table, join.from_column, dbType)} = ${quoteCol(join.to_table, join.to_column, dbType)}`;
        added.add(table);
      }
    }
    return { from, added };
  };
  // A period another fact holds (the month of the sales) is read, for a fact
  // that cannot reach it, on that fact's own date — its only one — at the same
  // part: the month of the store traffic. The subqueries then meet on the
  // month itself (Marché Plus: a basket by month read 2 € through the join).
  const ownDates = (fact) => (allDimensions || []).filter((x) => x && x.table === fact && x.column && !x.datePart && !x.expression && /date|time/i.test(String(x.type || '')));
  const dimsFor = (fact) => dimInfos.map((x, i) => {
    if (x.tables.every((t) => t === fact) || factFrom(fact, x.tables)) return x;
    const d = selectedDimensions[i];
    const dates = ownDates(fact);
    if (!isPeriodDim(d) || d.expression || dates.length !== 1) return null;
    return { ...x, expr: buildDimensionExpr({ ...d, table: fact, column: dates[0].column }, dbType, columnTypes), tables: [fact], moved: true };
  });
  const subs = [];
  const measureAliases = [];
  for (const fact of factsInvolved) {
    const own = measures.filter((x) => x.fact === fact);
    const dims = dimsFor(fact);
    if (dims.some((x) => !x)) return null;
    // A running total orders by the query's own periods: not across facts.
    if (dims.some((x) => x.moved) && own.some((x) => /\bOVER\s*\(/i.test(x.expr))) return null;
    const groupSql = dims.length > 0 ? ` GROUP BY ${dims.map((x) => x.expr).join(', ')}` : '';
    const needed = [...new Set([...own.flatMap((x) => [...x.tables]), ...dims.flatMap((x) => x.tables)])];
    const built = factFrom(fact, needed);
    if (!built) return null;
    // Filters this fact can take: those on dimensions it reaches (joined on
    // demand, through its dimensions); the others are not its to answer.
    let from = built.from;
    const kept = [];
    for (const w of wheres) {
      const missing = w.tables.filter((t) => !built.added.has(t));
      if (missing.length) {
        const more = factFrom(fact, [...built.added, ...missing]);
        if (!more) continue;
        from = more.from;
        more.added.forEach((t) => built.added.add(t));
      }
      kept.push(w.sql);
    }
    own.forEach((x) => measureAliases.push({ alias: x.alias, g: subs.length, hidden: !!x.hidden }));
    subs.push(`SELECT ${[...dims.map((x) => `${x.expr} AS ${x.alias}`), ...own.map((x) => `${x.expr} AS ${x.alias}`)].join(', ')} FROM ${from}${kept.length ? ` WHERE ${kept.join(' AND ')}` : ''}${groupSql}`);
  }

  const wrapped = subs.map((s, i) => `(${s}) g${i}`);
  // The final measures, in the order asked: a fact's own under its alias, a
  // spanning one as its arithmetic over the hidden columns.
  const spanOrder = new Map(spans.map((s) => [s.alias, s]));
  const finalMeasures = (ref) => wanted.map((m) => {
    const alias = quoteAlias(m.label || m.name, dbType);
    const span = spanOrder.get(alias);
    if (span) return `${span.parts.reduce((sql, p) => sql.split(`COALESCE(${p.alias}, 0)`).join(`COALESCE(${ref(p.alias)}, 0)`), span.outer)} AS ${alias}`;
    return ref(alias);
  });
  const gOf = (alias) => measureAliases.find((x) => x.alias === alias).g;
  const measureRefs = finalMeasures((alias) => alias);

  // A scorecard has no grain: nothing to match on, each subquery yields one row.
  if (dimAliases.length === 0) {
    const joined = wrapped.reduce((acc, cur, i) => (i === 0 ? cur : `${acc} CROSS JOIN ${cur}`));
    return { sql: `SELECT ${measureRefs.join(', ')} FROM ${joined}`, orderByAliases: null, rankAlias };
  }

  // T-SQL has no USING clause: SQL Server and Azure SQL only know ON. USING
  // merges the two grain columns into one; ON leaves them side by side, one
  // of them NULL on the rows the other side lacks. So that COALESCE has to be
  // written out — in the final SELECT, and in the ON of the next join, which
  // compares against the grain already merged.
  if (!capabilities(dbType).joinUsing) {
    const merged = (ai, upTo) => (upTo === 0
      ? `g0.${dimAliases[ai]}`
      : `COALESCE(${Array.from({ length: upTo + 1 }, (_, g) => `g${g}.${dimAliases[ai]}`).join(', ')})`);
    let joined = wrapped[0];
    for (let i = 1; i < wrapped.length; i++) {
      const on = dimAliases.map((a, ai) => `${merged(ai, i - 1)} = g${i}.${a}`).join(' AND ');
      joined = `${joined} FULL JOIN ${wrapped[i]} ON ${on}`;
    }
    const dimSelect = dimAliases.map((a, ai) => `${merged(ai, wrapped.length - 1)} AS ${a}`);
    const measSelect = finalMeasures((alias) => `g${gOf(alias)}.${alias}`);
    return {
      sql: `SELECT ${[...dimSelect, ...measSelect].join(', ')} FROM ${joined}`,
      orderByAliases: dimAliases.join(', '),
      rankAlias,
    };
  }

  const joined = wrapped.reduce((acc, cur, i) => (i === 0
    ? cur
    : `${acc} FULL JOIN ${cur} USING (${dimAliases.join(', ')})`));
  return {
    sql: `SELECT ${[...dimAliases, ...measureRefs].join(', ')} FROM ${joined}`,
    orderByAliases: dimAliases.join(', '),
    rankAlias,
  };
}

module.exports = { buildMultiFactBody };
