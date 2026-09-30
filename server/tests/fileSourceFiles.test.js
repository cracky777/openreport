// Refreshing an imported source writes a new version of its file (in a child
// process, utils/fileImport.js) and switches the source to it. One file is one
// source; a source imported before that rule can still hold several files, and
// refreshing one of them replaces that file's tables and nothing else.
const request = require('supertest');

// Every import runs in a child process (utils/fileImport.js): under a full
// parallel run, the default 5 s is short.
jest.setTimeout(30000);
const { buildApp, seedUser, seedDatasource, seedWorkspace, db } = require('./helpers/testApp');

const app = buildApp();
const as = (uid) => (r) => r.set('x-test-user', uid);

async function importFile(uid, name, content, fields = {}) {
  let req = request(app).post('/api/upload').use(as(uid));
  for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
  const res = await req.attach('file', Buffer.from(content), name);
  expect(res.status).toBe(201);
  return res.body.datasource.id;
}
const count = async (uid, id, table) => {
  const res = await request(app).post(`/api/datasources/${id}/query`).use(as(uid)).send({ sql: `SELECT COUNT(*) AS n FROM "${table}"` });
  expect(res.status).toBe(200);
  return Number(res.body.rows[0].n);
};
const extraOf = (id) => JSON.parse(db.prepare('SELECT extra_config FROM datasources WHERE id = ?').get(id).extra_config);
const refresh = (uid, id, name, content, fields = {}) => {
  let req = request(app).put(`/api/upload/${id}`).use(as(uid));
  for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
  return req.attach('file', Buffer.from(content), name);
};

// A source of two files, as imports made them before "one file, one source":
// a workbook's two sheets, described as two files.
async function twoFileSource(u) {
  const XLSX = require('xlsx');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['id'], [1], [2]]), 'orders');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['customer_id'], [10]]), 'customers');
  const res = await request(app).post('/api/upload').use(as(u))
    .field('sheets', JSON.stringify(['orders', 'customers']))
    .attach('file', XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), 'legacy.xlsx');
  const id = res.body.datasource.id;
  const extra = extraOf(id);
  extra.files = [
    { sourceFile: 'orders.csv', tables: [{ tableName: 'orders', rowCount: 2 }] },
    { sourceFile: 'customers.csv', tables: [{ tableName: 'customers', rowCount: 1 }] },
  ];
  db.prepare('UPDATE datasources SET extra_config = ? WHERE id = ?').run(JSON.stringify(extra), id);
  return id;
}

describe('Refreshing an imported source', () => {
  test('a new export under another name keeps the table models know', async () => {
    const u = seedUser({ role: 'editor' });
    const id = await importFile(u, 'stock.csv', 'q\n1\n');
    const before = db.prepare('SELECT db_name FROM datasources WHERE id = ?').get(id).db_name;
    const res = await refresh(u, id, 'stock_2026_10.csv', 'q\n1\n2\n');
    expect(res.status).toBe(200);
    expect(res.body.missingTables).toEqual([]);
    expect(await count(u, id, 'stock')).toBe(2);
    // A new version of the file, the previous one retired.
    expect(db.prepare('SELECT db_name FROM datasources WHERE id = ?').get(id).db_name).not.toBe(before);
  });

  test('one file of several: named, and the others are kept', async () => {
    const u = seedUser({ role: 'editor' });
    const id = await twoFileSource(u);
    expect((await refresh(u, id, 'orders.csv', 'id\n1\n')).status).toBe(400);

    const res = await refresh(u, id, 'customers_2026_10.csv', 'customer_id\n10\n20\n30\n', { sourceFile: 'customers.csv' });
    expect(res.status).toBe(200);
    expect(await count(u, id, 'customers')).toBe(3);
    expect(await count(u, id, 'orders')).toBe(2);
    expect(extraOf(id).files.map((f) => f.sourceFile)).toEqual(['orders.csv', 'customers_2026_10.csv']);
  });

  test('a file that fails to parse leaves the source as it was', async () => {
    const u = seedUser({ role: 'editor' });
    const id = await importFile(u, 'fine.csv', 'q\n1\n');
    const before = db.prepare('SELECT db_name FROM datasources WHERE id = ?').get(id).db_name;
    const res = await refresh(u, id, 'broken.duckdb', 'not a database');
    expect(res.status).toBe(500);
    expect(db.prepare('SELECT db_name FROM datasources WHERE id = ?').get(id).db_name).toBe(before);
    expect(await count(u, id, 'fine')).toBe(1);
  });

  test('refreshing takes a manager of the source', async () => {
    const owner = seedUser({ role: 'editor' });
    const editor = seedUser({ role: 'editor' });
    const ws = seedWorkspace({ ownerId: owner, name: 'Team' });
    db.prepare('INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)').run(ws, editor, 'editor');
    const id = await importFile(owner, 'team.csv', 'a\n1\n', { workspaceId: ws });
    expect((await refresh(editor, id, 'team.csv', 'a\n1\n2\n')).status).toBe(403);
  });

  test('a live connection takes no file', async () => {
    const u = seedUser({ role: 'editor' });
    expect((await refresh(u, seedDatasource({ userId: u }), 'x.csv', 'a\n1\n')).status).toBe(400);
  });

  // Source files are served read-only, but a DuckDB connection without a file
  // runs in memory — and DuckDB crashes the process when asked for an
  // in-memory database in read-only mode.
  test('a DuckDB connection without a file still answers', async () => {
    const { createConnection } = require('../utils/dbConnector');
    const conn = createConnection({ db_type: 'duckdb', db_name: '' });
    expect(await conn.query('SELECT 42 AS x')).toEqual([{ x: 42 }]);
  });

  // Imports run in a child process: the instance serving a source reads no file
  // at all — not the server's, not another source's database.
  test('a query reads no file of the server', async () => {
    const path = require('path');
    const u = seedUser({ role: 'editor' });
    const a = await importFile(u, 'a.csv', 'x\n1\n');
    const b = await importFile(u, 'b.csv', 'secret\n42\n');
    const bFile = db.prepare('SELECT db_name FROM datasources WHERE id = ?').get(b).db_name;
    const fwd = (p) => p.split(path.sep).join('/');
    const reads = [
      `SELECT * FROM read_csv('${fwd(path.join(__dirname, '..', 'package.json'))}')`,
      `SELECT * FROM read_text('${fwd(bFile)}')`,
      `SELECT * FROM glob('${fwd(path.dirname(bFile))}/*')`,
    ];
    for (const sql of reads) {
      const res = await request(app).post(`/api/datasources/${a}/query`).use(as(u)).send({ sql });
      // Refused — DuckDB's wording varies, what matters is that no row came back.
      expect(res.status).toBe(500);
      expect(res.body.rows).toBeUndefined();
    }
  });
});
