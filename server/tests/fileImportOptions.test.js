// CSV parse options: the whitelisted tokens (delimiter, header, …) must reach
// DuckDB's read_csv. We probe the two most observable ones — a ';' separator and
// header on/off — via the shape of the resulting datasource.
const request = require('supertest');
const XLSX = require('xlsx');
const { buildApp, seedUser } = require('./helpers/testApp');

const app = buildApp();
const as = (uid) => (r) => r.set('x-test-user', uid);

// Build an in-memory .xlsx buffer from { sheetName: aoa } maps.
function xlsxBuffer(sheets) {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

describe('File import parse options', () => {
  test('semicolon delimiter, header off → both rows kept, split into 2 columns', async () => {
    const u = seedUser({ role: 'editor' });
    const res = await request(app).post('/api/upload').use(as(u))
      .field('delimiter', 'semicolon').field('hasHeader', 'false')
      .attach('file', Buffer.from('1;2\n3;4\n'), 'semi_noheader.csv');
    expect(res.status).toBe(201);
    expect(res.body.datasource.rowCount).toBe(2);       // no header row was consumed
    expect(res.body.datasource.columns.length).toBe(2); // ';' actually split the columns
  });

  test('auto delimiter (no token) detects a semicolon-separated file', async () => {
    // A forced delim=',' would sniff to a single column / fail; auto must split.
    const u = seedUser({ role: 'editor' });
    const res = await request(app).post('/api/upload').use(as(u))
      .attach('file', Buffer.from('a;b;c\n1;2;3\n4;5;6\n'), 'auto_semi.csv');
    expect(res.status).toBe(201);
    expect(res.body.datasource.columns.length).toBe(3);
  });

  test('full auto: a Latin-1 + semicolon file imports with no options at all', async () => {
    // 'coût' in Latin-1 has byte 0xFB (invalid UTF-8) → the UTF-8 attempt fails
    // and the Latin-1 fallback kicks in, while the delimiter is sniffed as ';'.
    const u = seedUser({ role: 'editor' });
    const res = await request(app).post('/api/upload').use(as(u))
      .attach('file', Buffer.from('ville;coût\nParis;12\nLyon;9\n', 'latin1'), 'fr.csv');
    expect(res.status).toBe(201);
    expect(res.body.datasource.rowCount).toBe(2);
    expect(res.body.datasource.columns.length).toBe(2);
  });

  test('semicolon delimiter, header on (default) → first row becomes the column names', async () => {
    const u = seedUser({ role: 'editor' });
    const res = await request(app).post('/api/upload').use(as(u))
      .field('delimiter', 'semicolon')
      .attach('file', Buffer.from('a;b\n1;2\n3;4\n'), 'semi_header.csv');
    expect(res.status).toBe(201);
    expect(res.body.datasource.rowCount).toBe(2);
    expect(res.body.datasource.columns.map((c) => c.column_name).sort()).toEqual(['a', 'b']);
  });

  test('Excel: two selected sheets become two tables', async () => {
    const u = seedUser({ role: 'editor' });
    const buf = xlsxBuffer({ Sales: [['a', 'b'], [1, 2], [3, 4]], Costs: [['x'], [9]] });
    const res = await request(app).post('/api/upload').use(as(u))
      .field('sheets', JSON.stringify(['Sales', 'Costs']))
      .attach('file', buf, 'book.xlsx');
    expect(res.status).toBe(201);
    expect(res.body.datasource.tables.map((t) => t.tableName).sort()).toEqual(['Costs', 'Sales']);
    const sales = res.body.datasource.tables.find((t) => t.tableName === 'Sales');
    expect(sales.rowCount).toBe(2); // header row consumed
    expect(sales.columns.map((c) => c.column_name).sort()).toEqual(['a', 'b']);
  });

  test('Excel: only the selected sheet is imported', async () => {
    const u = seedUser({ role: 'editor' });
    const buf = xlsxBuffer({ Keep: [['a'], [1]], Skip: [['b'], [2]] });
    const res = await request(app).post('/api/upload').use(as(u))
      .field('sheets', JSON.stringify(['Keep']))
      .attach('file', buf, 'pick.xlsx');
    expect(res.status).toBe(201);
    expect(res.body.datasource.tables.map((t) => t.tableName)).toEqual(['Keep']);
  });

  test('Excel: header off keeps the first row as data', async () => {
    const u = seedUser({ role: 'editor' });
    const buf = xlsxBuffer({ S: [['a', 'b'], [1, 2], [3, 4]] });
    const res = await request(app).post('/api/upload').use(as(u))
      .field('sheets', JSON.stringify(['S'])).field('hasHeader', 'false')
      .attach('file', buf, 'noheader.xlsx');
    expect(res.status).toBe(201);
    expect(res.body.datasource.tables[0].rowCount).toBe(3); // header row kept as data
  });
});

// SQLite files go through DuckDB's sqlite extension: every table becomes a
// DuckDB table, views are skipped, declared types survive the copy.
describe('SQLite import', () => {
  function sqliteBuffer(sql) {
    const Database = require('better-sqlite3');
    const mem = new Database(':memory:');
    mem.exec(sql);
    const buf = mem.serialize();
    mem.close();
    return buf;
  }

  test('every table becomes a DuckDB table, views are left out', async () => {
    const u = seedUser({ role: 'editor' });
    const buf = sqliteBuffer(`
      CREATE TABLE orders (id INTEGER PRIMARY KEY, amount REAL, label TEXT);
      INSERT INTO orders VALUES (1, 9.5, 'a'), (2, 3, 'b');
      CREATE TABLE "weird name" (x INTEGER);
      INSERT INTO "weird name" VALUES (7);
      CREATE VIEW v AS SELECT * FROM orders;
    `);
    const res = await request(app).post('/api/upload').use(as(u))
      .attach('file', buf, 'shop.db');
    expect(res.status).toBe(201);
    expect(res.body.datasource.tables.map((t) => t.tableName).sort()).toEqual(['orders', 'weird_name']);
    const orders = res.body.datasource.tables.find((t) => t.tableName === 'orders');
    expect(orders.rowCount).toBe(2);
    const types = Object.fromEntries(orders.columns.map((c) => [c.column_name, c.data_type]));
    expect(types.amount).toBe('DOUBLE'); // declared REAL, not coerced to text
    expect(types.label).toBe('VARCHAR');
  });

  test('a .db file that is not SQLite is rejected with a readable error', async () => {
    const u = seedUser({ role: 'editor' });
    const res = await request(app).post('/api/upload').use(as(u))
      .attach('file', Buffer.from('this is not a database'), 'notes.db');
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/not a SQLite database/);
  });

  test('an empty SQLite file is rejected', async () => {
    const u = seedUser({ role: 'editor' });
    const res = await request(app).post('/api/upload').use(as(u))
      .attach('file', sqliteBuffer('CREATE TABLE t (a INTEGER); DROP TABLE t;'), 'empty.sqlite');
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/no tables/);
  });
});

// DuckDB files are attached read-only and copied table by table; a table in a
// schema other than main keeps the schema as a prefix.
describe('DuckDB file import', () => {
  const os = require('os');
  const fs = require('fs');
  const path = require('path');
  // Written by a child process: the DuckDB binding keeps a file it has opened
  // locked for the life of the process, even after close(), so the bytes could
  // not be read back from here on Windows.
  function duckdbBuffer(sql) {
    const { execFileSync } = require('child_process');
    const file = path.join(os.tmpdir(), `or-test-${Date.now()}-${Math.random().toString(36).slice(2)}.duckdb`);
    const script = `
      const [file, sql] = process.argv.slice(1);
      require('duckdb-async').Database.create(file)
        .then((db) => db.run(sql).then(() => db.close()))
        .catch((e) => { console.error(e.message); process.exit(1); });
    `;
    execFileSync(process.execPath, ['-e', script, file, sql], { cwd: path.join(__dirname, '..'), stdio: 'pipe' });
    const buf = fs.readFileSync(file);
    try { fs.unlinkSync(file); } catch { /* temp file, harmless */ }
    return buf;
  }

  test('tables from main and from another schema are copied, views skipped', async () => {
    const u = seedUser({ role: 'editor' });
    const buf = await duckdbBuffer(`
      CREATE TABLE sales (id INTEGER, amount DOUBLE, day DATE);
      INSERT INTO sales VALUES (1, 9.5, '2024-01-02'), (2, 3, '2024-02-03');
      CREATE SCHEMA ref; CREATE TABLE ref.sales (code VARCHAR);
      INSERT INTO ref.sales VALUES ('x');
      CREATE VIEW v AS SELECT * FROM sales;
    `);
    const res = await request(app).post('/api/upload').use(as(u))
      .attach('file', buf, 'warehouse.duckdb');
    expect(res.status).toBe(201);
    expect(res.body.datasource.tables.map((t) => t.tableName).sort()).toEqual(['ref_sales', 'sales']);
    const sales = res.body.datasource.tables.find((t) => t.tableName === 'sales');
    expect(sales.rowCount).toBe(2);
    const types = Object.fromEntries(sales.columns.map((c) => [c.column_name, c.data_type]));
    expect(types.day).toBe('DATE'); // native types survive the copy
  });

  test('a .duckdb file that is not DuckDB is rejected with a readable error', async () => {
    const u = seedUser({ role: 'editor' });
    const res = await request(app).post('/api/upload').use(as(u))
      .attach('file', Buffer.from('definitely not a duckdb file, long enough to read the header'), 'fake.duckdb');
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/not a DuckDB database/);
  });
});
