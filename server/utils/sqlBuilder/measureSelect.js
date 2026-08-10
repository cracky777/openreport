// SELECT-list emission for the measures of a /query — extracted verbatim from
// routes/models.js (the ~190-line selectedMeasures loop). This is orchestration,
// not a pure helper: it MUTATES the shared SELECT-building accumulators passed in
// (selectParts / tablesUsed / dimOnlyMeasureInfos / overrideMeasureInfos /
// groupByParts) and delegates to two handler closures (inlineMeasureRefs,
// buildRuleClause) that themselves mutate tablesUsed / overrideRefInfos. Kept
// together so the branch cascade (dim-only → override → intersection → custom →
// count_col/hll/count → plain agg) lives in one place.
//
// Returns { error } for a bad custom expression (cyclic/invalid ref) so the
// caller can emit a single 400 — never touches res. Covered by
// tests/sqlSnapshot*, tests/queryErrors.
const { measurePrimaryTable, sameComponent } = require('./joinGraph');
const { preWrapIntervalRefs } = require('../columnTypeResolver');
const {
  transformAggregates, dialectNumericCast, applyNumericCast, buildMeasureAggExpr,
} = require('./measureAgg');
const { quoteIdent, quoteCol } = require('../sqlDialect');

function emitMeasureSelects(ctx) {
  const {
    selectedMeasures, realFacts, joinedTables, rlsApplies,
    allDimensions, allFieldsForLookup, dbType, columnTypes,
    selectParts, tablesUsed, dimOnlyMeasureInfos, overrideMeasureInfos, groupByParts,
    inlineMeasureRefs, buildRuleClause,
    components, dimTables,
  } = ctx;

  for (const m of selectedMeasures) {
    // Dim-only fast path. Skip the normal selectParts emission AND skip
    // the `tablesUsed.add` — the dim is queried by the scalar subquery
    // independently, so adding it here would needlessly force the join
    // graph to thread through it (and bring along the cross-table
    // filters whose inflation we're avoiding in the first place).
    // Bail out for measures that carry their own pipeline (filterRules,
    // override mode, custom-with-refs); those go through the dedicated
    // paths below.
    const primaryTable = measurePrimaryTable(m);
    // RLS gate: the dim-only subquery is independent of the outer WHERE
    // and would silently bypass an RLS clause (the clause references the
    // RLS table, which the subquery's FROM doesn't include). For
    // RLS-restricted users we fall through to the regular structured
    // path so the outer WHERE enforces it — the measure may be
    // fact-inflated but it's never leaky. Owners/admins (rlsApplies =
    // false) get the clean subquery path.
    // A measure whose table sits in a DIFFERENT join component than every
    // grouping dimension can't be aggregated per group — pulling it into the
    // main FROM would cross-join it (Cartesian product → each group shows a
    // multiple of the grand total). Emit it as its own scalar subquery instead,
    // so it reads as an honest ungrouped total. Only kicks in when a) there's a
    // dimension to group by and b) the tables are genuinely unrelated; properly
    // joined tables share a component and keep the normal join path.
    const disconnectedFromDims = primaryTable
      && components && dimTables && dimTables.size > 0
      && ![...dimTables].some((dt) => sameComponent(components, primaryTable, dt));

    const isDimOnlyCandidate = primaryTable
      && ((joinedTables.has(primaryTable) && !realFacts.has(primaryTable)) || disconnectedFromDims)
      && !(Array.isArray(m.filterRules) && m.filterRules.length > 0)
      && !rlsApplies;
    if (isDimOnlyCandidate) {
      dimOnlyMeasureInfos.push({
        index: selectParts.length,
        m,
        primaryTable,
        label: m.label || m.name,
      });
      selectParts.push(null);
      continue;
    }
    if (m.table) tablesUsed.add(m.table);
    // Override-mode filtered measure: register tables referenced by its
    // filterRules so the JOIN graph picks them up, then push a placeholder
    // into selectParts. We patch it up after fromClause is built.
    if (Array.isArray(m.filterRules) && m.filterRules.length > 0 && m.overrideFilters) {
      for (const r of m.filterRules) {
        if (!r || r.isMeasure || !r.field) continue;
        const dimDef = allDimensions.find((d) => d.name === r.field);
        if (dimDef) tablesUsed.add(dimDef.table);
      }
      // Custom expression: inline `${measure}` refs and register tables
      // referenced inside the resolved SQL so the outer JOIN graph picks
      // them up (the subquery duplicates the outer FROM clause, so its
      // tables must already be in tablesUsed).
      let inlinedExpression = null;
      if (m.aggregation === 'custom' && m.expression) {
        try {
          inlinedExpression = inlineMeasureRefs(m.expression);
        } catch (e) {
          return { error: e.message };
        }
        // Detect tables BEFORE wrapping interval refs — the wrap inserts the
        // exact same column ref inside EXTRACT(EPOCH FROM …) so includes()
        // still matches, but routing pre-wrap is cleaner.
        for (const field of allFieldsForLookup) {
          if (inlinedExpression.includes(field.column) || inlinedExpression.includes(field.table)) {
            tablesUsed.add(field.table);
          }
        }
        inlinedExpression = preWrapIntervalRefs(inlinedExpression, columnTypes, dbType);
      }
      overrideMeasureInfos.push({
        index: selectParts.length,
        m,
        label: m.label || m.name,
        inlinedExpression,
      });
      selectParts.push(null); // placeholder, filled in after fromClause is built
      continue;
    }
    // Filtered measure (intersection mode): aggregate over rows that
    // satisfy `filterRules`, otherwise NULL. The visual's WHERE clauses
    // still apply, so this is a strict subset of the visual's data —
    // perfect for "active sales only", "this category only" etc.
    if (Array.isArray(m.filterRules) && m.filterRules.length > 0 && !m.overrideFilters) {
      const clauses = m.filterRules.map(buildRuleClause).filter(Boolean);
      if (clauses.length > 0) {
        const whenSql = clauses.join(' AND ');
        if (m.aggregation === 'custom' && m.expression) {
          // Inline `${measure}` references before the CASE WHEN wrap so any
          // aggregates from referenced measures get the filter context too.
          let inlined;
          try {
            inlined = inlineMeasureRefs(m.expression);
          } catch (e) {
            return { error: e.message };
          }
          // Pre-wrap interval-column refs so CAST AS NUMERIC inside the
          // aggregate doesn't blow up on an interval-typed column.
          inlined = preWrapIntervalRefs(inlined, columnTypes, dbType);
          // Wrap each top-level aggregate's argument in `CASE WHEN <rules>
          // THEN <arg> END`. Paren-aware so an inlined CASE WHEN containing
          // `IN (...)` doesn't break the matcher. Composes with the NUMERIC
          // cast for SUM/AVG so divisions preserve decimals.
          const rewritten = transformAggregates(
            inlined,
            ['SUM', 'AVG', 'MIN', 'MAX', 'COUNT'],
            (fn, arg) => {
              const cast = (fn.toUpperCase() === 'SUM' || fn.toUpperCase() === 'AVG')
                ? dialectNumericCast(arg, dbType)
                : arg;
              return `${fn}(CASE WHEN ${whenSql} THEN ${cast} END)`;
            },
          );
          selectParts.push(`(${rewritten}) AS ${quoteIdent(m.label || m.name, dbType)}`);
          // Register tables referenced by the inlined expression
          for (const field of allFieldsForLookup) {
            if (inlined.includes(field.column) || inlined.includes(field.table)) {
              tablesUsed.add(field.table);
            }
          }
        } else if (m.aggregation === 'count' || (m.column === '*' && !m.table)) {
          selectParts.push(`COUNT(CASE WHEN ${whenSql} THEN 1 END) AS ${quoteIdent(m.label || m.name, dbType)}`);
        } else if (m.table && m.column) {
          selectParts.push(`${buildMeasureAggExpr(m, { dbType, columnTypes, caseWhenSql: whenSql })} AS ${quoteIdent(m.label || m.name, dbType)}`);
        }
        continue; // handled
      }
      // No clauses survived (e.g. all rules pointed at non-existent fields)
      // → fall through to the regular aggregation path.
    }
    if (m.aggregation === 'custom' && m.expression) {
      // Inline `${measure}` references first so the NUMERIC cast also wraps
      // any aggregates that came from referenced measures.
      let inlined;
      try {
        inlined = inlineMeasureRefs(m.expression);
      } catch (e) {
        return { error: e.message };
      }
      // Pre-wrap interval-column refs (EXTRACT EPOCH) so the NUMERIC cast
      // below doesn't try CAST(interval AS NUMERIC) — illegal in PG.
      inlined = preWrapIntervalRefs(inlined, columnTypes, dbType);
      // Custom SQL expression - force NUMERIC inside aggregates to avoid integer division truncation
      // SUM(col) becomes SUM((col)::NUMERIC) so division preserves decimals.
      // Paren-aware so a CASE WHEN ... IN (..) inside an aggregate doesn't
      // break the matcher.
      const numericExpr = applyNumericCast(inlined, dbType);
      selectParts.push(`(${numericExpr}) AS ${quoteIdent(m.label || m.name, dbType)}`);
      // Extract table references from the INLINED expression for joins
      for (const field of allFieldsForLookup) {
        if (inlined.includes(field.column) || inlined.includes(field.table)) {
          tablesUsed.add(field.table);
        }
      }
    } else if (m.aggregation === 'count_col' && m.table && m.column) {
      // Internal kind used ONLY by the AVG decomposition's denominator
      // (measureType.collectComponentsForVisual): COUNT of NON-NULL
      // values of the column, so a rolled-up AVG = SUM(x)/COUNT(x)
      // matches SQL AVG (NULLs skipped). Distinct from user `count`
      // measures, which stay COUNT(*) (next branch).
      selectParts.push(`COUNT(${quoteCol(m.table, m.column, dbType)}) AS ${quoteIdent(m.label || m.name, dbType)}`);
    } else if (m.aggregation === 'hll' && m.table && m.column) {
      // Internal kind used ONLY by the rollup builder's DISTINCT-via-HLL
      // pipeline (measureType.collectComponentsForVisual emits one
      // synthetic per `COUNT(DISTINCT col)` measure). The source DB has
      // no `datasketch_hll` function — every dialect we support, BQ
      // excepted — so we can't compute a sketch here. Instead we emit
      // the column RAW (no aggregate) and add it to GROUP BY. The
      // source DB then delivers deduped (grain ∪ col) tuples; the
      // downstream DuckDB staging step computes
      // `datasketch_hll(lgK, col)` at the grain level. Sibling additive
      // atoms in the same query get aggregated at the finer (grain ∪
      // col) cardinality, then re-aggregated in DuckDB — mathematically
      // exact since SUM/MIN/MAX/COUNT are additive.
      const rawCol = quoteCol(m.table, m.column, dbType);
      selectParts.push(`${rawCol} AS ${quoteIdent(m.label || m.name, dbType)}`);
      groupByParts.push(rawCol);
    } else if (m.aggregation === 'count') {
      // COUNT(*) when no column is specified (or the legacy '*' sentinel),
      // COUNT(table.column) — non-null count — when a column was picked
      // in the measure wizard. The wizard now lets the user choose
      // either; for backwards-compat existing measures that came in
      // with `column='*'` or no table keep the COUNT(*) shape.
      if (m.table && m.column && m.column !== '*') {
        selectParts.push(`COUNT(${quoteCol(m.table, m.column, dbType)}) AS ${quoteIdent(m.label || m.name, dbType)}`);
      } else {
        selectParts.push(`COUNT(*) AS ${quoteIdent(m.label || m.name, dbType)}`);
      }
    } else {
      // Wrap the column in CAST when the user has overridden it to a numeric
      // type — otherwise SUM/AVG on a text column (e.g. nvarchar storing
      // numbers) blows up with "operand data type ... is invalid for sum".
      // interval columns render as an `[object Object]` blob; the shared helper
      // flattens SUM/AVG/MIN/MAX(interval) with EXTRACT(EPOCH …) on pg/azure_pg/
      // duckdb (mysql/mssql have no interval type; BQ flattens post-query).
      selectParts.push(`${buildMeasureAggExpr(m, { dbType, columnTypes })} AS ${quoteIdent(m.label || m.name, dbType)}`);
    }
  }
  return null;
}

module.exports = { emitMeasureSelects };
