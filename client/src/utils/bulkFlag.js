import { isNumeric } from './modelEditorHelpers';

/**
 * Flag every column a search found as a dimension or a measure, in one go —
 * the D / M tags of the schema canvas, applied to a whole search. Pure: the
 * model editor passes its state in and sets what comes back.
 *
 * The objects are the ones the per-column tags create (addDimension /
 * addMeasure), so a field flagged in bulk is the same as one flagged by hand.
 */

// Case-insensitive, on the column name alone: the search is for fields, and
// matching the table name would drag every column of that table along.
export function matchColumns(tablesData, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const out = [];
  for (const [table, cols] of Object.entries(tablesData || {})) {
    for (const col of cols || []) {
      if (String(col.column_name || '').toLowerCase().includes(q)) out.push({ table, col });
    }
  }
  return out;
}

const isDimOf = (table, column) => (d) => d.table === table && d.column === column && !d.expression;
const isMeasOf = (table, column) => (m) => m.table === table && m.column === column && m.aggregation !== 'custom';

// Whether every match already carries the role — the button then unflags.
export function allFlagged(state, matches, role) {
  const list = role === 'dimension' ? state.dimensions : state.measures;
  const of = role === 'dimension' ? isDimOf : isMeasOf;
  return matches.length > 0 && matches.every(({ table, col }) => list.some(of(table, col.column_name)));
}

/**
 * All matches flagged as `role` — or, when they all already are, none of them.
 * Other roles are left alone: a column can be both a dimension and a measure.
 *
 * @param {object} state    { dimensions, measures }
 * @param {Array}  matches  from matchColumns
 * @param {string} role     'dimension' | 'measure'
 * @param {object} columns  { typeOf(table, column, dataType) → dimension type }
 */
export function toggleRole(state, matches, role, { typeOf }) {
  let { dimensions, measures } = state;
  if (allFlagged(state, matches, role)) {
    const hit = (f) => matches.some(({ table, col }) => (role === 'dimension' ? isDimOf : isMeasOf)(table, col.column_name)(f));
    if (role === 'dimension') dimensions = dimensions.filter((d) => !hit(d));
    else measures = measures.filter((m) => !hit(m));
    return { dimensions, measures };
  }

  dimensions = [...dimensions];
  measures = [...measures];
  // A query result is keyed by label: a second field on a label already in use
  // is labelled after its role, as addDimension / addMeasure do.
  const labelTaken = (label) => [...dimensions, ...measures].some((f) => (f.label || f.name) === label);
  for (const { table, col } of matches) {
    const column = col.column_name;
    if (role === 'dimension') {
      if (dimensions.some(isDimOf(table, column))) continue;
      dimensions.push({
        name: `${table}.${column}`, table, column,
        type: typeOf(table, column, col.data_type),
        label: labelTaken(column) ? `${column} (dimension)` : column,
      });
    } else {
      if (measures.some(isMeasOf(table, column))) continue;
      const agg = isNumeric(col.data_type) ? 'sum' : 'max';
      measures.push({
        name: `${table}.${column}_${agg}`, table, column, aggregation: agg,
        label: labelTaken(column) ? `${column} (${agg})` : column,
        dataType: String(col.data_type || '').toLowerCase(),
      });
    }
  }
  return { dimensions, measures };
}
