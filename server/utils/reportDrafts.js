const db = require('../db');

// A report is created the moment the "New report" dialog is confirmed, before
// the editor opens — so a report nobody ever saved used to sit in the list as
// an empty card. It is born a draft instead (`reports.draft = 1`): the editor
// opens it like any other, no list shows it, and its first save makes it a
// report. Leaving the editor without saving deletes it (DELETE /:id/draft);
// what that cannot catch — a closed tab, a crash — is purged here after a day.
// A draft born with its model (files dropped in Chat mode, `owns_model`) takes
// the model with it when nothing else uses it: two such models were left
// behind by drafts abandoned on a reload.

const STALE_AFTER = '-1 day';

function dropDrafts(where, ...params) {
  const drafts = db.prepare(`SELECT id, model_id, owns_model FROM reports WHERE draft = 1 AND ${where}`).all(...params);
  const del = db.prepare('DELETE FROM reports WHERE id = ? AND draft = 1');
  const unused = db.prepare('SELECT 1 FROM reports WHERE model_id = ? LIMIT 1');
  db.transaction(() => {
    for (const d of drafts) del.run(d.id);
    for (const d of drafts) {
      if (d.owns_model && d.model_id && !unused.get(d.model_id)) db.prepare('DELETE FROM models WHERE id = ?').run(d.model_id);
    }
  })();
  return drafts.length;
}

function purgeStaleDrafts() {
  dropDrafts(`created_at < datetime('now', '${STALE_AFTER}')`);
}

// Leaving the editor of a draft: 1 when it was still one.
function dropDraft(id) {
  return dropDrafts('id = ?', id);
}

// For lists built by a cloud hook, whose query this file does not own.
function withoutDrafts(rows) {
  const drafts = new Set(db.prepare('SELECT id FROM reports WHERE draft = 1').all().map((r) => r.id));
  return drafts.size ? rows.filter((r) => !drafts.has(r.id)) : rows;
}

module.exports = { purgeStaleDrafts, dropDraft, withoutDrafts };
