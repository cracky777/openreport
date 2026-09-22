// 👍 / 👎 on an answer of the assistant, for the admin to see whether the
// provider they configured is any good on their models.
//
// What is kept is the QUESTION and the SHAPE of what was proposed. Never the
// answer's text and never a row of data: an answer can quote figures read from
// the cache, and this table outlives the 30 days of `usage_events`.

const { v4: uuidv4 } = require('uuid');
const db = require('../../db');

const MAX_QUESTION = 500;
const MAX_VISUALS = 6;
const SURFACES = new Set(['ask', 'editor']);
const FIELD_KEYS = ['selectedDimensions', 'groupBy', 'columnDimensions', 'selectedMeasures'];

// Field names are looked up in the model, like everywhere the assistant is
// involved: what is not a field of this model is not stored.
function shapeOf(visuals, effective) {
  const known = new Set([...effective.dimensions, ...effective.measures].map((f) => f.name));
  return (Array.isArray(visuals) ? visuals : []).slice(0, MAX_VISUALS).map((v) => {
    const binding = (v && v.dataBinding) || {};
    const fields = FIELD_KEYS.flatMap((k) => (Array.isArray(binding[k]) ? binding[k] : [])).filter((n) => known.has(n));
    return {
      type: String((v && v.type) || '').slice(0, 40),
      subType: String((v && v.config && v.config.subType) || '').slice(0, 40) || null,
      title: String((v && v.config && v.config.title) || '').slice(0, 200),
      fields: [...new Set(fields)],
    };
  });
}

/**
 * One rating per user and answer; rating again changes it.
 * @returns {{ok: true} | {error: string}}
 */
function record({ user, orgId, modelId, effective, access, body }) {
  const b = body && typeof body === 'object' ? body : {};
  const rating = b.rating === 'up' ? 1 : b.rating === 'down' ? -1 : 0;
  const answerId = typeof b.answerId === 'string' ? b.answerId.slice(0, 64) : '';
  if (!rating || !answerId) return { error: 'answerId and a rating of "up" or "down" are required' };

  db.prepare(`
    INSERT INTO ai_feedback (id, answer_id, user_id, organization_id, model_id, surface, rating, question, visuals, provider_model, provider_source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, answer_id) DO UPDATE SET rating = excluded.rating
  `).run(
    uuidv4(), answerId, user.id, orgId || null, modelId,
    SURFACES.has(b.surface) ? b.surface : 'ask',
    rating,
    String(b.question || '').slice(0, MAX_QUESTION),
    JSON.stringify(shapeOf(b.visuals, effective)),
    String((access.config && access.config.model) || '').slice(0, 120),
    access.source || null,
  );
  return { ok: true };
}

function summary({ days, orgId }) {
  const window = Math.min(Math.max(parseInt(days, 10) || 30, 1), 365);
  const scope = orgId ? 'AND f.organization_id = ?' : '';
  const args = [`-${window} days`, ...(orgId ? [orgId] : [])];
  const where = `WHERE f.created_at >= datetime('now', ?) ${scope}`;
  const totals = db.prepare(`SELECT COALESCE(SUM(rating = 1), 0) AS up, COALESCE(SUM(rating = -1), 0) AS down FROM ai_feedback f ${where}`).get(...args);
  const byModel = db.prepare(`
    SELECT f.model_id AS modelId, m.name AS modelName, SUM(f.rating = 1) AS up, SUM(f.rating = -1) AS down
    FROM ai_feedback f LEFT JOIN models m ON m.id = f.model_id ${where}
    GROUP BY f.model_id ORDER BY down DESC, up DESC
  `).all(...args);
  const recent = db.prepare(`
    SELECT f.rating, f.question, f.visuals, f.surface, f.provider_model AS providerModel, f.provider_source AS providerSource,
      f.created_at AS createdAt, m.name AS modelName, u.email AS userEmail
    FROM ai_feedback f LEFT JOIN models m ON m.id = f.model_id LEFT JOIN users u ON u.id = f.user_id ${where}
    ORDER BY f.created_at DESC LIMIT 50
  `).all(...args).map((r) => ({ ...r, rating: r.rating === 1 ? 'up' : 'down', visuals: JSON.parse(r.visuals || '[]') }));
  return { days: window, totals, byModel, recent };
}

module.exports = { record, summary };
