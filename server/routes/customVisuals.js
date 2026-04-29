const express = require('express');
const multer = require('multer');
const AdmZip = require('adm-zip');
const { requireAuth } = require('../middleware/auth');
const db = require('../db');

const router = express.Router();

const MAX_PACKAGE_SIZE = 5 * 1024 * 1024;       // 5 MB total .zip
const MAX_BUNDLE_SIZE = 1 * 1024 * 1024;        // 1 MB visual.js
const MAX_ICON_SIZE = 200 * 1024;               // 200 KB icon
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ICON_MIMES = { svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PACKAGE_SIZE },
});

// Workspace access helper — duplicates the one in workspaces.js to keep this
// route file self-contained. ws_admin OR workspace owner can upload/delete.
function getWorkspaceAccess(workspaceId, userId) {
  const ws = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(workspaceId);
  if (!ws) return null;
  if (ws.owner_id === userId) return { workspace: ws, role: 'admin' };
  const member = db.prepare('SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?').get(workspaceId, userId);
  if (!member) return null;
  return { workspace: ws, role: member.role };
}

function requireWorkspaceMember(req, res, next) {
  const access = getWorkspaceAccess(req.params.wsId, req.user.id);
  const isGlobalAdmin = req.user.role === 'admin';
  if (!access && !isGlobalAdmin) return res.status(404).json({ error: 'Workspace not found' });
  req.wsAccess = access || { workspace: { id: req.params.wsId }, role: 'admin' };
  next();
}

function requireWorkspaceAdmin(req, res, next) {
  const access = getWorkspaceAccess(req.params.wsId, req.user.id);
  const isGlobalAdmin = req.user.role === 'admin';
  if ((!access || access.role !== 'admin') && !isGlobalAdmin) {
    return res.status(403).json({ error: 'Workspace admin access required' });
  }
  next();
}

function validateManifest(raw) {
  let m;
  try { m = JSON.parse(raw); } catch { return { error: 'manifest.json is not valid JSON' }; }
  if (!m || typeof m !== 'object') return { error: 'manifest.json must be an object' };
  if (typeof m.id !== 'string' || !ID_PATTERN.test(m.id)) return { error: 'manifest.id must match [a-z0-9-] (1-64 chars)' };
  if (typeof m.name !== 'string' || !m.name.trim()) return { error: 'manifest.name is required' };
  if (typeof m.version !== 'string' || !m.version.trim()) return { error: 'manifest.version is required' };
  if (!m.dataSchema || typeof m.dataSchema !== 'object') return { error: 'manifest.dataSchema is required' };
  const ds = m.dataSchema;
  if (!Array.isArray(ds.dimensions) || !Array.isArray(ds.measures)) {
    return { error: 'manifest.dataSchema.dimensions and .measures must be arrays' };
  }
  if (m.configSchema != null && !Array.isArray(m.configSchema)) {
    return { error: 'manifest.configSchema must be an array if provided' };
  }
  return { manifest: m };
}

// List all visuals installed on this workspace
router.get('/:wsId/visuals', requireAuth, requireWorkspaceMember, (req, res) => {
  const rows = db.prepare(`
    SELECT visual_id, name, version, manifest, (icon IS NOT NULL) as has_icon, created_at, uploaded_by
    FROM custom_visuals WHERE workspace_id = ? ORDER BY name
  `).all(req.params.wsId);
  const visuals = rows.map((r) => ({
    id: r.visual_id,
    name: r.name,
    version: r.version,
    manifest: JSON.parse(r.manifest),
    hasIcon: !!r.has_icon,
    createdAt: r.created_at,
    uploadedBy: r.uploaded_by,
  }));
  res.json({ visuals });
});

// Serve the JS bundle for the iframe sandbox to import
router.get('/:wsId/visuals/:visualId/bundle.js', requireAuth, requireWorkspaceMember, (req, res) => {
  const row = db.prepare('SELECT bundle FROM custom_visuals WHERE workspace_id = ? AND visual_id = ?')
    .get(req.params.wsId, req.params.visualId);
  if (!row) return res.status(404).end();
  res.type('application/javascript').send(row.bundle);
});

// Serve the icon binary
router.get('/:wsId/visuals/:visualId/icon', requireAuth, requireWorkspaceMember, (req, res) => {
  const row = db.prepare('SELECT icon, icon_mime FROM custom_visuals WHERE workspace_id = ? AND visual_id = ?')
    .get(req.params.wsId, req.params.visualId);
  if (!row || !row.icon) return res.status(404).end();
  res.type(row.icon_mime || 'application/octet-stream').send(row.icon);
});

// Upload a .zip package
router.post('/:wsId/visuals', requireAuth, requireWorkspaceAdmin, upload.single('package'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'package file is required (.zip)' });

  let zip;
  try { zip = new AdmZip(req.file.buffer); }
  catch { return res.status(400).json({ error: 'Could not read .zip file' }); }

  const entries = zip.getEntries();
  const findEntry = (name) => entries.find((e) => !e.isDirectory && e.entryName.toLowerCase() === name.toLowerCase());
  const findEntryByExt = (...exts) => entries.find((e) => !e.isDirectory && exts.some((ext) => e.entryName.toLowerCase().endsWith(ext)));

  const manifestEntry = findEntry('manifest.json');
  const bundleEntry = findEntry('visual.js');
  if (!manifestEntry) return res.status(400).json({ error: 'Missing manifest.json at the root of the .zip' });
  if (!bundleEntry) return res.status(400).json({ error: 'Missing visual.js at the root of the .zip' });

  const manifestRaw = manifestEntry.getData().toString('utf-8');
  const { manifest, error: manifestErr } = validateManifest(manifestRaw);
  if (manifestErr) return res.status(400).json({ error: manifestErr });

  const bundleBuf = bundleEntry.getData();
  if (bundleBuf.length > MAX_BUNDLE_SIZE) {
    return res.status(400).json({ error: `visual.js exceeds ${MAX_BUNDLE_SIZE / 1024} KB` });
  }
  const bundle = bundleBuf.toString('utf-8');

  // Optional icon
  const iconEntry = findEntry('icon.svg') || findEntry('icon.png') || findEntry('icon.jpg') || findEntry('icon.jpeg')
    || findEntryByExt('icon.svg', 'icon.png', 'icon.jpg');
  let icon = null, iconMime = null;
  if (iconEntry) {
    const iconBuf = iconEntry.getData();
    if (iconBuf.length > MAX_ICON_SIZE) return res.status(400).json({ error: `Icon exceeds ${MAX_ICON_SIZE / 1024} KB` });
    const ext = iconEntry.entryName.toLowerCase().split('.').pop();
    iconMime = ICON_MIMES[ext];
    if (!iconMime) return res.status(400).json({ error: 'Icon must be .svg, .png, or .jpg' });
    icon = iconBuf;
  }

  // Upsert (workspace_id, visual_id) — replaces an existing visual with the same id
  db.prepare(`
    INSERT INTO custom_visuals (workspace_id, visual_id, name, version, manifest, bundle, icon, icon_mime, uploaded_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id, visual_id) DO UPDATE SET
      name = excluded.name,
      version = excluded.version,
      manifest = excluded.manifest,
      bundle = excluded.bundle,
      icon = excluded.icon,
      icon_mime = excluded.icon_mime,
      uploaded_by = excluded.uploaded_by,
      created_at = datetime('now')
  `).run(
    req.params.wsId, manifest.id, manifest.name, manifest.version,
    JSON.stringify(manifest), bundle, icon, iconMime, req.user.id
  );

  res.status(201).json({
    visual: {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      manifest,
      hasIcon: !!icon,
    },
  });
});

// Delete a visual
router.delete('/:wsId/visuals/:visualId', requireAuth, requireWorkspaceAdmin, (req, res) => {
  const result = db.prepare('DELETE FROM custom_visuals WHERE workspace_id = ? AND visual_id = ?')
    .run(req.params.wsId, req.params.visualId);
  if (result.changes === 0) return res.status(404).json({ error: 'Visual not found' });
  res.json({ message: 'Deleted' });
});

module.exports = router;
