/**
 * Model-row deserialiser.
 *
 * The `models` table stores six fields as JSON text columns:
 *   selected_tables  table_positions  dimensions
 *   measures         joins            rls          column_types
 *
 * Every consumer that fetches `SELECT * FROM models` has to walk those
 * columns through JSON.parse with hand-rolled fallbacks (`|| '[]'` /
 * `|| '{}'`) and the occasional try/catch (rollupBuilder.js does this
 * around each parse to survive malformed rows). 16+ near-duplicate
 * call sites across `routes/models.js`, `cloud/routes/models.js`,
 * and `utils/rollupBuilder.js` — every new JSON column would land in
 * all of them.
 *
 * `parseModel(row)` returns the row with every JSON column replaced by
 * its parsed value (arrays for the list-typed columns, objects for the
 * map-typed ones). Malformed/empty/null payloads fall back to the
 * type-appropriate empty value — same defensive behaviour as the prior
 * inline parses, but in one place.
 *
 * Pass-through for everything else: scalar columns (id, name, user_id,
 * datasource_id, date_column, organization_id, …) come back unchanged
 * so the consumer can keep treating `model.user_id` etc. like before.
 */

// JSON.parse that returns the supplied fallback for null / empty /
// malformed input. Also folds a successfully-parsed `null` to the
// fallback so callers don't have to null-check the parsed value either.
function safeParse(text, fallback) {
  if (text == null || text === '') return fallback;
  try {
    const parsed = JSON.parse(text);
    return parsed == null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function parseModel(row) {
  if (!row) return null;
  return {
    ...row,
    selected_tables: safeParse(row.selected_tables, []),
    table_positions: safeParse(row.table_positions, {}),
    dimensions:      safeParse(row.dimensions, []),
    measures:        safeParse(row.measures, []),
    joins:           safeParse(row.joins, []),
    rls:             safeParse(row.rls, {}),
    column_types:    safeParse(row.column_types, {}),
  };
}

module.exports = { parseModel, safeParse };
