const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { authFor } = require('../middleware/auth');
const db = require('../db');
const cloudHooks = require('../cloudHooks');
const { rejectIfNameTaken } = require('../utils/nameUniqueness');

const router = express.Router();

// Access to a workspace. OSS: owner (→ admin) or member (→ their role), unscoped.
// Cloud org-scopes it. Returns { workspace, role } | null (null → 404).
function workspaceAccess(workspaceId, req) {
  if (typeof cloudHooks.workspaceAccess === 'function') return cloudHooks.workspaceAccess(workspaceId, req);
  const ws = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(workspaceId);
  if (!ws) return null;
  if (ws.owner_id === req.user.id) return { workspace: ws, role: 'admin' };
  const member = db.prepare('SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?').get(workspaceId, req.user.id);
  if (!member) return null;
  return { workspace: ws, role: member.role };
}

// Full-access bypass. OSS: global admin. Cloud: org admin.
function canAdminAllWorkspaces(req) {
  if (typeof cloudHooks.canAdminAllWorkspaces === 'function') return cloudHooks.canAdminAllWorkspaces(req);
  return !!(req.user && req.user.role === 'admin');
}

// The workspaces the caller may list, as { owned, shared }. Cloud org-scopes both.
function listWorkspaces(req) {
  if (typeof cloudHooks.listWorkspaces === 'function') return cloudHooks.listWorkspaces(req);
  const owned = db.prepare(`
    SELECT w.*, 'admin' as member_role,
      (SELECT COUNT(*) FROM reports WHERE workspace_id = w.id) as report_count,
      (SELECT COUNT(*) FROM workspace_members WHERE workspace_id = w.id) + 1 as member_count
    FROM workspaces w WHERE w.owner_id = ?
  `).all(req.user.id);
  const shared = db.prepare(`
    SELECT w.*, wm.role as member_role,
      (SELECT COUNT(*) FROM reports WHERE workspace_id = w.id) as report_count,
      (SELECT COUNT(*) FROM workspace_members WHERE workspace_id = w.id) + 1 as member_count
    FROM workspaces w
    JOIN workspace_members wm ON wm.workspace_id = w.id
    WHERE wm.user_id = ?
  `).all(req.user.id);
  return { owned, shared };
}

function stampNewWorkspace(req, id) {
  if (typeof cloudHooks.onWorkspaceCreate === 'function') cloudHooks.onWorkspaceCreate(req, id);
}

// Rehome target for a report owner's reports when their workspace is deleted.
// OSS: the owner's personal ws. Cloud: within the active org.
function personalWorkspaceFor(req, userId) {
  if (typeof cloudHooks.resolvePersonalWorkspaceFor === 'function') return cloudHooks.resolvePersonalWorkspaceFor(req, userId);
  const { ensurePersonalWorkspace } = require('../utils/personalWorkspace');
  return ensurePersonalWorkspace(userId);
}

// Whether sharing the workspace is disallowed (cloud personal-org guard). Returns
// the 400 reason string, or null when allowed. OSS: always allowed.
function workspaceSharingDenied(ws, req) {
  if (typeof cloudHooks.workspaceSharingDenied === 'function') return cloudHooks.workspaceSharingDenied(ws, req);
  return null;
}

// Extra validation for a member being added (cloud: must be an org member).
// Returns the 400 reason string, or null. OSS: no extra rule.
function validateNewMember(req, targetUser) {
  if (typeof cloudHooks.validateNewMember === 'function') return cloudHooks.validateNewMember(req, targetUser);
  return null;
}

// Whether the caller may see the member list (avoids leaking co-member emails).
// OSS: yes. Cloud: workspace admin / org admin only.
function canSeeWorkspaceMembers(req, access) {
  if (typeof cloudHooks.canSeeWorkspaceMembers === 'function') return cloudHooks.canSeeWorkspaceMembers(req, access);
  return true;
}

// Whether the workspace lives in a personal org (cloud response field). OSS: false.
function workspaceIsPersonalOrg(req, ws) {
  if (typeof cloudHooks.workspaceIsPersonalOrg === 'function') return cloudHooks.workspaceIsPersonalOrg(req, ws);
  return false;
}

// The admin-bypass fetch for a workspace the caller isn't a member of but may
// still act on as an admin. OSS: any workspace. Cloud: org-scoped so an org
// admin can't reach another org's. Takes an explicit id (customVisuals uses the
// same cloudHooks.adminViewWorkspace with its own :wsId param).
function adminViewWorkspace(workspaceId, req) {
  if (typeof cloudHooks.adminViewWorkspace === 'function') return cloudHooks.adminViewWorkspace(workspaceId, req);
  return db.prepare('SELECT * FROM workspaces WHERE id = ?').get(workspaceId);
}

// List workspaces the user has access to. Personal workspaces are returned
// separately so the client can hide them from the regular switcher and use the
// id internally for the "My Reports" view.
router.get('/', authFor('org'), (req, res) => {
  const { owned, shared } = listWorkspaces(req);
  const all = [...owned, ...shared];
  const personal = all.find((w) => w.is_personal === 1) || null;
  const visible = all.filter((w) => w.is_personal !== 1);
  const personalReportCount = personal ? personal.report_count : 0;

  res.json({
    workspaces: visible,
    personalWorkspace: personal,
    unassignedReportCount: personalReportCount,
  });
});

// Create workspace
router.post('/', authFor('write'), (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  if (rejectIfNameTaken('workspace', name, req, res)) return;
  const id = uuidv4();
  db.prepare('INSERT INTO workspaces (id, name, description, owner_id) VALUES (?, ?, ?, ?)').run(
    id, name, description || '', req.user.id
  );
  stampNewWorkspace(req, id);
  res.status(201).json({ workspace: { id, name, description: description || '', owner_id: req.user.id } });
});

// Get workspace details + reports + members
router.get('/:id', authFor('org'), (req, res) => {
  const access = workspaceAccess(req.params.id, req);
  const isAdmin = canAdminAllWorkspaces(req);
  if (!access && !isAdmin) return res.status(404).json({ error: 'Workspace not found' });

  const ws = access?.workspace || adminViewWorkspace(req.params.id, req);
  if (!ws) return res.status(404).json({ error: 'Workspace not found' });
  const reportsRaw = db.prepare(`
    SELECT r.id, r.title, r.updated_at, r.is_public, r.live_mode, r.model_id, r.workspace_id,
      m.name as model_name,
      d.id as datasource_id, d.db_type, d.extra_config
    FROM reports r
    LEFT JOIN models m ON m.id = r.model_id
    LEFT JOIN datasources d ON d.id = m.datasource_id
    WHERE r.workspace_id = ?
    ORDER BY r.updated_at DESC
  `).all(req.params.id);

  // Surface uploaded-file size on local (DuckDB) datasources so the workspace UI
  // can show storage usage per report without an extra round-trip.
  const reports = reportsRaw.map((r) => {
    const out = { id: r.id, title: r.title, updated_at: r.updated_at, is_public: r.is_public, live_mode: r.live_mode, model_id: r.model_id, workspace_id: r.workspace_id, model_name: r.model_name, datasource_id: r.datasource_id, db_type: r.db_type };
    if (r.db_type === 'duckdb' && r.extra_config) {
      try {
        const cfg = JSON.parse(r.extra_config);
        if (typeof cfg.fileSize === 'number') out.fileSize = cfg.fileSize;
        if (cfg.sourceFile) out.sourceFile = cfg.sourceFile;
      } catch { /* ignore */ }
    }
    return out;
  });

  // Member list can leak co-member emails — only admins see it (OSS: everyone).
  const canSeeMembers = canSeeWorkspaceMembers(req, access);
  const members = canSeeMembers ? db.prepare(`
    SELECT u.id, u.email, u.display_name, wm.role
    FROM workspace_members wm
    JOIN users u ON u.id = wm.user_id
    WHERE wm.workspace_id = ?
  `).all(req.params.id) : [];

  const owner = db.prepare('SELECT id, email, display_name FROM users WHERE id = ?').get(ws.owner_id);

  res.json({
    workspace: ws, reports, members, owner,
    userRole: access?.role || (isAdmin ? 'admin' : null),
    can_see_members: canSeeMembers,
    is_personal_org: workspaceIsPersonalOrg(req, ws),
  });
});

// Update workspace
router.put('/:id', authFor('org'), (req, res) => {
  const access = workspaceAccess(req.params.id, req);
  if (!access || access.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  const { name, description } = req.body;
  if (rejectIfNameTaken('workspace', name, req, res, req.params.id)) return;
  db.prepare('UPDATE workspaces SET name = COALESCE(?, name), description = COALESCE(?, description), updated_at = datetime(\'now\') WHERE id = ?')
    .run(name || null, description !== undefined ? description : null, req.params.id);
  res.json({ message: 'Updated' });
});

// Delete workspace. Personal workspaces are not deletable — they're the
// implicit home for reports without an explicit workspace and removing one
// would orphan the user's reports + custom visuals.
router.delete('/:id', authFor('org'), (req, res) => {
  const access = workspaceAccess(req.params.id, req);
  if (!access || access.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  if (access.workspace.is_personal) {
    return res.status(400).json({ error: 'The personal workspace cannot be deleted' });
  }
  // Unassign reports (don't delete them) — rehome them into each owner's personal
  // workspace so they keep a workspace_id (custom visuals etc. require one).
  const reports = db.prepare('SELECT id, user_id FROM reports WHERE workspace_id = ?').all(req.params.id);
  const moveReport = db.prepare('UPDATE reports SET workspace_id = ? WHERE id = ?');
  const personalWsByUser = new Map();
  for (const r of reports) {
    let personalWs = personalWsByUser.get(r.user_id);
    if (personalWs === undefined) {
      personalWs = personalWorkspaceFor(req, r.user_id);
      personalWsByUser.set(r.user_id, personalWs);
    }
    moveReport.run(personalWs, r.id);
  }
  db.prepare('DELETE FROM workspaces WHERE id = ?').run(req.params.id);
  res.json({ message: 'Deleted' });
});

// Add member
router.post('/:id/members', authFor('org'), (req, res) => {
  const access = workspaceAccess(req.params.id, req);
  if (!access || access.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  const denied = workspaceSharingDenied(access.workspace, req);
  if (denied) return res.status(400).json({ error: denied });
  const { email, role } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  const memberRole = ['admin', 'editor', 'viewer'].includes(role) ? role : 'viewer';
  const targetUser = db.prepare('SELECT id, email, display_name FROM users WHERE email = ?').get(email);
  if (!targetUser) return res.status(404).json({ error: 'User not found' });
  if (targetUser.id === access.workspace.owner_id) return res.status(400).json({ error: 'User is already the owner' });
  const memberErr = validateNewMember(req, targetUser);
  if (memberErr) return res.status(400).json({ error: memberErr });
  try {
    db.prepare('INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)').run(req.params.id, targetUser.id, memberRole);
  } catch {
    db.prepare('UPDATE workspace_members SET role = ? WHERE workspace_id = ? AND user_id = ?').run(memberRole, req.params.id, targetUser.id);
  }
  res.json({ member: { ...targetUser, role: memberRole } });
});

// Update member role
router.put('/:id/members/:userId', authFor('org'), (req, res) => {
  const access = workspaceAccess(req.params.id, req);
  if (!access || access.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  const denied = workspaceSharingDenied(access.workspace, req);
  if (denied) return res.status(400).json({ error: denied });
  const { role } = req.body;
  if (!['admin', 'editor', 'viewer'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  db.prepare('UPDATE workspace_members SET role = ? WHERE workspace_id = ? AND user_id = ?').run(role, req.params.id, req.params.userId);
  res.json({ message: 'Updated' });
});

// Remove member
router.delete('/:id/members/:userId', authFor('org'), (req, res) => {
  const access = workspaceAccess(req.params.id, req);
  if (!access || access.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  const denied = workspaceSharingDenied(access.workspace, req);
  if (denied) return res.status(400).json({ error: denied });
  db.prepare('DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?').run(req.params.id, req.params.userId);
  res.json({ message: 'Removed' });
});

// Move report to workspace
router.put('/:id/reports/:reportId', authFor('org'), (req, res) => {
  const access = workspaceAccess(req.params.id, req);
  if (!access || (access.role !== 'admin' && access.role !== 'editor')) return res.status(403).json({ error: 'Editor access required' });
  // Verify the report belongs to the requesting user
  const report = db.prepare('SELECT id FROM reports WHERE id = ? AND user_id = ?').get(req.params.reportId, req.user.id);
  if (!report) return res.status(404).json({ error: 'Report not found' });
  db.prepare('UPDATE reports SET workspace_id = ? WHERE id = ?').run(req.params.id, req.params.reportId);
  res.json({ message: 'Report moved' });
});

module.exports = router;
