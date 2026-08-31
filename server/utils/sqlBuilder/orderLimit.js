// ORDER BY + LIMIT for a top-N / bottom-N override — dialect-aware NULLS
// handling and the OFFSET…FETCH vs LIMIT split. Extracted from routes/models.js
// where the identical cascade appeared twice (main query + x-grain subquery).
// `topN` is { aggExpr, direction, n }. Covered by tests/orderLimit.
const { capabilities } = require('../sqlDialect');
function buildTopNOrderLimit(topN, dbType) {
  const { nullsLast, pagination } = capabilities(dbType);
  let out;
  if (nullsLast === 'emulated') {
    out = ` ORDER BY ${topN.aggExpr} IS NULL, ${topN.aggExpr} ${topN.direction}`;
  } else if (nullsLast === 'inline') {
    out = ` ORDER BY ${topN.aggExpr} ${topN.direction} NULLS LAST`;
  } else {
    // No NULL ordering available — an aggregate over a non-empty group is
    // rarely NULL, so the plain ORDER BY is close enough.
    out = ` ORDER BY ${topN.aggExpr} ${topN.direction}`;
  }
  out += pagination === 'fetch'
    ? ` OFFSET 0 ROWS FETCH NEXT ${topN.n} ROWS ONLY`
    : ` LIMIT ${topN.n}`;
  return out;
}

module.exports = { buildTopNOrderLimit };
