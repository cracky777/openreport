// WHERE / HAVING scalar-clause builder for the /query SQL compiler — extracted
// verbatim from routes/models.js. Pure: `dbType` is an explicit trailing param
// (it used to be captured from the handler closure via escVal/castToDate/
// buildInList). Returns the SQL fragment, or null when the value is absent so
// the caller skips the empty filter. Covered by tests/sqlSnapshotJoins.
const { quoteLiteral } = require('../sqlDialect');
const { castToString, castToDate, buildInList } = require('./casts');

function buildScalarClause(colExpr, op, value, values, isDateCol, dateFmt, dimType, dbType) {
  const escVal = (v) => quoteLiteral(v, dbType);
  const isEmpty = (v) => v == null || v === '';
  const cast = isDateCol ? castToDate(colExpr, dbType, dateFmt || 'auto') : colExpr;
  const list = Array.isArray(values) ? values : (Array.isArray(value) ? value : null);
  const numericFor = (v) => isDateCol ? escVal(v) : Number(v);
  switch (op) {
    case 'in':
      return list?.length ? buildInList(colExpr, dimType || 'string', list, dbType) : null;
    case 'not_in':
      return list?.length ? buildInList(colExpr, dimType || 'string', list, dbType, true) : null;
    case 'eq':  return isEmpty(value) ? null : `${cast} = ${escVal(value)}`;
    case 'neq': return isEmpty(value) ? null : `${cast} <> ${escVal(value)}`;
    case 'gt':  return isEmpty(value) ? null : `${cast} > ${numericFor(value)}`;
    case 'gte': return isEmpty(value) ? null : `${cast} >= ${numericFor(value)}`;
    case 'lt':  return isEmpty(value) ? null : `${cast} < ${numericFor(value)}`;
    case 'lte': return isEmpty(value) ? null : `${cast} <= ${numericFor(value)}`;
    case 'between': {
      const [a, b] = list || [];
      if (isEmpty(a) || isEmpty(b)) return null;
      return isDateCol
        ? `${cast} BETWEEN ${escVal(a)} AND ${escVal(b)}`
        : `${cast} BETWEEN ${Number(a)} AND ${Number(b)}`;
    }
    // Case-insensitive, like starts_with below: a search for "salaire" finds
    // "Salaires". The rollup planner reads these the same way (rollupPlanner.js).
    case 'contains':     return isEmpty(value) ? null : `LOWER(${castToString(colExpr, dbType)}) LIKE ${escVal('%' + String(value).toLowerCase() + '%')}`;
    case 'not_contains': return isEmpty(value) ? null : `LOWER(${castToString(colExpr, dbType)}) NOT LIKE ${escVal('%' + String(value).toLowerCase() + '%')}`;
    case 'starts_with':  return isEmpty(value) ? null : `LOWER(${castToString(colExpr, dbType)}) LIKE ${escVal(String(value).toLowerCase() + '%')}`;
    case 'ends_with':    return isEmpty(value) ? null : `${castToString(colExpr, dbType)} LIKE ${escVal('%' + value)}`;
    case 'is_empty':     return `(${colExpr} IS NULL OR ${castToString(colExpr, dbType)} = '')`;
    case 'is_not_empty': return `(${colExpr} IS NOT NULL AND ${castToString(colExpr, dbType)} <> '')`;
    default: return null;
  }
}

module.exports = { buildScalarClause };
