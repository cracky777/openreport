const path = require('path');
const fs = require('fs');

// Embedded DuckDB store for materialised rollup tables. One file per app
// instance, shared by every model whose datasource is configured for
// `rollup_storage = 'duckdb'` (the default). Lives in the same data dir
// as the metadata SQLite DB so a single Docker volume covers both.
const ROLLUP_DB_PATH = process.env.ROLLUP_DUCKDB_PATH
  || path.join(__dirname, '..', 'data', 'rollups.duckdb');

const dataDir = path.dirname(ROLLUP_DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

let _dbPromise = null;

async function getDb() {
  if (_dbPromise) return _dbPromise;
  const duckdb = require('duckdb-async');
  // We materialise one physical table per (grain × baked-filter) — many
  // are tiny (a handful of rows). DuckDB's default 256 KB block size
  // means every small table wastes a full block, so the file balloons
  // to several MB of pure block overhead regardless of real data. A
  // 16 KB block size (the DuckDB minimum) cuts that ~16×. NOTE: this
  // only takes effect when the file is created NEW — an existing
  // rollups.duckdb keeps its original block size until deleted/rebuilt.
  _dbPromise = duckdb.Database
    .create(ROLLUP_DB_PATH, { access_mode: 'read_write', default_block_size: '16384' })
    .catch(() => duckdb.Database.create(ROLLUP_DB_PATH)) // older DuckDB w/o the setting
    .then((d) => d)
    .catch((err) => {
      _dbPromise = null;
      throw err;
    });
  return _dbPromise;
}

// Same BigInt/Date normalisation we apply to user DuckDB datasources — keeps
// rollup query results JSON-serialisable and consistent with the rest of the
// pipeline (numbers as Number, dates as ISO date strings).
function convertValues(rows) {
  return rows.map((r) => {
    const obj = {};
    for (const [k, v] of Object.entries(r)) {
      if (typeof v === 'bigint') obj[k] = Number(v);
      else if (v instanceof Date) obj[k] = v.toISOString().split('T')[0];
      else obj[k] = v;
    }
    return obj;
  });
}

async function query(sql) {
  const db = await getDb();
  return convertValues(await db.all(sql));
}

async function run(sql) {
  const db = await getDb();
  await db.run(sql);
}

// Bulk insert from an array of plain row objects. Used by the rollup builder
// when the source DB returned the aggregated rows over a regular SELECT and
// we need to land them in DuckDB without a federated query path.
async function insertRows(tableName, columns, rows) {
  if (!rows.length) return 0;
  const db = await getDb();
  const colList = columns.map((c) => `"${c.replace(/"/g, '""')}"`).join(', ');
  // DuckDB's appender API would be faster but the duckdb-async binding doesn't
  // expose it cleanly; chunked parameterised INSERTs are fast enough for
  // rollups (1k-100k rows in practice, not millions).
  const CHUNK = 1000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const placeholders = slice
      .map(() => `(${columns.map(() => '?').join(', ')})`)
      .join(', ');
    const params = [];
    for (const row of slice) {
      for (const col of columns) params.push(row[col] === undefined ? null : row[col]);
    }
    await db.run(`INSERT INTO "${tableName}" (${colList}) VALUES ${placeholders}`, ...params);
  }
  return rows.length;
}

async function dropTable(tableName) {
  const db = await getDb();
  await db.run(`DROP TABLE IF EXISTS "${tableName.replace(/"/g, '""')}"`);
}

async function tableBytes(tableName) {
  const db = await getDb();
  const rows = await db.all(
    "SELECT estimated_size FROM duckdb_tables() WHERE table_name = ?",
    tableName,
  );
  const v = rows[0]?.estimated_size;
  if (typeof v === 'bigint') return Number(v);
  return Number(v || 0);
}

// Every physical rollup table currently in the file (the `or_rollup_`
// prefix is reserved for us — see rollupBuilder.rollupTableName).
async function listRollupTables() {
  const db = await getDb();
  const rows = await db.all(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'main' AND table_name LIKE 'or\\_rollup\\_%' ESCAPE '\\'"
  );
  return rows.map((r) => r.table_name);
}

// DuckDB never shrinks its file on its own and only reclaims freed
// blocks on a checkpoint. Call after dropping dead tables so the space
// is reused (the file stops growing unbounded across rebuilds).
async function checkpoint() {
  const db = await getDb();
  try { await db.run('CHECKPOINT'); } catch { /* best-effort */ }
}

module.exports = {
  ROLLUP_DB_PATH,
  getDb,
  query,
  run,
  insertRows,
  dropTable,
  tableBytes,
  listRollupTables,
  checkpoint,
};
