// Who may do what with a datasource or a model, decided by workspace.
//
// Each datasource and each model lives in ONE workspace, its home
// (`workspace_id`). Both can also be shared into other workspaces
// (`workspace_datasources`, `workspace_models`): a shared source lets a
// workspace's editors see its tables and build models on it, a shared model
// lets them build reports on it and its members read its data — nobody there
// edits or holds credentials. Rights follow the role held in the workspace —
// owner → admin, member → its role, anyone else → nothing:
//
//   viewer  reads the workspace's reports, and through them the data
//   editor  + sees the workspace's sources and models (own and shared),
//             creates models on its sources, edits its models, builds reports
//   admin   + creates sources, holds their credentials, deletes, moves and
//             shares, sets RLS, drives the cache
//
// Two rules the global admin lives by. They MANAGE everything — every
// workspace, source, model, report, cache — but they READ DATA only where a
// workspace gave them a role: no bypass on /query, on a datasource preview or
// on RLS. And a new workspace holds nothing: a source or a model reaches it
// by being created there, moved there, or shared into it.
//
// The cloud edition keeps taking these decisions itself through cloudHooks;
// what is here is the self-hosted rule.

const db = require('../db');
const { ensurePersonalWorkspace } = require('./personalWorkspace');

const WRITING_ROLES = new Set(['admin', 'editor']);
const isGlobalAdmin = (user) => !!user && user.role === 'admin';
const isOwner = (row, user) => !!user && !!row && user.id === row.user_id;

// The role the caller holds in a workspace: its owner is an admin, a member
// has the role of their membership, anyone else none.
function workspaceRoleOf(workspaceId, userId) {
  if (!workspaceId || !userId) return null;
  const ws = db.prepare('SELECT owner_id FROM workspaces WHERE id = ?').get(workspaceId);
  if (!ws) return null;
  if (ws.owner_id === userId) return 'admin';
  const member = db.prepare('SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?').get(workspaceId, userId);
  return member ? member.role : null;
}

// Home workspace of a datasource or model row. A row that predates the column,
// or was inserted without one, belongs to its owner's personal workspace; the
// id is written back once so later reads are a plain column.
function homeWorkspaceOf(table, row) {
  if (!row) return null;
  if (row.workspace_id) return row.workspace_id;
  if (!row.user_id) return null;
  const wsId = ensurePersonalWorkspace(row.user_id);
  db.prepare(`UPDATE ${table} SET workspace_id = ? WHERE id = ? AND workspace_id IS NULL`).run(wsId, row.id);
  row.workspace_id = wsId;
  return wsId;
}
const datasourceHome = (ds) => homeWorkspaceOf('datasources', ds);
const modelHome = (m) => homeWorkspaceOf('models', m);

function sharedWorkspaceIdsOf(modelId) {
  return db.prepare('SELECT workspace_id FROM workspace_models WHERE model_id = ?').all(modelId).map((r) => r.workspace_id);
}
function sharedWorkspaceIdsOfDatasource(datasourceId) {
  return db.prepare('SELECT workspace_id FROM workspace_datasources WHERE datasource_id = ?').all(datasourceId).map((r) => r.workspace_id);
}
// The best role a user holds in the workspaces a source is shared into.
function datasourceSharedRole(ds, user) {
  let role = null;
  for (const wsId of sharedWorkspaceIdsOfDatasource(ds.id)) role = best(role, workspaceRoleOf(wsId, user.id));
  return role;
}

// Best of two workspace roles.
const RANK = { admin: 3, editor: 2, viewer: 1 };
const best = (a, b) => ((RANK[a] || 0) >= (RANK[b] || 0) ? a : b);

// The roles a user holds over a model: in its home workspace, and the best one
// among the workspaces it is shared into. A share never grants management.
function modelRoles(model, user) {
  if (!model || !user) return { home: null, shared: null };
  const home = workspaceRoleOf(modelHome(model), user.id);
  let shared = null;
  for (const wsId of sharedWorkspaceIdsOf(model.id)) shared = best(shared, workspaceRoleOf(wsId, user.id));
  return { home, shared };
}

// ---------------------------------------------------------------- datasources

// Structure (tables, columns, connection settings without secrets): an
// admin/editor of the source's workspace or of one it is shared into, the
// global admin, or someone who edits a model built on it — a model's editor
// has to see the tables behind it.
function canReadDatasource(ds, user) {
  if (!ds || !user) return false;
  if (isGlobalAdmin(user) || isOwner(ds, user)) return true;
  if (WRITING_ROLES.has(workspaceRoleOf(datasourceHome(ds), user.id))) return true;
  if (WRITING_ROLES.has(datasourceSharedRole(ds, user))) return true;
  const models = db.prepare('SELECT id, user_id, workspace_id FROM models WHERE datasource_id = ?').all(ds.id);
  return models.some((m) => WRITING_ROLES.has(workspaceRoleOf(modelHome(m), user.id)));
}

// Rows of the source (the SQL preview): an admin/editor of its workspace or of
// one it is shared into — they build models on it — nothing else, not even the
// global admin.
function canQueryDatasource(ds, user) {
  if (!ds || !user) return false;
  if (isOwner(ds, user)) return true;
  return WRITING_ROLES.has(workspaceRoleOf(datasourceHome(ds), user.id)) || WRITING_ROLES.has(datasourceSharedRole(ds, user));
}

// Credentials, deletion, moving: the global admin, the creator, or an admin of
// the source's workspace.
function canManageDatasource(ds, user) {
  if (!ds || !user) return false;
  if (isGlobalAdmin(user) || isOwner(ds, user)) return true;
  return workspaceRoleOf(datasourceHome(ds), user.id) === 'admin';
}

function canCreateDatasourceIn(workspaceId, user) {
  if (!workspaceId || !user) return false;
  return isGlobalAdmin(user) || workspaceRoleOf(workspaceId, user.id) === 'admin';
}

// What the caller may do with a source, for the client: 'manage' | 'read' | null.
function datasourceAccess(ds, user) {
  if (canManageDatasource(ds, user)) return 'manage';
  if (canReadDatasource(ds, user)) return 'read';
  return null;
}

// ---------------------------------------------------------------------- models

// Deletion, moving, sharing, RLS, the cache: the global admin, the creator, or
// an admin of the model's home workspace.
function canManageModel(model, user) {
  if (!model || !user) return false;
  if (isGlobalAdmin(user) || isOwner(model, user)) return true;
  return workspaceRoleOf(modelHome(model), user.id) === 'admin';
}

// Editing the structure: an admin/editor of the home workspace as well.
function canWriteModel(model, user) {
  if (!model || !user) return false;
  if (isGlobalAdmin(user) || isOwner(model, user)) return true;
  return WRITING_ROLES.has(workspaceRoleOf(modelHome(model), user.id));
}

// Authoring reports: an admin/editor of the home workspace or of one the model
// is shared into. Deliberately NOT canWriteModel: authoring never requires the
// right to edit the model, and a share grants exactly this.
function canBuildOnModel(model, user) {
  if (!model || !user) return false;
  if (isGlobalAdmin(user) || isOwner(model, user)) return true;
  const { home, shared } = modelRoles(model, user);
  return WRITING_ROLES.has(home) || WRITING_ROLES.has(shared);
}

// Reading the data (/query), by workspace role alone — the reports a caller
// can open give access too, and the report router adds that path. No global
// admin bypass: data is read where a role was given.
function canAccessModelData(model, user) {
  if (!model || !user) return false;
  if (isOwner(model, user)) return true;
  const { home, shared } = modelRoles(model, user);
  return !!home || !!shared;
}

// RLS is for the audience of a model, not for those who own it: the creator
// and the admins of its home workspace read every row.
function bypassesRls(model, user) {
  if (!model || !user) return false;
  return isOwner(model, user) || workspaceRoleOf(modelHome(model), user.id) === 'admin';
}

// A report placed in a workspace must find its model there: the workspace is
// the model's home, or the model is shared into it.
function modelReachableFromWorkspace(model, workspaceId) {
  if (!model || !workspaceId) return false;
  if (modelHome(model) === workspaceId) return true;
  return !!db.prepare('SELECT 1 FROM workspace_models WHERE model_id = ? AND workspace_id = ?').get(model.id, workspaceId);
}

// What the caller may do with a model, for the client:
// 'manage' | 'edit' | 'build' | null.
function modelAccess(model, user) {
  if (canManageModel(model, user)) return 'manage';
  if (canWriteModel(model, user)) return 'edit';
  if (canBuildOnModel(model, user)) return 'build';
  return null;
}

// Replace the set of workspaces a source is shared into.
function setDatasourceShares(datasourceId, workspaceIds) {
  const row = db.prepare('SELECT id, user_id, workspace_id FROM datasources WHERE id = ?').get(datasourceId);
  const homeId = datasourceHome(row);
  const wanted = new Set((workspaceIds || []).filter((id) => id && id !== homeId));
  db.transaction(() => {
    db.prepare('DELETE FROM workspace_datasources WHERE datasource_id = ?').run(datasourceId);
    const ins = db.prepare('INSERT OR IGNORE INTO workspace_datasources (workspace_id, datasource_id) VALUES (?, ?)');
    for (const wsId of wanted) ins.run(wsId, datasourceId);
  })();
  return [...wanted];
}

// Replace the set of workspaces a model is shared into.
function setModelShares(modelId, workspaceIds) {
  const home = db.prepare('SELECT id, user_id, workspace_id FROM models WHERE id = ?').get(modelId);
  const homeId = modelHome(home);
  const wanted = new Set((workspaceIds || []).filter((id) => id && id !== homeId));
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM workspace_models WHERE model_id = ?').run(modelId);
    const ins = db.prepare('INSERT OR IGNORE INTO workspace_models (workspace_id, model_id) VALUES (?, ?)');
    for (const wsId of wanted) ins.run(wsId, modelId);
  });
  tx();
  return [...wanted];
}

// ----------------------------------------------------------------------- lists
// The metadata tables are small: every row is read and the same predicates
// decide, so a list can never disagree with the check on the route.

const DATASOURCE_COLUMNS = 'id, user_id, workspace_id, name, db_type, host, port, db_name, created_at, extra_config';

function listVisibleDatasources(user) {
  const rows = db.prepare(`SELECT ${DATASOURCE_COLUMNS} FROM datasources ORDER BY name`).all();
  const out = [];
  for (const ds of rows) {
    const access = datasourceAccess(ds, user);
    if (!access) continue;
    out.push({ ...ds, workspace_id: datasourceHome(ds), access, shared_in: sharedWorkspaceIdsOfDatasource(ds.id) });
  }
  return out;
}

function listVisibleModels(user) {
  const rows = db.prepare(`
    SELECT m.id, m.user_id, m.workspace_id, m.name, m.description, m.datasource_id, d.name as datasource_name, m.created_at, m.updated_at
    FROM models m
    JOIN datasources d ON d.id = m.datasource_id
    ORDER BY m.updated_at DESC
  `).all();
  const out = [];
  for (const m of rows) {
    const access = modelAccess(m, user);
    if (!access) continue;
    out.push({ ...m, workspace_id: modelHome(m), access, shared_in: sharedWorkspaceIdsOf(m.id) });
  }
  return out;
}

// -------------------------------------------------------------------- lifecycle

// A deleted workspace sends its sources and models back to their creators'
// personal workspaces, like its reports, and stops receiving shares.
function rehomeWorkspaceResources(workspaceId, personalWorkspaceFor) {
  for (const table of ['datasources', 'models']) {
    const rows = db.prepare(`SELECT id, user_id FROM ${table} WHERE workspace_id = ?`).all(workspaceId);
    const move = db.prepare(`UPDATE ${table} SET workspace_id = ? WHERE id = ?`);
    for (const r of rows) move.run(personalWorkspaceFor(r.user_id), r.id);
  }
  db.prepare('DELETE FROM workspace_models WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM workspace_datasources WHERE workspace_id = ?').run(workspaceId);
}

module.exports = {
  WRITING_ROLES,
  isGlobalAdmin,
  workspaceRoleOf,
  datasourceHome,
  modelHome,
  sharedWorkspaceIdsOf,
  sharedWorkspaceIdsOfDatasource,
  setDatasourceShares,
  canReadDatasource,
  canQueryDatasource,
  canManageDatasource,
  canCreateDatasourceIn,
  datasourceAccess,
  canManageModel,
  canWriteModel,
  canBuildOnModel,
  canAccessModelData,
  bypassesRls,
  modelReachableFromWorkspace,
  modelAccess,
  setModelShares,
  listVisibleDatasources,
  listVisibleModels,
  rehomeWorkspaceResources,
};
