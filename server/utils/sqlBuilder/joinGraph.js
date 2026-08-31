// Join-graph classification helpers for the /query SQL compiler — extracted
// verbatim from routes/models.js. Pure functions of the model's join list; they
// decide which tables are "facts" (the many side) so a measure on a joined dim
// table gets the dim-only scalar-subquery treatment instead of inflating the
// aggregate through a fan-out join. Covered indirectly by tests/sqlSnapshotJoins
// (the multi-fact FULL JOIN shape depends on this classification).
const { extractColumnRefsFromExpression } = require('../columnTypeResolver');

// Fact tables = a "many" side ("*") that is NEVER a "one" side. A measure on a
// fact aggregates through its join (it IS the grain); a measure on a pure dim
// (one-side) would fan out, so it gets the scalar-subquery treatment instead.
//
// The many/one sets are read from explicit cardinality; a join with no hint is
// assumed from=one → to=many (the historical default). Excluding one-side tables
// (rather than every from_table) is what lets an EXPLICIT fact defined as
// `fact.fk (*) → dim.pk (1)` — i.e. the fact is the from_table — still count as a
// fact, while snowflake bridge tables (which ARE a one-side somewhere) stay dims.
//
// A "1" only demotes a table when it faces a "*". The set exists to name the
// tables a join would FAN OUT, and a 1:1 join fans out nothing: read literally,
// a single `fact (1) → detail (1)` relation stripped the fact of its status,
// every measure on it fell through to the dim-only grand total, and each row of
// the visual showed the same number. One such join in a model was enough to flatten
// every other one.
function computeRealFacts(allJoins) {
  const list = Array.isArray(allJoins) ? allJoins : [];
  const many = new Set();
  const one = new Set();
  for (const j of list) {
    if (!j || !j.from_table || !j.to_table) continue;
    const c = j.cardinality || {};
    if (c.from === '*') many.add(j.from_table);
    if (c.to === '*') many.add(j.to_table);
    if (c.from === '1' && c.to === '*') one.add(j.from_table);
    if (c.to === '1' && c.from === '*') one.add(j.to_table);
    if (!c.from && !c.to) { many.add(j.to_table); one.add(j.from_table); }
  }
  return new Set([...many].filter((t) => !one.has(t)));
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

// Connected components of the join graph (union-find). Two tables share a
// component iff a chain of joins connects them. Tables that appear in no join
// are absent from the map — `sameComponent` treats an absent table as its own
// singleton, so an unjoined table is connected only to itself.
function computeConnectedComponents(allJoins) {
  const parent = new Map();
  const find = (x) => {
    if (!parent.has(x)) parent.set(x, x);
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root);
    let cur = x;
    while (parent.get(cur) !== root) { const nxt = parent.get(cur); parent.set(cur, root); cur = nxt; }
    return root;
  };
  for (const j of (Array.isArray(allJoins) ? allJoins : [])) {
    if (j && j.from_table && j.to_table) parent.set(find(j.from_table), find(j.to_table));
  }
  const comp = new Map();
  for (const t of parent.keys()) comp.set(t, find(t));
  return comp;
}

// Are two tables in the same join component? An absent table is its own
// singleton (unjoined → connected only to itself).
function sameComponent(comp, a, b) {
  return (comp.get(a) || a) === (comp.get(b) || b);
}

module.exports = { computeRealFacts, computeJoinedTables, measurePrimaryTable, computeConnectedComponents, sameComponent };
