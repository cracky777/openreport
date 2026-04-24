const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { requireAuth } = require('../middleware/auth');
const db = require('../db');
const { createConnection } = require('../utils/dbConnector');

const router = express.Router();

// List datasources for current user
router.get('/', requireAuth, (req, res) => {
  const sources = db.prepare(
    'SELECT id, name, db_type, host, port, db_name, created_at FROM datasources WHERE user_id = ? ORDER BY name'
  ).all(req.user.id);
  res.json({ datasources: sources });
});

// Get single datasource
router.get('/:id', requireAuth, (req, res) => {
  const source = db.prepare(
    'SELECT id, name, db_type, host, port, db_name, db_user, created_at FROM datasources WHERE id = ? AND user_id = ?'
  ).get(req.params.id, req.user.id);

  if (!source) {
    return res.status(404).json({ error: 'Datasource not found' });
  }
  res.json({ datasource: source });
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
router.post('/', requireAuth, (req, res) => {
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
  `).run(id, req.user.id, name, dbType, host || '', port || 5432, dbName, dbUser || '', dbPassword || '', JSON.stringify(extraConfig || {}));

  res.status(201).json({
    datasource: { id, name, db_type: dbType, host: host || '', port: port || 5432, db_name: dbName },
  });
});

// Update datasource (edit existing connection)
router.put('/:id', requireAuth, (req, res) => {
  const existing = db.prepare(
    'SELECT * FROM datasources WHERE id = ? AND user_id = ?'
  ).get(req.params.id, req.user.id);
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

  // Empty password means "keep existing" — non-empty replaces it
  const finalPassword = (dbPassword && dbPassword !== '') ? dbPassword : existing.db_password;

  db.prepare(`
    UPDATE datasources
    SET name = ?, db_type = ?, host = ?, port = ?, db_name = ?, db_user = ?, db_password = ?, extra_config = ?
    WHERE id = ? AND user_id = ?
  `).run(
    name,
    newDbType,
    newHost || '',
    port != null ? port : existing.port,
    newDbName,
    dbUser !== undefined ? dbUser : existing.db_user,
    finalPassword,
    extraConfig !== undefined ? JSON.stringify(extraConfig) : existing.extra_config,
    req.params.id,
    req.user.id,
  );

  const updated = db.prepare(
    'SELECT id, name, db_type, host, port, db_name, db_user, created_at FROM datasources WHERE id = ? AND user_id = ?'
  ).get(req.params.id, req.user.id);
  res.json({ datasource: updated });
});

// List tables for a datasource
router.get('/:id/tables', requireAuth, async (req, res) => {
  const source = db.prepare(
    'SELECT * FROM datasources WHERE id = ? AND user_id = ?'
  ).get(req.params.id, req.user.id);

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
router.get('/:id/tables/:table/columns', requireAuth, async (req, res) => {
  const source = db.prepare(
    'SELECT * FROM datasources WHERE id = ? AND user_id = ?'
  ).get(req.params.id, req.user.id);

  if (!source) {
    return res.status(404).json({ error: 'Datasource not found' });
  }

  let conn;
  try {
    conn = createConnection(source);
    const columns = await conn.getColumns(req.params.table);
    res.json({ columns });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    conn?.close();
  }
});

// Execute query on a datasource
router.post('/:id/query', requireAuth, async (req, res) => {
  const source = db.prepare(
    'SELECT * FROM datasources WHERE id = ? AND user_id = ?'
  ).get(req.params.id, req.user.id);

  if (!source) {
    return res.status(404).json({ error: 'Datasource not found' });
  }

  const { sql } = req.body;
  if (!sql) {
    return res.status(400).json({ error: 'SQL query is required' });
  }

  // Basic safety: only allow SELECT
  if (!/^\s*SELECT\b/i.test(sql)) {
    return res.status(400).json({ error: 'Only SELECT queries are allowed' });
  }

  let conn;
  try {
    conn = createConnection(source);
    const rows = await conn.query(sql);
    res.json({ rows, rowCount: rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    conn?.close();
  }
});

// Delete datasource
router.delete('/:id', requireAuth, (req, res) => {
  // Check if any models use this datasource
  const modelCount = db.prepare('SELECT COUNT(*) as count FROM models WHERE datasource_id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (modelCount && modelCount.count > 0) {
    return res.status(409).json({ error: `This datasource is used by ${modelCount.count} model(s). Delete them first.` });
  }

  const result = db.prepare('DELETE FROM datasources WHERE id = ? AND user_id = ?').run(
    req.params.id, req.user.id
  );

  if (result.changes === 0) {
    return res.status(404).json({ error: 'Datasource not found' });
  }

  res.json({ message: 'Datasource deleted' });
});

module.exports = router;
