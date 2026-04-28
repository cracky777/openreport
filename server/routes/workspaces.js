const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { requireAuth } = require('../middleware/auth');
const db = require('../db');

const router = express.Router();

// Helper: check user access to workspace
function getWorkspaceAccess(workspaceId, userId) {
  const ws = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(workspaceId);
  if (!ws) return null;
  if (ws.owner_id === userId) return { workspace: ws, role: 'admin' };
  const member = db.prepare('SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?').get(workspaceId, userId);
  if (!member) return null;
  return { workspace: ws, role: member.role };
}

// List workspaces the user has access to
router.get('/', requireAuth, (req, res) => {
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

  // Also get reports without workspace ("My Reports")
  const unassignedCount = db.prepare('SELECT COUNT(*) as c FROM reports WHERE user_id = ? AND workspace_id IS NULL').get(req.user.id);

  res.json({ workspaces: [...owned, ...shared], unassignedReportCount: unassignedCount.c });
});

// Create workspace
router.post('/', requireAuth, (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  const id = uuidv4();
  db.prepare('INSERT INTO workspaces (id, name, description, owner_id) VALUES (?, ?, ?, ?)').run(
    id, name, description || '', req.user.id
  );
  res.status(201).json({ workspace: { id, name, description: description || '', owner_id: req.user.id } });
});

// Get workspace details + reports + members
router.get('/:id', requireAuth, (req, res) => {
  const access = getWorkspaceAccess(req.params.id, req.user.id);
  // Admins can see all workspaces
  const isGlobalAdmin = req.user.role === 'admin';
  if (!access && !isGlobalAdmin) return res.status(404).json({ error: 'Workspace not found' });

  const ws = access?.workspace || db.prepare('SELECT * FROM workspaces WHERE id = ?').get(req.params.id);
  const reportsRaw = db.prepare(`
    SELECT r.id, r.title, r.updated_at, r.is_public, r.model_id, r.workspace_id,
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
    const out = { id: r.id, title: r.title, updated_at: r.updated_at, is_public: r.is_public, model_id: r.model_id, workspace_id: r.workspace_id, model_name: r.model_name, datasource_id: r.datasource_id, db_type: r.db_type };
    if (r.db_type === 'duckdb' && r.extra_config) {
      try {
        const cfg = JSON.parse(r.extra_config);
        if (typeof cfg.fileSize === 'number') out.fileSize = cfg.fileSize;
        if (cfg.sourceFile) out.sourceFile = cfg.sourceFile;
      } catch { /* ignore */ }
    }
    return out;
  });

  const members = db.prepare(`
    SELECT u.id, u.email, u.display_name, wm.role
    FROM workspace_members wm
    JOIN users u ON u.id = wm.user_id
    WHERE wm.workspace_id = ?
  `).all(req.params.id);

  const owner = db.prepare('SELECT id, email, display_name FROM users WHERE id = ?').get(ws.owner_id);

  res.json({ workspace: ws, reports, members, owner, userRole: access?.role || (isGlobalAdmin ? 'admin' : null) });
});

// Update workspace
router.put('/:id', requireAuth, (req, res) => {
  const access = getWorkspaceAccess(req.params.id, req.user.id);
  if (!access || access.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  const { name, description } = req.body;
  db.prepare('UPDATE workspaces SET name = COALESCE(?, name), description = COALESCE(?, description), updated_at = datetime(\'now\') WHERE id = ?')
    .run(name || null, description !== undefined ? description : null, req.params.id);
  res.json({ message: 'Updated' });
});

// Delete workspace
router.delete('/:id', requireAuth, (req, res) => {
  const access = getWorkspaceAccess(req.params.id, req.user.id);
  if (!access || access.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  // Unassign reports (don't delete them)
  db.prepare('UPDATE reports SET workspace_id = NULL WHERE workspace_id = ?').run(req.params.id);
  db.prepare('DELETE FROM workspaces WHERE id = ?').run(req.params.id);
  res.json({ message: 'Deleted' });
});

// Add member
router.post('/:id/members', requireAuth, (req, res) => {
  const access = getWorkspaceAccess(req.params.id, req.user.id);
  if (!access || access.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  const { email, role } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  const memberRole = ['admin', 'editor', 'viewer'].includes(role) ? role : 'viewer';
  const targetUser = db.prepare('SELECT id, email, display_name FROM users WHERE email = ?').get(email);
  if (!targetUser) return res.status(404).json({ error: 'User not found' });
  if (targetUser.id === access.workspace.owner_id) return res.status(400).json({ error: 'User is already the owner' });
  try {
    db.prepare('INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)').run(req.params.id, targetUser.id, memberRole);
  } catch {
    db.prepare('UPDATE workspace_members SET role = ? WHERE workspace_id = ? AND user_id = ?').run(memberRole, req.params.id, targetUser.id);
  }
  res.json({ member: { ...targetUser, role: memberRole } });
});

// Update member role
router.put('/:id/members/:userId', requireAuth, (req, res) => {
  const access = getWorkspaceAccess(req.params.id, req.user.id);
  if (!access || access.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  const { role } = req.body;
  if (!['admin', 'editor', 'viewer'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  db.prepare('UPDATE workspace_members SET role = ? WHERE workspace_id = ? AND user_id = ?').run(role, req.params.id, req.params.userId);
  res.json({ message: 'Updated' });
});

// Remove member
router.delete('/:id/members/:userId', requireAuth, (req, res) => {
  const access = getWorkspaceAccess(req.params.id, req.user.id);
  if (!access || access.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  db.prepare('DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?').run(req.params.id, req.params.userId);
  res.json({ message: 'Removed' });
});

// Move report to workspace
router.put('/:id/reports/:reportId', requireAuth, (req, res) => {
  const access = getWorkspaceAccess(req.params.id, req.user.id);
  if (!access || (access.role !== 'admin' && access.role !== 'editor')) return res.status(403).json({ error: 'Editor access required' });
  // Verify the report belongs to the requesting user
  const report = db.prepare('SELECT id FROM reports WHERE id = ? AND user_id = ?').get(req.params.reportId, req.user.id);
  if (!report) return res.status(404).json({ error: 'Report not found' });
  db.prepare('UPDATE reports SET workspace_id = ? WHERE id = ?').run(req.params.id, req.params.reportId);
  res.json({ message: 'Report moved' });
});

module.exports = router;
