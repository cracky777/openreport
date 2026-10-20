// Relationships found for a model's tables, from the keys the database
// declares and — asked for — from column names (customer_id, id_customer,
// fk_customer, CustomerID → the customer table's id/pk). Every one points from
// the many side to the one side, fact → dimension, and goes through the rules
// every set of joins keeps (utils/joinChecks.js): no loop, no second way
// between two tables, one join per pair. What does not pass is reported, not
// added. Names only: nothing here reads a row. Dates too: a calendar table
// (named so, or holding Date, Year and Month) is what every date column of
// the other tables points at — one calendar per model, shared by its facts.

const { makesLoop, secondPath, joinedPair } = require('./joinChecks');

const MARKERS = new Set(['id', 'pk', 'fk']);
// Codes that identify a thing by themselves: `sku` in a stock file and in its
// reorder thresholds is the product (Karim's two files did not join).
const IDENTIFIERS = new Set(['sku', 'ean', 'gtin', 'upc', 'isbn', 'siren', 'siret', 'iban', 'imei', 'vin']);
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
  if (ws.length === 1 && IDENTIFIERS.has(ws[0])) return { base: ws[0] };
  // A column named as a table is about ("client" next to a clients file) is
  // its key: Léa's activities and her clients' fees did not join.
  if (ws.length === 1 && bases.has(singular(ws[0]))) return { base: singular(ws[0]) };
  if (ws.length === 1) {
    const m = /^(id|pk|fk)?(.+?)(id|pk|fk)?$/.exec(ws[0]);
    if (m && (m[1] || m[3]) && bases.has(singular(m[2]))) return { base: singular(m[2]) };
  }
  return null;
}

const CALENDAR_BASES = new Set(['calendar', 'calendrier', 'date', 'time', 'day', 'period']);
const isDateWord = (w) => w === 'date' || w === 'day' || w === 'jour';
// A column holding a date, by its name: Date, EcritureDate, order_date, day
// — not a key that names one (date_key, day_id).
const dateColumn = (c) => { const ws = words(c); return ws.some(isDateWord) && !ws.some((w) => MARKERS.has(w) || w === 'key'); };

// The model's calendar table and its key, or null: a table named as one that
// has a date column, or one carrying Date, Year and Month (what the import
// of books and a file's `calendar` step write). The first found; exact
// `date` is the key when there is one.
function calendarTableOf(tables, columns) {
  for (const t of tables) {
    const cols = columns[t] || [];
    const lower = new Set(cols.map((c) => String(c).toLowerCase()));
    const named = CALENDAR_BASES.has(tableBase(t));
    const shaped = lower.has('date') && lower.has('year') && lower.has('month');
    if (!named && !shaped) continue;
    const key = cols.find((c) => String(c).toLowerCase() === 'date') || cols.find(dateColumn);
    if (key) return { table: t, column: key };
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

// A table named by a noun and its qualifier ("agences_bancaires": the
// branches) is also about its first word, when that is its first column: the
// requests' "agence" did not join Crédit Ardent's branches; or its key
// (tickets_caisse opens on ticket_id: Maison Gaspard's lines found no ticket).
// Never a table whose first column says otherwise (customer_orders opens on
// an order id).
function headBase(table, columns) {
  const ws = words(String(table).split('.').pop().split('__').pop().toLowerCase().replace(TABLE_AFFIXES, ''));
  const first = (columns[table] || [])[0];
  if (ws.length < 2 || !first) return null;
  const head = singular(ws[0]);
  const col = words(first);
  if (col.length === 1) return singular(col[0]) === head ? head : null;
  const key = keyOf(first, new Set([head]));
  return key && key.base === head ? head : null;
}

function byNames(tables, columns) {
  const bases = new Set(tables.map(tableBase));
  const byBase = new Map();
  for (const t of tables) {
    const b = tableBase(t);
    if (!byBase.has(b)) byBase.set(b, []);
    byBase.get(b).push(t);
  }
  for (const t of tables) {
    const head = headBase(t, columns);
    if (!head || bases.has(head)) continue;
    bases.add(head);
    byBase.set(head, [t]);
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
          if (b === a) continue;
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
  // Dates: the first date column of each other table points at the calendar
  // (exact `date` first; a second date column of the same table is left
  // out — one join per pair).
  const calendar = calendarTableOf(tables, columns);
  if (calendar) {
    for (const a of tables) {
      if (a === calendar.table) continue;
      const cols = columns[a] || [];
      const c = cols.find((x) => String(x).toLowerCase() === 'date') || cols.find(dateColumn);
      if (c) references.push(join(a, c, calendar.table, calendar.column, 'date'));
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
  // A table listing things starts with their key: with no role to go by, the
  // table whose first column is the shared key is the dimension.
  const leads = (t, c) => (columns[t] || [])[0] === c;
  const lookup = (fact, dim, c) => leads(dim, c) && !leads(fact, c) && role(fact) !== 'dimension' && role(dim) !== 'fact';
  for (const { a, b, column } of found.shared) {
    let pair = null;
    if (role(a) === 'fact' && role(b) === 'dimension') pair = [a, b];
    else if (role(b) === 'fact' && role(a) === 'dimension') pair = [b, a];
    else if (lookup(a, b, column)) pair = [a, b];
    else if (lookup(b, a, column)) pair = [b, a];
    if (!pair) continue;
    candidates.push(join(pair[0], column, pair[1], column, 'names'));
    if (!role(pair[0])) inferred[pair[0]] = 'fact';
    if (!role(pair[1])) inferred[pair[1]] = 'dimension';
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

module.exports = { detectRelationships, calendarTableOf, tableBase, keyOf };
