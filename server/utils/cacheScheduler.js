/**
 * node-cron runtime for OSS cache_warm schedules.
 *
 * On boot: load every enabled schedule and register a cron job for it.
 * On create/update/delete: hot-reload by stop+register.
 *
 * Each tick fires `cacheWarmer.warmReport(...)` and persists the result
 * via `cacheSchedules.recordRun`. We intentionally do NOT use a queue —
 * the warmer is fast enough (a handful of HTTP calls back to localhost)
 * that overlapping cron ticks aren't a real concern in OSS, where
 * there's only one server process.
 */

const cron = require('node-cron');
const cacheSchedules = require('./cacheSchedules');
const cacheWarmer = require('./cacheWarmer');

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
    const r = await cacheWarmer.warmReport({
      scheduleId: sched.id,
      reportId: sched.report_id,
      userId: sched.user_id,
    });
    const status = r.failed > 0 && r.ok === 0 ? 'error' : 'ok';
    const note = r.errors
      ? r.errors.join(' | ').slice(0, 500)
      : `Warmed ${r.warmed}/${r.fired} widget(s)${r.preAggsStored ? `, ${r.preAggsStored} pre-agg` : ''}`;
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
}

module.exports = { register, unregister, runOne, bootRegisterAll };
