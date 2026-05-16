/**
 * REST API for OSS cache_warm schedules.
 *
 * Endpoints (all under /api/cache-schedules, requireAuth):
 *   GET    /by-report/:reportId   list schedules for a report
 *   POST   /by-report/:reportId   create a schedule
 *   PUT    /:id                   update (cron / enabled / timezone)
 *   DELETE /:id                   remove
 *   POST   /:id/run               run-now (recompute the cache immediately)
 *
 * Permission model — same as report editing: the report owner or a
 * global admin can manage cache schedules. Workspace member roles are
 * not consulted (cache_warm is a server-side cost, not a content-access
 * decision; we keep the gate aligned with "who can edit this report").
 */

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const db = require('../db');
const cacheSchedules = require('../utils/cacheSchedules');
const cacheScheduler = require('../utils/cacheScheduler');
const fs = require('fs');
const queryCache = require('../utils/queryCache');
const rollupBuilder = require('../utils/rollupBuilder');
const rollupDuckDB = require('../utils/rollupDuckDB');

// Real on-disk size of THIS report's model store. Each model has its own
// DuckDB file, so this is now a true per-report (per-model) figure — the
// storage that report's "refresh" rebuilds and reclaims.
function rollupDiskBytes(modelId, orgId) {
  return rollupDuckDB.modelStoreBytes(modelId, orgId);
}

const router = express.Router();

function loadReportOrFail(reportId, res) {
  const r = db.prepare('SELECT id, user_id, workspace_id FROM reports WHERE id = ?').get(reportId);
  if (!r) {
    res.status(404).json({ error: 'Report not found' });
    return null;
  }
  return r;
}

function canManageSchedule(report, user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return report.user_id === user.id;
}

router.get('/by-report/:reportId', requireAuth, (req, res) => {
  const report = loadReportOrFail(req.params.reportId, res);
  if (!report) return;
  if (!canManageSchedule(report, req.user)) return res.status(403).json({ error: 'Forbidden' });
  res.json({ schedules: cacheSchedules.listForReport(report.id) });
});

router.post('/by-report/:reportId', requireAuth, (req, res) => {
  const report = loadReportOrFail(req.params.reportId, res);
  if (!report) return;
  if (!canManageSchedule(report, req.user)) return res.status(403).json({ error: 'Forbidden' });
  const { cronExpression, timezone, enabled } = req.body || {};
  const cronErr = cacheSchedules.validateCron(cronExpression);
  if (cronErr) return res.status(400).json({ error: cronErr });
  const created = cacheSchedules.create({
    reportId: report.id,
    userId: req.user.id,
    cronExpression,
    timezone: timezone || 'UTC',
    enabled: enabled !== false,
  });
  cacheScheduler.register(created);
  res.status(201).json({ schedule: created });
});

router.put('/:id', requireAuth, (req, res) => {
  const cur = cacheSchedules.getById(req.params.id);
  if (!cur) return res.status(404).json({ error: 'Schedule not found' });
  const report = loadReportOrFail(cur.report_id, res);
  if (!report) return;
  if (!canManageSchedule(report, req.user)) return res.status(403).json({ error: 'Forbidden' });
  const { cronExpression, timezone, enabled } = req.body || {};
  const next = { ...cur };
  if (cronExpression !== undefined) {
    const e = cacheSchedules.validateCron(cronExpression);
    if (e) return res.status(400).json({ error: e });
    next.cron_expression = cronExpression;
  }
  if (timezone !== undefined) next.timezone = timezone;
  if (enabled !== undefined) next.enabled = !!enabled;
  const updated = cacheSchedules.update(cur.id, next);
  cacheScheduler.register(updated);
  res.json({ schedule: updated });
});

router.delete('/:id', requireAuth, (req, res) => {
  const cur = cacheSchedules.getById(req.params.id);
  if (!cur) return res.status(404).json({ error: 'Schedule not found' });
  const report = loadReportOrFail(cur.report_id, res);
  if (!report) return;
  if (!canManageSchedule(report, req.user)) return res.status(403).json({ error: 'Forbidden' });
  cacheSchedules.remove(cur.id);
  cacheScheduler.unregister(cur.id);
  res.json({ ok: true });
});

router.post('/:id/run', requireAuth, async (req, res) => {
  const cur = cacheSchedules.getById(req.params.id);
  if (!cur) return res.status(404).json({ error: 'Schedule not found' });
  const report = loadReportOrFail(cur.report_id, res);
  if (!report) return;
  if (!canManageSchedule(report, req.user)) return res.status(403).json({ error: 'Forbidden' });
  const result = await cacheScheduler.runOne(cur.id);
  res.json({ result });
});

// Reports whose rollup rebuild is currently in flight. Used by the
// Dashboard to keep the spinner on the right cards after an F5. Rollups
// are model-scoped; we translate the building model ids back to the
// caller-visible reports attached to them.
router.get('/warming', requireAuth, (req, res) => {
  const modelIds = rollupBuilder.buildingModelIds();
  if (modelIds.length === 0) return res.json({ reportIds: [], progress: {} });
  const placeholders = modelIds.map(() => '?').join(', ');
  const reports = db.prepare(
    `SELECT id, user_id, model_id FROM reports WHERE model_id IN (${placeholders})`
  ).all(...modelIds);
  const prog = rollupBuilder.buildProgress(); // modelId → { done, total }
  const reportIds = [];
  const progress = {}; // reportId → { done, total }
  for (const r of reports) {
    if (!canManageSchedule(r, req.user)) continue;
    reportIds.push(r.id);
    if (prog[r.model_id]) progress[r.id] = prog[r.model_id];
  }
  res.json({ reportIds, progress });
});

// Rollup inspector — admin / owner view of the materialised rollup
// tables backing this report's model. One row per rollup (grain ×
// baked-global-filter). Rollup-native shape (no buckets / orphans /
// RAM concepts — those died with the GROUPING SETS warmer).
router.get('/inspect/:reportId', requireAuth, (req, res) => {
  const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.reportId);
  if (!report) return res.status(404).json({ error: 'Report not found' });
  if (!canManageSchedule(report, req.user)) return res.status(403).json({ error: 'Forbidden' });

  const manifest = rollupBuilder.getManifest({
    modelId: report.model_id,
    orgId: req.organizationId || null,
  });

  const diskBytes = rollupDiskBytes(report.model_id, req.organizationId || null);
  const base = manifest.map((r) => ({
    grainHash: r.grainHash,
    grainDims: r.grainDims || [],
    grainCount: (r.grainDims || []).length,
    measures: r.measureNames || [],
    baseFilters: (r.baseFilters || []).map((f) => ({
      field: f.field, op: f.op, values: f.values || [],
    })),
    storageMode: r.storageMode || 'duckdb',
    rowCount: r.rowCount || 0,
    builtAt: r.builtAt || null,
    _est: r.bytes || 0, // per-grain build-time estimate (weight only)
  }));
  // Distribute the REAL on-disk volume across grains proportionally to
  // their build-time estimate, so the Size column sums to the actual
  // rollups.duckdb file size shown to the user.
  const sumEst = base.reduce((s, r) => s + r._est, 0);
  const rollups = base
    .map((r) => ({
      ...r,
      bytes: sumEst > 0
        ? Math.round(diskBytes * (r._est / sumEst))
        : (base.length ? Math.round(diskBytes / base.length) : 0),
    }))
    .map(({ _est, ...r }) => r)
    .sort((a, b) => b.bytes - a.bytes);

  res.json({
    storageMode: rollups[0]?.storageMode || 'duckdb',
    diskBytes,
    rollupCount: rollups.length,
    totalBytes: diskBytes,
    totalRows: rollups.reduce((s, r) => s + r.rowCount, 0),
    rollups,
  });
});

// Compact per-report footprint for the card line: rollup count + total
// rows for the report's model, plus the in-RAM query-cache layer.
router.get('/size/:reportId', requireAuth, (req, res) => {
  const r = db.prepare('SELECT id, user_id, model_id FROM reports WHERE id = ?').get(req.params.reportId);
  if (!r) return res.status(404).json({ error: 'Report not found' });
  if (!canManageSchedule(r, req.user)) return res.status(403).json({ error: 'Forbidden' });
  const modelId = r.model_id;
  const manifest = rollupBuilder.getManifest({ modelId, orgId: req.organizationId || null });
  const rollupBuiltAt = manifest.map((x) => x.builtAt).filter(Boolean).sort().pop() || null;
  const queryBuiltAt = queryCache.latestBuiltAtForModel(modelId);
  res.json({
    rollupCount: manifest.length,
    totalBytes: manifest.reduce((s, x) => s + (x.bytes || 0), 0),
    totalRows: manifest.reduce((s, x) => s + (x.rowCount || 0), 0),
    diskBytes: rollupDiskBytes(modelId, req.organizationId || null),
    queryEntries: queryCache.entriesForModel(modelId),
    queryBytes: queryCache.bytesForModel(modelId),
    builtAt: [queryBuiltAt, rollupBuiltAt].filter(Boolean).sort().pop() || null,
  });
});

// On-demand rebuild for a report's model — independent of any schedule.
// Backs the "Warm now" / Refresh button. Rollups are model-scoped, so
// this rebuilds every rollup the model needs across all of its reports.
router.post('/run-now/:reportId', requireAuth, async (req, res) => {
  const report = loadReportOrFail(req.params.reportId, res);
  if (!report) return;
  if (!canManageSchedule(report, req.user)) return res.status(403).json({ error: 'Forbidden' });
  const full = db.prepare('SELECT model_id FROM reports WHERE id = ?').get(report.id);
  if (!full || !full.model_id) return res.status(400).json({ error: 'Report has no model' });
  try {
    const result = await rollupBuilder.buildRollupsForModel({
      modelId: full.model_id,
      internalUserId: req.user.id,
      orgId: req.organizationId || null,
      log: process.env.ROLLUP_LOG !== '0',
    });
    res.json({ result });
  } catch (err) {
    if (err.code === 'ROLLUP_STORAGE_UNSUPPORTED') {
      return res.status(501).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
