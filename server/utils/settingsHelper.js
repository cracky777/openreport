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

// ─── Query result cache ─────────────────────────────────────────────
// Same shape as the timeout: bounded values, persisted in app_settings,
// admin-tunable via /api/admin/settings.
const QUERY_CACHE_TTL_MIN_MS = 0;            // 0 = cache disabled
const QUERY_CACHE_TTL_MAX_MS = 24 * 3600_000; // 24 h ceiling
const QUERY_CACHE_TTL_DEFAULT_MS = 5 * 60_000; // 5 min default
const QUERY_CACHE_MAX_ENTRIES_DEFAULT = 5000;

function clampQueryCacheTtl(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n)) return QUERY_CACHE_TTL_DEFAULT_MS;
  return Math.max(QUERY_CACHE_TTL_MIN_MS, Math.min(QUERY_CACHE_TTL_MAX_MS, Math.round(n)));
}

function isQueryCacheEnabled() {
  return getSetting('query_cache_enabled', true) !== false;
}

function setQueryCacheEnabled(enabled) {
  setSetting('query_cache_enabled', !!enabled);
  return !!enabled;
}

function getQueryCacheTtlMs() {
  return clampQueryCacheTtl(getSetting('query_cache_ttl_ms', QUERY_CACHE_TTL_DEFAULT_MS));
}

function setQueryCacheTtlMs(ms) {
  const clamped = clampQueryCacheTtl(ms);
  setSetting('query_cache_ttl_ms', clamped);
  return clamped;
}

function getQueryCacheMaxEntries() {
  const v = Number(getSetting('query_cache_max_entries', QUERY_CACHE_MAX_ENTRIES_DEFAULT));
  return Number.isFinite(v) && v > 0 ? Math.round(v) : QUERY_CACHE_MAX_ENTRIES_DEFAULT;
}

module.exports = {
  QUERY_TIMEOUT_MIN_MS,
  QUERY_TIMEOUT_MAX_MS,
  QUERY_TIMEOUT_DEFAULT_MS,
  QUERY_CACHE_TTL_MIN_MS,
  QUERY_CACHE_TTL_MAX_MS,
  QUERY_CACHE_TTL_DEFAULT_MS,
  getSetting,
  setSetting,
  clampQueryTimeout,
  getQueryTimeoutMs,
  setQueryTimeoutMs,
  clampQueryCacheTtl,
  isQueryCacheEnabled,
  setQueryCacheEnabled,
  getQueryCacheTtlMs,
  setQueryCacheTtlMs,
  getQueryCacheMaxEntries,
};
