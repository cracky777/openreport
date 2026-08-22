/**
 * Threshold alerts — CRUD + manual evaluation + event history.
 *
 * Ownership model: an alert belongs to its creator (it evaluates with
 * THEIR identity, so RLS applies as if they ran the widget). Listing
 * shows the caller's own alerts (admins see everything); mutating and
 * running someone else's alert requires admin. Creation needs write
 * role + read access to the model — same bar as querying it.
 */
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { authFor } = require('../middleware/auth');
const db = require('../db');
const { canAccessModel } = require('./reports');
const { parseModel } = require('../db/modelRow');
const { validateCron } = require('../utils/cacheSchedules');
const { hostIsBlocked } = require('./datasources');
const alertRunner = require('../utils/alertRunner');
const cloudHooks = require('../cloudHooks');

const router = express.Router();
router.use(authFor('write'));

const OPS = new Set(['gt', 'gte', 'lt', 'lte', 'eq', 'neq']);

function isOwnerOrAdmin(alert, req) {
  return alert.user_id === req.user.id || req.user.role === 'admin';
}

// Validate the mutable fields; returns { error } or the normalised patch.
// `existing` is null on create — then every required field must be there.
function validateAlertBody(body, req, existing) {
  const out = {};
  const b = body || {};

  if (b.name !== undefined || !existing) {
    if (typeof b.name !== 'string' || !b.name.trim()) return { error: '"name" is required' };
    if (b.name.length > 120) return { error: '"name" is too long (max 120)' };
    out.name = b.name.trim();
  }
  if (b.modelId !== undefined || !existing) {
    const model = db.prepare('SELECT * FROM models WHERE id = ?').get(String(b.modelId || ''));
    if (!model || !canAccessModel(model, req.user, req)) return { error: 'Model not found' };
    out.model_id = model.id;
    out._model = model;
  }
  if (b.measureName !== undefined || !existing) {
    const modelRow = out._model || db.prepare('SELECT * FROM models WHERE id = ?').get(existing.model_id);
    const model = parseModel(modelRow);
    if (!model.measures.find((m) => m.name === b.measureName)) {
      return { error: `Measure "${b.measureName}" is not in the model` };
    }
    out.measure_name = b.measureName;
  }
  if (b.op !== undefined || !existing) {
    if (!OPS.has(b.op)) return { error: `"op" must be one of ${[...OPS].join(', ')}` };
    out.op = b.op;
  }
  if (b.threshold !== undefined || !existing) {
    const t = Number(b.threshold);
    if (!Number.isFinite(t)) return { error: '"threshold" must be a number' };
    out.threshold = t;
  }
  if (b.cronExpression !== undefined || !existing) {
    const e = validateCron(b.cronExpression);
    if (e) return { error: e };
    out.cron_expression = b.cronExpression;
  }
  if (b.timezone !== undefined) {
    if (b.timezone !== null && typeof b.timezone !== 'string') return { error: '"timezone" must be a string' };
    out.timezone = b.timezone || null;
  }
  if (b.webhookUrl !== undefined) {
    if (b.webhookUrl === null || b.webhookUrl === '') {
      out.webhook_url = null;
    } else {
      let u;
      try { u = new URL(String(b.webhookUrl)); } catch { return { error: 'Invalid webhook URL' }; }
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return { error: 'The webhook must be http(s)' };
      if (hostIsBlocked(u.hostname)) return { error: 'This webhook host is not reachable from the server.' };
      if (String(b.webhookUrl).length > 500) return { error: 'Webhook URL too long' };
      out.webhook_url = String(b.webhookUrl);
    }
  }
  if (b.widgetFilters !== undefined) {
    const wf = b.widgetFilters;
    if (!Array.isArray(wf) || wf.length > 20) return { error: '"widgetFilters" must be a list (max 20)' };
    for (const f of wf) {
      if (!f || typeof f.field !== 'string' || typeof f.op !== 'string') {
        return { error: 'Every filter needs "field" and "op"' };
      }
    }
    out.widget_filters = JSON.stringify(wf);
  }
  if (b.enabled !== undefined) out.enabled = b.enabled ? 1 : 0;
  if (b.notifyOnRecover !== undefined) out.notify_on_recover = b.notifyOnRecover ? 1 : 0;
  delete out._model;
  // Extra channels (cloud: e-mail recipients) — the hook validates its own
  // fields and hands back the column patch; OSS has no hook → nothing merged.
  if (typeof cloudHooks.validateAlertExtras === 'function') {
    const extra = cloudHooks.validateAlertExtras(b, req, existing);
    if (extra && extra.error) return { error: extra.error };
    if (extra && extra.fields) Object.assign(out, extra.fields);
  }
  return { fields: out };
}

const publicAlert = (a) => ({
  ...a,
  widget_filters: JSON.parse(a.widget_filters || '[]'),
  enabled: !!a.enabled,
  notify_on_recover: !!a.notify_on_recover,
});

// Owner email + model name ride along so the admin console (which lists
// EVERY alert) can label rows without N+1 fetches; the same shape for
// non-admins keeps the client agnostic.
const LIST_SQL = `SELECT a.*, u.email AS owner_email, m.name AS model_name
                  FROM alerts a
                  LEFT JOIN users u ON u.id = a.user_id
                  LEFT JOIN models m ON m.id = a.model_id`;

router.get('/', (req, res) => {
  const rows = req.user.role === 'admin'
    ? db.prepare(`${LIST_SQL} ORDER BY a.created_at DESC`).all()
    : db.prepare(`${LIST_SQL} WHERE a.user_id = ? ORDER BY a.created_at DESC`).all(req.user.id);
  res.json({ alerts: rows.map(publicAlert) });
});

router.post('/', (req, res) => {
  const v = validateAlertBody(req.body, req, null);
  if (v.error) return res.status(400).json({ error: v.error });
  const id = uuidv4();
  // Column list built from the validated patch so hook-provided columns
  // (cloud e-mail recipients) land on create as well as on update.
  const row = {
    id,
    user_id: req.user.id,
    organization_id: req.organizationId || null,
    widget_filters: '[]',
    timezone: null,
    webhook_url: null,
    enabled: 1,
    notify_on_recover: 1,
    ...v.fields,
  };
  const cols = Object.keys(row);
  db.prepare(`INSERT INTO alerts (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .run(...cols.map((c) => row[c]));
  const created = db.prepare('SELECT * FROM alerts WHERE id = ?').get(id);
  alertRunner.register(created);
  res.status(201).json({ alert: publicAlert(created) });
});

router.put('/:id', (req, res) => {
  const alert = db.prepare('SELECT * FROM alerts WHERE id = ?').get(req.params.id);
  if (!alert) return res.status(404).json({ error: 'Alert not found' });
  if (!isOwnerOrAdmin(alert, req)) return res.status(403).json({ error: 'Forbidden' });
  const v = validateAlertBody(req.body, req, alert);
  if (v.error) return res.status(400).json({ error: v.error });
  const f = v.fields;
  const cols = Object.keys(f);
  if (cols.length > 0) {
    db.prepare(`UPDATE alerts SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`)
      .run(...cols.map((c) => f[c]), alert.id);
  }
  const updated = db.prepare('SELECT * FROM alerts WHERE id = ?').get(alert.id);
  alertRunner.register(updated); // hot-reload cron (also stops it when disabled)
  res.json({ alert: publicAlert(updated) });
});

router.delete('/:id', (req, res) => {
  const alert = db.prepare('SELECT * FROM alerts WHERE id = ?').get(req.params.id);
  if (!alert) return res.status(404).json({ error: 'Alert not found' });
  if (!isOwnerOrAdmin(alert, req)) return res.status(403).json({ error: 'Forbidden' });
  alertRunner.unregister(alert.id);
  db.prepare('DELETE FROM alerts WHERE id = ?').run(alert.id);
  res.json({ ok: true });
});

// Evaluate now — the "does my condition work?" button. Runs exactly the
// cron-tick path (transitions, events, webhook included).
router.post('/:id/run', async (req, res) => {
  const alert = db.prepare('SELECT * FROM alerts WHERE id = ?').get(req.params.id);
  if (!alert) return res.status(404).json({ error: 'Alert not found' });
  if (!isOwnerOrAdmin(alert, req)) return res.status(403).json({ error: 'Forbidden' });
  const result = await alertRunner.runOne(alert.id);
  res.json({ result });
});

router.get('/:id/events', (req, res) => {
  const alert = db.prepare('SELECT * FROM alerts WHERE id = ?').get(req.params.id);
  if (!alert) return res.status(404).json({ error: 'Alert not found' });
  if (!isOwnerOrAdmin(alert, req)) return res.status(403).json({ error: 'Forbidden' });
  const events = db.prepare(
    'SELECT * FROM alert_events WHERE alert_id = ? ORDER BY rowid DESC LIMIT 50'
  ).all(alert.id);
  res.json({ events });
});

module.exports = router;
