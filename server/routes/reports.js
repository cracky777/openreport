const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { requireAuth, requireRole } = require('../middleware/auth');
const db = require('../db');
const { ensurePersonalWorkspace } = require('../utils/personalWorkspace');

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

// Returns true if the user has access to the model, either directly (owner / global admin)
// or indirectly through a report that uses the model (public or workspace-shared).
function canAccessModel(model, user) {
  if (!model) return false;
  if (user && user.role === 'admin') return true;
  if (user && user.id === model.user_id) return true;
  // Check every report that uses this model — if the user can access any of them, they can use the model.
  const reports = db.prepare('SELECT * FROM reports WHERE model_id = ?').all(model.id);
  return reports.some((r) => canAccessReport(r, user));
}

// List reports for current user
router.get('/', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT r.id, r.title, r.model_id, r.workspace_id, r.is_public, r.live_mode, r.created_at, r.updated_at,
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
    const out = { id: r.id, title: r.title, model_id: r.model_id, workspace_id: r.workspace_id, is_public: r.is_public, live_mode: r.live_mode, created_at: r.created_at, updated_at: r.updated_at, model_name: r.model_name, datasource_id: r.datasource_id, db_type: r.db_type };
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
  // their own model going forward, subject to their RLS. EXCEPT for the
  // text widget: its body is persisted as `widget.data.text` (the only
  // "user-authored" payload that lives on `.data` rather than on
  // `.config`), and stripping it would land the imported report with
  // every text block reset to "Double-click to edit". Keep `data.text`
  // explicitly; everything else under `.data` (cached rows, _fetched*
  // markers, etc.) goes.
  const cleanWidgets = (map) => {
    if (!map || typeof map !== 'object') return {};
    const out = {};
    for (const [wId, w] of Object.entries(map)) {
      if (w && typeof w === 'object') {
        const { data: _d, ...rest } = w;
        if (w.type === 'text' && _d && typeof _d.text === 'string') {
          out[wId] = { ...rest, data: { text: _d.text } };
        } else {
          out[wId] = rest;
        }
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

  // Reports always live in a workspace — fall back to the user's personal
  // workspace when the caller didn't pick one, so custom visuals etc. remain available.
  const targetWs = workspaceId || ensurePersonalWorkspace(req.user.id);
  db.prepare(`
    INSERT INTO reports (id, user_id, model_id, title, workspace_id, layout, widgets, settings)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, req.user.id, modelId, title, targetWs,
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

  // Authorize the model BEFORE inserting — otherwise a low-privilege user could
  // create a report on someone else's (RLS-protected) model and later persist
  // custom-SQL measures against it. Checked here (pre-insert) so the not-yet-created
  // report can't grant access to itself via canAccessModel.
  const model = db.prepare('SELECT * FROM models WHERE id = ?').get(modelId);
  if (!model) return res.status(404).json({ error: 'Model not found' });
  if (!canAccessModel(model, req.user)) {
    return res.status(403).json({ error: 'Not authorized for this model' });
  }

  // Bake in initial settings (e.g. createdTheme) at creation time
  const initialSettings = settings && typeof settings === 'object' ? JSON.stringify(settings) : '{}';

  const targetWs = workspaceId || ensurePersonalWorkspace(req.user.id);
  db.prepare('INSERT INTO reports (id, user_id, model_id, title, workspace_id, settings) VALUES (?, ?, ?, ?, ?, ?)').run(
    id, req.user.id, modelId, title || 'Untitled Report', targetWs, initialSettings
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

// Snapshot the current state of a report into report_versions, then prune to
// the most recent 20. Called before a content-changing update so an admin can
// roll back. Metadata-only saves (workspace_id, is_public) skip this.
function snapshotReportVersion(reportId, savedBy) {
  const r = db.prepare(
    'SELECT title, layout, widgets, settings, model_id FROM reports WHERE id = ?'
  ).get(reportId);
  if (!r) return;
  db.prepare(`
    INSERT INTO report_versions (id, report_id, saved_by, title, layout, widgets, settings, model_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(uuidv4(), reportId, savedBy || null, r.title, r.layout, r.widgets, r.settings, r.model_id);
  db.prepare(`
    DELETE FROM report_versions
    WHERE report_id = ? AND id NOT IN (
      SELECT id FROM report_versions WHERE report_id = ? ORDER BY saved_at DESC LIMIT 20
    )
  `).run(reportId, reportId);
}

// Update report
router.put('/:id', requireAuth, (req, res) => {
  const report = db.prepare('SELECT * FROM reports WHERE id = ? AND user_id = ?').get(
    req.params.id, req.user.id
  );

  if (!report) {
    return res.status(404).json({ error: 'Report not found' });
  }

  // Re-check model access on edit too. Authoritative gating of custom-SQL
  // measure execution lives in models.js /query (model-owner/admin only); this
  // is defense-in-depth so a report can't be repointed/edited against a model
  // the caller has lost access to.
  const model = db.prepare('SELECT * FROM models WHERE id = ?').get(report.model_id);
  if (model && !canAccessModel(model, req.user)) {
    return res.status(403).json({ error: 'Not authorized for this model' });
  }

  const { title, layout, widgets, settings, is_public, live_mode, workspace_id, pages } = req.body;

  // Only build a settings payload when the caller actually supplied one.
  // Returning null lets the COALESCE keep the existing row value — otherwise
  // metadata-only saves (toggle is_public, rename, move workspace) would
  // overwrite settings with `{}` and lose extraDimensions / extraMeasures.
  const settingsParam = (settings !== undefined || pages !== undefined)
    ? JSON.stringify({ ...(settings || {}), ...(pages ? { pages } : {}) })
    : null;

  // Snapshot the BEFORE state for content changes only — skip metadata-only saves.
  const isContentChange = title !== undefined
    || layout !== undefined
    || widgets !== undefined
    || settings !== undefined
    || pages !== undefined;
  if (isContentChange) snapshotReportVersion(req.params.id, req.user.id);

  db.prepare(`
    UPDATE reports SET
      title = COALESCE(?, title),
      layout = COALESCE(?, layout),
      widgets = COALESCE(?, widgets),
      settings = COALESCE(?, settings),
      is_public = COALESCE(?, is_public),
      live_mode = COALESCE(?, live_mode),
      workspace_id = CASE WHEN ? = 1 THEN ? ELSE workspace_id END,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    title || null,
    layout ? JSON.stringify(layout) : null,
    widgets ? JSON.stringify(widgets) : null,
    settingsParam,
    is_public !== undefined ? (is_public ? 1 : 0) : null,
    live_mode !== undefined ? (live_mode ? 1 : 0) : null,
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

// Duplicate report — creates a copy in the same workspace, owned by the caller.
router.post('/:id/duplicate', requireAuth, (req, res) => {
  const src = db.prepare('SELECT * FROM reports WHERE id = ? AND user_id = ?').get(
    req.params.id, req.user.id
  );
  if (!src) return res.status(404).json({ error: 'Report not found' });

  const newId = uuidv4();
  const newTitle = `${src.title} (copy)`.slice(0, 200);
  db.prepare(`
    INSERT INTO reports (id, user_id, model_id, title, workspace_id, layout, widgets, settings)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(newId, req.user.id, src.model_id, newTitle, src.workspace_id, src.layout, src.widgets, src.settings);

  const created = db.prepare('SELECT * FROM reports WHERE id = ?').get(newId);
  res.status(201).json({
    report: {
      ...created,
      layout: JSON.parse(created.layout),
      widgets: JSON.parse(created.widgets),
      settings: JSON.parse(created.settings),
    },
  });
});

// History (admin only) — list saved versions, newest first. Bodies excluded
// from the list payload to keep it small; use /restore to materialize one.
router.get('/:id/history', requireAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  const exists = db.prepare('SELECT 1 FROM reports WHERE id = ?').get(req.params.id);
  if (!exists) return res.status(404).json({ error: 'Report not found' });
  const rows = db.prepare(`
    SELECT v.id, v.title, v.saved_at, v.saved_by, u.email AS saved_by_email, u.display_name AS saved_by_name
    FROM report_versions v
    LEFT JOIN users u ON u.id = v.saved_by
    WHERE v.report_id = ?
    ORDER BY v.saved_at DESC
  `).all(req.params.id);
  res.json({ versions: rows });
});

// Restore a version (admin only). Snapshots the current state first so the
// rollback itself is recoverable, then overwrites the report with the version.
router.post('/:id/history/:versionId/restore', requireAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  const report = db.prepare('SELECT id FROM reports WHERE id = ?').get(req.params.id);
  if (!report) return res.status(404).json({ error: 'Report not found' });
  const version = db.prepare(
    'SELECT * FROM report_versions WHERE id = ? AND report_id = ?'
  ).get(req.params.versionId, req.params.id);
  if (!version) return res.status(404).json({ error: 'Version not found' });

  // Snapshot current state before overwriting so the restore is itself reversible.
  snapshotReportVersion(req.params.id, req.user.id);

  db.prepare(`
    UPDATE reports SET
      title = ?, layout = ?, widgets = ?, settings = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(version.title, version.layout, version.widgets, version.settings, req.params.id);

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
module.exports.canAccessModel = canAccessModel;
