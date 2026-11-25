// "Forgot password" tokens. Only a SHA-256 of the token is stored: a leaked
// database copy must not hand out working reset links.

const crypto = require('crypto');
const db = require('../db');

const TTL_MINUTES = 60;
// One mail per account per minute: the endpoint is open to anyone who knows an
// address, and must not become a way to flood someone's inbox.
const RESEND_SECONDS = 60;

const hashOf = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

// Returns the raw token to mail, or null when one was issued too recently.
function issue(userId) {
  const recent = db.prepare(
    `SELECT 1 FROM password_resets WHERE user_id = ? AND used_at IS NULL
       AND created_at > datetime('now', ?)`,
  ).get(userId, `-${RESEND_SECONDS} seconds`);
  if (recent) return null;
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare(
    `INSERT INTO password_resets (token_hash, user_id, expires_at)
     VALUES (?, ?, datetime('now', ?))`,
  ).run(hashOf(token), userId, `+${TTL_MINUTES} minutes`);
  return token;
}

// Spends the token and every other one of its account (an older mail must not
// stay usable after the password changed). Returns the user id, or null.
function consume(token) {
  if (typeof token !== 'string' || !token) return null;
  const row = db.prepare(
    `SELECT user_id FROM password_resets WHERE token_hash = ? AND used_at IS NULL
       AND expires_at > datetime('now')`,
  ).get(hashOf(token));
  if (!row) return null;
  db.prepare(`UPDATE password_resets SET used_at = datetime('now') WHERE user_id = ? AND used_at IS NULL`).run(row.user_id);
  return row.user_id;
}

module.exports = { issue, consume, TTL_MINUTES };
