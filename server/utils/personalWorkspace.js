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
// report that was sitting with workspace_id IS NULL is rehomed into it.
// Custom visuals can then attach to a real workspace_id even for "solo" use.
function backfillPersonalWorkspaces() {
  const users = db.prepare('SELECT id FROM users').all();
  for (const u of users) {
    const wsId = ensurePersonalWorkspace(u.id);
    db.prepare(
      'UPDATE reports SET workspace_id = ? WHERE user_id = ? AND workspace_id IS NULL'
    ).run(wsId, u.id);
  }
}

module.exports = { ensurePersonalWorkspace, backfillPersonalWorkspaces };
