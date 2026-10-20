// Relationships found for a model: declared foreign keys, and — asked for —
// key column names, pointed fact → dimension and kept free of loops and second
// paths (utils/relationships.js).
const { detectRelationships, calendarTableOf, tableBase, keyOf } = require('../utils/relationships');

const pairs = (joins) => joins.map((j) => `${j.from_table}.${j.from_column}>${j.to_table}.${j.to_column}`);

test('table and key names are read the way people write them', () => {
  expect(tableBase('dim_customers')).toBe('customer');
  expect(tableBase('sales.Categories')).toBe('category');
  expect(tableBase('fact_sales')).toBe('sale');
  const bases = new Set(['customer']);
  for (const c of ['customer_id', 'id_customer', 'fk_customer', 'CustomerID', 'customerid', 'fk_customer_id']) {
    expect(keyOf(c, bases)).toEqual({ base: 'customer' });
  }
  expect(keyOf('id', bases)).toEqual({ base: '' });
  expect(keyOf('amount', bases)).toBeNull();
  expect(keyOf('paid', bases)).toBeNull();
});

test('declared foreign keys between the model\'s tables become joins, many → one', () => {
  const r = detectRelationships({
    tables: ['orders', 'customers'],
    foreignKeys: [
      { table: 'orders', column: 'cust', refTable: 'customers', refColumn: 'id' },
      { table: 'orders', column: 'shop', refTable: 'shops', refColumn: 'id' }, // shops is not in the model
    ],
  });
  expect(pairs(r.joins)).toEqual(['orders.cust>customers.id']);
  expect(r.joins[0]).toMatchObject({ cardinality: { from: '*', to: '1' }, reason: 'foreign key' });
  expect(r.roles).toEqual({}); // keys alone set no role
});

test('by name: key columns find their table, roles follow for the tables that had none', () => {
  const r = detectRelationships({
    tables: ['fact_orders', 'dim_customers', 'products'],
    columns: {
      fact_orders: ['id', 'CustomerID', 'id_product', 'amount'],
      dim_customers: ['id', 'name'],
      products: ['product_id', 'label'],
    },
    byName: true,
  });
  expect(pairs(r.joins).sort()).toEqual([
    'fact_orders.CustomerID>dim_customers.id',
    'fact_orders.id_product>products.product_id',
  ]);
  expect(r.roles).toEqual({ fact_orders: 'fact', dim_customers: 'dimension', products: 'dimension' });
});

test('a bare id shared by every table joins nothing', () => {
  const r = detectRelationships({
    tables: ['a', 'b'], columns: { a: ['id', 'x'], b: ['id', 'y'] }, byName: true,
  });
  expect(r.joins).toEqual([]);
});

test('the same key naming no table joins fact → dimension, by roles', () => {
  const r = detectRelationships({
    tables: ['events', 'people'],
    columns: { events: ['person_id', 'at'], people: ['person_id', 'name'] },
    roles: { events: 'fact', people: 'dimension' },
    byName: true,
  });
  expect(pairs(r.joins)).toEqual(['events.person_id>people.person_id']);
  // Without roles, nothing says which way it points: nothing is added.
  expect(detectRelationships({
    tables: ['events', 'people'], columns: { events: ['person_id'], people: ['person_id'] }, byName: true,
  }).joins).toEqual([]);
});

test('no loop, no second path, never towards a fact; what is refused is said', () => {
  // a → b → c, then c → a would come back: refused.
  const loop = detectRelationships({
    tables: ['a', 'b', 'c'],
    columns: { a: ['id', 'b_id'], b: ['id', 'c_id'], c: ['id', 'a_id'] },
    byName: true,
  });
  expect(loop.joins).toHaveLength(2);
  expect(loop.skipped.map((s) => s.why)).toEqual(['it would make a loop of relations']);

  // sales → customer and sales → store → customer: two ways from sales to customer.
  const second = detectRelationships({
    tables: ['sales', 'stores', 'customers'],
    columns: { sales: ['customer_id', 'store_id'], stores: ['id', 'customer_id'], customers: ['id'] },
    byName: true,
  });
  expect(second.joins).toHaveLength(2);
  expect(second.skipped[0].why).toBe('it would open a second path between two tables');

  // Two facts: one never points at the other.
  const facts = detectRelationships({
    tables: ['orders', 'order_lines'],
    columns: { orders: ['id'], order_lines: ['order_id'] },
    roles: { orders: 'fact', order_lines: 'fact' },
    byName: true,
  });
  expect(facts.joins).toEqual([]);
  expect(facts.skipped[0].why).toBe('it would point at a fact table');
});

test('the joins already drawn stay, and a pair already joined is not joined again', () => {
  const existing = [{ from_table: 'orders', from_column: 'cust', to_table: 'customers', to_column: 'id', cardinality: { from: '*', to: '1' } }];
  const r = detectRelationships({
    tables: ['orders', 'customers'],
    columns: { orders: ['customer_id', 'cust'], customers: ['id'] },
    joins: existing,
    foreignKeys: [{ table: 'orders', column: 'cust', refTable: 'customers', refColumn: 'id' }],
    byName: true,
  });
  expect(r.joins).toEqual([]);
  expect(r.skipped).toEqual([]);
});

test('the calendar table is known by its name or by Date, Year and Month', () => {
  expect(calendarTableOf(['entries', 'calendar'], { entries: ['EcritureDate'], calendar: ['Date', 'Year', 'Month'] })).toEqual({ table: 'calendar', column: 'Date' });
  expect(calendarTableOf(['budget__dim_date'], { budget__dim_date: ['day_key', 'full_date'] })).toEqual({ table: 'budget__dim_date', column: 'full_date' });
  expect(calendarTableOf(['orders', 'customers'], { orders: ['order_date'], customers: ['id'] })).toBeNull();
});

test('by name: the date columns of the other tables point at the calendar, one join per table', () => {
  // The books' star already joins its entries to the calendar; the reshaped
  // budget linked to the model gets the same calendar, not one of its own.
  const existing = [{ from_table: 'entries', from_column: 'EcritureDate', to_table: 'calendar', to_column: 'Date', cardinality: { from: '*', to: '1' } }];
  const r = detectRelationships({
    tables: ['entries', 'calendar', 'accounts', 'bp__budget'],
    columns: {
      entries: ['EcritureDate', 'PieceDate', 'CompteNum', 'Amount'],
      calendar: ['Date', 'Year', 'Month'],
      accounts: ['CompteNum', 'CompteLib'],
      bp__budget: ['Compte', 'Date', 'ship_date', 'Amount'],
    },
    joins: existing,
    roles: { entries: 'fact', calendar: 'dimension', accounts: 'dimension' },
    byName: true,
  });
  expect(pairs(r.joins)).toEqual(['bp__budget.Date>calendar.Date']);
  expect(r.joins[0]).toMatchObject({ cardinality: { from: '*', to: '1' }, reason: 'date' });
  expect(r.roles).toEqual({ bp__budget: 'fact' });
  expect(r.skipped).toEqual([]);
});

describe('POST /datasources/:id/relationships', () => {
  const fs = require('fs');
  const path = require('path');
  const request = require('supertest');
  const { buildApp, seedUser, db } = require('./helpers/testApp');
  const { closeDuckDBFile, DUCKDB_DIR } = require('../utils/dbConnector');
  const app = buildApp();
  // The suite's own data dir, not server/data: one file per run used to pile up there.
  const file = path.join(DUCKDB_DIR, `relationships-${process.pid}.duckdb`);
  let user;
  let dsId;

  beforeAll(async () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    user = seedUser({ role: 'admin' });
    dsId = `rel-${process.pid}`;
    db.prepare("INSERT INTO datasources (id, user_id, name, db_type, host, port, db_name, db_user, db_password, extra_config) VALUES (?,?,?,'duckdb','',0,?,'','','{}')")
      .run(dsId, user, 'rel', file);
    // Written by another process, as every source file is: the server opens
    // them read-only (utils/fileImport.js).
    const ddl = [
      'CREATE TABLE customers (id INTEGER PRIMARY KEY, name VARCHAR)',
      'CREATE TABLE orders (id INTEGER, buyer INTEGER REFERENCES customers(id), product_id INTEGER)',
      'CREATE TABLE products (id INTEGER, label VARCHAR)',
    ];
    require('child_process').execFileSync(process.execPath, ['-e', `
      const duckdb = require(${JSON.stringify(require.resolve('duckdb-async'))});
      (async () => {
        const d = await duckdb.Database.create(${JSON.stringify(file)});
        for (const sql of ${JSON.stringify(ddl)}) await d.run(sql);
        await d.close();
      })();`]);
  });
  afterAll(async () => {
    await closeDuckDBFile(file);
    try { fs.unlinkSync(file); } catch { /* already gone */ }
  });

  const post = (body) => request(app).post(`/api/datasources/${dsId}/relationships`).set('x-test-user', user).send(body);
  const body = {
    tables: ['customers', 'orders', 'products'],
    columns: { customers: ['id', 'name'], orders: ['id', 'buyer', 'product_id'], products: ['id', 'label'] },
    joins: [],
    roles: {},
  };

  test('reads the keys the database declares; names only when asked', async () => {
    const keys = await post(body);
    expect(keys.status).toBe(200);
    expect(keys.body.keysRead).toBe(true);
    expect(pairs(keys.body.joins)).toEqual(['orders.buyer>customers.id']);

    const both = await post({ ...body, byName: true });
    expect(pairs(both.body.joins).sort()).toEqual(['orders.buyer>customers.id', 'orders.product_id>products.id']);
    expect(both.body.roles).toEqual({ orders: 'fact', customers: 'dimension', products: 'dimension' });
  });

  test('refuses what is not the model\'s shape', async () => {
    expect((await post({ ...body, tables: 'orders' })).status).toBe(400);
    expect((await post({ ...body, roles: { orders: 'boss' } })).status).toBe(400);
    expect((await post({ ...body, joins: [{ from_table: 'orders' }] })).status).toBe(400);
  });
});

describe('identifiers shared by two files', () => {
  test('a sku in a stock file and in its thresholds: the thresholds are the dimension', () => {
    const found = detectRelationships({
      tables: ['mouvements', 'seuils__seuils'],
      columns: { mouvements: ['date', 'entrepot', 'sku', 'stock'], seuils__seuils: ['sku', 'stock_minimum'] },
      byName: true,
    });
    expect(found.joins.map((j) => `${j.from_table}.${j.from_column}>${j.to_table}.${j.to_column}`)).toEqual(['mouvements.sku>seuils__seuils.sku']);
    expect(found.roles).toEqual({ mouvements: 'fact', seuils__seuils: 'dimension' });
  });
  test('a column named as the other file is about: client → the clients file', () => {
    const found = detectRelationships({
      tables: ['activites', 'clients__clients'],
      columns: { activites: ['date', 'client', 'canal', 'rdv_pris'], clients__clients: ['client', 'forfait_mensuel_eur'] },
      byName: true,
    });
    expect(found.joins.map((j) => `${j.from_table}.${j.from_column}>${j.to_table}.${j.to_column}`)).toEqual(['activites.client>clients__clients.client']);
    expect(found.roles).toEqual({ activites: 'fact', clients__clients: 'dimension' });
  });
  test('a table named by a noun and its qualifier is about its first word when that is its first column', () => {
    const found = detectRelationships({
      tables: ['demandes_credit', 'agences_bancaires__agences_bancaires'],
      columns: { demandes_credit: ['dossier_id', 'agence', 'montant'], agences_bancaires__agences_bancaires: ['agence', 'objectif'] },
      byName: true,
    });
    expect(found.joins.map((j) => `${j.from_table}.${j.from_column}>${j.to_table}.${j.to_column}`)).toEqual(['demandes_credit.agence>agences_bancaires__agences_bancaires.agence']);
    expect(found.roles).toEqual({ demandes_credit: 'fact', agences_bancaires__agences_bancaires: 'dimension' });
    // An order table is not the customers' table for opening on an order id.
    expect(detectRelationships({
      tables: ['sales', 'customer_orders'],
      columns: { sales: ['customer', 'amount'], customer_orders: ['order_id', 'customer'] },
      byName: true,
    }).joins).toEqual([]);
  });
  test('a shared column that names nothing is no key', () => {
    expect(detectRelationships({ tables: ['a', 'b'], columns: { a: ['region', 'x'], b: ['date', 'region'] }, byName: true }).joins).toEqual([]);
  });
});

describe('a table named by a noun and its qualifier, opening on its key', () => {
  test('ticket lines join the till tickets on ticket_id', () => {
    const found = detectRelationships({
      tables: ['tickets_caisse', 'lignes_tickets__lignes_tickets'],
      columns: { tickets_caisse: ['ticket_id', 'date', 'montant'], lignes_tickets__lignes_tickets: ['ticket_id', 'produit', 'quantite'] },
      byName: true,
    });
    expect(found.joins.map((j) => `${j.from_table}.${j.from_column}>${j.to_table}.${j.to_column}`)).toEqual(['lignes_tickets__lignes_tickets.ticket_id>tickets_caisse.ticket_id']);
  });
});
