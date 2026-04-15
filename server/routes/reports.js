const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { requireAuth } = require('../middleware/auth');
const db = require('../db');

const router = express.Router();

// List reports for current user
router.get('/', requireAuth, (req, res) => {
  const reports = db.prepare(`
    SELECT r.id, r.title, r.model_id, r.is_public, r.created_at, r.updated_at, m.name as model_name
    FROM reports r
    LEFT JOIN models m ON m.id = r.model_id
    WHERE r.user_id = ?
    ORDER BY r.updated_at DESC
  `).all(req.user.id);
  res.json({ reports });
});

// Get single report (public or owned)
router.get('/:id', (req, res) => {
  const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id);

  if (!report) {
    return res.status(404).json({ error: 'Report not found' });
  }

  if (!report.is_public && (!req.user || req.user.id !== report.user_id)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  res.json({
    report: {
      ...report,
      layout: JSON.parse(report.layout),
      widgets: JSON.parse(report.widgets),
      settings: JSON.parse(report.settings),
    },
  });
});

// Create report
router.post('/', requireAuth, (req, res) => {
  const id = uuidv4();
  const { title, modelId } = req.body;

  if (!modelId) {
    return res.status(400).json({ error: 'A data model is required' });
  }

  db.prepare('INSERT INTO reports (id, user_id, model_id, title) VALUES (?, ?, ?, ?)').run(
    id, req.user.id, modelId, title || 'Untitled Report'
  );

  const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(id);
  res.status(201).json({
    report: {
      ...report,
      layout: JSON.parse(report.layout),
      widgets: JSON.parse(report.widgets),
      settings: JSON.parse(report.settings),
    },
  });
});

// Update report
router.put('/:id', requireAuth, (req, res) => {
  const report = db.prepare('SELECT * FROM reports WHERE id = ? AND user_id = ?').get(
    req.params.id, req.user.id
  );

  if (!report) {
    return res.status(404).json({ error: 'Report not found' });
  }

  const { title, layout, widgets, settings, is_public } = req.body;

  db.prepare(`
    UPDATE reports SET
      title = COALESCE(?, title),
      layout = COALESCE(?, layout),
      widgets = COALESCE(?, widgets),
      settings = COALESCE(?, settings),
      is_public = COALESCE(?, is_public),
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    title || null,
    layout ? JSON.stringify(layout) : null,
    widgets ? JSON.stringify(widgets) : null,
    settings ? JSON.stringify(settings) : null,
    is_public !== undefined ? (is_public ? 1 : 0) : null,
    req.params.id
  );

  const updated = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id);
  res.json({
    report: {
      ...updated,
      layout: JSON.parse(updated.layout),
      widgets: JSON.parse(updated.widgets),
      settings: JSON.parse(updated.settings),
    },
  });
});

// Delete report
router.delete('/:id', requireAuth, (req, res) => {
  const result = db.prepare('DELETE FROM reports WHERE id = ? AND user_id = ?').run(
    req.params.id, req.user.id
  );

  if (result.changes === 0) {
    return res.status(404).json({ error: 'Report not found' });
  }

  res.json({ message: 'Report deleted' });
});

module.exports = router;
