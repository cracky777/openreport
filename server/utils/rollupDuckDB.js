const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Embedded DuckDB rollup store — ONE physical file per (org?, model,
// GENERATION). Every successful build writes a brand-new
// `rollups_[o<org>_]m<model>_g<gen>.duckdb` file containing only that
// build's tables, then the manifest's `table_name` (which carries the
// `_g<gen>` suffix) flips to point at it. The planner derives the gen
// from the table name and opens that file.
//
// Why per-generation FILES (not just per-generation tables in one file):
// DuckDB never truncates a file in place — DROP+CHECKPOINT only reuses
// blocks internally, the OS file stays at high-water forever. A fresh
// file per build is naturally tight (~real data size). The OLD gen file
// is referenced by nobody once the manifest flips, so it can be deleted
// on ANY OS — no fighting node-duckdb's GC-deferred file handle (the
// active file is a different path, never the one being deleted). A
// failed build never flips the manifest, so the old gen file stays
// referenced and is kept → zero cache loss on a transient error.
//
// orgId is null in OSS; the cloud edition includes it so two orgs'
// models never collide on a shared volume. Files live next to the
// metadata SQLite DB so one Docker volume covers both.
const LEGACY_PATH = process.env.ROLLUP_DUCKDB_PATH;
const DATA_DIR = process.env.ROLLUP_DUCKDB_DIR
  || (LEGACY_PATH ? path.dirname(LEGACY_PATH) : path.join(__dirname, '..', 'data'));

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function shortHash(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 12);
}

// `rollups_[o<orgHash>_]m<modelHash>` — the per-model prefix; gen files
// append `_g<gen>.duckdb`, the legacy single-file form is `<prefix>.duckdb`.
function prefixFor(modelId, orgId) {
  const parts = ['rollups'];
  if (orgId) parts.push(`o${shortHash(orgId)}`);
  parts.push(`m${shortHash(modelId)}`);
  return parts.join('_');
}

// Absolute path of a model's gen file. `gen` falsy → the legacy
// single-file path (kept only so cleanup can find + delete it).
function dbPathFor(modelId, orgId, gen) {
  const base = prefixFor(modelId, orgId);
  const name = gen ? `${base}_g${gen}.duckdb` : `${base}.duckdb`;
  return path.join(DATA_DIR, name);
}

// The `_g<gen>` token a physical rollup table name ends with (see
// rollupBuilder.rollupTableName). gen is base36, no underscores, always
// the last segment, so this is unambiguous. Returns '' if absent.
function genOfTableName(tableName) {
  const m = /_g([0-9a-z]+)$/.exec(String(tableName || ''));
  return m ? m[1] : '';
}

// Every gen file currently on disk for a model: [{ gen, path, file }].
function genFilesFor(modelId, orgId) {
  const base = prefixFor(modelId, orgId);
  const re = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_g([0-9a-z]+)\\.duckdb$`);
  const out = [];
  try {
    for (const f of fs.readdirSync(DATA_DIR)) {
      const m = re.exec(f);
      if (m) out.push({ gen: m[1], file: f, path: path.join(DATA_DIR, f) });
    }
  } catch { /* dir missing */ }
  return out;
}

const _dbByPath = new Map(); // absolute path -> Promise<duckdb.Database>

// DataSketches (Query.farm community extension) gives us mergeable HLL
// sketches: `datasketch_hll(lg_k, col)` aggregates to a BLOB sketch we
// can store as a rollup column, then `datasketch_hll_union(lg_k, sketch)`
// merges sketches at query time and `datasketch_hll_estimate(sketch)`
// extracts the approximate cardinality. lg_k=12 → ~4 KB / sketch, ~1.6%
// std-error — the default we use everywhere DISTINCT runs through HLL.
//
// `LOAD` is attempted first (cheap, succeeds on every subsequent open
// once the extension binary is on disk). If LOAD fails we try the full
// INSTALL FROM community + LOAD — that one needs network on the very
// first call inside the container. If BOTH fail (no network at boot,
// or repo unreachable), the connection still works; `db.__hllReady`
// stays false and the planner / builder treat DISTINCT as non-additive
// → falls back to live SQL. Zero hard dependency on the extension.
async function loadDataSketches(db) {
  try {
    await db.run('LOAD datasketches');
    db.__hllReady = true;
    if (process.env.ROLLUP_HLL_LOG === '1') console.log('[hll] DataSketches loaded (cached)');
    return;
  } catch { /* not installed yet — try INSTALL */ }
  try {
    await db.run('INSTALL datasketches FROM community');
    await db.run('LOAD datasketches');
    db.__hllReady = true;
    if (process.env.ROLLUP_HLL_LOG === '1') console.log('[hll] DataSketches installed from community + loaded');
  } catch (err) {
    db.__hllReady = false;
    db.__hllError = err && err.message ? err.message : String(err);
    if (process.env.ROLLUP_HLL_LOG === '1') console.warn(`[hll] DataSketches unavailable: ${db.__hllError}`);
  }
}

// Returns true iff `db` has the DataSketches extension loaded. The
// builder and planner gate every HLL path on this flag so the rollup
// pipeline stays green even when the extension can't be fetched.
function isHllReady(db) {
  return !!(db && db.__hllReady);
}

// Whether we may load the DataSketches (HLL) extension. Single source of
// truth for both this module (which loads it) and rollupBuilder (which plans
// around it). Default ON where the extension is known-safe, OFF on Windows
// where the community binary can crash the process natively (ACCESS_VIOLATION,
// uncatchable). `ROLLUP_HLL_ENABLED=1|0` forces either way.
function hllAllowedByEnv() {
  const flag = process.env.ROLLUP_HLL_ENABLED;
  if (flag === '1') return true;
  if (flag === '0') return false;
  return process.platform !== 'win32';
}

async function getDb(modelId, orgId, gen) {
  const p = dbPathFor(modelId, orgId, gen);
  const existing = _dbByPath.get(p);
  if (existing) return existing;
  const duckdb = require('duckdb-async');
  const promise = duckdb.Database
    .create(p, { access_mode: 'read_write', default_block_size: '16384' })
    .catch(() => duckdb.Database.create(p)) // older DuckDB w/o the setting
    .then(async (db) => {
      // Only TOUCH the DataSketches extension where it's allowed (ON by
      // default, OFF on Windows where the community binary triggers a native
      // ACCESS_VIOLATION 0xC0000005; `ROLLUP_HLL_ENABLED=1|0` overrides).
      // Gating the load itself (not just the atom) keeps the process alive.
      if (hllAllowedByEnv()) {
        await loadDataSketches(db);
      } else {
        db.__hllReady = false;
      }
      return db;
    })
    .catch((err) => { _dbByPath.delete(p); throw err; });
  _dbByPath.set(p, promise);
  return promise;
}

async function closePath(p) {
  const pending = _dbByPath.get(p);
  _dbByPath.delete(p);
  if (pending) { try { const d = await pending; await d.close(); } catch { /* gone */ } }
}

// best-effort unlink (node-duckdb frees the handle on GC, so a just-
// closed file can EBUSY briefly on Windows dev — retry, then give up;
// an un-deleted OLD gen file is harmless, the next build/boot cleans it).
async function rmFile(p) {
  for (const f of [p, `${p}.wal`, `${p}.tmp`]) {
    for (let attempt = 0; attempt < 4; attempt++) {
      try { fs.rmSync(f, { force: true }); break; }
      catch { await new Promise((r) => setTimeout(r, 60)); }
    }
  }
}

// Delete every gen file for the model whose gen is NOT in `keepGens`,
// plus the legacy single-file form. Called after a successful build's
// manifest flip: the old gen is now referenced by nobody (the planner
// only opens the gen the manifest points at), so deleting it is safe on
// every OS — we're never deleting the file that's actively serving.
async function pruneGenFiles(modelId, orgId, keepGens) {
  const keep = new Set((keepGens || []).filter(Boolean));
  // Legacy non-gen file (pre per-generation migration) is never the
  // active store anymore — always remove it.
  const legacy = dbPathFor(modelId, orgId, null);
  await closePath(legacy);
  await rmFile(legacy);
  for (const { gen, path: gp } of genFilesFor(modelId, orgId)) {
    if (keep.has(gen)) continue;
    await closePath(gp);
    await rmFile(gp);
  }
}

// Delete the WHOLE store for a model (every gen file + legacy). Used by
// dropAllRollups (model schema changed → all rows invalid regardless).
async function destroyModelStore(modelId, orgId) {
  await pruneGenFiles(modelId, orgId, []);
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

async function query(modelId, gen, sql, orgId) {
  const db = await getDb(modelId, orgId, gen);
  return convertValues(await db.all(sql));
}

async function run(modelId, gen, sql, orgId) {
  const db = await getDb(modelId, orgId, gen);
  await db.run(sql);
}

// Fold the gen file's WAL into the main .duckdb. We keep the connection
// open to serve queries, so DuckDB never auto-checkpoints — without this
// the main file stays a ~12 KB header while all the data sits in a
// sibling .wal (durable via recovery, but the on-disk size we report is
// wrong and the file isn't self-contained). Call once after a build run
// populates a gen.
async function checkpoint(modelId, gen, orgId) {
  const db = await getDb(modelId, orgId, gen);
  try { await db.run('CHECKPOINT'); } catch { /* best-effort */ }
}

// Bulk insert from an array of plain row objects. Used by the rollup builder
// when the source DB returned the aggregated rows over a regular SELECT and
// we need to land them in DuckDB without a federated query path.
async function insertRows(modelId, gen, tableName, columns, rows, orgId) {
  if (!rows.length) return 0;
  const db = await getDb(modelId, orgId, gen);
  const colList = columns.map((c) => `"${c.replace(/"/g, '""')}"`).join(', ');
  // DuckDB's appender API would be faster but the duckdb-async binding doesn't
  // expose it cleanly; chunked parameterised INSERTs are fast enough for
  // rollups (1k-100k rows in practice, not millions).
  const CHUNK = 1000;
  const rowGroup = `(${columns.map(() => '?').join(', ')})`;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const placeholders = slice.map(() => rowGroup).join(', ');
    const params = [];
    for (const row of slice) {
      for (const col of columns) params.push(row[col] === undefined ? null : row[col]);
    }
    await db.run(`INSERT INTO "${tableName}" (${colList}) VALUES ${placeholders}`, ...params);
  }
  return rows.length;
}

// Real on-disk size of ONE model's store = sum of its gen file(s) (+ any
// stray legacy file). The figure a per-report view shows.
function modelStoreBytes(modelId, orgId) {
  let total = 0;
  for (const { path: gp } of genFilesFor(modelId, orgId)) {
    try { total += fs.statSync(gp).size; } catch { /* race */ }
  }
  try { total += fs.statSync(dbPathFor(modelId, orgId, null)).size; } catch { /* none */ }
  return total;
}

// Sum of every rollup store on the instance (admin / system-wide view).
function totalStoreBytes() {
  let total = 0;
  try {
    for (const f of fs.readdirSync(DATA_DIR)) {
      if (/^rollups(_[^.]*)?\.duckdb$/.test(f)) {
        try { total += fs.statSync(path.join(DATA_DIR, f)).size; } catch { /* race */ }
      }
    }
  } catch { /* dir missing */ }
  return total;
}

module.exports = {
  dbPathFor,
  genOfTableName,
  genFilesFor,
  getDb,
  isHllReady,
  hllAllowedByEnv,
  query,
  run,
  insertRows,
  checkpoint,
  pruneGenFiles,
  destroyModelStore,
  modelStoreBytes,
  totalStoreBytes,
};
