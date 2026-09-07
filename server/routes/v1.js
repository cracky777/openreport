/**
 * Public API, v1 — the only surface an API token can reach.
 *
 *   GET  /api/v1/whoami                  identity behind the token
 *   GET  /api/v1/models                  models the caller can see
 *   GET  /api/v1/reports                 reports the caller can see
 *   POST /api/v1/models/:id/refresh      rebuild that model's cache
 *   POST /api/v1/reports/:id/refresh     same, addressed by report
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
const apiToken = require('../utils/apiToken');
const { requireAuth } = require('../middleware/auth');
const rollupBuilder = require('../utils/rollupBuilder');
const { canAccessModel, canAccessReport, canBuildOnModel } = require('./reports');
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
  const models = typeof cloudHooks.listModels === 'function'
    ? cloudHooks.listModels(req)
    : db.prepare(`
      SELECT m.id, m.name, m.description, m.updated_at
      FROM models m WHERE m.user_id = ? ORDER BY m.updated_at DESC
    `).all(req.user.id);
  res.json({ models: models.map((m) => ({ id: m.id, name: m.name, description: m.description, updated_at: m.updated_at })) });
});

router.get('/reports', requireAuth, apiToken.requireScope('read'), (req, res) => {
  const rows = typeof cloudHooks.listReports === 'function'
    ? cloudHooks.listReports(req)
    : db.prepare(`
      SELECT r.id, r.title, r.model_id, r.updated_at, r.cache_built_at
      FROM reports r WHERE r.user_id = ? ORDER BY r.updated_at DESC
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

module.exports = router;
