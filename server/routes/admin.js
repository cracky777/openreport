const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { requireAdmin } = require('../middleware/auth');
const aiFeedback = require('../utils/ai/feedback');
const db = require('../db');
const { retireDuckDBFile } = require('../utils/duckdbFiles');
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
  getSupportEmail,
  setSupportEmail,
  isApiEnabled,
  setApiEnabled,
  getApiMinRole,
  setApiMinRole,
  getAiConfig,
  setAiConfig,
  publicAiConfig,
} = require('../utils/settingsHelper');
const { testProvider } = require('../utils/ai/providerTest');
const cloudHooks = require('../cloudHooks');
const aiAccess = require('../utils/ai/access');
const queryCache = require('../utils/queryCache');
const apiToken = require('../utils/apiToken');
const { validatePassword } = require('./auth');
const { destroySessionsForUser } = require('../utils/sessionRegistry');
const usage = require('../utils/usage');

const router = express.Router();

// Usage & observability summary for the Admin console. `days` = window
// (1..90, default 7). Cloud scopes it to the active org.
router.get('/usage', requireAdmin, (req, res) => {
  res.json(usage.summary({ days: req.query.days, orgId: req.organizationId || null }));
});

// What users thought of the assistant's answers. `days` = window (default 30).
// When the edition sets the assistant up per organization (cloudHooks.
// resolveAiScope), the instance-wide settings below would configure nothing —
// and the ratings of every organization are not the operator's to read.
const aiPerOrganization = () => typeof cloudHooks.resolveAiScope === 'function';
function instanceAiOnly(req, res, next) {
  if (aiPerOrganization()) return res.status(404).json({ error: 'The AI assistant is set up by each organization' });
  return next();
}

// Every datasource, model and report of the instance: who created it, the
// workspace it lives in, the workspaces it is shared into. Metadata only — no
// credentials, no rows: the global admin manages everything but reads data
// where a workspace gave them a role (utils/workspaceAccess.js). The cloud
// scopes these per organization through its own hooks, so the instance-wide
// list is not served there.
router.get('/inventory', requireAdmin, (req, res) => {
  if (typeof cloudHooks.workspaceActor === 'function') return res.status(404).json({ error: 'Not available' });
  const workspaces = new Map(db.prepare(`
    SELECT w.id, w.name, w.is_personal, u.email AS owner_email, u.display_name AS owner_name
    FROM workspaces w LEFT JOIN users u ON u.id = w.owner_id
  `).all().map((w) => [w.id, {
    id: w.id,
    // A personal workspace is named "Personal" for everyone: say whose it is.
    name: w.is_personal ? `Personal · ${w.owner_name || w.owner_email || 'deleted user'}` : w.name,
    personal: !!w.is_personal,
  }]));
  const ws = (id) => (id ? workspaces.get(id) || { id, name: 'Unknown workspace', personal: false } : null);
  const sharesOf = (table, column) => {
    const out = new Map();
    for (const r of db.prepare(`SELECT workspace_id, ${column} AS id FROM ${table}`).all()) {
      if (!out.has(r.id)) out.set(r.id, []);
      out.get(r.id).push(ws(r.workspace_id));
    }
    return out;
  };
  const dsShares = sharesOf('workspace_datasources', 'datasource_id');
  const modelShares = sharesOf('workspace_models', 'model_id');
  const reportShares = sharesOf('workspace_reports', 'report_id');
  const creator = (r) => ({ id: r.user_id, email: r.creator_email || null, name: r.creator_name || null });

  const datasources = db.prepare(`
    SELECT d.id, d.name, d.db_type, d.created_at, d.user_id, d.workspace_id,
      u.email AS creator_email, u.display_name AS creator_name,
      (SELECT COUNT(*) FROM models m WHERE m.datasource_id = d.id) AS model_count
    FROM datasources d LEFT JOIN users u ON u.id = d.user_id
    ORDER BY d.name COLLATE NOCASE
  `).all().map((d) => ({
    id: d.id, name: d.name, dbType: d.db_type, createdAt: d.created_at, modelCount: d.model_count,
    creator: creator(d), workspace: ws(d.workspace_id), sharedIn: dsShares.get(d.id) || [],
  }));

  const models = db.prepare(`
    SELECT m.id, m.name, m.created_at, m.updated_at, m.user_id, m.workspace_id, d.name AS datasource_name,
      u.email AS creator_email, u.display_name AS creator_name,
      (SELECT COUNT(*) FROM reports r WHERE r.model_id = m.id AND r.draft = 0) AS report_count
    FROM models m
    LEFT JOIN datasources d ON d.id = m.datasource_id
    LEFT JOIN users u ON u.id = m.user_id
    ORDER BY m.name COLLATE NOCASE
  `).all().map((m) => ({
    id: m.id, name: m.name, datasourceName: m.datasource_name, createdAt: m.created_at, updatedAt: m.updated_at,
    reportCount: m.report_count, creator: creator(m), workspace: ws(m.workspace_id), sharedIn: modelShares.get(m.id) || [],
  }));

  const reports = db.prepare(`
    SELECT r.id, r.title, r.created_at, r.updated_at, r.user_id, r.workspace_id, r.is_public, m.name AS model_name,
      u.email AS creator_email, u.display_name AS creator_name
    FROM reports r
    LEFT JOIN models m ON m.id = r.model_id
    LEFT JOIN users u ON u.id = r.user_id
    WHERE r.draft = 0
    ORDER BY r.title COLLATE NOCASE
  `).all().map((r) => ({
    id: r.id, name: r.title, modelName: r.model_name, createdAt: r.created_at, updatedAt: r.updated_at,
    isPublic: !!r.is_public, creator: creator(r), workspace: ws(r.workspace_id), sharedIn: reportShares.get(r.id) || [],
  }));

  res.json({ datasources, models, reports });
});

router.get('/ai/feedback', requireAdmin, instanceAiOnly, (req, res) => {
  res.json(aiFeedback.summary({ days: req.query.days, orgId: req.organizationId || null }));
});

// List all users
router.get('/users', requireAdmin, (req, res) => {
  // `ai_denied` rides along as a boolean; `ai_config` (a user's own provider,
  // key included) is theirs alone and is never selected here.
  const users = db.prepare('SELECT id, email, display_name, role, created_at, ai_denied FROM users ORDER BY created_at ASC').all()
    .map(({ ai_denied: denied, ...user }) => ({ ...user, aiDenied: !!denied }));
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
  // The role travels in the session, so an open session keeps the OLD one —
  // a demotion would only bite at the next login. End their sessions instead.
  const evicted = destroySessionsForUser(req.params.id);
  res.json({ message: 'Role updated', sessionsEnded: evicted });
});

// Create user (admin only)
router.post('/users', requireAdmin, async (req, res) => {
  const { password, displayName, role } = req.body;
  // One canonical form, and no case-variant twin of an existing account —
  // RLS and workspace shares match emails case-insensitively.
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const passwordError = validatePassword(password);
  if (passwordError) return res.status(400).json({ error: passwordError });

  const existing = db.prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE').get(email);
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
  // The user's sources go with them (ON DELETE CASCADE), and so must the files
  // their imported ones are made of.
  const files = db.prepare("SELECT db_name FROM datasources WHERE user_id = ? AND db_type = 'duckdb'")
    .all(req.params.id).map((r) => r.db_name);
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  destroySessionsForUser(req.params.id);
  for (const f of files) {
    retireDuckDBFile(f).catch((e) => console.warn('[admin] file of deleted user kept:', e.message));
  }
  res.json({ message: 'User deleted' });
});

// Reset user password
router.put('/users/:id/password', requireAdmin, (req, res) => {
  const { password } = req.body;
  const passwordError = validatePassword(password);
  if (passwordError) return res.status(400).json({ error: passwordError });
  const hash = bcrypt.hashSync(password, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.params.id);
  // The usual reason to reset someone's password is that their account is
  // compromised. A live cookie outlives the password by up to seven days, so
  // the reset has to take the attacker's sessions with it.
  const evicted = destroySessionsForUser(req.params.id);
  res.json({ message: 'Password reset', sessionsEnded: evicted });
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
    supportEmail: getSupportEmail(),
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
    apiEnabled: isApiEnabled(),
    apiMinRole: getApiMinRole(),
    ai: aiPerOrganization() ? null : publicAiConfig(),
    aiPerOrganization: aiPerOrganization(),
  });
});

// The AI provider the assistant talks to. The key goes in and never comes back
// out: reads carry `hasApiKey` only, and an empty key on save keeps the stored one.
router.put('/settings/ai', requireAdmin, instanceAiOnly, (req, res) => {
  try {
    res.json({ ai: setAiConfig(req.body) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Who does NOT get the assistant. Everyone who can edit a report has it by
// default; an admin takes it away account by account, and that holds whatever
// provider the account would bring itself (utils/ai/access.js).
router.put('/users/:id/ai-access', requireAdmin, instanceAiOnly, (req, res) => {
  if (typeof req.body.denied !== 'boolean') return res.status(400).json({ error: '`denied` must be true or false' });
  if (!aiAccess.setDenied(req.params.id, req.body.denied)) return res.status(404).json({ error: 'User not found' });
  res.json({ id: req.params.id, aiDenied: req.body.denied });
});

// Tries the SAVED config (utils/ai/providerTest.js).
router.post('/settings/ai/test', requireAdmin, instanceAiOnly, async (req, res) => {
  res.json(await testProvider(getAiConfig()));
});

// Every API token on the instance. The admin who decides whether the API is
// open needs to be able to answer "by whom, and is any of this still in use" —
// and to cut one integration without taking the whole API down.
router.get('/api-tokens', requireAdmin, (req, res) => {
  res.json({ tokens: apiToken.listAll() });
});

router.delete('/api-tokens/:id', requireAdmin, (req, res) => {
  if (!apiToken.revokeAny(req.params.id)) {
    return res.status(404).json({ error: 'Token not found or already revoked' });
  }
  res.json({ ok: true });
});

// The public API: off until an admin turns it on, then limited to a role
// floor. Both land in one handler because the panel presents them as one
// decision — "is the API open, and to whom".
router.put('/settings/api', requireAdmin, (req, res) => {
  try {
    if (req.body?.enabled != null) setApiEnabled(!!req.body.enabled);
    if (req.body?.minRole != null) setApiMinRole(String(req.body.minRole));
    res.json({ apiEnabled: isApiEnabled(), apiMinRole: getApiMinRole() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
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

// Où partent les signalements de bug de cette installation. Vide = le bouton
// dit à l'utilisateur qu'aucune adresse n'est configurée, plutôt que d'ouvrir
// un mailto sans destinataire.
router.put('/settings/support-email', requireAdmin, (req, res) => {
  try {
    res.json({ supportEmail: setSupportEmail(req.body?.supportEmail) });
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
