/**
 * CRUD + run-recording for OSS cache_warm schedules.
 *
 * Same kind of contract as cloud's schedules.js but stripped to the
 * essentials: no email path, no per-recipient logic, no plan-based
 * quotas. Every row is just (report_id, cron, enabled, last_run_*).
 */

const { v4: uuidv4 } = require('uuid');
const { CronExpressionParser } = require('cron-parser');
const db = require('../db');

function listForReport(reportId) {
  return db.prepare(`
    SELECT s.*, u.email AS owner_email, u.display_name AS owner_name
    FROM cache_schedules s
    LEFT JOIN users u ON u.id = s.user_id
    WHERE s.report_id = ?
    ORDER BY s.created_at DESC
  `).all(reportId).map(parseRow);
}

function listAllEnabled() {
  return db.prepare('SELECT * FROM cache_schedules WHERE enabled = 1').all().map(parseRow);
}

function getById(id) {
  const row = db.prepare('SELECT * FROM cache_schedules WHERE id = ?').get(id);
  return row ? parseRow(row) : null;
}

function parseRow(row) {
  return {
    ...row,
    enabled: row.enabled === 1,
  };
}

// Reject obviously malformed cron expressions before we hand them to
// node-cron. Returns null on OK, an error string otherwise.
function validateCron(expr) {
  if (!expr || typeof expr !== 'string') return 'cron_expression must be a string';
  try {
    CronExpressionParser.parse(expr);
    return null;
  } catch (e) {
    return `Invalid cron: ${e.message || e}`;
  }
}

function create({ reportId, userId, cronExpression, timezone, enabled }) {
  const id = uuidv4();
  db.prepare(`
    INSERT INTO cache_schedules
      (id, report_id, user_id, cron_expression, timezone, enabled)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    id, reportId, userId,
    cronExpression, timezone || 'UTC',
    enabled === false ? 0 : 1,
  );
  return getById(id);
}

function update(id, patch) {
  const cur = getById(id);
  if (!cur) return null;
  const next = { ...cur, ...patch };
  db.prepare(`
    UPDATE cache_schedules SET
      cron_expression = ?,
      timezone = ?,
      enabled = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    next.cron_expression,
    next.timezone || 'UTC',
    next.enabled === false ? 0 : 1,
    id,
  );
  return getById(id);
}

function remove(id) {
  const info = db.prepare('DELETE FROM cache_schedules WHERE id = ?').run(id);
  return info.changes > 0;
}

// Persist the result of a run so the UI can show "last run: 5 min ago,
// ok / error". Never throws — if the schedule was deleted between the
// run and the record, the UPDATE is a no-op.
function recordRun(id, status, error) {
  try {
    db.prepare(`
      UPDATE cache_schedules SET
        last_run_at = datetime('now'),
        last_run_status = ?,
        last_error = ?
      WHERE id = ?
    `).run(status, error || null, id);
  } catch (e) {
    console.warn('[cacheSchedules.recordRun]', e.message);
  }
}

module.exports = {
  listForReport,
  listAllEnabled,
  getById,
  validateCron,
  create,
  update,
  remove,
  recordRun,
};
