// setupEnv makes one throwaway data dir per test FILE and nothing removed them:
// a full run left ~26 openreport-test-* behind, each holding a SQLite database,
// and they accumulated run after run (885 of them on the machine this was
// written on).
//
// Cleaning from inside a worker doesn't work — better-sqlite3 still holds the
// file when the worker exits. This runs once, in the main process, after every
// worker is gone. Best-effort by design: a directory still locked is a harmless
// orphan in the OS temp dir, not a reason to fail a green run.
const os = require('os');
const path = require('path');
const fs = require('fs');

module.exports = () => {
  const tmp = os.tmpdir();
  let entries = [];
  try { entries = fs.readdirSync(tmp); } catch { return; }
  for (const name of entries) {
    if (!name.startsWith('openreport-test-')) continue;
    try { fs.rmSync(path.join(tmp, name), { recursive: true, force: true }); } catch { /* locked — leave it */ }
  }
};
