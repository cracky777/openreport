// Relationships found for a model's tables, from the keys the database
// declares and — asked for — from column names (customer_id, id_customer,
// fk_customer, CustomerID → the customer table's id/pk). Every one points from
// the many side to the one side, fact → dimension, and goes through the rules
// every set of joins keeps (utils/joinChecks.js): no loop, no second way
// between two tables, one join per pair. What does not pass is reported, not
// added. Names only: nothing here reads a row.

const { makesLoop, secondPath, joinedPair } = require('./joinChecks');

const MARKERS = new Set(['id', 'pk', 'fk']);
const TABLE_AFFIXES = /^(dim|fact|fct|tbl)_|_(dim|fact|fct)$/g;

// "CustomerID" → ['customer', 'id']; "fk_customer_id" → ['fk', 'customer', 'id'].
const words = (name) => String(name)
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
  .toLowerCase()
  .split(/[^a-z0-9]+/)
  .filter(Boolean);

const singular = (w) => {
  if (w.endsWith('ies') && w.length > 4) return `${w.slice(0, -3)}y`;
  if (/(ss|us|is)$/.test(w)) return w;
  if (w.endsWith('s') && w.length > 3) return w.slice(0, -1);
  return w;
};

// What a table is about: "sales.dim_customers" → "customer". A table of a
// file linked to the model ("ventes__dim_customers") is about the same thing.
function tableBase(table) {
  const bare = String(table).split('.').pop().split('__').pop().toLowerCase().replace(TABLE_AFFIXES, '');
  const ws = words(bare);
  if (!ws.length) return '';
  ws[ws.length - 1] = singular(ws[ws.length - 1]);
  return ws.join('_');
}

// A key column and what it names: "customer_id" → { base: 'customer' };
// "id" → { base: '' }; "amount" → null. A name written in one piece
// ("customerid") only counts when what is left names a table (`bases`).
function keyOf(column, bases) {
  const ws = words(column);
  if (!ws.length) return null;
  if (ws.some((w) => MARKERS.has(w))) {
    const rest = ws.filter((w) => !MARKERS.has(w));
    if (rest.length) rest[rest.length - 1] = singular(rest[rest.length - 1]);
    return { base: rest.join('_') };
  }
  if (ws.length === 1) {
    const m = /^(id|pk|fk)?(.+?)(id|pk|fk)?$/.exec(ws[0]);
    if (m && (m[1] || m[3]) && bases.has(singular(m[2]))) return { base: singular(m[2]) };
  }
  return null;
}

const join = (from, fromColumn, to, toColumn, reason) => ({
  from_table: from, from_column: fromColumn, to_table: to, to_column: toColumn,
  cardinality: { from: '*', to: '1' }, reason,
});

// The column of `table` another one points at with `column`: the same name,
// else its id / pk, else a key naming the table itself.
function targetColumn(table, column, columns, bases) {
  const cols = columns[table] || [];
  if (cols.includes(column)) return column;
  const plain = cols.find((c) => { const ws = words(c); return ws.length === 1 && MARKERS.has(ws[0]); });
  if (plain) return plain;
  return cols.find((c) => { const k = keyOf(c, bases); return k && k.base === tableBase(table); }) || null;
}

function byNames(tables, columns) {
  const bases = new Set(tables.map(tableBase));
  const byBase = new Map();
  for (const t of tables) {
    const b = tableBase(t);
    if (!byBase.has(b)) byBase.set(b, []);
    byBase.get(b).push(t);
  }
  const references = [];
  const shared = [];
  for (const a of tables) {
    for (const c of columns[a] || []) {
      const key = keyOf(c, bases);
      if (!key) continue;
      // A key naming a table points at it — never at itself.
      if (key.base && key.base !== tableBase(a)) {
        for (const b of byBase.get(key.base) || []) {
          const to = targetColumn(b, c, columns, bases);
          if (to) references.push(join(a, c, b, to, 'names'));
        }
      }
      // The same key column (naming something: never a bare id) in two tables,
      // naming none of them: which way it points is left to the roles.
      for (const b of tables) {
        if (key.base && b !== a && a < b && (columns[b] || []).includes(c) && !byBase.has(key.base)) shared.push({ a, b, column: c });
      }
    }
  }
  return { references, shared };
}

// A table that only receives joins describes things (dimension); one that only
// points at others records events (fact); one that does both is a dimension of
// a snowflake. Only for the tables that have no role yet.
function inferRoles(tables, joins, roles) {
  const inferred = {};
  for (const t of tables) {
    if (roles[t]) continue;
    const out = joins.some((j) => j.from_table === t);
    const into = joins.some((j) => j.to_table === t);
    if (into) inferred[t] = 'dimension';
    else if (out) inferred[t] = 'fact';
  }
  return inferred;
}

function detectRelationships({ tables, columns = {}, foreignKeys = [], joins = [], roles = {}, byName = false }) {
  const inModel = new Set(tables);
  const hasColumn = (t, c) => !columns[t] || columns[t].includes(c);
  const candidates = foreignKeys
    .filter((k) => inModel.has(k.table) && inModel.has(k.refTable) && hasColumn(k.table, k.column) && hasColumn(k.refTable, k.refColumn))
    .map((k) => join(k.table, k.column, k.refTable, k.refColumn, 'foreign key'));

  let found = { references: [], shared: [] };
  if (byName) {
    found = byNames(tables, columns);
    candidates.push(...found.references);
  }

  const inferred = byName ? inferRoles(tables, [...joins, ...candidates], roles) : {};
  const role = (t) => roles[t] || inferred[t];
  for (const { a, b, column } of found.shared) {
    if (role(a) === 'fact' && role(b) === 'dimension') candidates.push(join(a, column, b, column, 'names'));
    else if (role(b) === 'fact' && role(a) === 'dimension') candidates.push(join(b, column, a, column, 'names'));
  }

  const current = [...joins];
  const added = [];
  const skipped = [];
  for (const cand of candidates) {
    const skip = (why) => skipped.push({ ...cand, why });
    if (cand.from_table === cand.to_table) continue;
    if (joinedPair(current, cand.from_table, cand.to_table)) continue;
    // A fact on the one side would repeat every row of what points at it.
    if (role(cand.to_table) === 'fact') { skip('it would point at a fact table'); continue; }
    if (makesLoop(current, cand)) { skip('it would make a loop of relations'); continue; }
    if (secondPath([...current, cand])) { skip('it would open a second path between two tables'); continue; }
    current.push(cand);
    added.push(cand);
  }

  // Roles are only proposed for the tables the added joins actually touch.
  const touched = new Set(added.flatMap((j) => [j.from_table, j.to_table]));
  const proposedRoles = Object.fromEntries(Object.entries(inferred).filter(([t]) => touched.has(t)));
  return { joins: added, roles: proposedRoles, skipped };
}

module.exports = { detectRelationships, tableBase, keyOf };
