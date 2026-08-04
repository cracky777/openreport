// Join-graph classification helpers for the /query SQL compiler — extracted
// verbatim from routes/models.js. Pure functions of the model's join list; they
// decide which tables are "facts" (the many side) so a measure on a joined dim
// table gets the dim-only scalar-subquery treatment instead of inflating the
// aggregate through a fan-out join. Covered indirectly by tests/sqlSnapshotJoins
// (the multi-fact FULL JOIN shape depends on this classification).
const { extractColumnRefsFromExpression } = require('../columnTypeResolver');

// Fact tables = the "many" side of a join (cardinality "*", or the to_table when
// a join carries no cardinality hint) that is NOT itself a from_table.
function computeRealFacts(allJoins) {
  const list = Array.isArray(allJoins) ? allJoins : [];
  const fromTables = new Set();
  const manyTables = new Set();
  for (const j of list) {
    if (!j || !j.from_table || !j.to_table) continue;
    fromTables.add(j.from_table);
    const c = j.cardinality || {};
    if (c.to === '*' || (!c.from && !c.to)) manyTables.add(j.to_table);
    if (c.from === '*') manyTables.add(j.from_table);
  }
  return new Set([...manyTables].filter((t) => !fromTables.has(t)));
}

// Every table that participates in at least one join. The dim-only treatment
// only makes sense for a table reached THROUGH a join — a table that joins to
// nothing (single-table model) can't fan out, so its measures aggregate
// normally via GROUP BY rather than as an uncorrelated grand-total subquery.
function computeJoinedTables(allJoins) {
  const s = new Set();
  for (const j of (Array.isArray(allJoins) ? allJoins : [])) {
    if (j && j.from_table) s.add(j.from_table);
    if (j && j.to_table) s.add(j.to_table);
  }
  return s;
}

// Primary table for a measure — the dim table that owns its column. For a custom
// expression we accept the dim-only treatment only if every quoted column ref
// points at the SAME table; multi-table refs (or `${ref}` markers, which the
// inliner may expand across tables) need the join graph and stay on the regular
// path.
function measurePrimaryTable(m) {
  if (m.table) return m.table;
  if (m.aggregation === 'custom' && m.expression) {
    if (String(m.expression).includes('${')) return null;
    const refs = extractColumnRefsFromExpression(m.expression);
    const tables = new Set(refs.map((r) => r.table).filter(Boolean));
    if (tables.size === 1) return [...tables][0];
  }
  return null;
}

module.exports = { computeRealFacts, computeJoinedTables, measurePrimaryTable };
