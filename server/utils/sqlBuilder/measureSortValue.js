const { transformAggregates } = require('./measureAgg');

// Prefix of the companion column. Reserved: the client strips any key starting
// with it before it decides what a table's columns are, so this never shows up
// as a column of its own.
const SORT_VALUE_PREFIX = '__orsort__';

/**
 * The first aggregate inside a custom expression.
 *
 * A custom measure is free to return TEXT — a duration formatted in SQL, a
 * label. What is displayed is then that string, and a string has no height on
 * a bar, no order in a sort and no total. But the expression is aggregated:
 * the number is right there inside it, and it is the number the author's own
 * SQL is built on. So it is emitted alongside, and the visuals position and
 * sort with it while showing the author's text.
 *
 * Paren-aware, via the same walker the NUMERIC cast uses, so a CASE WHEN with
 * an IN (...) inside an aggregate doesn't fool the matcher.
 */
function firstAggregate(expression) {
  if (!expression || typeof expression !== 'string') return null;
  let found = null;
  transformAggregates(expression, ['SUM', 'AVG', 'MIN', 'MAX', 'COUNT'], (fn, arg) => {
    if (found === null) found = `${fn}(${arg})`;
    return `${fn}(${arg})`;
  });
  return found;
}

/**
 * Whether an expression builds a STRING — the only case that needs a companion.
 *
 * A numeric custom measure already returns the number it is sorted and drawn
 * with, and emitting a second aggregate for it would change the SQL of every
 * report that has one, for nothing. So the companion is reserved for the
 * constructs that turn a number into text: concatenation, padding, explicit
 * casts to a character type, and the formatting functions.
 */
const TEXTUAL = /(\|\|)|\b(CONCAT|LPAD|RPAD|TO_CHAR|FORMAT|SUBSTRING|TRIM)\s*\(|\bAS\s+(VARCHAR|VARCHAR2|TEXT|CHAR|STRING|NVARCHAR|NCHAR)\b/i;
function looksTextual(expression) {
  return typeof expression === 'string' && TEXTUAL.test(expression);
}

/** The alias the companion is emitted under, for a measure's display label. */
function sortValueAlias(label) {
  return `${SORT_VALUE_PREFIX}${label}`;
}

module.exports = { firstAggregate, looksTextual, sortValueAlias, SORT_VALUE_PREFIX };
