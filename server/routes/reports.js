const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { requireAuth, requireRole } = require('../middleware/auth');
const db = require('../db');

const router = express.Router();

// Strip widget.data from a widgets map. Used to prevent the owner's pre-baked
// snapshot from leaking to non-owner viewers (it bypasses RLS). The viewer will
// re-query each widget itself, going through the RLS-aware /models/:id/query path.
function stripWidgetData(widgets) {
  if (!widgets || typeof widgets !== 'object') return widgets;
  const out = {};
  for (const [id, w] of Object.entries(widgets)) {
    if (!w || typeof w !== 'object') { out[id] = w; continue; }
    const { data: _data, ...rest } = w;
    out[id] = rest;
  }
  return out;
}

// Authorization helper used by report viewing and downstream model/query routes.
// A user can access a report if they own it, it's public, they are a global admin,
// or they're a member of the workspace containing it.
function canAccessReport(report, user) {
  if (!report) return false;
  if (report.is_public) return true;
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.id === report.user_id) return true;
  if (report.workspace_id) {
    const ws = db.prepare('SELECT owner_id FROM workspaces WHERE id = ?').get(report.workspace_id);
    if (ws && ws.owner_id === user.id) return true;
    const member = db.prepare('SELECT 1 FROM workspace_members WHERE workspace_id = ? AND user_id = ?').get(report.workspace_id, user.id);
    if (member) return true;
  }
  return false;
}

// List reports for current user
router.get('/', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT r.id, r.title, r.model_id, r.workspace_id, r.is_public, r.created_at, r.updated_at,
      m.name as model_name,
      d.id as datasource_id, d.db_type, d.extra_config
    FROM reports r
    LEFT JOIN models m ON m.id = r.model_id
    LEFT JOIN datasources d ON d.id = m.datasource_id
    WHERE r.user_id = ?
    ORDER BY r.updated_at DESC
  `).all(req.user.id);
  // Same shape as /workspaces/:id — surface fileSize for local (DuckDB) datasources.
  const reports = rows.map((r) => {
    const out = { id: r.id, title: r.title, model_id: r.model_id, workspace_id: r.workspace_id, is_public: r.is_public, created_at: r.created_at, updated_at: r.updated_at, model_name: r.model_name, datasource_id: r.datasource_id, db_type: r.db_type };
    if (r.db_type === 'duckdb' && r.extra_config) {
      try {
        const cfg = JSON.parse(r.extra_config);
        if (typeof cfg.fileSize === 'number') out.fileSize = cfg.fileSize;
        if (cfg.sourceFile) out.sourceFile = cfg.sourceFile;
      } catch { /* ignore */ }
    }
    return out;
  });
  res.json({ reports });
});

// Get single report (public, owned, workspace-member, or global admin).
router.get('/:id', (req, res) => {
  const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id);

  if (!report) {
    return res.status(404).json({ error: 'Report not found' });
  }

  if (!canAccessReport(report, req.user)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const parsedSettings = JSON.parse(report.settings);
  let widgets = JSON.parse(report.widgets);
  let pages = parsedSettings.pages || null;

  // For anyone other than the owner, strip the owner's pre-baked widget data so it
  // never reaches the client without going through the RLS-aware re-query path.
  // The owner sees their snapshot for fast Editor opens; everyone else fetches fresh
  // data subject to row-level security.
  const isOwner = req.user && req.user.id === report.user_id;
  if (!isOwner) {
    widgets = stripWidgetData(widgets);
    if (pages) pages = pages.map((p) => ({ ...p, widgets: stripWidgetData(p.widgets) }));
  }

  res.json({
    report: {
      ...report,
      layout: JSON.parse(report.layout),
      widgets,
      settings: parsedSettings,
      pages,
    },
  });
});

// Import report from a raw JSON bundle (the file produced by the client-side
// "Export raw (JSON)" action). The bundle's shape is:
//   { format: 'open-report.report.v1', exportedAt, report: { title, model_id, layout, widgets, settings, pages } }
// We DON'T try to recreate the source datasource or model — the importer must
// pick one they already have access to via `modelId` in the query/body.
// model_name in the bundle is only used to surface a hint in the response.
router.post('/import', requireAuth, (req, res) => {
  const { bundle, modelId, workspaceId } = req.body || {};
  if (!bundle || typeof bundle !== 'object') {
    return res.status(400).json({ error: 'Missing or invalid bundle' });
  }
  if (bundle.format !== 'open-report.report.v1') {
    return res.status(400).json({ error: `Unsupported bundle format: ${bundle.format}` });
  }
  const src = bundle.report;
  if (!src || typeof src !== 'object') {
    return res.status(400).json({ error: 'Bundle is missing the "report" object' });
  }
  if (!modelId) {
    return res.status(400).json({ error: 'A target modelId is required to import' });
  }

  // The model must belong to the calling user (or they must be admin) — we
  // never let an import silently bind to someone else's model.
  const model = db.prepare('SELECT id, user_id FROM models WHERE id = ?').get(modelId);
  if (!model) return res.status(404).json({ error: 'Target model not found' });
  if (req.user.role !== 'admin' && model.user_id !== req.user.id) {
    return res.status(403).json({ error: 'You do not own the target model' });
  }

  const id = uuidv4();
  const title = (src.title ? `${src.title} (imported)` : 'Imported report').slice(0, 200);
  const layout = Array.isArray(src.layout) ? src.layout : [];
  // Strip any cached widget data from the bundle — viewers re-query against
  // their own model going forward, subject to their RLS.
  const cleanWidgets = (map) => {
    if (!map || typeof map !== 'object') return {};
    const out = {};
    for (const [wId, w] of Object.entries(map)) {
      if (w && typeof w === 'object') {
        const { data: _d, ...rest } = w;
        out[wId] = rest;
      }
    }
    return out;
  };
  const widgets = cleanWidgets(src.widgets);
  const settings = (src.settings && typeof src.settings === 'object') ? { ...src.settings } : {};
  if (Array.isArray(src.pages)) {
    settings.pages = src.pages.map((p) => ({
      id: p.id, name: p.name,
      layout: Array.isArray(p.layout) ? p.layout : [],
      widgets: cleanWidgets(p.widgets),
    }));
  }

  db.prepare(`
    INSERT INTO reports (id, user_id, model_id, title, workspace_id, layout, widgets, settings)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, req.user.id, modelId, title, workspaceId || null,
    JSON.stringify(layout), JSON.stringify(widgets), JSON.stringify(settings),
  );

  const created = db.prepare('SELECT * FROM reports WHERE id = ?').get(id);
  res.status(201).json({
    report: {
      ...created,
      layout: JSON.parse(created.layout),
      widgets: JSON.parse(created.widgets),
      settings: JSON.parse(created.settings),
    },
    sourceModelHint: src.model_name || null,
  });
});

// Create report
router.post('/', requireAuth, (req, res) => {
  const id = uuidv4();
  const { title, modelId, workspaceId, settings } = req.body;

  if (!modelId) {
    return res.status(400).json({ error: 'A data model is required' });
  }

  // Bake in initial settings (e.g. createdTheme) at creation time
  const initialSettings = settings && typeof settings === 'object' ? JSON.stringify(settings) : '{}';

  db.prepare('INSERT INTO reports (id, user_id, model_id, title, workspace_id, settings) VALUES (?, ?, ?, ?, ?, ?)').run(
    id, req.user.id, modelId, title || 'Untitled Report', workspaceId || null, initialSettings
  );

  const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(id);
  res.status(201).json({
    report: {
      ...report,
      layout: JSON.parse(report.layout),
      widgets: JSON.parse(report.widgets),
      settings: JSON.parse(report.settings),
    },
  });
});

// Update report
router.put('/:id', requireAuth, (req, res) => {
  const report = db.prepare('SELECT * FROM reports WHERE id = ? AND user_id = ?').get(
    req.params.id, req.user.id
  );

  if (!report) {
    return res.status(404).json({ error: 'Report not found' });
  }

  const { title, layout, widgets, settings, is_public, workspace_id, pages } = req.body;

  // Merge pages into settings for storage
  const mergedSettings = { ...(settings || {}), ...(pages ? { pages } : {}) };

  db.prepare(`
    UPDATE reports SET
      title = COALESCE(?, title),
      layout = COALESCE(?, layout),
      widgets = COALESCE(?, widgets),
      settings = COALESCE(?, settings),
      is_public = COALESCE(?, is_public),
      workspace_id = CASE WHEN ? = 1 THEN ? ELSE workspace_id END,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    title || null,
    layout ? JSON.stringify(layout) : null,
    widgets ? JSON.stringify(widgets) : null,
    mergedSettings ? JSON.stringify(mergedSettings) : null,
    is_public !== undefined ? (is_public ? 1 : 0) : null,
    workspace_id !== undefined ? 1 : 0,
    workspace_id !== undefined ? workspace_id : null,
    req.params.id
  );

  const updated = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id);
  const parsedSettings = JSON.parse(updated.settings);
  res.json({
    report: {
      ...updated,
      layout: JSON.parse(updated.layout),
      widgets: JSON.parse(updated.widgets),
      settings: parsedSettings,
      pages: parsedSettings.pages || null,
    },
  });
});

// Delete report
router.delete('/:id', requireAuth, (req, res) => {
  const result = db.prepare('DELETE FROM reports WHERE id = ? AND user_id = ?').run(
    req.params.id, req.user.id
  );

  if (result.changes === 0) {
    return res.status(404).json({ error: 'Report not found' });
  }

  res.json({ message: 'Report deleted' });
});

module.exports = router;
module.exports.canAccessReport = canAccessReport;
