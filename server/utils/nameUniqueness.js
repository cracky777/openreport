// Name-uniqueness checks for datasources / models / workspaces. Case-insensitive.
// Scope is per-user in OSS; the cloud edition replaces it with a per-org check
// (cloudHooks.nameTaken). Reports are scoped per-workspace and handled inline in
// routes/reports.js (edition-neutral), not here.
const db = require('../db');
const cloudHooks = require('../cloudHooks');

const NAME_TABLES = { datasource: 'datasources', model: 'models', workspace: 'workspaces' };
// OSS ownership column per table — workspaces use owner_id, the rest user_id.
const SCOPE_COL = { datasource: 'user_id', model: 'user_id', workspace: 'owner_id' };
// Human label used in the 409 message.
const ENTITY_LABEL = { datasource: 'datasource', model: 'model', workspace: 'workspace' };

// Is `name` already used by another `entity` the caller owns? `excludeId` skips a
// row (for renames — a resource keeping its own name isn't a conflict).
function nameTaken(entity, name, req, excludeId) {
  if (typeof cloudHooks.nameTaken === 'function') return cloudHooks.nameTaken(entity, name, req, excludeId);
  const table = NAME_TABLES[entity];
  const scopeCol = SCOPE_COL[entity];
  if (!table || !scopeCol) return false;
  const sql = `SELECT id FROM ${table} WHERE name = ? COLLATE NOCASE AND ${scopeCol} = ?${excludeId ? ' AND id != ?' : ''}`;
  const args = excludeId ? [name, req.user.id, excludeId] : [name, req.user.id];
  return !!db.prepare(sql).get(...args);
}

// Sends a 409 and returns true when the name is taken; returns false otherwise.
// `name` is trimmed before checking (a blank/undefined name is never a conflict).
function rejectIfNameTaken(entity, name, req, res, excludeId) {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!trimmed) return false;
  if (nameTaken(entity, trimmed, req, excludeId)) {
    const label = ENTITY_LABEL[entity] || 'resource';
    res.status(409).json({ error: `A ${label} named "${trimmed}" already exists.` });
    return true;
  }
  return false;
}

module.exports = { nameTaken, rejectIfNameTaken };
