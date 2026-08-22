/**
 * Threshold-alert runtime.
 *
 * Same architecture as cacheScheduler: node-cron jobs registered at boot
 * and hot-reloaded on CRUD. Each tick evaluates ONE alert: fire the
 * model's /query over loopback with the CREATOR's identity (internal
 * token — RLS applies exactly as if they ran the widget themselves,
 * bypassCache so the value is live, never a stale cache read), compare
 * the measure to the threshold, and act on STATE TRANSITIONS only:
 *
 *   ok → triggered        event 'triggered'  + webhook
 *   triggered → ok        event 'recovered'  + webhook (opt-out per alert)
 *   * → error             event 'error', no webhook (history + last_error)
 *
 * A tick that lands in the same state as the previous one records
 * nothing — an alert that stays red does not re-notify every cadence.
 *
 * Channels: the webhook (OSS) plus whatever `cloudHooks.notifyAlert`
 * adds (cloud: e-mail). Both are best-effort — a delivery failure is
 * noted on the event, never retried, and never blocks the state update.
 *
 * `deps` exists for tests: they inject `fireQuery` (no listening server
 * under Jest), `postWebhook` and `notify`.
 */

const cron = require('node-cron');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const internalToken = require('./internalToken');
const { parseModel } = require('../db/modelRow');
const cloudHooks = require('../cloudHooks');

const WEBHOOK_TIMEOUT_MS = 10_000;

function appBase() {
  if (process.env.ROLLUP_INTERNAL_URL) return process.env.ROLLUP_INTERNAL_URL.replace(/\/+$/, '');
  const port = process.env.PORT || '3001';
  return `http://127.0.0.1:${port}`;
}

const OPS = {
  gt: (v, t) => v > t,
  gte: (v, t) => v >= t,
  lt: (v, t) => v < t,
  lte: (v, t) => v <= t,
  eq: (v, t) => v === t,
  neq: (v, t) => v !== t,
};

function compare(op, value, threshold) {
  const fn = OPS[op];
  if (!fn) return null;
  return fn(value, threshold);
}

// Default evaluator: loopback /query as the alert's owner.
async function defaultFireQuery(alert) {
  const token = internalToken.sign({
    userId: alert.user_id,
    organizationId: alert.organization_id || null,
  });
  const res = await fetch(`${appBase()}/api/models/${alert.model_id}/query`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', [internalToken.HEADER]: token },
    body: JSON.stringify({
      dimensionNames: [],
      measureNames: [alert.measure_name],
      widgetFilters: JSON.parse(alert.widget_filters || '[]'),
      limit: 1,
      bypassCache: true,
    }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error((json && json.error) || `query failed (${res.status})`);
  return json.rows || [];
}

// The /query response keys columns by the measure's LABEL — resolve it
// from the model, falling back to the first numeric cell so a renamed
// label between two ticks doesn't break the alert.
function extractValue(alert, rows) {
  if (!rows || rows.length === 0) return null;
  const row = rows[0];
  const model = parseModel(db.prepare('SELECT * FROM models WHERE id = ?').get(alert.model_id));
  const def = model && model.measures.find((m) => m.name === alert.measure_name);
  const key = def ? (def.label || def.name) : null;
  if (key && row[key] != null && Number.isFinite(Number(row[key]))) return Number(row[key]);
  for (const v of Object.values(row)) {
    if (v != null && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}

async function defaultPostWebhook(url, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
      redirect: 'error', // a redirect could bounce the POST to an internal target
    });
    return res.ok ? null : `webhook responded ${res.status}`;
  } catch (e) {
    return `webhook failed: ${e.message}`;
  } finally {
    clearTimeout(timer);
  }
}

function recordEvent(alertId, state, value, threshold, message) {
  db.prepare(`INSERT INTO alert_events (id, alert_id, state, value, threshold, message)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .run(uuidv4(), alertId, state, value, threshold, message || null);
  // History cap — an alert flapping every 5 minutes for a year must not
  // grow the metadata DB unbounded. 200 most recent events per alert.
  // rowid = insertion order; created_at only has second precision.
  db.prepare(`DELETE FROM alert_events WHERE alert_id = ? AND rowid NOT IN (
                SELECT rowid FROM alert_events WHERE alert_id = ? ORDER BY rowid DESC LIMIT 200
              )`).run(alertId, alertId);
}

/**
 * Evaluate one alert now. Returns { state, value, notified } (or
 * { skipped }). Used by the cron tick AND the "Run now" route.
 */
async function runOne(alertId, deps = {}) {
  const alert = db.prepare('SELECT * FROM alerts WHERE id = ?').get(alertId);
  if (!alert) return { skipped: true, reason: 'not-found' };
  if (!alert.enabled) return { skipped: true, reason: 'disabled' };
  const fireQuery = deps.fireQuery || defaultFireQuery;
  const postWebhook = deps.postWebhook || defaultPostWebhook;
  const notify = deps.notify || (typeof cloudHooks.notifyAlert === 'function' ? cloudHooks.notifyAlert : null);
  const prev = alert.last_state || null;

  // Fan a transition out to every channel; returns { note, notified }.
  // Notes from failed channels are joined so the history shows which one
  // broke; `notified` means at least one channel accepted the message.
  async function deliver(state, v) {
    const payload = webhookPayload(alert, state, v);
    const notes = [];
    let delivered = false;
    if (alert.webhook_url) {
      const n = await postWebhook(alert.webhook_url, payload);
      if (n) notes.push(n); else delivered = true;
    }
    if (notify) {
      try {
        const r = await notify({ alert, state, value: v, payload });
        if (r && r.note) notes.push(r.note);
        if (r && r.delivered) delivered = true;
      } catch (e) {
        notes.push(`notification failed: ${e.message}`);
      }
    }
    return { note: notes.length ? notes.join(' · ') : null, notified: delivered };
  }

  let value = null;
  let next;
  let message = null;
  try {
    const rows = await fireQuery(alert);
    value = extractValue(alert, rows);
    if (value === null) {
      next = 'error';
      message = 'The query returned no numeric value';
    } else {
      const hit = compare(alert.op, value, alert.threshold);
      if (hit === null) {
        next = 'error';
        message = `Unknown operator "${alert.op}"`;
      } else {
        next = hit ? 'triggered' : 'ok';
      }
    }
  } catch (err) {
    next = 'error';
    message = (err && err.message ? err.message : String(err)).slice(0, 500);
  }

  let notified = false;
  const transition = next !== prev;
  if (transition && next === 'triggered') {
    const d = await deliver('triggered', value);
    notified = d.notified;
    recordEvent(alert.id, 'triggered', value, alert.threshold, d.note);
  } else if (transition && next === 'ok' && prev === 'triggered') {
    let note = null;
    if (alert.notify_on_recover) {
      const d = await deliver('recovered', value);
      notified = d.notified;
      note = d.note;
    }
    recordEvent(alert.id, 'recovered', value, alert.threshold, note);
  } else if (transition && next === 'error') {
    recordEvent(alert.id, 'error', value, alert.threshold, message);
  }

  db.prepare(`UPDATE alerts SET last_state = ?, last_value = ?, last_checked_at = datetime('now'),
                last_error = ?,
                last_triggered_at = CASE WHEN ? = 1 THEN datetime('now') ELSE last_triggered_at END
              WHERE id = ?`)
    .run(next, value, next === 'error' ? message : null, next === 'triggered' && transition ? 1 : 0, alert.id);

  return { state: next, value, notified, transition };
}

function webhookPayload(alert, state, value) {
  const OP_TEXT = { gt: '>', gte: '>=', lt: '<', lte: '<=', eq: '=', neq: '!=' };
  return {
    source: 'openreport',
    alert: alert.name,
    state,
    value,
    threshold: alert.threshold,
    condition: `${OP_TEXT[alert.op] || alert.op} ${alert.threshold}`,
    measure: alert.measure_name,
    checkedAt: new Date().toISOString(),
    // Slack/Teams/Discord render `text` — one field covers the common
    // incoming-webhook integrations without per-vendor formats.
    text: state === 'triggered'
      ? `🔴 Alert "${alert.name}": value ${value} is ${OP_TEXT[alert.op] || alert.op} ${alert.threshold}`
      : `🟢 Alert "${alert.name}" recovered: value ${value}`,
  };
}

// ─── cron registry (mirrors cacheScheduler) ───────────────────────────
const _jobs = new Map();

function unregister(alertId) {
  const entry = _jobs.get(alertId);
  if (!entry) return;
  try { entry.task.stop(); } catch { /* already stopped */ }
  _jobs.delete(alertId);
}

function register(alert) {
  unregister(alert.id);
  if (!alert.enabled) return;
  const expr = alert.cron_expression;
  if (!expr || !cron.validate(expr)) {
    console.warn(`[alertRunner] invalid cron "${expr}" for alert ${alert.id}`);
    return;
  }
  const opts = { scheduled: true };
  if (alert.timezone) opts.timezone = alert.timezone;
  const task = cron.schedule(expr, () => {
    runOne(alert.id).catch((err) => console.error('[alertRunner] tick failed:', err));
  }, opts);
  _jobs.set(alert.id, { task, cronExpr: expr });
}

function bootRegisterAll() {
  const all = db.prepare('SELECT * FROM alerts WHERE enabled = 1').all();
  for (const a of all) register(a);
  if (all.length > 0) console.log(`[alertRunner] registered ${all.length} alert(s)`);
}

// Stop every registered job — graceful shutdown, and the Jest suite's way
// of releasing the event loop after route tests registered live crons.
function stopAll() {
  for (const id of [..._jobs.keys()]) unregister(id);
}

module.exports = { register, unregister, runOne, bootRegisterAll, stopAll, compare, extractValue, webhookPayload };
