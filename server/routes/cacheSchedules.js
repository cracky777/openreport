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

  // Phase 4: re-plan the report through the new GROUPING SETS warmer.
  // Each plan item now coalesces N widgets sharing widgetFilters; we
  // expand back to per-widget rows for the UI by walking each item's
  // `specs` list. For each spec we compute the exact cache key the
  // warmer would have used and match it against the live displayCache
  // entries.
  const displayCache = require('../utils/displayCache');
  const modelMetaRow = db.prepare('SELECT id, datasource_id, user_id FROM models WHERE id = ?')
    .get(report.model_id);
  const datasourceId = modelMetaRow ? modelMetaRow.datasource_id : null;

  const plan = cacheWarmer.planForReport(
    { ...report, widgets, settings },
    settings,
    { dimensions: allDimensions },
  );

  const allEntries = displayCache.inspectModel(report.model_id);
  // Match each plan spec to its cache entry by computing the SHA-256 of
  // its shape and slicing to the same 12 chars `inspectModel` reports.
  // The bypass label MUST match exactly what /query computed when the
  // warmer fired — the route applies "owner wins over admin", so a user
  // who happens to be BOTH owner of the model AND a global admin gets
  // `bypass: 'owner'`. Earlier this matched on role first and reported
  // every entry as orphaned for those users.
  const reportExtras = {
    extraDimensions: settings.extraDimensions || [],
    extraMeasures: settings.extraMeasures || [],
    dimensionOverrides: settings.dimensionOverrides || {},
    measureOverrides: settings.measureOverrides || {},
  };
  // Match by widgetId — robust against RLS context drift, widgetFilters
  // sanitization differences, or any other subtle hash-input change
  // between warm-time and inspect-time. The warmer tags each entry with
  // its spec's `widgetId` (incl. the `#comboLine` / `#n1` suffixes), so
  // the lookup is a string equality on a well-known label.
  const entryByWidgetId = new Map();
  // Phase 4-v2: multiple cache entries from coalesced widgets share a
  // single columnar dataset in RAM (different keys → same rowsByGrain
  // reference, tagged via `_bucketId`). `entryBytes` walks each entry
  // independently, so the raw sum double-counts shared bytes. Group by
  // bucketId here to report honest sizes.
  const sharedBucketCount = new Map();
  for (const e of allEntries) {
    if (e.widgetId) entryByWidgetId.set(e.widgetId, e);
    if (e.bucketId) {
      sharedBucketCount.set(e.bucketId, (sharedBucketCount.get(e.bucketId) || 0) + 1);
    }
  }
  // Honest bytes per entry = raw bytes / number of entries sharing that
  // bucket (= the actual RAM proportional to this widget).
  const sharedBytesFor = (e) => {
    if (!e || !e.bucketId) return e?.bytes || 0;
    const n = sharedBucketCount.get(e.bucketId) || 1;
    return Math.round((e.bytes || 0) / n);
  };

  // Combo widgets fire 2 specs (`#comboLine` sibling at axis-only grain)
  // and scorecards with compareDateDim fire 2 specs (`#n1` sibling with
  // year-shifted filters). Surface the variant in the UI rather than
  // stripping it — without this, the same widget appears twice with no
  // way to tell which row is which.
  const variantLabelFor = (wId) => {
    if (!wId) return '';
    if (wId.includes('#comboLine')) return 'line';
    if (wId.includes('#n1')) return 'N-1';
    return '';
  };

  const claimed = new Set();
  const byWidget = [];
  for (const item of plan) {
    for (const spec of (item.specs || [])) {
      // Primary lookup: by `widgetId` tagged on the entry at warm time.
      // This is robust against any input-encoding drift between warm
      // and inspect (RLS context, widgetFilters serialization order,
      // etc.). Entries warmed before this tagging was added fall back
      // to the absent state — re-warm to populate the tag.
      const match = entryByWidgetId.get(spec.wId) || null;
      if (match) claimed.add(match.keyHash);
      const cleanWId = String(spec.wId || '').replace(/#.*$/, '');
      const w = widgets[cleanWId];
      byWidget.push({
        widgetId: spec.wId,
        widgetType: w?.type || null,
        widgetTitle: w?.config?.title || null,
        // Surfaced in the UI as "<title> · <variant>" when set —
        // disambiguates the two combo specs and the two scorecard specs.
        variant: variantLabelFor(spec.wId),
        measures: spec.uniqueMeas,
        // Grain count gives a sense of the coverage breadth (drill
        // levels × cross-filter subsets the warmer fired for this spec).
        grainCount: match?.grains?.length || (spec.sets ? spec.sets.length : 0),
        // Honest per-widget bytes — divided across the N widgets sharing
        // the bucket's columnar dataset. Sum across rows gives the real
        // total RAM the report consumes, not N× the actual usage.
        bytes: sharedBytesFor(match),
        // Surface bucket membership so the UI can group / colour-code
        // widgets that share a coalesced SQL response. `bucketSize` is
        // the FULL columnar bytes for the bucket (= the actual RAM
        // footprint, not a per-widget share); `sharedAcrossN` is how
        // many widgets reference it.
        bucketId: match?.bucketId || null,
        bucketSize: match?.bytes || 0,
        sharedAcrossN: match?.bucketId ? (sharedBucketCount.get(match.bucketId) || 1) : 1,
        rowCount: match?.rowCount || 0,
        builtAt: match?.builtAt || null,
        cached: !!match,
      });
    }
  }
  byWidget.sort((a, b) => b.bytes - a.bytes);

  const orphans = allEntries.filter((e) => !claimed.has(e.keyHash))
    .map((e) => ({ ...e, bytes: sharedBytesFor(e) }));

  // Total bytes = sum unique bucket bytes (count each shared dataset
  // ONCE) + bytes from any tag-less entries (which fall back to their
  // own bytes since they're not shared).
  const seenBuckets = new Set();
  let total = 0;
  for (const e of allEntries) {
    if (e.bucketId) {
      if (seenBuckets.has(e.bucketId)) continue;
      seenBuckets.add(e.bucketId);
      total += e.bytes || 0;
    } else {
      total += e.bytes || 0;
    }
  }
  // Per-bucket summary — surfaces the cohesion the v2 dedup produces:
  // each bucket represents ONE coalesced SQL response shared by N
  // widgets. The UI uses this to colour-code rows and to show "X
  // buckets share Y widgets" at the top of the modal.
  const bucketSummary = [];
  const bucketSeen = new Set();
  for (const e of allEntries) {
    if (!e.bucketId || bucketSeen.has(e.bucketId)) continue;
    bucketSeen.add(e.bucketId);
    const widgetsInBucket = allEntries
      .filter((x) => x.bucketId === e.bucketId)
      .map((x) => x.widgetId)
      .filter(Boolean);
    bucketSummary.push({
      bucketId: e.bucketId,
      bytes: e.bytes || 0,
      rowCount: e.rowCount || 0,
      widgetCount: widgetsInBucket.length,
      widgetIds: widgetsInBucket,
    });
  }
  bucketSummary.sort((a, b) => b.bytes - a.bytes);
  res.json({
    preAggTotalBytes: total,
    preAggTotalEntries: allEntries.length,
    queryCacheTotalBytes: queryCache.bytesForModel(report.model_id),
    queryCacheTotalEntries: queryCache.entriesForModel(report.model_id),
    byWidget,
    orphans,
    buckets: bucketSummary,
  });
});

// Cache footprint for a single report — sum of queryCache +
// displayCache (Phase 4) entries indexed under the report's model.
// Legacy preAggCache is included for compatibility but should always
// be empty since the warmer now writes to displayCache.
router.get('/size/:reportId', requireAuth, (req, res) => {
  const r = db.prepare('SELECT id, user_id, model_id FROM reports WHERE id = ?').get(req.params.reportId);
  if (!r) return res.status(404).json({ error: 'Report not found' });
  if (!canManageSchedule(r, req.user)) return res.status(403).json({ error: 'Forbidden' });
  const modelId = r.model_id;
  const displayCache = require('../utils/displayCache');
  const queryEntries = queryCache.entriesForModel(modelId);
  const queryBytes = queryCache.bytesForModel(modelId);
  const preAggEntries = preAggCache.entriesForModel(modelId);
  const preAggBytes = preAggCache.bytesForModel(modelId);
  const displayEntries = displayCache.entriesForModel(modelId);
  const displayBytes = displayCache.bytesForModel(modelId);
  const queryBuiltAt = queryCache.latestBuiltAtForModel(modelId);
  const preAggBuiltAt = preAggCache.latestBuiltAtForModel(modelId);
  const displayBuiltAt = displayCache.latestBuiltAtForModel(modelId);
  const builtAt = [queryBuiltAt, preAggBuiltAt, displayBuiltAt].filter(Boolean).sort().pop() || null;
  // The card shows ONE row for "RAM cache" so we lump preAgg + display
  // together as `preAggBytes` for back-compat with the existing UI. The
  // discrete counts are exposed too in case a future UI version wants
  // to split them.
  res.json({
    queryEntries, queryBytes,
    preAggEntries: preAggEntries + displayEntries,
    preAggBytes: preAggBytes + displayBytes,
    displayEntries, displayBytes,
    totalEntries: queryEntries + preAggEntries + displayEntries,
    totalBytes: queryBytes + preAggBytes + displayBytes,
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
