const { extractColumnRefsFromExpression } = require('../columnTypeResolver');
const { firstAggregate } = require('./measureSortValue');

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Tables a dimension pulls into the query. A column dimension names its own
// table. A calculated dimension belongs to the table the author attached it
// to (its home table, where bare column names resolve), plus whatever other
// tables its SQL references — quoted "table"."column" as the editor inserts
// them, or unquoted `table.column`. Every table found here must reach
// `tablesUsed` before the FROM clause and the RLS reachability check are
// built: a table the expression touches but nobody registered would join in
// with no row filter.
//
// No bare-column matching here, unlike `expressionTables`: a calculated
// dimension always has a home table where bare names resolve, and over-joining
// a second fact table fans the numbers out silently, whereas a missed table
// fails loudly at the database.
function dimensionTables(dim, fields) {
  if (!dim) return [];
  if (!dim.expression) return dim.table ? [dim.table] : [];
  const text = String(dim.expression);
  const tables = new Set(extractColumnRefsFromExpression(text).map((r) => r.table));
  if (dim.table) tables.add(dim.table);
  for (const f of fields || []) {
    if (!f || !f.table || tables.has(f.table)) continue;
    if (new RegExp(`(^|[^\\w"])${escapeRe(f.table)}\\.`).test(text)) tables.add(f.table);
  }
  return [...tables];
}

// Tables a custom measure's (inlined) expression reads. Quoted "table"."column"
// refs and unquoted `table.column` refs name their table outright. A bare
// column name only counts when the expression quotes nothing at all: matched
// alongside quoted refs, `id_appel` also named the dimension and the SECOND
// fact table that own a column of that name, that fact was LEFT JOINed in, and
// every count and ratio on the first fact was multiplied by its rows.
function expressionTables(expression, fields) {
  const text = String(expression || '');
  const tables = new Set(extractColumnRefsFromExpression(text).map((r) => r.table));
  for (const f of fields || []) {
    if (!f || !f.table || tables.has(f.table)) continue;
    if (new RegExp(`(^|[^\\w"])${escapeRe(f.table)}\\.`).test(text)) tables.add(f.table);
  }
  if (tables.size === 0) {
    for (const f of fields || []) {
      if (!f || !f.table || !f.column || tables.has(f.table)) continue;
      if (new RegExp(`(^|[^\\w"])${escapeRe(f.column)}(?![\\w])`).test(text)) tables.add(f.table);
    }
  }
  return [...tables];
}

// A dimension is a row-level value: an aggregate inside it cannot be grouped
// by, and the database error that follows ("must appear in GROUP BY") names
// nothing the author recognises. Returns the offending call, or null.
function dimensionAggregate(dim) {
  return dim && dim.expression ? firstAggregate(dim.expression) : null;
}

// Tables a calculated dimension attached to `home` may read without
// multiplying its rows: each join is crossed from its many side to its one
// side only (a 1:1 join both ways), transitively — Power BI's RELATED. Reading
// the many side would repeat every home row once per child row, and a
// measure grouped by the dimension would be inflated by that fan-out. A join
// whose cardinality was never set is not crossed at all: guessing a direction
// here (as the fact detection does with its from=one → to=many convention)
// would silently open the fan-out the rule exists to prevent.
function readableTables(home, allJoins) {
  const reach = new Set([home]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const j of allJoins || []) {
      if (!j || !j.from_table || !j.to_table) continue;
      const c = j.cardinality || {};
      if (!c.from || !c.to) continue;
      const cross = (a, b, bMany) => {
        if (bMany || !reach.has(a) || reach.has(b)) return;
        reach.add(b);
        changed = true;
      };
      cross(j.from_table, j.to_table, c.to === '*');
      cross(j.to_table, j.from_table, c.from === '*');
    }
  }
  return reach;
}

// Joins that touch `table` and carry no cardinality — the reason a connected
// table may be unreadable for no fault of the model's shape.
function joinsWithoutCardinality(table, allJoins) {
  return (allJoins || []).filter((j) => j && (j.from_table === table || j.to_table === table)
    && !(j.cardinality && j.cardinality.from && j.cardinality.to));
}

// Every table a chain of joins connects to `home`, whatever the direction.
function connectedTables(home, allJoins) {
  const reach = new Set([home]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const j of allJoins || []) {
      if (!j || !j.from_table || !j.to_table) continue;
      for (const [a, b] of [[j.from_table, j.to_table], [j.to_table, j.from_table]]) {
        if (reach.has(a) && !reach.has(b)) { reach.add(b); changed = true; }
      }
    }
  }
  return reach;
}

// Tables the expression reads that its home table should not: `unjoined`
// has no join path at all, `noCardinality` sits behind a join whose
// cardinality was never set, `manySide` is reachable only through the many
// side of a join (the read that would fan the dimension out). All empty when
// the dimension is sound. A dimension without a home table is not checked —
// it predates the attachment and is handled by the FROM builder.
function fanOutTables(dim, fields, allJoins) {
  if (!dim || !dim.expression || !dim.table) return { unjoined: [], noCardinality: [], manySide: [] };
  const readable = readableTables(dim.table, allJoins);
  const connected = connectedTables(dim.table, allJoins);
  const foreign = dimensionTables(dim, fields).filter((t) => !readable.has(t));
  const unset = (t) => joinsWithoutCardinality(t, allJoins).length > 0 || joinsWithoutCardinality(dim.table, allJoins).length > 0;
  return {
    unjoined: foreign.filter((t) => !connected.has(t)),
    noCardinality: foreign.filter((t) => connected.has(t) && unset(t)),
    manySide: foreign.filter((t) => connected.has(t) && !unset(t)),
  };
}

module.exports = { dimensionTables, expressionTables, dimensionAggregate, readableTables, fanOutTables };
