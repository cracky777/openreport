// Deleting an imported source deletes its DuckDB file. Before, the row went and
// the file stayed: the data of a "deleted" source was still on disk, and every
// deletion or re-import left one more behind (3172 of them, 1.2 GB, on a dev
// instance). A file Windows still holds is written down and retried.
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const { buildApp, seedUser } = require('./helpers/testApp');
const db = require('../db');
const { retireDuckDBFile, retryPending } = require('../utils/duckdbFiles');
const { DUCKDB_DIR } = require('../utils/dbConnector');

const app = buildApp();
const as = (uid) => (r) => r.set('x-test-user', uid);

// Deleted now — or, where Windows still holds a file DuckDB wrote in this
// process (it lets go only when the handle is collected), written down for the
// retry at the next start. Either way it is not left behind for good.
const pending = (file) => !!db.prepare('SELECT 1 FROM pending_file_deletions WHERE path = ?').get(path.resolve(file));
const retired = async (file) => {
  for (let i = 0; i < 40; i += 1) {
    if (!fs.existsSync(file) || pending(file)) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
};

async function importCsv(u, name) {
  const res = await request(app).post('/api/upload').use(as(u))
    .attach('file', Buffer.from('a,b\n1,2\n3,4\n'), `${name}.csv`);
  expect(res.status).toBe(201);
  return res.body.datasource;
}

describe('DuckDB files of imported sources', () => {
  test('deleting an imported source deletes its file', async () => {
    const u = seedUser({ role: 'editor' });
    const ds = await importCsv(u, `retire-${Date.now()}`);
    expect(fs.existsSync(ds.db_name)).toBe(true);

    expect((await request(app).delete(`/api/datasources/${ds.id}`).use(as(u))).status).toBe(200);
    expect(await retired(ds.db_name)).toBe(true);
    if (!pending(ds.db_name)) expect(fs.existsSync(`${ds.db_name}.wal`)).toBe(false);
  });

  test('deleting a user deletes the files of the sources that go with them', async () => {
    const admin = seedUser({ role: 'admin' });
    const u = seedUser({ role: 'editor' });
    const ds = await importCsv(u, `leaver-${Date.now()}`);
    expect((await request(app).delete(`/api/admin/users/${u}`).use(as(admin))).status).toBe(200);
    expect(db.prepare('SELECT 1 FROM datasources WHERE id = ?').get(ds.id)).toBeUndefined();
    expect(await retired(ds.db_name)).toBe(true);
  });

  test('a file that cannot be deleted yet is retried until it goes', async () => {
    // A file no DuckDB instance ever opened: only the simulated refusal holds it.
    fs.mkdirSync(DUCKDB_DIR, { recursive: true });
    const ds = { db_name: path.join(DUCKDB_DIR, `held-${Date.now()}.duckdb`) };
    fs.writeFileSync(ds.db_name, 'x');

    // What Windows answers while DuckDB still holds the file.
    const real = fs.rmSync;
    const spy = jest.spyOn(fs, 'rmSync').mockImplementation((f, o) => {
      if (String(f) === path.resolve(ds.db_name)) { const e = new Error('busy'); e.code = 'EBUSY'; throw e; }
      return real(f, o);
    });
    await retireDuckDBFile(ds.db_name);
    spy.mockRestore();

    expect(fs.existsSync(ds.db_name)).toBe(true);
    expect(db.prepare('SELECT 1 FROM pending_file_deletions WHERE path = ?').get(path.resolve(ds.db_name))).toBeTruthy();

    retryPending();
    expect(fs.existsSync(ds.db_name)).toBe(false);
    expect(db.prepare('SELECT 1 FROM pending_file_deletions WHERE path = ?').get(path.resolve(ds.db_name))).toBeUndefined();
  });

  test('a file a source still names, or outside the managed directory, is never touched', async () => {
    const u = seedUser({ role: 'editor' });
    const ds = await importCsv(u, `kept-${Date.now()}`);
    // Written down by mistake while still in use: the retry drops the entry, not the file.
    db.prepare('INSERT OR IGNORE INTO pending_file_deletions (path) VALUES (?)').run(path.resolve(ds.db_name));
    retryPending();
    expect(fs.existsSync(ds.db_name)).toBe(true);
    expect(db.prepare('SELECT 1 FROM pending_file_deletions WHERE path = ?').get(path.resolve(ds.db_name))).toBeUndefined();

    const outside = path.join(os.tmpdir(), `not-ours-${Date.now()}.duckdb`);
    fs.writeFileSync(outside, 'x');
    await retireDuckDBFile(outside);
    expect(fs.existsSync(outside)).toBe(true);
    fs.rmSync(outside, { force: true });

    await request(app).delete(`/api/datasources/${ds.id}`).use(as(u));
    await retired(ds.db_name);
  });
});
