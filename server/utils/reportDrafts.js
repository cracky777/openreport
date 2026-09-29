const db = require('../db');

// A report is created the moment the "New report" dialog is confirmed, before
// the editor opens — so a report nobody ever saved used to sit in the list as
// an empty card. It is born a draft instead (`reports.draft = 1`): the editor
// opens it like any other, no list shows it, and its first save makes it a
// report. Leaving the editor without saving deletes it (DELETE /:id/draft);
// what that cannot catch — a closed tab, a crash — is purged here after a day.

const STALE_AFTER = '-1 day';

function purgeStaleDrafts() {
  db.prepare(`DELETE FROM reports WHERE draft = 1 AND created_at < datetime('now', '${STALE_AFTER}')`).run();
}

// For lists built by a cloud hook, whose query this file does not own.
function withoutDrafts(rows) {
  const drafts = new Set(db.prepare('SELECT id FROM reports WHERE draft = 1').all().map((r) => r.id));
  return drafts.size ? rows.filter((r) => !drafts.has(r.id)) : rows;
}

module.exports = { purgeStaleDrafts, withoutDrafts };
