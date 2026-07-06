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

// Run an idempotent migration. `ignoreIfExists` swallows ONLY the
// "duplicate column"/"already exists" errors SQLite returns when the
// migration has already been applied — real failures (permissions
// errors, corrupted metadata, missing parent table, …) propagate and
// crash boot. Bare `catch {}` blocks hid those crashes behind an
// otherwise-healthy startup, with the schema silently incomplete →
// 500s later from code expecting columns that don't exist.
function safeMigrate(sql) {
  try { db.exec(sql); } catch (e) {
    const msg = String(e && e.message || '');
    if (/duplicate column name/i.test(msg)
        || /already exists/i.test(msg)
        || /no such table/i.test(msg) /* upstream ALTER on a table that hasn't been created in OSS — cloud-only schema */) {
      return;
    }
    throw e;
  }
}

// Migrations for existing DBs
safeMigrate("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'viewer'");
safeMigrate("ALTER TABLE reports ADD COLUMN workspace_id TEXT");
// Per-report data-source mode toggle (managed from the workspace card by
// ws/org admins). 0 = serve from the rollup cache when available (fast,
// default); 1 = bypass the cache, query the source DB live on every
// widget. The Viewer reads this and sets `bypassCache` on every /query.
safeMigrate("ALTER TABLE reports ADD COLUMN live_mode INTEGER NOT NULL DEFAULT 0");
// ISO timestamp set on every successful rollup-cache rebuild
// (cacheSchedules run-now). The Editor folds it into its bindingKey
// so a saved widget's `_fetchedBinding` invalidates the next time the
// report opens after a rebuild — otherwise the saved data + cached
// binding silently reuses pre-rebuild content (the "rebuild ignored"
// bug when triggered from the workspace card). NULL = never rebuilt
// since the column was added.
safeMigrate("ALTER TABLE reports ADD COLUMN cache_built_at TEXT");
safeMigrate("ALTER TABLE datasources ADD COLUMN extra_config TEXT DEFAULT '{}'");
safeMigrate("ALTER TABLE models ADD COLUMN date_column TEXT DEFAULT ''");
safeMigrate("ALTER TABLE models ADD COLUMN rls TEXT NOT NULL DEFAULT '{}'");
// Per-column type overrides — JSON map { "table.column": "date" | "string" | "number" | "boolean" }.
// Lets the user reinterpret a varchar that holds dates as a real date dimension,
// or a numeric ID as a categorical string. Empty / missing keys fall back to the
// native db type returned by information_schema.
safeMigrate("ALTER TABLE models ADD COLUMN column_types TEXT NOT NULL DEFAULT '{}'");
safeMigrate("ALTER TABLE workspaces ADD COLUMN is_personal INTEGER NOT NULL DEFAULT 0");
safeMigrate("CREATE INDEX IF NOT EXISTS idx_workspaces_personal_owner ON workspaces (owner_id) WHERE is_personal = 1");
// Email verification (cloud-only enforcement; OSS keeps logging in regardless).
// Existing OSS users default to 0 — but OSS doesn't gate on this, so they're
// unaffected. The cloud edition runs a backfill at boot to mark all
// pre-existing users as verified (they were created before the feature
// shipped — gating them retroactively would lock them out).
safeMigrate("ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0");
safeMigrate("ALTER TABLE users ADD COLUMN last_verification_sent_at TEXT");
// Last login / activity timestamp — updated by the login route. Used by the
// platform supervisor dashboard to surface stale / inactive accounts.
safeMigrate("ALTER TABLE users ADD COLUMN last_seen_at TEXT");

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

// Rollup cache manifest — registry of pre-aggregated tables materialised per
// (model, grain, baked-global-filter). Replaces the GROUPING SETS warmer.
// Physical tables live in either an embedded DuckDB (default) or the model's
// source DB (opt-in via `datasources.rollup_storage`). organization_id is
// always null in OSS; cloud uses it for tenant isolation on shared DBs.
//
// `base_filters` = normalized JSON of the report's global-filter-bar rules
// baked into this rollup at build time (the slice the rollup represents).
// `base_filter_hash` participates in the uniqueness + physical table name so
// two widgets at the same grain but different global-filter selections /
// exclusion sets get distinct rollups.
//
// Migration: the (model, grain) → (model, grain, base_filter) key change can't
// be ALTERed onto SQLite's auto-unique-index, so an old-schema table (created
// before base_filter_hash existed) is dropped and recreated. Rollups are a
// rebuildable cache — no data loss of record. Orphaned physical DuckDB tables
// are harmless (disk only) and get overwritten on the next build.
// `fact_table` scopes a rollup to ONE fact table of a constellation
// model — a rollup aggregates a single fact (joining facts together
// fans out cartesian). It participates in the uniqueness + physical
// table name so different facts at the same grain/filter get distinct
// rollups; the runtime planner FULL OUTER JOINs the per-fact rollups
// on the conformed grain dims.
{
  const rollupCols = db.prepare("PRAGMA table_info(rollups)").all();
  const hasFactTable = rollupCols.some((c) => c.name === 'fact_table');
  if (rollupCols.length > 0 && !hasFactTable) {
    db.exec('DROP TABLE rollups');
  }
}
db.exec(`CREATE TABLE IF NOT EXISTS rollups (
  id               TEXT PRIMARY KEY,
  model_id         TEXT NOT NULL,
  organization_id  TEXT,
  storage_mode     TEXT NOT NULL,
  grain_hash       TEXT NOT NULL,
  grain_dims       TEXT NOT NULL,
  measures         TEXT NOT NULL,
  base_filters     TEXT NOT NULL DEFAULT '[]',
  base_filter_hash TEXT NOT NULL DEFAULT '0',
  fact_table       TEXT NOT NULL DEFAULT '',
  table_name       TEXT NOT NULL,
  built_at         TEXT,
  row_count        INTEGER,
  bytes            INTEGER,
  UNIQUE(model_id, grain_hash, base_filter_hash, fact_table, organization_id),
  FOREIGN KEY (model_id) REFERENCES models(id) ON DELETE CASCADE
)`);
db.exec("CREATE INDEX IF NOT EXISTS idx_rollups_model ON rollups (model_id)");
db.exec("CREATE INDEX IF NOT EXISTS idx_rollups_org ON rollups (organization_id) WHERE organization_id IS NOT NULL");

// Per-datasource rollup storage choice. 'duckdb' (default) writes rollup tables
// to an embedded DuckDB file owned by the app — no DDL against the user's DB.
// 'source' opts into materialising rollup tables INSIDE the source DB itself
// (Looker PDT pattern), which requires the configured user to hold write
// privileges on that database.
safeMigrate("ALTER TABLE datasources ADD COLUMN rollup_storage TEXT NOT NULL DEFAULT 'duckdb'");

// Encrypt datasource credentials at rest (idempotent). Requires DATASOURCE_ENC_KEY
// once any datasource carries a secret; migrates plaintext rows in place.
require('../utils/secretCrypto').migrateDatasourceSecrets(db);

// Promote first user to admin if no admin exists
const adminCount = db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'admin'").get();
if (adminCount.c === 0) {
  const firstUser = db.prepare("SELECT id FROM users ORDER BY created_at ASC LIMIT 1").get();
  if (firstUser) db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(firstUser.id);
}

module.exports = db;
