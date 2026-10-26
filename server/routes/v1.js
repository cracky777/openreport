/**
 * Public API, v1 — the only surface an API token can reach.
 *
 *   GET  /api/v1/whoami                  identity behind the token
 *   GET  /api/v1/models                  models the caller can see
 *   GET  /api/v1/reports                 reports the caller can see
 *   POST /api/v1/models/:id/refresh      rebuild that model's cache
 *   POST /api/v1/reports/:id/refresh     same, addressed by report
 *   GET  /api/v1/metadata/...            reports and semantic models for a catalog (scope `metadata`)
 *
 * Two rules make this router different from the rest of /api:
 *
 * 1. The contract is frozen. Browser routes change with the UI; anything here
 *    is something a customer's ETL job depends on. Breaking changes go to v2.
 * 2. It is the ONLY place apiToken.middleware runs. A new route elsewhere in
 *    the app cannot silently become token-reachable — it has to be added here.
 *
 * Authorization is unchanged from the browser paths: the token resolves to its
 * owner, then canAccessModel / canBuildOnModel decide, exactly as for a session.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { withoutDrafts } = require('../utils/reportDrafts');
const apiToken = require('../utils/apiToken');
const { requireAuth } = require('../middleware/auth');
const rollupBuilder = require('../utils/rollupBuilder');
const { canAccessModel, canAccessReport, canBuildOnModel, canWriteModel } = require('./reports');
const catalog = require('../utils/metadata/catalog');
const cloudHooks = require('../cloudHooks');

const router = express.Router();

// A public API is reachable by anyone holding a string, so a leaked token
// shouldn't also mean unbounded load. Generous for a scheduled ETL job (which
// refreshes on the order of times per hour), low enough that a scripted loop
// against /refresh — the one endpoint that costs real database work — hits a
// wall. Keyed per IP, like the auth limiters.
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  // Tests drive the router in-process without a socket address; skipping there
  // keeps the limiter from bucketing every request under a single undefined key.
  skip: () => process.env.NODE_ENV === 'test',
  message: { error: 'Rate limit exceeded. Try again shortly.' },
});

router.use(apiLimiter);
router.use(apiToken.middleware);

router.get('/whoami', requireAuth, (req, res) => {
  res.json({
    user: { id: req.user.id, email: req.user.email, display_name: req.user.display_name, role: req.user.role },
    // null for a browser session — it isn't scope-limited.
    scopes: req.apiTokenScopes || null,
  });
});

router.get('/models', requireAuth, apiToken.requireScope('read'), (req, res) => {
  const wsAccess = require('../utils/workspaceAccess');
  const models = wsAccess.listVisibleModels(wsAccess.actorOf(req));
  res.json({ models: models.map((m) => ({ id: m.id, name: m.name, description: m.description, updated_at: m.updated_at })) });
});

router.get('/reports', requireAuth, apiToken.requireScope('read'), (req, res) => {
  const rows = typeof cloudHooks.listReports === 'function'
    ? withoutDrafts(cloudHooks.listReports(req))
    : db.prepare(`
      SELECT r.id, r.title, r.model_id, r.updated_at, r.cache_built_at
      FROM reports r WHERE r.user_id = ? AND r.draft = 0 ORDER BY r.updated_at DESC
    `).all(req.user.id);
  res.json({ reports: rows.map((r) => ({ id: r.id, title: r.title, model_id: r.model_id, updated_at: r.updated_at, cache_built_at: r.cache_built_at })) });
});

/**
 * One refresh, whatever the caller happens to hold an id for.
 *
 * The UI exposes two buttons — "rebuild rollups" on a model, "warm now" on a
 * report — but both already funnel into buildRollupsForModel, which invalidates
 * the query cache and stamps cache_built_at on the model's reports. The split
 * is an addressing detail, so v1 exposes it as one verb on both nouns rather
 * than making an ETL author read ROLLUP-CACHE.md to pick.
 */
async function refreshModel(model, req, res) {
  if (!canBuildOnModel(model, req.user, req)) return res.status(403).json({ error: 'Forbidden' });
  try {
    const result = await rollupBuilder.buildRollupsForModel({
      modelId: model.id,
      internalUserId: req.user.id,
      orgId: req.organizationId || null,
      log: process.env.ROLLUP_LOG !== '0',
    });
    res.json({ model_id: model.id, refreshed_at: new Date().toISOString(), result });
  } catch (err) {
    console.error('[v1 refresh]', err);
    if (err.code === 'ROLLUP_STORAGE_UNSUPPORTED') return res.status(501).json({ error: err.message });
    res.status(500).json({ error: err.message || 'Refresh failed' });
  }
}

router.post('/models/:id/refresh', requireAuth, apiToken.requireScope('refresh'), async (req, res) => {
  const model = db.prepare('SELECT * FROM models WHERE id = ?').get(req.params.id);
  // 404 rather than 403 for a model the caller cannot see: a token holder must
  // not be able to probe which model ids exist.
  if (!model || !canAccessModel(model, req.user, req)) return res.status(404).json({ error: 'Model not found' });
  await refreshModel(model, req, res);
});

router.post('/reports/:id/refresh', requireAuth, apiToken.requireScope('refresh'), async (req, res) => {
  const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id);
  if (!report || !canAccessReport(report, req.user, req)) return res.status(404).json({ error: 'Report not found' });
  if (!report.model_id) return res.status(400).json({ error: 'Report has no model' });
  const model = db.prepare('SELECT * FROM models WHERE id = ?').get(report.model_id);
  if (!model) return res.status(404).json({ error: 'Model not found' });
  await refreshModel(model, req, res);
});

// ---------------------------------------------------------------- metadata
//
// A catalog (OpenMetadata) reads what describes reports and their models:
// workspaces, sources (never a credential), models with each measure's
// lineage and compiled SQL, reports and their widgets. No row of data, no
// connection to a source, no RLS rule (utils/metadata/catalog.js).

const ACCESS = { canAccessModel, canAccessReport, canWriteModel };
const PAGE = { default: 100, max: 500 };
// A full model compiles each measure: fewer per page.
const FULL_PAGE = { default: 20, max: 50 };

// Stable order by id; `after` = the last id of the previous page.
function page(list, query, size) {
  const limit = Math.min(Math.max(1, Number.parseInt(query.limit, 10) || size.default), size.max);
  const after = typeof query.after === 'string' ? query.after : '';
  const rest = after ? list.filter((x) => x.id > after) : list;
  const items = rest.slice(0, limit);
  return { items, next: rest.length > limit ? items[items.length - 1].id : null };
}

// The address readers open a report at: PUBLIC_URL when the server sits behind
// something that rewrites the host (the dev proxy does), the request's otherwise.
const baseUrlOf = (req) => (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
const metadata = [requireAuth, apiToken.requireScope('metadata')];
const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((err) => {
  console.error('[v1 metadata]', err);
  res.status(500).json({ error: 'Metadata could not be read' });
});

router.get('/metadata/workspaces', ...metadata, (req, res) => {
  const scope = catalog.scopeFor(req, ACCESS);
  const { items, next } = page(scope.workspaces, req.query, PAGE);
  res.json({ metadata_format: catalog.METADATA_FORMAT, workspaces: items.map(catalog.workspaceOut), next });
});

router.get('/metadata/datasources', ...metadata, (req, res) => {
  const scope = catalog.scopeFor(req, ACCESS);
  const { items, next } = page(catalog.scopedDatasources(scope), req.query, PAGE);
  res.json({ metadata_format: catalog.METADATA_FORMAT, datasources: items.map(catalog.datasourceOut), next });
});

router.get('/metadata/models', ...metadata, wrap(async (req, res) => {
  const scope = catalog.scopeFor(req, ACCESS);
  const full = req.query.include === 'all';
  const { items, next } = page(catalog.scopedModels(scope), req.query, full ? FULL_PAGE : PAGE);
  const models = [];
  for (const m of items) models.push(full ? await catalog.modelOut(scope, m) : catalog.modelSummary(m));
  res.json({ metadata_format: catalog.METADATA_FORMAT, models, next });
}));

// One object, addressed by id: outside the caller's scope it does not exist.
const findIn = (list, id) => list.find((x) => x.id === id) || null;

router.get('/metadata/models/:id', ...metadata, wrap(async (req, res) => {
  const scope = catalog.scopeFor(req, ACCESS);
  const m = findIn(catalog.scopedModels(scope), req.params.id);
  if (!m) return res.status(404).json({ error: 'Model not found' });
  res.json({ metadata_format: catalog.METADATA_FORMAT, model: await catalog.modelOut(scope, m) });
}));

router.get('/metadata/models/:id/measures/:name/explain', ...metadata, wrap(async (req, res) => {
  const scope = catalog.scopeFor(req, ACCESS);
  const m = findIn(catalog.scopedModels(scope), req.params.id);
  if (!m) return res.status(404).json({ error: 'Model not found' });
  const out = await catalog.explainMeasure(scope, { modelRow: m, name: req.params.name });
  if (!out) return res.status(404).json({ error: 'Measure not found' });
  res.json(out);
}));

router.get('/metadata/reports', ...metadata, wrap(async (req, res) => {
  const scope = catalog.scopeFor(req, ACCESS);
  const { items, next } = page(catalog.scopedReports(scope), req.query, FULL_PAGE);
  const reports = [];
  for (const r of items) reports.push(await catalog.reportOut(scope, r, baseUrlOf(req)));
  res.json({ metadata_format: catalog.METADATA_FORMAT, reports, next });
}));

router.get('/metadata/reports/:id', ...metadata, wrap(async (req, res) => {
  const scope = catalog.scopeFor(req, ACCESS);
  const r = findIn(catalog.scopedReports(scope), req.params.id);
  if (!r) return res.status(404).json({ error: 'Report not found' });
  res.json({ metadata_format: catalog.METADATA_FORMAT, report: await catalog.reportOut(scope, r, baseUrlOf(req)) });
}));

// A measure as the report reads it: the report's own measures, and the model's.
router.get('/metadata/reports/:id/measures/:name/explain', ...metadata, wrap(async (req, res) => {
  const scope = catalog.scopeFor(req, ACCESS);
  const r = findIn(catalog.scopedReports(scope), req.params.id);
  const modelRow = r && r.model_id ? db.prepare('SELECT * FROM models WHERE id = ?').get(r.model_id) : null;
  if (!r || !modelRow) return res.status(404).json({ error: 'Report not found' });
  const out = await catalog.explainMeasure(scope, { modelRow, report: r, name: req.params.name });
  if (!out) return res.status(404).json({ error: 'Measure not found' });
  res.json(out);
}));

module.exports = router;
