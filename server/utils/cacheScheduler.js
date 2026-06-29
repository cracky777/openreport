/**
 * node-cron runtime for OSS cache_warm schedules.
 *
 * On boot: load every enabled schedule and register a cron job for it.
 * On create/update/delete: hot-reload by stop+register.
 *
 * Each tick fires `rollupBuilder.buildRollupsForModel(...)` — the schedule
 * is report-scoped but rollups are model-scoped, so a tick rebuilds every
 * rollup the model needs across all of its reports. Multiple schedules on
 * the same model are redundant but harmless (idempotent rebuild).
 *
 * Persisted result via `cacheSchedules.recordRun`. We intentionally do
 * NOT use a queue — even on a slow source DB the builder is one
 * sequential pass over a handful of grains, and overlapping cron ticks
 * aren't a real concern in OSS where there's only one server process.
 */

const cron = require('node-cron');
const cacheSchedules = require('./cacheSchedules');
const rollupBuilder = require('./rollupBuilder');
const db = require('../db');

// scheduleId → { task, cronExpr } so we can stop/replace on hot-reload.
const _jobs = new Map();

function unregister(scheduleId) {
  const entry = _jobs.get(scheduleId);
  if (!entry) return;
  try { entry.task.stop(); } catch { /* ignore */ }
  _jobs.delete(scheduleId);
}

function register(schedule) {
  unregister(schedule.id);
  if (!schedule.enabled) return;
  const expr = schedule.cron_expression;
  if (!expr || !cron.validate(expr)) {
    console.warn(`[cacheScheduler] invalid cron "${expr}" for schedule ${schedule.id}`);
    return;
  }
  const opts = { scheduled: true };
  if (schedule.timezone) opts.timezone = schedule.timezone;
  const task = cron.schedule(expr, () => {
    runOne(schedule.id).catch((err) => console.error('[cacheScheduler] tick failed:', err));
  }, opts);
  _jobs.set(schedule.id, { task, cronExpr: expr });
}

// Run a single schedule now and persist the result. Used by both the
// cron tick AND the manual "Run now" button in the UI.
async function runOne(scheduleId) {
  const sched = cacheSchedules.getById(scheduleId);
  if (!sched) return { skipped: true, reason: 'not-found' };
  if (!sched.enabled) return { skipped: true, reason: 'disabled' };
  try {
    const report = db.prepare('SELECT model_id FROM reports WHERE id = ?').get(sched.report_id);
    if (!report || !report.model_id) {
      cacheSchedules.recordRun(sched.id, 'error', 'Report has no model');
      return { error: 'no-model' };
    }
    const r = await rollupBuilder.buildRollupsForModel({
      modelId: report.model_id,
      internalUserId: sched.user_id,
      orgId: null,
      log: process.env.ROLLUP_LOG !== '0',
    });
    const hasErrors = r.errors && r.errors.length > 0;
    const status = (hasErrors && r.built === 0) ? 'error' : 'ok';
    const note = hasErrors
      ? r.errors.join(' | ').slice(0, 500)
      : `Built ${r.built}/${r.fired} rollup(s)`;
    cacheSchedules.recordRun(sched.id, status, note);
    return { ok: status === 'ok', ...r };
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    cacheSchedules.recordRun(sched.id, 'error', msg.slice(0, 500));
    console.error(`[cacheScheduler] schedule ${sched.id} failed:`, msg);
    return { error: msg };
  }
}

function bootRegisterAll() {
  const all = cacheSchedules.listAllEnabled();
  for (const s of all) register(s);
  if (all.length > 0) console.log(`[cacheScheduler] registered ${all.length} cache schedule(s)`);
  // No boot warm. Rollup tables persist in DuckDB (or the source DB)
  // across container restarts — there's nothing to rebuild on startup.
  // Each schedule's cron tick refreshes its model's rollups on its
  // normal cadence; the runtime /query planner falls through to direct
  // fact queries on a miss, so a stale rollup degrades to baseline
  // (slow) rather than failing.
}

module.exports = { register, unregister, runOne, bootRegisterAll };
