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
const cacheWarmer = require('../utils/cacheWarmer');
const queryCache = require('../utils/queryCache');
const preAggCache = require('../utils/preAggCache');

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

// Reports whose warm is currently in flight. Used by the Dashboard to
// keep the spinner on the right cards after an F5 — the in-memory Set
// in `cacheWarmer` is the source of truth, this endpoint just exposes
// it filtered to reports the caller is allowed to see (avoids leaking
// org-internal IDs across tenants — same gate as report listing).
router.get('/warming', requireAuth, (req, res) => {
  const ids = cacheWarmer.warmingReportIds();
  if (ids.length === 0) return res.json({ reportIds: [] });
  // Only surface reports the caller can read (owner OR org-shared etc.).
  // Cheap pass: load each report and filter through canManageSchedule.
  const visible = ids.filter((rid) => {
    const r = db.prepare('SELECT id, user_id FROM reports WHERE id = ?').get(rid);
    return r && canManageSchedule(r, req.user);
  });
  res.json({ reportIds: visible });
});

// Per-widget cache breakdown — admin / owner inspector. Each visual is
// expanded through the same `planForReport` the warmer uses, so the
// `dims + measures` shape we look up matches what the warmer stored. The
// response also surfaces "orphan" entries (live in cache but no visual
// claims them — happens after a binding edit before TTL or invalidation).
router.get('/inspect/:reportId', requireAuth, (req, res) => {
  const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.reportId);
  if (!report) return res.status(404).json({ error: 'Report not found' });
  if (!canManageSchedule(report, req.user)) return res.status(403).json({ error: 'Forbidden' });

  let widgets = {};
  let settings = {};
  try { widgets = JSON.parse(report.widgets || '{}'); } catch { /* ignore */ }
  try { settings = JSON.parse(report.settings || '{}'); } catch { /* ignore */ }

  const modelRow = db.prepare('SELECT id, dimensions, measures FROM models WHERE id = ?').get(report.model_id);
  let modelDimensions = [];
  let modelMeasures = [];
  try { modelDimensions = JSON.parse(modelRow?.dimensions || '[]'); } catch { /* ignore */ }
  try { modelMeasures = JSON.parse(modelRow?.measures || '[]'); } catch { /* ignore */ }
  const allDimensions = [...modelDimensions, ...(settings.extraDimensions || [])];
  const allMeasures = [...modelMeasures, ...(settings.extraMeasures || [])];
  const measureLookup = (name) => allMeasures.find((mm) => mm.name === name) || null;

  // Same expansion the warmer does, so the shape we compute per widget is
  // byte-identical to what was stored.
  const slicerDims = (function collect() {
    const out = new Set();
    for (const w of Object.values(widgets || {})) {
      if (!w || !w.dataBinding) continue;
      const b = w.dataBinding;
      if (w.type === 'filter') { for (const d of (b.selectedDimensions || [])) out.add(d); continue; }
      for (const d of (b.selectedDimensions || [])) out.add(d);
      for (const d of (b.groupBy || [])) out.add(d);
      for (const d of (b.columnDimensions || [])) out.add(d);
    }
    return [...out];
  })();
  const plan = cacheWarmer.planForReport(
    { ...report, widgets, settings },
    settings,
    { slicerDims, measureLookup, allMeasures, dimensions: allDimensions },
  );

  const allEntries = preAggCache.inspectModel(report.model_id);
  // Index entries by their fingerprint (dims + measures names, sorted) so
  // we can match them to plan items deterministically. Using the dataset
  // metadata avoids re-hashing the shape on this side.
  const fingerprint = (dims, measures) => {
    const dimsS = [...(dims || [])].sort().join('|');
    const measS = [...(measures || [])].sort().join('|');
    return `${dimsS}::${measS}`;
  };
  const claimed = new Set();
  const byWidget = plan
    .filter((item) => item.preAgg)
    .map((item) => {
      // The dataset stored under this entry includes ALL fired measures
      // (visual + component refs for ratios). Match against that.
      const wantedMeasures = new Set([...(item.uniqueMeas || []), ...(item.firedMeasureNames || [])]);
      const match = allEntries.find((e) => {
        if (claimed.has(e.keyHash)) return false;
        if (!Array.isArray(e.dims) || e.dims.length !== item.expandedDims.length) return false;
        const dimsMatch = item.expandedDims.every((d) => e.dims.includes(d));
        if (!dimsMatch) return false;
        // Every visual+fired measure should appear in the entry's measures list.
        for (const m of wantedMeasures) if (!e.measures.includes(m)) return false;
        return true;
      });
      if (match) claimed.add(match.keyHash);
      const w = widgets[item.widgetId.replace(/#.*$/, '')];
      return {
        widgetId: item.widgetId,
        widgetType: w?.type || null,
        widgetTitle: w?.config?.title || null,
        measures: item.uniqueMeas,
        bytes: match?.bytes || 0,
        rowCount: match?.rowCount || 0,
        builtAt: match?.builtAt || null,
        cached: !!match,
      };
    })
    .sort((a, b) => b.bytes - a.bytes);

  const orphans = allEntries.filter((e) => !claimed.has(e.keyHash));

  const total = allEntries.reduce((acc, e) => acc + e.bytes, 0);
  res.json({
    preAggTotalBytes: total,
    preAggTotalEntries: allEntries.length,
    queryCacheTotalBytes: queryCache.bytesForModel(report.model_id),
    queryCacheTotalEntries: queryCache.entriesForModel(report.model_id),
    byWidget,
    orphans,
  });
});

// Cache footprint for a single report — sum of queryCache + preAggCache
// entries indexed under the report's model. Surfaced on the report card
// next to the Refresh button so the user can see what's hot.
router.get('/size/:reportId', requireAuth, (req, res) => {
  const r = db.prepare('SELECT id, user_id, model_id FROM reports WHERE id = ?').get(req.params.reportId);
  if (!r) return res.status(404).json({ error: 'Report not found' });
  if (!canManageSchedule(r, req.user)) return res.status(403).json({ error: 'Forbidden' });
  const modelId = r.model_id;
  const queryEntries = queryCache.entriesForModel(modelId);
  const queryBytes = queryCache.bytesForModel(modelId);
  const preAggEntries = preAggCache.entriesForModel(modelId);
  const preAggBytes = preAggCache.bytesForModel(modelId);
  const queryBuiltAt = queryCache.latestBuiltAtForModel(modelId);
  const preAggBuiltAt = preAggCache.latestBuiltAtForModel(modelId);
  // Surface the most recent build time across both caches — that's the
  // "Data update" the user sees on the card.
  const builtAt = [queryBuiltAt, preAggBuiltAt].filter(Boolean).sort().pop() || null;
  res.json({
    queryEntries, queryBytes,
    preAggEntries, preAggBytes,
    totalEntries: queryEntries + preAggEntries,
    totalBytes: queryBytes + preAggBytes,
    builtAt,
  });
});

// One-shot warm pass for a report — independent of any schedule. Used by
// the "Warm now" button so a user can refresh the cache on demand even
// before they've configured a recurring schedule. Fires under the
// caller's identity so RLS-restricted users can warm the slice they
// can actually see.
router.post('/run-now/:reportId', requireAuth, async (req, res) => {
  const report = loadReportOrFail(req.params.reportId, res);
  if (!report) return;
  if (!canManageSchedule(report, req.user)) return res.status(403).json({ error: 'Forbidden' });
  try {
    const result = await cacheWarmer.warmReport({
      scheduleId: null,
      reportId: report.id,
      userId: req.user.id,
    });
    res.json({ result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
