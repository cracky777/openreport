const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { requireAdmin } = require('../middleware/auth');
const db = require('../db');
const authHooks = require('../hooks/auth');
const {
  QUERY_TIMEOUT_MIN_MS,
  QUERY_TIMEOUT_MAX_MS,
  QUERY_TIMEOUT_DEFAULT_MS,
  QUERY_CACHE_TTL_MIN_MS,
  QUERY_CACHE_TTL_MAX_MS,
  QUERY_CACHE_TTL_DEFAULT_MS,
  getQueryTimeoutMs,
  setQueryTimeoutMs,
  isQueryCacheEnabled,
  setQueryCacheEnabled,
  getQueryCacheTtlMs,
  setQueryCacheTtlMs,
} = require('../utils/settingsHelper');
const queryCache = require('../utils/queryCache');
const preAggCache = require('../utils/preAggCache');

const router = express.Router();

// List all users
router.get('/users', requireAdmin, (req, res) => {
  const users = db.prepare('SELECT id, email, display_name, role, created_at FROM users ORDER BY created_at ASC').all();
  res.json({ users });
});

// Update user role
router.put('/users/:id/role', requireAdmin, (req, res) => {
  const { role } = req.body;
  if (!['admin', 'editor', 'viewer'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role. Must be admin, editor, or viewer' });
  }
  // Prevent removing the last admin
  if (role !== 'admin') {
    const target = db.prepare('SELECT role FROM users WHERE id = ?').get(req.params.id);
    if (target?.role === 'admin') {
      const adminCount = db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'admin'").get();
      if (adminCount.c <= 1) {
        return res.status(400).json({ error: 'Cannot remove the last admin' });
      }
    }
  }
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, req.params.id);
  res.json({ message: 'Role updated' });
});

// Create user (admin only)
router.post('/users', requireAdmin, async (req, res) => {
  const { email, password, displayName, role } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return res.status(409).json({ error: 'Email already registered' });

  const id = uuidv4();
  const passwordHash = bcrypt.hashSync(password, 10);
  const userRole = ['admin', 'editor', 'viewer'].includes(role) ? role : 'viewer';

  db.prepare('INSERT INTO users (id, email, password_hash, display_name, role) VALUES (?, ?, ?, ?, ?)').run(
    id, email, passwordHash, displayName || email.split('@')[0], userRole
  );

  // Same post-register hooks as /api/auth/register: in cloud mode this provisions
  // a personal org for the new user. The hook receives the creator's `req` so
  // the cloud's session-based active-org logic doesn't accidentally swap onto
  // the new user's org for the admin who triggered the creation.
  const newUser = { id, email, display_name: displayName || email.split('@')[0], role: userRole };
  await authHooks.runPostRegister({ user: newUser, req: { session: null, user: req.user } });

  res.status(201).json({ user: newUser });
});

// Delete user
router.delete('/users/:id', requireAdmin, (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'Cannot delete yourself' });
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ message: 'User deleted' });
});

// Reset user password
router.put('/users/:id/password', requireAdmin, (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 4) return res.status(400).json({ error: 'Password too short' });
  const hash = bcrypt.hashSync(password, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.params.id);
  res.json({ message: 'Password reset' });
});

// ─── Settings ──────────────────────────────────────────────
// Global app settings, admin-only. Currently exposes the query
// timeout (clamped to [QUERY_TIMEOUT_MIN_MS, QUERY_TIMEOUT_MAX_MS]
// at the helper level so misuse can't park a runaway query).
router.get('/settings', requireAdmin, (req, res) => {
  // Sum the byte size of every DuckDB upload tracked in datasources —
  // gives the admin a single number for "how much disk this instance
  // is using for source files". Stored as `fileSize` in extra_config
  // when the upload route records the import (see routes/fileUpload).
  let totalUploadedBytes = 0;
  let uploadedFileCount = 0;
  try {
    const rows = db.prepare(
      "SELECT extra_config FROM datasources WHERE db_type = 'duckdb'"
    ).all();
    for (const r of rows) {
      try {
        const cfg = JSON.parse(r.extra_config || '{}');
        if (typeof cfg.fileSize === 'number') {
          totalUploadedBytes += cfg.fileSize;
          uploadedFileCount++;
        }
      } catch { /* skip malformed */ }
    }
  } catch { /* table missing on a fresh install */ }
  res.json({
    queryTimeoutMs: getQueryTimeoutMs(),
    queryTimeoutMinMs: QUERY_TIMEOUT_MIN_MS,
    queryTimeoutMaxMs: QUERY_TIMEOUT_MAX_MS,
    queryTimeoutDefaultMs: QUERY_TIMEOUT_DEFAULT_MS,
    queryCacheEnabled: isQueryCacheEnabled(),
    queryCacheTtlMs: getQueryCacheTtlMs(),
    queryCacheTtlMinMs: QUERY_CACHE_TTL_MIN_MS,
    queryCacheTtlMaxMs: QUERY_CACHE_TTL_MAX_MS,
    queryCacheTtlDefaultMs: QUERY_CACHE_TTL_DEFAULT_MS,
    queryCacheStats: queryCache.stats(),
    preAggCacheStats: preAggCache.stats(),
    storage: {
      uploadedFileCount,
      uploadedBytes: totalUploadedBytes,
    },
  });
});

router.put('/settings/query-timeout', requireAdmin, (req, res) => {
  const { queryTimeoutMs } = req.body || {};
  const n = Number(queryTimeoutMs);
  if (!Number.isFinite(n)) return res.status(400).json({ error: 'queryTimeoutMs must be a number' });
  const stored = setQueryTimeoutMs(n);
  res.json({ queryTimeoutMs: stored });
});

// Query cache settings — admin-only. Toggling `enabled` off doesn't flush
// existing entries (we keep them around in case the admin re-enables); use
// the explicit /flush endpoint to drop everything in memory.
router.put('/settings/query-cache', requireAdmin, (req, res) => {
  const { enabled, ttlMs } = req.body || {};
  const out = {};
  if (enabled !== undefined) out.queryCacheEnabled = setQueryCacheEnabled(enabled);
  if (ttlMs !== undefined) {
    const n = Number(ttlMs);
    if (!Number.isFinite(n)) return res.status(400).json({ error: 'ttlMs must be a number' });
    out.queryCacheTtlMs = setQueryCacheTtlMs(n);
  }
  res.json(out);
});

// Flush — drops every cached entry on this instance. The next visual
// refresh on every report rebuilds the cache from the DB. Useful after
// an out-of-band schema change on a source DB the admin couldn't surface
// through the model-save invalidation hook.
router.post('/settings/query-cache/flush', requireAdmin, (req, res) => {
  const evicted = queryCache.flush();
  const evictedPreAgg = preAggCache.flush();
  res.json({ evicted, evictedPreAgg });
});

module.exports = router;
