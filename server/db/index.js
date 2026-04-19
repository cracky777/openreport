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
try { db.exec("ALTER TABLE users ADD COLUMN plan TEXT NOT NULL DEFAULT 'free'"); } catch { /* already exists */ }
try { db.exec("ALTER TABLE users ADD COLUMN plan_expires_at TEXT"); } catch { /* already exists */ }

// Promote first user to admin if no admin exists
const adminCount = db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'admin'").get();
if (adminCount.c === 0) {
  const firstUser = db.prepare("SELECT id FROM users ORDER BY created_at ASC LIMIT 1").get();
  if (firstUser) db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(firstUser.id);
}

module.exports = db;
