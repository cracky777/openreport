const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { authFor } = require('../middleware/auth');
const db = require('../db');
const { ensurePersonalWorkspace } = require('../utils/personalWorkspace');
const { getPublicSharingPolicy } = require('../utils/settingsHelper');
const queryCache = require('../utils/queryCache');
// Cloud extension points (null in OSS). See server/cloudHooks.js.
const cloudHooks = require('../cloudHooks');
const embedToken = require('../utils/embedToken');
const usage = require('../utils/usage');

const router = express.Router();

// Materialise req.embedPrincipal from a signed X-Embed-Token — the grant
// behind /embed pages. Mounted here AND in routes/models.js so both the
// report fetch and the widget queries honour the same token.
router.use(embedToken.middleware);

// Strip widget.data from a widgets map. Used to prevent the owner's pre-baked
// snapshot from leaking to non-owner viewers (it bypasses RLS). The viewer will
// re-query each widget itself, going through the RLS-aware /models/:id/query path.
// Widget types whose `data` is AUTHORED content (typed by the report author),
// not a query result: stripping it would blank the widget for every reader
// who isn't the owner. Query-backed widgets get their data re-fetched under
// the reader's own RLS instead.
const AUTHORED_DATA_TYPES = new Set(['text']);

function stripWidgetData(widgets) {
  if (!widgets || typeof widgets !== 'object') return widgets;
  const out = {};
  for (const [id, w] of Object.entries(widgets)) {
    if (!w || typeof w !== 'object') { out[id] = w; continue; }
    if (AUTHORED_DATA_TYPES.has(w.type)) { out[id] = w; continue; }
    const { data: _data, ...rest } = w;
    out[id] = rest;
  }
  return out;
}

// Authorization helper used by report viewing and downstream model/query routes.
// A user can access a report if they own it, it's public, they are a global admin,
// or they're a member of the workspace containing it. The cloud edition replaces
// this whole decision with an org read-role check via cloudHooks.canAccessReport.
function canAccessReport(report, user, req) {
  // A signed embed token grants exactly its own report — checked before the
  // cloud delegation so embeds behave identically in both editions. Model
  // access follows through canAccessModel's report walk; nothing else opens.
  if (report && req && req.embedPrincipal && req.embedPrincipal.reportId === report.id) return true;
  if (typeof cloudHooks.canAccessReport === 'function') return cloudHooks.canAccessReport(report, user, req);
  if (!report) return false;
  // Kill switch: with sharing disabled, already-public reports stop serving
  // through the public branch — signed-in access paths below still apply.
  if (report.is_public && getPublicSharingPolicy() !== 'disabled') return true;
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
// Cloud replaces this with an org read-role check via cloudHooks.canAccessModel.
function canAccessModel(model, user, req) {
  // An embed token grants exactly the model behind ITS report. Checked before
  // the cloud delegation, like canAccessReport above: the cloud hook knows
  // nothing about embed principals, so without this an embed could load the
  // report but every widget query came back 404 — the feature only appeared
  // to work when the report happened to be public.
  if (model && req && req.embedPrincipal) {
    const embedded = db.prepare('SELECT model_id FROM reports WHERE id = ?').get(req.embedPrincipal.reportId);
    if (embedded && embedded.model_id === model.id) return true;
  }
  if (typeof cloudHooks.canAccessModel === 'function') return cloudHooks.canAccessModel(model, user, req);
  if (!model) return false;
  if (user && user.role === 'admin') return true;
  if (user && user.id === model.user_id) return true;
  // Check every report that uses this model — if the user can access any of them, they can use the model.
  const reports = db.prepare('SELECT * FROM reports WHERE model_id = ?').all(model.id);
  return reports.some((r) => canAccessReport(r, user, req));
}

// Write access: who may mutate a model (edit / delete / re-validate / column
// overrides). OSS: the model owner or a global admin. Cloud replaces this with
// the org write-role check (editor/admin) via cloudHooks.canWriteModel.
function canWriteModel(model, user, req) {
  if (typeof cloudHooks.canWriteModel === 'function') return cloudHooks.canWriteModel(model, user, req);
  if (!model || !user) return false;
  return user.id === model.user_id || user.role === 'admin';
}

// Building a report on a model is not editing it. What this guard has to
// exclude is the caller whose ONLY route to the model is someone else's shared
// report: they could build on it, flip the report public, and open anonymous
// /query on data that is not theirs. OSS has no tenant to lean on, so the
// honest bar is owner-or-admin. Cloud delegates and answers a different, richer
// question — "is this model in your org?" — because there a viewer who is
// editor on a workspace is a legitimate report author, while the public-report
// path stays excluded. Deliberately NOT canWriteModel: that one means "may edit
// the model", which authoring a report never requires.
function canBuildOnModel(model, user, req) {
  if (typeof cloudHooks.canBuildOnModel === 'function') return cloudHooks.canBuildOnModel(model, user, req);
  if (!model || !user) return false;
  return user.id === model.user_id || user.role === 'admin';
}

// Read access to a model's METADATA (GET /:id). OSS: same as query access.
// Cloud makes it stricter (org membership only, no public-report path) so a
// public-report viewer can /query the model but not enumerate its full schema.
function canReadModel(model, user, req) {
  if (typeof cloudHooks.canReadModel === 'function') return cloudHooks.canReadModel(model, user, req);
  return canAccessModel(model, user, req);
}

// Write access to a report (edit / delete / duplicate). OSS: owner or global
// admin. Cloud: org admin, or workspace owner/admin/editor, or (personal
// report) owner + org editor.
function canWriteReport(report, user, req) {
  if (typeof cloudHooks.canWriteReport === 'function') return cloudHooks.canWriteReport(report, user, req);
  if (!report || !user) return false;
  return user.id === report.user_id || user.role === 'admin';
}

// View / restore a report's version history. OSS: global admin. Cloud: org admin.
function canManageReportHistory(report, user, req) {
  if (typeof cloudHooks.canManageReportHistory === 'function') return cloudHooks.canManageReportHistory(report, user, req);
  return !!user && user.role === 'admin';
}

// May the caller put a report in this workspace? Same decision workspaces.js
// makes, delegated to the same hook so cloud org-scopes it identically.
//
// The previous check passed a synthetic row carrying the caller's own user_id
// to canWriteReport, whose owner test then matched every time: the workspace
// named in the request was never actually consulted, and a report could be
// dropped into anyone's workspace.
function canPlaceReportIn(workspaceId, req) {
  if (!workspaceId) return false;
  if (typeof cloudHooks.canAdminAllWorkspaces === 'function'
    ? cloudHooks.canAdminAllWorkspaces(req)
    : req.user.role === 'admin') return true;
  const access = typeof cloudHooks.workspaceAccess === 'function'
    ? cloudHooks.workspaceAccess(workspaceId, req)
    : (() => {
      const ws = db.prepare('SELECT owner_id FROM workspaces WHERE id = ?').get(workspaceId);
      if (!ws) return null;
      if (ws.owner_id === req.user.id) return { role: 'admin' };
      const member = db.prepare('SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?').get(workspaceId, req.user.id);
      return member ? { role: member.role } : null;
    })();
  return !!access && access.role !== 'viewer';
}

// Fallback workspace for a report with no explicit one. OSS: the user's personal
// workspace. Cloud: their personal workspace within the active org.
function defaultWorkspaceFor(req) {
  if (typeof cloudHooks.resolveDefaultWorkspace === 'function') return cloudHooks.resolveDefaultWorkspace(req);
  return ensurePersonalWorkspace(req.user.id);
}

// Post-INSERT tenant-column stamp (cloud: organization_id). No-op in OSS.
function stampNewReport(req, reportId) {
  if (typeof cloudHooks.onReportCreate === 'function') cloudHooks.onReportCreate(req, reportId);
}

// Did an edit touch anything the cached rows were computed from? Only the
// report-scoped formulas qualify: everything else in `settings` is presentation.
function formulasChanged(beforeJson, afterJson) {
  const pick = (raw) => {
    try {
      const s = JSON.parse(raw || '{}');
      return JSON.stringify([s.extraMeasures || null, s.measureOverrides || null,
        s.extraDimensions || null, s.dimensionOverrides || null]);
    } catch { return raw || ''; /* unparseable: treat as changed */ }
  };
  return pick(beforeJson) !== pick(afterJson);
}

// A report's title must be unique within its workspace (case-insensitive). The
// scope is the workspace itself, so no cloud hook is needed. Sends the 409 and
// returns true on conflict. The default 'Untitled Report' and blank titles are
// exempt so multiple drafts (and duplicate/import, which suffix the title) work.
function rejectIfReportTitleTaken(workspaceId, title, res, excludeId) {
  const t = typeof title === 'string' ? title.trim() : '';
  if (!t || t === 'Untitled Report' || !workspaceId) return false;
  const sql = `SELECT id FROM reports WHERE workspace_id = ? AND title = ? COLLATE NOCASE${excludeId ? ' AND id != ?' : ''}`;
  const args = excludeId ? [workspaceId, t, excludeId] : [workspaceId, t];
  if (db.prepare(sql).get(...args)) {
    res.status(409).json({ error: `A report named "${t}" already exists in this workspace.` });
    return true;
  }
  return false;
}

// A free title for a name the APP generated rather than the user typed.
//
// Rejecting a generated title makes the product argue with itself: "New report"
// on a model always proposes "<model> — Report", so the second one failed with
// an error about a name nobody chose. A typed title still gets its 409 — there
// the conflict is worth telling the user about.
//
// Suffixes " (2)", " (3)"… and keeps counting, so the free slot left by a
// deleted "(2)" is reused rather than skipped.
function uniqueReportTitle(workspaceId, title) {
  const base = typeof title === 'string' ? title.trim() : '';
  if (!base || !workspaceId) return base;
  const taken = (t) => !!db.prepare('SELECT id FROM reports WHERE workspace_id = ? AND title = ? COLLATE NOCASE').get(workspaceId, t);
  if (!taken(base)) return base;
  // Bounded: a workspace that somehow holds 999 of the same name gets the
  // plain title back and the usual uniqueness error, rather than a hung loop.
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base} (${n})`;
    if (!taken(candidate)) return candidate;
  }
  return base;
}

// List reports for current user
router.get('/', authFor('read'), (req, res) => {
  // Cloud scopes the list to the active org (cloudHooks.listReports); OSS lists
  // the caller's own reports. Both return the same row shape for the map below.
  const rows = typeof cloudHooks.listReports === 'function'
    ? cloudHooks.listReports(req)
    : db.prepare(`
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

  if (!canAccessReport(report, req.user, req)) {
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

  // A read of the report by a human: the Viewer flags its load with
  // ?view=1 (not in print mode — the PDF renderer isn't a reader). Editor
  // opens and API consumers don't count.
  if (req.query.view === '1') {
    usage.record({
      kind: 'report_view',
      userId: req.user ? req.user.id : null,
      reportId: report.id,
      modelId: report.model_id,
      organizationId: report.organization_id || null,
      detail: req.user ? null : 'anonymous',
    });
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

// Mint a signed embed token for one report. Same authorization bar as
// flipping a report public (write access to the underlying MODEL): an embed
// token hands report data to an external page, so whoever owns the data —
// not merely the report author — must be the one signing it out.
router.post('/:id/embed-token', authFor('read'), (req, res) => {
  const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id);
  if (!report) return res.status(404).json({ error: 'Report not found' });
  const model = db.prepare('SELECT * FROM models WHERE id = ?').get(report.model_id);
  if (!model || !canWriteModel(model, req.user, req)) {
    return res.status(403).json({ error: 'Only someone with write access to the underlying model can create embed tokens' });
  }

  const { email, groups, lockedFilters, expiresIn } = req.body || {};
  // Locked filters travel inside the signed token and are re-applied
  // server-side on every query — validate the shape now so a malformed rule
  // can't 500 later inside the compiler.
  const cleanedFilters = [];
  for (const f of Array.isArray(lockedFilters) ? lockedFilters : []) {
    if (!f || typeof f.field !== 'string' || !f.field || typeof f.op !== 'string' || f.isMeasure) {
      return res.status(400).json({ error: 'Each locked filter needs a dimension field and an op' });
    }
    cleanedFilters.push({ field: f.field, op: f.op, ...(f.values !== undefined ? { values: f.values } : {}), ...(f.value !== undefined ? { value: f.value } : {}) });
  }
  const cleanedGroups = (Array.isArray(groups) ? groups : []).map((g) => String(g).trim()).filter(Boolean);

  const ttl = Math.min(Math.max(parseInt(expiresIn, 10) || embedToken.DEFAULT_TTL_SECONDS, 60), embedToken.MAX_TTL_SECONDS);
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
  // Record the token so it can be listed and revoked before it lapses.
  const jti = uuidv4();
  const token = embedToken.sign({
    reportId: report.id,
    email: email ? String(email) : undefined,
    groups: cleanedGroups,
    lockedFilters: cleanedFilters,
    expiresIn,
    jti,
  });
  db.prepare(`INSERT INTO embed_tokens (jti, report_id, created_by, label, expires_at)
              VALUES (?, ?, ?, ?, ?)`)
    .run(jti, report.id, req.user ? req.user.id : null, email ? String(email) : null, expiresAt);
  res.status(201).json({
    id: jti,
    token,
    url: `${req.protocol}://${req.get('host')}/embed/${report.id}?token=${encodeURIComponent(token)}`,
    expiresAt,
  });
});

// The embed links currently live for a report. Same bar as minting one: an
// embed hands the report's data to an outside page, so whoever owns the data
// decides which of those links stay open.
router.get('/:id/embed-tokens', authFor('read'), (req, res) => {
  const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id);
  if (!report) return res.status(404).json({ error: 'Report not found' });
  const model = db.prepare('SELECT * FROM models WHERE id = ?').get(report.model_id);
  if (!model || !canWriteModel(model, req.user, req)) {
    return res.status(403).json({ error: 'Only someone with write access to the underlying model can manage embed links' });
  }
  const tokens = db.prepare(`
    SELECT t.jti AS id, t.label, t.created_at, t.expires_at, t.revoked_at, u.email AS created_by_email
    FROM embed_tokens t LEFT JOIN users u ON u.id = t.created_by
    WHERE t.report_id = ? ORDER BY t.created_at DESC
  `).all(report.id);
  res.json({ tokens });
});

// Revoke one embed link (or every link of the report with ?all=1). Takes
// effect immediately: verify() refuses a revoked token id on the next request.
router.delete('/:id/embed-tokens/:jti', authFor('read'), (req, res) => {
  const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id);
  if (!report) return res.status(404).json({ error: 'Report not found' });
  const model = db.prepare('SELECT * FROM models WHERE id = ?').get(report.model_id);
  if (!model || !canWriteModel(model, req.user, req)) {
    return res.status(403).json({ error: 'Only someone with write access to the underlying model can manage embed links' });
  }
  const revokeAll = req.params.jti === 'all';
  const result = revokeAll
    ? db.prepare("UPDATE embed_tokens SET revoked_at = datetime('now') WHERE report_id = ? AND revoked_at IS NULL").run(report.id)
    : db.prepare("UPDATE embed_tokens SET revoked_at = datetime('now') WHERE report_id = ? AND jti = ? AND revoked_at IS NULL")
      .run(report.id, req.params.jti);
  res.json({ revoked: result.changes });
});

// Import report from a raw JSON bundle (the file produced by the client-side
// "Export raw (JSON)" action). The bundle's shape is:
//   { format: 'open-report.report.v1', exportedAt, report: { title, model_id, layout, widgets, settings, pages } }
// We DON'T try to recreate the source datasource or model — the importer must
// pick one they already have access to via `modelId` in the query/body.
// model_name in the bundle is only used to surface a hint in the response.
router.post('/import', authFor('read'), (req, res) => {
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

  // The importer must be able to WRITE the target model — never let an import
  // silently bind to a model they can't edit (OSS: owner/admin; cloud: org
  // write-role on the model's org).
  const model = db.prepare('SELECT * FROM models WHERE id = ?').get(modelId);
  if (!model) return res.status(404).json({ error: 'Target model not found' });
  if (!canBuildOnModel(model, req.user, req)) {
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

  // Reports always live in a workspace — fall back to the caller's personal
  // workspace when they didn't pick one, so custom visuals etc. remain available.
  const targetWs = workspaceId || defaultWorkspaceFor(req);
  // Must be allowed to create a report in the target workspace.
  if (!canPlaceReportIn(targetWs, req)) {
    return res.status(403).json({ error: 'Not authorized to create a report in this workspace' });
  }
  db.prepare(`
    INSERT INTO reports (id, user_id, model_id, title, workspace_id, layout, widgets, settings)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, req.user.id, modelId, title, targetWs,
    JSON.stringify(layout), JSON.stringify(widgets), JSON.stringify(settings),
  );
  stampNewReport(req, id);

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
router.post('/', authFor('read'), (req, res) => {
  const id = uuidv4();
  const { title, modelId, workspaceId, settings, autoTitle } = req.body;

  if (!modelId) {
    return res.status(400).json({ error: 'A data model is required' });
  }

  // Authorize the model BEFORE inserting — otherwise a low-privilege user could
  // create a report on someone else's (RLS-protected) model and later persist
  // custom-SQL measures against it. Checked here (pre-insert) so the not-yet-created
  // report can't grant access to itself via canAccessModel.
  // Write, not read: a model one can merely read through someone else's shared
  // report is not a model one may build on. Reading was enough to create a
  // report on a stranger's model and then flip it public, which opens anonymous
  // /query on their data. POST /import already guards this way.
  const model = db.prepare('SELECT * FROM models WHERE id = ?').get(modelId);
  if (!model) return res.status(404).json({ error: 'Model not found' });
  if (!canBuildOnModel(model, req.user, req)) {
    return res.status(403).json({ error: 'Not authorized for this model' });
  }

  // Bake in initial settings (e.g. createdTheme) at creation time
  const initialSettings = settings && typeof settings === 'object' ? JSON.stringify(settings) : '{}';

  const targetWs = workspaceId || defaultWorkspaceFor(req);
  if (!canPlaceReportIn(targetWs, req)) {
    return res.status(403).json({ error: 'Not authorized to create a report in this workspace' });
  }
  // A generated title is made unique; a typed one is defended.
  const finalTitle = autoTitle ? uniqueReportTitle(targetWs, title) : title;
  if (!autoTitle && rejectIfReportTitleTaken(targetWs, title, res)) return;
  db.prepare('INSERT INTO reports (id, user_id, model_id, title, workspace_id, settings) VALUES (?, ?, ?, ?, ?, ?)').run(
    id, req.user.id, modelId, finalTitle || 'Untitled Report', targetWs, initialSettings
  );
  stampNewReport(req, id);

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
router.put('/:id', authFor('read'), (req, res) => {
  const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id);
  // 404 when the report isn't even visible (hides existence cross-tenant), 403
  // when it's visible but the caller can't write it.
  if (!report || !canAccessReport(report, req.user, req)) {
    return res.status(404).json({ error: 'Report not found' });
  }
  if (!canWriteReport(report, req.user, req)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  // Re-check model access on edit too. Authoritative gating of custom-SQL
  // measure execution lives in models.js /query (model-owner/admin only); this
  // is defense-in-depth so a report can't be repointed/edited against a model
  // the caller has lost access to.
  const model = db.prepare('SELECT * FROM models WHERE id = ?').get(report.model_id);
  if (model && !canBuildOnModel(model, req.user, req)) {
    return res.status(403).json({ error: 'Not authorized for this model' });
  }

  const { title, layout, widgets, settings, is_public, live_mode, workspace_id, pages } = req.body;

  // Publishing exposes the MODEL, not just this report: /query answers anonymous
  // callers for a public report. Owning the report is therefore not enough —
  // whoever owns the data has to be the one deciding it goes public. On top of
  // that per-model bar, the instance-wide policy lets the admin restrict the
  // capability itself.
  if (is_public) {
    const policy = getPublicSharingPolicy();
    if (policy === 'disabled') {
      return res.status(403).json({ error: 'Public sharing is disabled on this instance' });
    }
    if (policy === 'admins' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only an admin can make a report public on this instance' });
    }
    if (!canWriteModel(model, req.user, req)) {
      return res.status(403).json({ error: 'Only someone with write access to the underlying model can make a report public' });
    }
  }
  // Moving a report is placing it: the destination gets the same check as a
  // creation, or a report could be pushed into a workspace of someone else.
  if (workspace_id !== undefined && workspace_id !== report.workspace_id
    && !canPlaceReportIn(workspace_id, req)) {
    return res.status(403).json({ error: 'Not authorized to move a report into this workspace' });
  }
  // Title stays unique within the (possibly new) workspace.
  if (title !== undefined
    && rejectIfReportTitleTaken(workspace_id !== undefined ? workspace_id : report.workspace_id, title, res, req.params.id)) return;

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

  // extraMeasures / measureOverrides live in the REPORT, not the model, but the
  // cache is keyed by model: editing a formula left the previous result being
  // served until something else happened to evict it. Only when those keys
  // actually moved — a rename or a layout nudge must not cost a full recompute.
  if (settingsParam !== null && report.model_id && formulasChanged(report.settings, settingsParam)) {
    queryCache.invalidateModel(report.model_id);
  }

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

// Duplicate report — creates a copy owned by the caller.
router.post('/:id/duplicate', authFor('read'), (req, res) => {
  const src = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id);
  if (!src || !canAccessReport(src, req.user, req)) return res.status(404).json({ error: 'Report not found' });
  if (!canWriteReport(src, req.user, req)) return res.status(403).json({ error: 'Access denied' });

  const newId = uuidv4();
  const newTitle = `${src.title} (copy)`.slice(0, 200);
  // Copying someone else's report must not hand over their pre-baked widget
  // data: that snapshot was computed under THEIR identity and bypasses the
  // copier's RLS — GET /:id strips it for exactly that reason. And the copy
  // belongs to the copier, so it must not land inside the source's workspace
  // (a foreign row in a workspace they may not even be a member of).
  const isSrcOwner = req.user && req.user.id === src.user_id;
  const widgetsForCopy = isSrcOwner
    ? src.widgets
    : JSON.stringify(stripWidgetData(JSON.parse(src.widgets || '{}')));
  const workspaceForCopy = isSrcOwner ? src.workspace_id : null;
  db.prepare(`
    INSERT INTO reports (id, user_id, model_id, title, workspace_id, layout, widgets, settings)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(newId, req.user.id, src.model_id, newTitle, workspaceForCopy, src.layout, widgetsForCopy, src.settings);
  stampNewReport(req, newId);

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
router.get('/:id/history', authFor('read'), (req, res) => {
  const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id);
  if (!report || !canAccessReport(report, req.user, req)) return res.status(404).json({ error: 'Report not found' });
  if (!canManageReportHistory(report, req.user, req)) return res.status(403).json({ error: 'Admin access required' });
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
router.post('/:id/history/:versionId/restore', authFor('read'), (req, res) => {
  const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id);
  if (!report || !canAccessReport(report, req.user, req)) return res.status(404).json({ error: 'Report not found' });
  if (!canManageReportHistory(report, req.user, req)) return res.status(403).json({ error: 'Admin access required' });
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
router.delete('/:id', authFor('read'), (req, res) => {
  const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id);
  if (!report || !canAccessReport(report, req.user, req)) return res.status(404).json({ error: 'Report not found' });
  if (!canWriteReport(report, req.user, req)) return res.status(403).json({ error: 'Access denied' });

  db.prepare('DELETE FROM reports WHERE id = ?').run(req.params.id);
  res.json({ message: 'Report deleted' });
});

module.exports = router;
module.exports.canAccessReport = canAccessReport;
module.exports.canAccessModel = canAccessModel;
module.exports.canWriteModel = canWriteModel;
module.exports.canBuildOnModel = canBuildOnModel;
module.exports.canReadModel = canReadModel;
module.exports.canWriteReport = canWriteReport;
