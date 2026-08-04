// Inner aggregation subquery for an override-mode (CALCULATE-style) filtered
// measure — extracted verbatim from routes/models.js. Used by both patch-up
// loops (the top-level overrideMeasureInfos loop and the __OVERRIDE_REF_<i>__
// placeholder resolver); sharing one helper keeps the interval EXTRACT(EPOCH …)
// wrap consistent across both.
//
// Returns the raw `SELECT ... FROM ... [WHERE ...]` string; the caller wraps it
// in `(...)` (+ an `AS <label>` or a placeholder splice). `inlinedExpr` lets the
// caller pre-feed the nested-`${}`-expanded form. `buildRuleClause` is passed in
// because it belongs to the handler: on the pre-FROM paths it mutates the
// join-graph table set, while here (post-FROM) that write is dead — we keep the
// same function so the emitted clause SQL is byte-identical. Covered by
// tests/sqlSnapshotMeasures (override-filtered measure).
const { buildMeasureAggExpr, applyNumericCast } = require('./measureAgg');
const { preWrapIntervalRefs } = require('../columnTypeResolver');

function buildOverrideSubquery(measure, inlinedExpr, { whereParts, fromClause, buildRuleClause, dbType, columnTypes }) {
  const overrideFields = new Set(
    (measure.filterRules || []).map((r) => r && r.field).filter(Boolean)
  );
  // Keep all WHERE clauses NOT tied to an override field. Untagged clauses
  // (RLS) are always kept so security is preserved.
  const keptWhere = whereParts
    .filter((w) => !w.field || !overrideFields.has(w.field))
    .map((w) => w.sql);
  const ruleClauses = (measure.filterRules || []).map(buildRuleClause).filter(Boolean);
  const innerWhere = [...keptWhere, ...ruleClauses];
  let innerAgg;
  if (measure.aggregation === 'custom' && measure.expression) {
    // Pre-wrap interval refs even on the fallback path (when inlinedExpr wasn't
    // pre-computed) — applyNumericCast will fail on raw interval columns.
    const exprForCast = inlinedExpr
      || preWrapIntervalRefs(measure.expression, columnTypes, dbType);
    innerAgg = applyNumericCast(exprForCast, dbType);
  } else if (measure.aggregation === 'count' || (measure.column === '*' && !measure.table)) {
    innerAgg = 'COUNT(*)';
  } else if (measure.table && measure.column) {
    innerAgg = buildMeasureAggExpr(measure, { dbType, columnTypes });
  } else {
    innerAgg = 'NULL';
  }
  let subSql = `SELECT ${innerAgg} FROM ${fromClause}`;
  if (innerWhere.length > 0) {
    subSql += ` WHERE ${innerWhere.join(' AND ')}`;
  }
  return subSql;
}

module.exports = { buildOverrideSubquery };
