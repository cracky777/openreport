const { v4: uuidv4 } = require('uuid');
const db = require('../db');

// Returns the user's personal workspace id, creating it if missing.
// Idempotent — safe to call from the post-register hook AND the boot backfill.
function ensurePersonalWorkspace(userId) {
  const existing = db.prepare(
    'SELECT id FROM workspaces WHERE owner_id = ? AND is_personal = 1'
  ).get(userId);
  if (existing) return existing.id;

  const id = uuidv4();
  db.prepare(`
    INSERT INTO workspaces (id, name, description, owner_id, is_personal)
    VALUES (?, ?, ?, ?, 1)
  `).run(id, 'Personal', 'Your personal workspace', userId);
  return id;
}

// One-shot at boot: every existing user gets a personal workspace, and any
// report, datasource or model that was sitting with workspace_id IS NULL is
// rehomed into it. Custom visuals can then attach to a real workspace_id even
// for "solo" use.
function backfillPersonalWorkspaces() {
  const users = db.prepare('SELECT id FROM users').all();
  const rehome = ['reports', 'datasources', 'models'].map((t) => db.prepare(
    `UPDATE ${t} SET workspace_id = ? WHERE user_id = ? AND workspace_id IS NULL`
  ));
  for (const u of users) {
    const wsId = ensurePersonalWorkspace(u.id);
    for (const stmt of rehome) stmt.run(wsId, u.id);
  }
  backfillModelShares();
}

// Once: before models had a home, a report placed in a workspace was what put
// its model in front of that team (its editors could build on it). Recording
// those pairs as shares keeps every such report editable after the move to
// explicit sharing; anything placed later goes through the share itself.
const SHARES_BACKFILL_KEY = 'workspace_models_backfill_v1';
function backfillModelShares() {
  if (db.prepare('SELECT 1 FROM app_settings WHERE key = ?').get(SHARES_BACKFILL_KEY)) return;
  db.prepare(`
    INSERT OR IGNORE INTO workspace_models (workspace_id, model_id)
    SELECT DISTINCT r.workspace_id, r.model_id
    FROM reports r
    JOIN models m ON m.id = r.model_id
    JOIN workspaces w ON w.id = r.workspace_id
    WHERE r.workspace_id IS NOT NULL AND m.workspace_id IS NOT NULL AND m.workspace_id <> r.workspace_id
      AND w.is_personal = 0
  `).run();
  db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, '1', datetime('now'))").run(SHARES_BACKFILL_KEY);
}

module.exports = { ensurePersonalWorkspace, backfillPersonalWorkspaces, backfillModelShares };
