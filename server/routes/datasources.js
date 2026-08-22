const express = require('express');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { authFor } = require('../middleware/auth');
const db = require('../db');
const { createConnection, invalidateDatasource } = require('../utils/dbConnector');
const queryCache = require('../utils/queryCache');
const rollupBuilder = require('../utils/rollupBuilder');
const { encrypt } = require('../utils/secretCrypto');
const cloudHooks = require('../cloudHooks');
const { rejectIfNameTaken } = require('../utils/nameUniqueness');

const router = express.Router();

// Access scoping (cloud org-scopes these; OSS scopes by owner). getDatasource
// returns the FULL row (secrets included) for the connection paths — callers
// that return it to the client must project the safe columns.
function getDatasource(id, req) {
  if (typeof cloudHooks.getDatasource === 'function') return cloudHooks.getDatasource(id, req);
  return db.prepare('SELECT * FROM datasources WHERE id = ? AND user_id = ?').get(id, req.user.id);
}
function listDatasources(req) {
  if (typeof cloudHooks.listDatasources === 'function') return cloudHooks.listDatasources(req);
  return db.prepare(
    'SELECT id, name, db_type, host, port, db_name, created_at, extra_config FROM datasources WHERE user_id = ? ORDER BY name'
  ).all(req.user.id);
}
function stampNewDatasource(req, id) {
  if (typeof cloudHooks.onDatasourceCreate === 'function') cloudHooks.onDatasourceCreate(req, id);
}
function countModelsUsingDatasource(req, id) {
  if (typeof cloudHooks.countModelsUsingDatasource === 'function') return cloudHooks.countModelsUsingDatasource(req, id);
  return db.prepare('SELECT COUNT(*) as count FROM models WHERE datasource_id = ? AND user_id = ?').get(id, req.user.id).count;
}

// Encrypt the sensitive field(s) inside a datasource's extra_config (currently
// the BigQuery service-account key) without touching the non-secret keys, so
// the blob stays readable for display fields (dataset, fileSize, …).
function encryptExtraConfig(extraConfig) {
  const cfg = { ...(extraConfig || {}) };
  if (cfg.credentials) cfg.credentials = encrypt(cfg.credentials);
  return cfg;
}

// What the client is allowed to read off extra_config. A whitelist, not a
// blacklist: the same blob carries the BigQuery service-account key, and a
// field added later must be withheld until someone decides it is safe.
const PUBLIC_EXTRA_KEYS = ['sourceFile', 'tableName', 'tables', 'rowCount', 'fileSize', 'importedAt'];
function publicExtraConfig(raw) {
  let cfg = raw;
  if (typeof cfg === 'string') {
    try { cfg = JSON.parse(cfg); } catch { return {}; /* malformed row — no display fields, not a 500 */ }
  }
  if (!cfg || typeof cfg !== 'object') return {};
  const out = {};
  for (const key of PUBLIC_EXTRA_KEYS) if (cfg[key] !== undefined) out[key] = cfg[key];
  return out;
}

// List datasources (write-gated: an org-viewer can't enumerate connections).
// extra_config comes back sanitised: an imported file is a file whatever engine
// ends up reading it, and `sourceFile` is the only thing that still says so
// once db_type has become 'duckdb'.
router.get('/', authFor('write'), (req, res) => {
  const datasources = listDatasources(req).map((ds) => ({
    ...ds,
    extra_config: publicExtraConfig(ds.extra_config),
  }));
  res.json({ datasources });
});

// Get single datasource — project the safe columns (never secrets).
router.get('/:id', authFor('write'), (req, res) => {
  const s = getDatasource(req.params.id, req);
  if (!s) {
    return res.status(404).json({ error: 'Datasource not found' });
  }
  res.json({ datasource: { id: s.id, name: s.name, db_type: s.db_type, host: s.host, port: s.port, db_name: s.db_name, db_user: s.db_user, created_at: s.created_at } });
});

// Hosts a datasource may never point at. Left unchecked, connecting is a
// network probe: any logged-in account could walk the internal range and read
// the cloud metadata service (169.254.169.254), using the returned error text
// as the oracle. Enforced on EVERY path that persists or opens a connection —
// not just /test, which an attacker simply skips by saving the row and then
// hitting /:id/tables or /query.
const BLOCKED_HOSTS = /^(localhost|127\.|0\.0\.0\.0|::1|169\.254\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i;

// Literal-host block-list. Returns true when `host` is an obvious loopback /
// link-local / RFC-1918 target, in any of the encodings a regex on the dotted
// form would miss: bracketed IPv6, IPv4-mapped IPv6 (::ffff:a.b.c.d), and the
// integer/hex forms of an IPv4 address (2130706433, 0x7f000001) that resolve to
// 127.0.0.1. A legitimate database host is a name or a dotted quad, never a bare
// integer, so rejecting those outright costs nothing.
//
// This cannot catch a HOSTNAME that resolves to an internal address (DNS
// rebinding): the literal passes, and only the connect-time resolution would
// reveal it. Closing that fully needs a resolve-and-check in the connector;
// tracked as a follow-up. This guard still shuts the trivial direct-IP probe.
function hostIsBlocked(rawHost) {
  // Policy gate. The block-list defends a MULTI-TENANT host: an untrusted org
  // member probing the internal range to reach the cloud metadata service. That
  // is a cloud concern, so it's always on there. A self-hosted OSS instance is
  // single-operator by default, and pointing a datasource at a localhost /
  // private-LAN database is the normal setup — blocking it there breaks the
  // primary use case. So OSS is OFF unless a multi-user instance opts in via
  // OPENREPORT_BLOCK_INTERNAL_HOSTS=1. Read at call time so a deploy can flip it
  // without a rebuild. Kept inside the predicate so no call site can forget it.
  const enforced = process.env.OPENREPORT_CLOUD === '1'
    || process.env.OPENREPORT_BLOCK_INTERNAL_HOSTS === '1';
  if (!enforced) return false;
  if (!rawHost) return false;
  let h = String(rawHost).trim().toLowerCase();
  // Strip an IPv6 bracket wrapper and any :port a caller may have appended.
  if (h.startsWith('[')) h = h.slice(1, h.indexOf(']') === -1 ? undefined : h.indexOf(']'));
  if (BLOCKED_HOSTS.test(h)) return true;
  // IPv4-mapped / -compatible IPv6: pull out the trailing dotted quad and retest.
  const mapped = h.match(/^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped && BLOCKED_HOSTS.test(mapped[1])) return true;
  // A bare integer or 0x-hex host is an alternate IPv4 encoding — decode and test.
  const asInt = /^0x[0-9a-f]+$/.test(h) ? parseInt(h, 16)
    : /^\d+$/.test(h) ? parseInt(h, 10) : NaN;
  if (Number.isInteger(asInt) && asInt >= 0 && asInt <= 0xffffffff) {
    const dotted = [(asInt >>> 24) & 255, (asInt >>> 16) & 255, (asInt >>> 8) & 255, asInt & 255].join('.');
    if (BLOCKED_HOSTS.test(dotted)) return true;
  }
  return false;
}

// Test connection (without saving). Write-gated: a read-only account has no
// reason to open outbound connections from the server.
router.post('/test', authFor('write'), async (req, res) => {
  const { dbType, host, port, dbName, dbUser, dbPassword, extraConfig } = req.body;

  if (hostIsBlocked(host)) {
    return res.status(400).json({ success: false, message: 'This host is not reachable from the server.' });
  }

  let conn;
  try {
    conn = createConnection({
      db_type: dbType,
      host: host || '',
      port,
      db_name: dbName,
      db_user: dbUser || '',
      db_password: dbPassword || '',
      extra_config: extraConfig || {},
    });
    await conn.testConnection();
    res.json({ success: true, message: 'Connection successful' });
  } catch (err) {
    res.json({ success: false, message: err.message });
  } finally {
    conn?.close();
  }
});

// Create datasource
router.post('/', authFor('write'), (req, res) => {
  const { name, dbType, host, port, dbName, dbUser, dbPassword, extraConfig } = req.body;

  // BigQuery and DuckDB don't need host/user
  const needsHost = !['bigquery', 'duckdb'].includes(dbType);
  if (!name || !dbType || (needsHost && !host) || !dbName) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  // Same guard as /test — enforced HERE too, or the row is saved with an
  // internal host and reached through /:id/tables, /:id/query, etc.
  if (needsHost && hostIsBlocked(host)) {
    return res.status(400).json({ error: 'This host is not reachable from the server.' });
  }
  if (rejectIfNameTaken('datasource', name, req, res)) return;

  const id = uuidv4();

  // A DuckDB db_name is a path on the server, so the caller does not get to pick
  // it: pointing at someone else's cube would read their tables, and any other
  // path would have the process create a file wherever it can write. The row
  // gets a path derived from its own id, inside the managed directory.
  // ':memory:' stays available — it names no file.
  const storedDbName = dbType === 'duckdb' && dbName !== ':memory:'
    ? path.join(__dirname, '..', 'data', 'duckdb', `${id}.duckdb`)
    : dbName;

  db.prepare(`
    INSERT INTO datasources (id, user_id, name, db_type, host, port, db_name, db_user, db_password, extra_config)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.user.id, name, dbType, host || '', port || 5432, storedDbName, dbUser || '', encrypt(dbPassword || ''), JSON.stringify(encryptExtraConfig(extraConfig)));
  stampNewDatasource(req, id);

  res.status(201).json({
    datasource: { id, name, db_type: dbType, host: host || '', port: port || 5432, db_name: storedDbName },
  });
});

// Update datasource (edit existing connection)
router.put('/:id', authFor('write'), (req, res) => {
  const existing = getDatasource(req.params.id, req);
  if (!existing) {
    return res.status(404).json({ error: 'Datasource not found' });
  }

  const { name, dbType, host, port, dbName, dbUser, dbPassword, extraConfig } = req.body;
  const newDbType = dbType || existing.db_type;
  const needsHost = !['bigquery', 'duckdb'].includes(newDbType);
  const newHost = host !== undefined ? host : existing.host;
  // Same reason as on create: for DuckDB the name IS a server path, so it stays
  // whatever the import pipeline set. Everything else on the row is editable.
  const isDuck = newDbType === 'duckdb' || existing.db_type === 'duckdb';
  const newDbName = (!isDuck && dbName !== undefined) ? dbName : existing.db_name;
  if (!name || !newDbType || (needsHost && !newHost) || !newDbName) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  // A host change must clear the same bar as a fresh create — otherwise the
  // guard is a create-time-only formality that an edit walks straight past.
  if (needsHost && hostIsBlocked(newHost)) {
    return res.status(400).json({ error: 'This host is not reachable from the server.' });
  }
  if (rejectIfNameTaken('datasource', name, req, res, req.params.id)) return;

  // Empty password means "keep existing" (already encrypted) — non-empty replaces
  // it (encrypt the new one).
  const finalPassword = dbPassword ? encrypt(dbPassword) : existing.db_password;

  db.prepare(`
    UPDATE datasources
    SET name = ?, db_type = ?, host = ?, port = ?, db_name = ?, db_user = ?, db_password = ?, extra_config = ?
    WHERE id = ?
  `).run(
    name,
    newDbType,
    newHost || '',
    port != null ? port : existing.port,
    newDbName,
    dbUser !== undefined ? dbUser : existing.db_user,
    finalPassword,
    extraConfig !== undefined ? JSON.stringify(encryptExtraConfig(extraConfig)) : existing.extra_config,
    req.params.id,
  );

  // Connection params (host / db / credentials / type) may have changed
  // — every cached row + materialised rollup tied to this datasource is
  // now potentially wrong. queryCache invalidation is synchronous; the
  // rollup drop is fire-and-forget (the planner falls through to a live
  // fact query if it races a half-dropped rollup).
  invalidateDatasource(req.params.id); // drop the cached pool so the new params take effect
  queryCache.invalidateDatasource(req.params.id);
  rollupBuilder.dropAllRollupsForDatasource({ datasourceId: req.params.id, orgId: req.organizationId || null })
    .catch((err) => console.warn('[rollup] invalidate on datasource update failed:', err.message));

  const updated = db.prepare(
    'SELECT id, name, db_type, host, port, db_name, db_user, created_at FROM datasources WHERE id = ?'
  ).get(req.params.id);
  res.json({ datasource: updated });
});

// List tables for a datasource
router.get('/:id/tables', authFor('write'), async (req, res) => {
  const source = getDatasource(req.params.id, req);

  if (!source) {
    return res.status(404).json({ error: 'Datasource not found' });
  }

  let conn;
  try {
    conn = createConnection(source);
    const tables = await conn.getTables();
    res.json({ tables });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    conn?.close();
  }
});

// List columns for a table
router.get('/:id/tables/:table/columns', authFor('write'), async (req, res) => {
  const source = getDatasource(req.params.id, req);

  if (!source) {
    return res.status(404).json({ error: 'Datasource not found' });
  }

  let conn;
  try {
    conn = createConnection(source);
    const columns = await conn.getColumns(req.params.table);
    res.json({ columns });
  } catch (err) {
    // Log the full stack so we can diagnose 500s on /columns (e.g. wide DuckDB tables).
    console.error('[GET /datasources/:id/tables/:table/columns] failed for', {
      datasource: req.params.id, table: req.params.table, db_type: source.db_type,
    }, err);
    res.status(500).json({ error: err.message || String(err) });
  } finally {
    conn?.close();
  }
});

// Execute query on a datasource
router.post('/:id/query', authFor('write'), async (req, res) => {
  const source = getDatasource(req.params.id, req);

  if (!source) {
    return res.status(404).json({ error: 'Datasource not found' });
  }

  const { sql } = req.body;
  if (!sql) {
    return res.status(400).json({ error: 'SQL query is required' });
  }

  // Basic safety: a single SELECT only. Strip one optional trailing semicolon,
  // then reject any remaining ';' — otherwise "SELECT 1; DROP TABLE x" would
  // pass the SELECT-prefix check and run as two statements on multi-statement
  // drivers.
  const safeSql = sql.trim().replace(/;\s*$/, '');
  if (!/^\s*SELECT\b/i.test(safeSql)) {
    return res.status(400).json({ error: 'Only SELECT queries are allowed' });
  }
  if (safeSql.includes(';')) {
    return res.status(400).json({ error: 'Only a single statement is allowed' });
  }

  let conn;
  try {
    conn = createConnection(source);
    const rows = await conn.query(safeSql);
    res.json({ rows, rowCount: rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    conn?.close();
  }
});

// Delete datasource
router.delete('/:id', authFor('write'), (req, res) => {
  // Load first so a cross-org / cross-owner delete is a clean 404, not a no-op.
  const source = getDatasource(req.params.id, req);
  if (!source) return res.status(404).json({ error: 'Datasource not found' });

  const count = countModelsUsingDatasource(req, req.params.id);
  if (count > 0) {
    return res.status(409).json({ error: `This datasource is used by ${count} model(s). Delete them first.` });
  }

  db.prepare('DELETE FROM datasources WHERE id = ?').run(req.params.id);
  invalidateDatasource(req.params.id); // tear down the cached pool for the removed datasource
  res.json({ message: 'Datasource deleted' });
});

module.exports = router;
// Shared with routes/alerts.js: outbound webhook URLs face the same
// internal-range probing risk as datasource hosts, under the same policy
// gate (cloud always, OSS via OPENREPORT_BLOCK_INTERNAL_HOSTS=1).
module.exports.hostIsBlocked = hostIsBlocked;
