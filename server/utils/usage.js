/**
 * Usage & observability events.
 *
 * The server already measures everything (query duration, rollup HIT/MISS,
 * build outcome) — this persists a thin event per occurrence so the Admin
 * console can answer "which reports are actually read, which queries are
 * slow, how fresh is each report's cache". Three kinds:
 *
 *   report_view  — a Viewer open (the Editor never counts)
 *   query        — one /query call: duration, where it was served from
 *                  (rollup | cache | live | error | timeout), rows, status
 *   cache_build  — one rollup build run for a model: duration, built/errors
 *
 * Recording is best-effort and never throws into a request path. Retention
 * is RETENTION_DAYS; pruning piggybacks on writes (at most once an hour) so
 * there is no extra timer to manage. Volumes are tame for SQLite — one row
 * per widget query — and the Admin aggregates run over indexed (kind, ts).
 */
const db = require('../db');

const RETENTION_DAYS = 30;
const PRUNE_EVERY_MS = 60 * 60 * 1000;
// A query slower than this counts as "slow" in the Admin summary.
const SLOW_QUERY_MS = 2000;

let _lastPrune = 0;

function prune(now = Date.now()) {
  if (now - _lastPrune < PRUNE_EVERY_MS) return 0;
  _lastPrune = now;
  const cutoff = new Date(now - RETENTION_DAYS * 86400e3).toISOString();
  return db.prepare('DELETE FROM usage_events WHERE ts < ?').run(cutoff).changes;
}

/**
 * record({ kind, userId, reportId, modelId, organizationId, durationMs,
 *          served, rows, status, detail })
 */
function record(ev) {
  try {
    db.prepare(`INSERT INTO usage_events
                  (kind, user_id, report_id, model_id, organization_id, duration_ms, served, rows, status, detail)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(ev.kind, ev.userId || null, ev.reportId || null, ev.modelId || null, ev.organizationId || null,
        Number.isFinite(ev.durationMs) ? Math.round(ev.durationMs) : null,
        ev.served || null, Number.isFinite(ev.rows) ? ev.rows : null,
        Number.isFinite(ev.status) ? ev.status : null,
        ev.detail == null ? null : String(ev.detail).slice(0, 500));
    prune();
  } catch (err) {
    // Telemetry must never take a request down with it.
    console.warn(`[usage] record failed: ${err.message}`);
  }
}

/**
 * Admin summary over the last `days` days. `orgId` (cloud) scopes every
 * aggregate to one organization; null = whole instance.
 */
function summary({ days = 7, orgId = null } = {}) {
  const d = Math.min(90, Math.max(1, Number(days) || 7));
  const since = new Date(Date.now() - d * 86400e3).toISOString();
  const orgSql = orgId ? ' AND e.organization_id = ?' : '';
  const args = (extra = []) => (orgId ? [since, orgId, ...extra] : [since, ...extra]);

  const totals = db.prepare(`
    SELECT
      SUM(CASE WHEN e.kind = 'report_view' THEN 1 ELSE 0 END) AS views,
      SUM(CASE WHEN e.kind = 'query' THEN 1 ELSE 0 END) AS queries,
      SUM(CASE WHEN e.kind = 'query' AND e.served = 'rollup' THEN 1 ELSE 0 END) AS fromRollup,
      SUM(CASE WHEN e.kind = 'query' AND e.served = 'cache' THEN 1 ELSE 0 END) AS fromCache,
      SUM(CASE WHEN e.kind = 'query' AND e.served = 'live' THEN 1 ELSE 0 END) AS live,
      SUM(CASE WHEN e.kind = 'query' AND e.served IN ('error', 'timeout') THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN e.kind = 'query' AND e.duration_ms >= ? THEN 1 ELSE 0 END) AS slow,
      AVG(CASE WHEN e.kind = 'query' THEN e.duration_ms END) AS avgQueryMs,
      SUM(CASE WHEN e.kind = 'cache_build' THEN 1 ELSE 0 END) AS builds
    FROM usage_events e WHERE e.ts >= ?${orgSql}`).get(SLOW_QUERY_MS, ...args());

  const topReports = db.prepare(`
    SELECT e.report_id AS reportId, r.title, COUNT(*) AS views,
           COUNT(DISTINCT e.user_id) AS viewers, MAX(e.ts) AS lastViewedAt
    FROM usage_events e LEFT JOIN reports r ON r.id = e.report_id
    WHERE e.kind = 'report_view' AND e.ts >= ?${orgSql}
    GROUP BY e.report_id ORDER BY views DESC LIMIT 50`).all(...args());

  const slowQueries = db.prepare(`
    SELECT e.ts, e.duration_ms AS durationMs, e.served, e.rows, e.status, e.detail,
           e.model_id AS modelId, m.name AS modelName,
           e.report_id AS reportId, r.title AS reportTitle,
           u.email AS userEmail
    FROM usage_events e
    LEFT JOIN models m ON m.id = e.model_id
    LEFT JOIN reports r ON r.id = e.report_id
    LEFT JOIN users u ON u.id = e.user_id
    WHERE e.kind = 'query' AND e.ts >= ?${orgSql} AND e.duration_ms IS NOT NULL
    ORDER BY e.duration_ms DESC LIMIT 50`).all(...args());

  // Per model: how its queries were served + its last cache build. The
  // "freshness" a reader cares about is per report, but rollups are
  // model-scoped — so the report rows below join on the model.
  const byModel = db.prepare(`
    SELECT e.model_id AS modelId, m.name AS modelName, COUNT(*) AS queries,
           SUM(CASE WHEN e.served = 'rollup' THEN 1 ELSE 0 END) AS fromRollup,
           SUM(CASE WHEN e.served = 'cache' THEN 1 ELSE 0 END) AS fromCache,
           SUM(CASE WHEN e.served = 'live' THEN 1 ELSE 0 END) AS live,
           AVG(e.duration_ms) AS avgMs, MAX(e.duration_ms) AS maxMs
    FROM usage_events e LEFT JOIN models m ON m.id = e.model_id
    WHERE e.kind = 'query' AND e.ts >= ?${orgSql}
    GROUP BY e.model_id ORDER BY queries DESC LIMIT 50`).all(...args());

  const builds = db.prepare(`
    SELECT e.ts, e.model_id AS modelId, m.name AS modelName, e.duration_ms AS durationMs,
           e.status, e.rows AS built, e.detail
    FROM usage_events e LEFT JOIN models m ON m.id = e.model_id
    WHERE e.kind = 'cache_build' AND e.ts >= ?${orgSql}
    ORDER BY e.ts DESC LIMIT 50`).all(...args());

  // Freshness per report: last cache build stamped on the report (rollup
  // rebuilds stamp every report of the model), last read, live toggle.
  const freshness = db.prepare(`
    SELECT r.id AS reportId, r.title, r.live_mode AS liveMode, r.cache_built_at AS cacheBuiltAt,
           m.name AS modelName,
           (SELECT MAX(ts) FROM usage_events v WHERE v.kind = 'report_view' AND v.report_id = r.id) AS lastViewedAt,
           (SELECT COUNT(*) FROM usage_events v WHERE v.kind = 'report_view' AND v.report_id = r.id AND v.ts >= ?) AS views
    FROM reports r LEFT JOIN models m ON m.id = r.model_id
    ${orgId ? 'WHERE r.organization_id = ?' : ''}
    ORDER BY views DESC, r.updated_at DESC LIMIT 200`).all(...(orgId ? [since, orgId] : [since]));

  return { days: d, since, slowQueryMs: SLOW_QUERY_MS, totals, topReports, slowQueries, byModel, builds, freshness };
}

module.exports = { record, prune, summary, RETENTION_DAYS, SLOW_QUERY_MS, _resetPruneClock: () => { _lastPrune = 0; } };
