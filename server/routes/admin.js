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
  getPublicSharingPolicy,
  setPublicSharingPolicy,
} = require('../utils/settingsHelper');
const queryCache = require('../utils/queryCache');

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

// ─── Groups ────────────────────────────────────────────────
// User groups back the `group:<name>` RLS patterns. Admin-only management:
// in OSS the instance operator owns access policy, and a self-managed group
// would let any member widen their own RLS scope.

// A group name lands verbatim inside RLS rules (`group:<name>`), so keep it
// to a shape that can't be confused with an email pattern or swallow the
// rule separator logic later.
const GROUP_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9 _.-]{0,63}$/;

router.get('/groups', requireAdmin, (req, res) => {
  const groups = db.prepare(`
    SELECT g.id, g.name, g.created_at, COUNT(gm.user_id) AS member_count
    FROM groups g LEFT JOIN group_members gm ON gm.group_id = g.id
    GROUP BY g.id ORDER BY g.name COLLATE NOCASE
  `).all();
  res.json({ groups });
});

router.get('/groups/:id/members', requireAdmin, (req, res) => {
  const group = db.prepare('SELECT id, name FROM groups WHERE id = ?').get(req.params.id);
  if (!group) return res.status(404).json({ error: 'Group not found' });
  const members = db.prepare(`
    SELECT u.id, u.email, u.display_name
    FROM group_members gm JOIN users u ON u.id = gm.user_id
    WHERE gm.group_id = ? ORDER BY u.email
  `).all(req.params.id);
  res.json({ group, members });
});

router.post('/groups', requireAdmin, (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!GROUP_NAME_RE.test(name)) {
    return res.status(400).json({ error: 'Group name must be 1-64 characters: letters, digits, spaces, . _ -' });
  }
  const existing = db.prepare('SELECT id FROM groups WHERE name = ? COLLATE NOCASE').get(name);
  if (existing) return res.status(409).json({ error: 'A group with this name already exists' });
  const id = uuidv4();
  db.prepare('INSERT INTO groups (id, name) VALUES (?, ?)').run(id, name);
  res.status(201).json({ group: { id, name, member_count: 0 } });
});

router.delete('/groups/:id', requireAdmin, (req, res) => {
  const done = db.prepare('DELETE FROM groups WHERE id = ?').run(req.params.id);
  if (done.changes === 0) return res.status(404).json({ error: 'Group not found' });
  // RLS rules referencing the deleted name simply stop matching anyone —
  // fail-closed, same as an email pattern for a departed user.
  res.json({ message: 'Group deleted' });
});

router.post('/groups/:id/members', requireAdmin, (req, res) => {
  const group = db.prepare('SELECT id FROM groups WHERE id = ?').get(req.params.id);
  if (!group) return res.status(404).json({ error: 'Group not found' });
  const email = String(req.body.email || '').trim();
  const user = db.prepare('SELECT id, email, display_name FROM users WHERE email = ? COLLATE NOCASE').get(email);
  if (!user) return res.status(404).json({ error: 'No user with this email' });
  db.prepare('INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)').run(req.params.id, user.id);
  res.status(201).json({ member: user });
});

router.delete('/groups/:id/members/:userId', requireAdmin, (req, res) => {
  const done = db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?')
    .run(req.params.id, req.params.userId);
  if (done.changes === 0) return res.status(404).json({ error: 'Not a member of this group' });
  res.json({ message: 'Member removed' });
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

  // Rollup manifest totals + on-disk store size, read once and shared by
  // both rollupStorage and the back-compat preAggCacheStats below.
  let rollupCount = 0;
  let rollupRows = 0;
  try {
    const r = db.prepare('SELECT COUNT(*) AS c, COALESCE(SUM(row_count),0) AS rws FROM rollups').get();
    rollupCount = r.c || 0;
    rollupRows = r.rws || 0;
  } catch { /* table missing on a fresh DB pre-migration */ }
  let rollupBytes = 0;
  try {
    rollupBytes = require('../utils/rollupDuckDB').totalStoreBytes();
  } catch { /* file not created yet (no rollups built) */ }

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
    // Persisted rollup tables replaced the in-RAM pre-agg cache. This is
    // LOCAL DISK storage (one embedded DuckDB file per model), not RAM.
    // `bytes` is the summed on-disk size of every model store; `rollups`/
    // `rows` are the manifest totals across every model.
    rollupStorage: { mode: 'duckdb-local', rollups: rollupCount, rows: rollupRows, bytes: rollupBytes },
    // Back-compat: QueryCacheControl still reads preAggStats.size for the
    // rollup entry count. Bytes = real disk size of the rollup store.
    preAggCacheStats: { enabled: true, ttlMs: 0, size: rollupCount, bytes: rollupBytes },
    storage: {
      uploadedFileCount,
      uploadedBytes: totalUploadedBytes,
    },
    publicSharingPolicy: getPublicSharingPolicy(),
  });
});

// Public-sharing policy — who may flip a report public, instance-wide.
// 'disabled' is also a kill switch: already-public reports stop serving
// anonymously until the policy is relaxed again.
router.put('/settings/public-sharing', requireAdmin, (req, res) => {
  try {
    res.json({ publicSharingPolicy: setPublicSharingPolicy(String(req.body?.policy || '')) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
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
  // Only the in-RAM SHA-keyed queryCache is flushable here. Rollup
  // tables are a persistent store rebuilt on schedule (or via the
  // per-model "Run now") — flushing them on an admin click would just
  // make every report cold with no automatic rebuild.
  const evicted = queryCache.flush();
  res.json({ evicted, evictedPreAgg: 0, evictedDisplay: 0 });
});

module.exports = router;
