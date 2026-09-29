#!/usr/bin/env node
// One-off cleanup of DuckDB files no source points at any more.
//
// Until the fix in routes/datasources.js, deleting an imported source left its
// file on disk, and so did a re-import that could not delete the version it
// replaced; the server test suites also wrote theirs into server/data. Those
// files hold the data of sources that no longer exist.
//
//   node scripts/cleanupOrphanDuckDB.js           lists what would go (nothing is deleted)
//   node scripts/cleanupOrphanDuckDB.js --delete  deletes it
//
// Kept whatever the flag: a file a source still names (and its .wal), anything
// outside the managed directory's top level (staging/ included), and a file
// touched in the last hour — an import writes its file before the source row
// points at it. A file Windows still holds is left to the retry at startup.
// Same .env as the server: the modules loaded below require its secrets.
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { DUCKDB_DIR } = require('../utils/dbConnector');

const RECENT_MS = 60 * 60 * 1000;
const doDelete = process.argv.includes('--delete');

function orphans() {
  const named = new Set(
    db.prepare("SELECT db_name FROM datasources WHERE db_type = 'duckdb' AND db_name IS NOT NULL")
      .all().map((r) => path.resolve(r.db_name)),
  );
  let entries = [];
  try { entries = fs.readdirSync(DUCKDB_DIR, { withFileTypes: true }); } catch { return []; }
  const now = Date.now();
  const out = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (!/\.duckdb(\.wal)?$/.test(e.name)) continue;
    const file = path.join(DUCKDB_DIR, e.name);
    const base = file.replace(/\.wal$/, '');
    if (named.has(path.resolve(base))) continue;
    const { size, mtimeMs } = fs.statSync(file);
    if (now - mtimeMs < RECENT_MS) continue;
    out.push({ file, size });
  }
  return out;
}

const found = orphans();
const mb = (n) => (n / 1048576).toFixed(1);
const total = found.reduce((s, f) => s + f.size, 0);
console.log(`${DUCKDB_DIR}`);
console.log(`${found.length} orphaned file(s), ${mb(total)} MB`);
for (const f of found.slice(0, 20)) console.log(`  ${path.basename(f.file)}  ${mb(f.size)} MB`);
if (found.length > 20) console.log(`  … and ${found.length - 20} more`);

if (!doDelete) {
  console.log('\nNothing deleted. Run again with --delete to remove them.');
  process.exit(0);
}

let removed = 0;
let held = 0;
for (const { file } of found) {
  try {
    fs.rmSync(file, { force: true });
    removed += 1;
  } catch {
    // Held by a running server on Windows: retried by the next startup.
    db.prepare('INSERT OR IGNORE INTO pending_file_deletions (path) VALUES (?)').run(path.resolve(file).replace(/\.wal$/, ''));
    held += 1;
  }
}
console.log(`\nDeleted ${removed} file(s).${held ? ` ${held} still held, retried at the next server start.` : ''}`);
