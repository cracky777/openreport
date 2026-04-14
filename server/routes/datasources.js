const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { requireAuth } = require('../middleware/auth');
const db = require('../db');

const router = express.Router();

// List datasources for current user
router.get('/', requireAuth, (req, res) => {
  const sources = db.prepare(
    'SELECT id, name, db_type, host, port, db_name, created_at FROM datasources WHERE user_id = ? ORDER BY name'
  ).all(req.user.id);
  res.json({ datasources: sources });
});

// Create datasource
router.post('/', requireAuth, (req, res) => {
  const { name, dbType, host, port, dbName, dbUser, dbPassword } = req.body;

  if (!name || !dbType || !host || !dbName || !dbUser) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const id = uuidv4();

  db.prepare(`
    INSERT INTO datasources (id, user_id, name, db_type, host, port, db_name, db_user, db_password)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.user.id, name, dbType, host, port || 5432, dbName, dbUser, dbPassword || '');

  res.status(201).json({
    datasource: { id, name, db_type: dbType, host, port: port || 5432, db_name: dbName },
  });
});

// Delete datasource
router.delete('/:id', requireAuth, (req, res) => {
  const result = db.prepare('DELETE FROM datasources WHERE id = ? AND user_id = ?').run(
    req.params.id, req.user.id
  );

  if (result.changes === 0) {
    return res.status(404).json({ error: 'Datasource not found' });
  }

  res.json({ message: 'Datasource deleted' });
});

module.exports = router;
