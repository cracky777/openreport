/**
 * Viewer bookmarks — personal named captures of a report view (active
 * page + slicer/filter selections).
 *
 * Personal by design: listing returns only the CALLER's bookmarks and
 * deletion is owner-only — a bookmark is a reading angle, not shared
 * report content. Requires an authenticated session (anonymous public
 * viewers get a 401 and the client simply hides the feature) plus read
 * access to the report.
 */
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { requireAuth } = require('../middleware/auth');
const db = require('../db');
const { canAccessReport } = require('./reports');

const router = express.Router();
router.use(requireAuth);

const MAX_STATE_BYTES = 32 * 1024; // filters + selections, never widget data
const MAX_PER_REPORT = 50;

function loadAccessibleReport(req, res) {
  const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.reportId);
  if (!report || !canAccessReport(report, req.user, req)) {
    res.status(404).json({ error: 'Report not found' });
    return null;
  }
  return report;
}

const isPlainObject = (v) => v != null && typeof v === 'object' && !Array.isArray(v);

// The state is opaque to the server except for its shape: a small mapping
// of page index + filter selections. It is echoed back only to its author,
// but bounding it keeps a hostile client from using bookmarks as storage.
function validateState(state) {
  if (!isPlainObject(state)) return 'The bookmark "state" must be a mapping';
  if (state.pageIdx !== undefined && !(Number.isInteger(state.pageIdx) && state.pageIdx >= 0)) {
    return '"pageIdx" must be a non-negative integer';
  }
  for (const key of ['reportFilters', 'slicerSelections']) {
    if (state[key] !== undefined && !isPlainObject(state[key])) return `"${key}" must be a mapping`;
  }
  if (Buffer.byteLength(JSON.stringify(state), 'utf8') > MAX_STATE_BYTES) {
    return 'The bookmark state is too large';
  }
  return null;
}

const publicBookmark = (b) => ({ ...b, state: JSON.parse(b.state || '{}') });

router.get('/:reportId/bookmarks', (req, res) => {
  if (!loadAccessibleReport(req, res)) return;
  const rows = db.prepare(
    'SELECT * FROM report_bookmarks WHERE report_id = ? AND user_id = ? ORDER BY rowid'
  ).all(req.params.reportId, req.user.id);
  res.json({ bookmarks: rows.map(publicBookmark) });
});

router.post('/:reportId/bookmarks', (req, res) => {
  const report = loadAccessibleReport(req, res);
  if (!report) return;
  const { name, state } = req.body || {};
  if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: '"name" is required' });
  if (name.length > 80) return res.status(400).json({ error: '"name" is too long (max 80)' });
  const stateErr = validateState(state);
  if (stateErr) return res.status(400).json({ error: stateErr });
  const count = db.prepare(
    'SELECT COUNT(*) AS n FROM report_bookmarks WHERE report_id = ? AND user_id = ?'
  ).get(report.id, req.user.id).n;
  if (count >= MAX_PER_REPORT) {
    return res.status(400).json({ error: `Bookmark limit reached (${MAX_PER_REPORT}) — delete one first` });
  }
  const id = uuidv4();
  db.prepare(`INSERT INTO report_bookmarks (id, report_id, user_id, name, state)
              VALUES (?, ?, ?, ?, ?)`)
    .run(id, report.id, req.user.id, name.trim(), JSON.stringify(state));
  const created = db.prepare('SELECT * FROM report_bookmarks WHERE id = ?').get(id);
  res.status(201).json({ bookmark: publicBookmark(created) });
});

router.delete('/:reportId/bookmarks/:bookmarkId', (req, res) => {
  if (!loadAccessibleReport(req, res)) return;
  const bm = db.prepare('SELECT * FROM report_bookmarks WHERE id = ? AND report_id = ?')
    .get(req.params.bookmarkId, req.params.reportId);
  if (!bm) return res.status(404).json({ error: 'Bookmark not found' });
  if (bm.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  db.prepare('DELETE FROM report_bookmarks WHERE id = ?').run(bm.id);
  res.json({ ok: true });
});

module.exports = router;
