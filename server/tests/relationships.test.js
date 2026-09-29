// Relationships found for a model: declared foreign keys, and — asked for —
// key column names, pointed fact → dimension and kept free of loops and second
// paths (utils/relationships.js).
const { detectRelationships, tableBase, keyOf } = require('../utils/relationships');

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

describe('POST /datasources/:id/relationships', () => {
  const fs = require('fs');
  const path = require('path');
  const request = require('supertest');
  const { buildApp, seedUser, db } = require('./helpers/testApp');
  const { createConnection, closeDuckDBFile, DUCKDB_DIR } = require('../utils/dbConnector');
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
    const conn = createConnection(db.prepare('SELECT * FROM datasources WHERE id = ?').get(dsId));
    await conn.executeDDL('CREATE TABLE customers (id INTEGER PRIMARY KEY, name VARCHAR)');
    await conn.executeDDL('CREATE TABLE orders (id INTEGER, buyer INTEGER REFERENCES customers(id), product_id INTEGER)');
    await conn.executeDDL('CREATE TABLE products (id INTEGER, label VARCHAR)');
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
