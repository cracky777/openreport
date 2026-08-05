const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { requireAuth, authFor } = require('../middleware/auth');
const db = require('../db');
const { createConnection, invalidateDatasource } = require('../utils/dbConnector');
const queryCache = require('../utils/queryCache');
const rollupBuilder = require('../utils/rollupBuilder');
const { encrypt } = require('../utils/secretCrypto');
const cloudHooks = require('../cloudHooks');

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
    'SELECT id, name, db_type, host, port, db_name, created_at FROM datasources WHERE user_id = ? ORDER BY name'
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

// List datasources (write-gated: an org-viewer can't enumerate connections).
router.get('/', authFor('write'), (req, res) => {
  res.json({ datasources: listDatasources(req) });
});

// Get single datasource — project the safe columns (never secrets).
router.get('/:id', authFor('write'), (req, res) => {
  const s = getDatasource(req.params.id, req);
  if (!s) {
    return res.status(404).json({ error: 'Datasource not found' });
  }
  res.json({ datasource: { id: s.id, name: s.name, db_type: s.db_type, host: s.host, port: s.port, db_name: s.db_name, db_user: s.db_user, created_at: s.created_at } });
});

// Test connection (without saving)
router.post('/test', requireAuth, async (req, res) => {
  const { dbType, host, port, dbName, dbUser, dbPassword, extraConfig } = req.body;

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

  const id = uuidv4();

  db.prepare(`
    INSERT INTO datasources (id, user_id, name, db_type, host, port, db_name, db_user, db_password, extra_config)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.user.id, name, dbType, host || '', port || 5432, dbName, dbUser || '', encrypt(dbPassword || ''), JSON.stringify(encryptExtraConfig(extraConfig)));
  stampNewDatasource(req, id);

  res.status(201).json({
    datasource: { id, name, db_type: dbType, host: host || '', port: port || 5432, db_name: dbName },
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
  const newDbName = dbName !== undefined ? dbName : existing.db_name;
  if (!name || !newDbType || (needsHost && !newHost) || !newDbName) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

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
