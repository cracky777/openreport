const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'open-report.db');

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent access
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Run migrations
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
db.exec(schema);

// Migrations for existing DBs
try { db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'viewer'"); } catch { /* already exists */ }
try { db.exec("ALTER TABLE reports ADD COLUMN workspace_id TEXT"); } catch { /* already exists */ }
try { db.exec("ALTER TABLE datasources ADD COLUMN extra_config TEXT DEFAULT '{}'"); } catch { /* already exists */ }
try { db.exec("ALTER TABLE models ADD COLUMN date_column TEXT DEFAULT ''"); } catch { /* already exists */ }
try { db.exec("ALTER TABLE models ADD COLUMN rls TEXT NOT NULL DEFAULT '{}'"); } catch { /* already exists */ }
try { db.exec("ALTER TABLE workspaces ADD COLUMN is_personal INTEGER NOT NULL DEFAULT 0"); } catch { /* already exists */ }
try { db.exec("CREATE INDEX IF NOT EXISTS idx_workspaces_personal_owner ON workspaces (owner_id) WHERE is_personal = 1"); } catch { /* ignore */ }
// Email verification (cloud-only enforcement; OSS keeps logging in regardless).
// Existing OSS users default to 0 — but OSS doesn't gate on this, so they're
// unaffected. The cloud edition runs a backfill at boot to mark all
// pre-existing users as verified (they were created before the feature
// shipped — gating them retroactively would lock them out).
try { db.exec("ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0"); } catch { /* already exists */ }
try { db.exec("ALTER TABLE users ADD COLUMN last_verification_sent_at TEXT"); } catch { /* already exists */ }

// Report version history — snapshots taken on every meaningful save so an
// admin can roll back. Capped at 20 versions per report (FIFO pruning in
// the route handler that takes the snapshot).
db.exec(`CREATE TABLE IF NOT EXISTS report_versions (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL,
  saved_by TEXT,
  title TEXT NOT NULL,
  layout TEXT NOT NULL,
  widgets TEXT NOT NULL,
  settings TEXT NOT NULL,
  model_id TEXT,
  saved_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE
)`);
db.exec("CREATE INDEX IF NOT EXISTS idx_report_versions_report ON report_versions (report_id, saved_at DESC)");

// Custom visuals — workspace-scoped plugin registry. Uploaded as .zip by ws_admin,
// rendered in a sandboxed iframe at runtime.
db.exec(`CREATE TABLE IF NOT EXISTS custom_visuals (
  workspace_id TEXT NOT NULL,
  visual_id TEXT NOT NULL,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  manifest TEXT NOT NULL,
  bundle TEXT NOT NULL,
  icon BLOB,
  icon_mime TEXT,
  uploaded_by TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (workspace_id, visual_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE CASCADE
)`);

// Promote first user to admin if no admin exists
const adminCount = db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'admin'").get();
if (adminCount.c === 0) {
  const firstUser = db.prepare("SELECT id FROM users ORDER BY created_at ASC LIMIT 1").get();
  if (firstUser) db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(firstUser.id);
}

module.exports = db;
