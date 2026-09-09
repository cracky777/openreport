import { keyRank } from './columnKeys';
import { isNumeric, getColumnType } from './modelEditorHelpers';

/**
 * What a freshly added table should already be flagged as.
 *
 * A model that arrives with nothing ticked asks the user to click every
 * column before anything can be built, which is busywork on a table they just
 * chose to import. Everything is flagged instead, and the only real decision —
 * dimension or measure — follows the same rule the canvas already shows:
 *
 *   - a key column (a leading id, pk or fk — `keyRank` < 2) is a dimension
 *     even when it is numeric. Summing customer ids produces a number that
 *     means nothing, and it is the mistake this pre-selection would otherwise
 *     make at scale.
 *   - any other numeric column is a measure, and ONLY a measure: it is what
 *     one aggregates, and flagging it both ways doubles the field list.
 *   - everything else is a dimension.
 *
 * Returns the two lists in the shape the model editor stores.
 */
export function autoFlagColumns(table, columns, { effectiveType } = {}) {
  const dimensions = [];
  const measures = [];

  for (const raw of columns || []) {
    const col = typeof raw === 'string' ? { column_name: raw, data_type: 'string' } : raw;
    const name = col?.column_name;
    if (!name) continue;

    const isKey = keyRank(name) < 2;
    if (!isKey && isNumeric(col.data_type)) {
      measures.push({
        name: `${table}.${name}_sum`,
        table,
        column: name,
        aggregation: 'sum',
        label: name,
        // Same stamp addMeasure writes: the SQL builder needs it to wrap
        // interval columns rather than summing them into an object.
        dataType: String(col.data_type || '').toLowerCase(),
      });
      continue;
    }

    dimensions.push({
      name: `${table}.${name}`,
      table,
      column: name,
      type: effectiveType ? effectiveType(table, name, col.data_type) : getColumnType(col.data_type),
      label: name,
    });
  }

  return { dimensions, measures };
}
