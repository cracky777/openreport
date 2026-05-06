const db = require('../db');

// Bounds for the query timeout setting — enforced server-side so a
// misconfigured admin UI can never park a runaway query.
const QUERY_TIMEOUT_MIN_MS = 5_000;        // 5 s safety floor for tests
const QUERY_TIMEOUT_MAX_MS = 300_000;      // 5 min hard ceiling
const QUERY_TIMEOUT_DEFAULT_MS = 60_000;   // 1 min default

function getSetting(key, fallback) {
  try {
    const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
    if (!row) return fallback;
    return JSON.parse(row.value);
  } catch {
    return fallback;
  }
}

function setSetting(key, value) {
  const json = JSON.stringify(value);
  db.prepare(`
    INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `).run(key, json);
}

function clampQueryTimeout(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n)) return QUERY_TIMEOUT_DEFAULT_MS;
  return Math.max(QUERY_TIMEOUT_MIN_MS, Math.min(QUERY_TIMEOUT_MAX_MS, Math.round(n)));
}

function getQueryTimeoutMs() {
  return clampQueryTimeout(getSetting('query_timeout_ms', QUERY_TIMEOUT_DEFAULT_MS));
}

function setQueryTimeoutMs(ms) {
  const clamped = clampQueryTimeout(ms);
  setSetting('query_timeout_ms', clamped);
  return clamped;
}

module.exports = {
  QUERY_TIMEOUT_MIN_MS,
  QUERY_TIMEOUT_MAX_MS,
  QUERY_TIMEOUT_DEFAULT_MS,
  getSetting,
  setSetting,
  clampQueryTimeout,
  getQueryTimeoutMs,
  setQueryTimeoutMs,
};
