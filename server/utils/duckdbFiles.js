const fs = require('fs');
const path = require('path');
const db = require('../db');
const { closeDuckDBFile, isManagedDuckDBPath } = require('./dbConnector');

// A DuckDB file an imported source no longer points at — the source was
// deleted, or a newer import replaced it. Left on disk it is not just wasted
// space: the data of a "deleted" source stays readable by anyone with the
// server's files.
//
// Windows may refuse to delete a file DuckDB still holds, even after close(),
// until the handle is collected. Such a file is written down and retried —
// on every later retirement and at startup, when nothing is open yet — so
// "cannot delete now" never turns into "kept forever".

function removeNow(file) {
  for (const f of [file, `${file}.wal`]) fs.rmSync(f, { force: true });
}

// Only files the app manages, and never one a source still names: a row
// written in between (it cannot happen with per-import paths, but the check
// costs one lookup) keeps its file.
function stillInUse(file) {
  return !!db.prepare('SELECT 1 FROM datasources WHERE db_name = ?').get(file);
}

function retryPending() {
  for (const { path: file } of db.prepare('SELECT path FROM pending_file_deletions').all()) {
    if (!isManagedDuckDBPath(file) || stillInUse(file)) {
      db.prepare('DELETE FROM pending_file_deletions WHERE path = ?').run(file);
      continue;
    }
    try {
      removeNow(file);
      db.prepare('DELETE FROM pending_file_deletions WHERE path = ?').run(file);
    } catch { /* still held — next retirement or next start */ }
  }
}

async function retireDuckDBFile(dbName) {
  if (!dbName || dbName === ':memory:' || !isManagedDuckDBPath(dbName)) return;
  const file = path.resolve(dbName);
  await closeDuckDBFile(file);
  try {
    removeNow(file);
  } catch {
    db.prepare('INSERT OR IGNORE INTO pending_file_deletions (path) VALUES (?)').run(file);
  }
  retryPending();
}

module.exports = { retireDuckDBFile, retryPending };
