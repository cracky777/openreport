/**
 * Server-side session eviction.
 *
 * A session cookie stays valid for its whole 7-day life, independently of the
 * account behind it. So changing a password, taking a role away or deleting a
 * user does nothing to whoever is already holding a cookie — which is exactly
 * backwards when the reason for the change is that the account is compromised.
 *
 * The session store (better-sqlite3-session-store) keeps one row per session
 * with the serialised session in `sess`; passport puts the user id at
 * `passport.user`. index.js hands us its open handle at boot so we act on the
 * same file the store is using, rather than opening a second connection to it.
 */

let sessionsDb = null;

// Called once from index.js with the store's own database handle.
function useDatabase(db) {
  sessionsDb = db;
}

/**
 * Drop every stored session belonging to `userId`. Returns the number of
 * sessions removed. Best-effort: an eviction failure must never take down the
 * password change that triggered it (the caller has already succeeded).
 */
function destroySessionsForUser(userId) {
  if (!sessionsDb || !userId) return 0;
  try {
    const rows = sessionsDb.prepare('SELECT sid, sess FROM sessions').all();
    const doomed = rows.filter((row) => {
      try {
        return JSON.parse(row.sess)?.passport?.user === userId;
      } catch {
        return false; // an unparseable row belongs to nobody we can identify
      }
    });
    if (doomed.length === 0) return 0;
    const drop = sessionsDb.prepare('DELETE FROM sessions WHERE sid = ?');
    const tx = sessionsDb.transaction((list) => { for (const row of list) drop.run(row.sid); });
    tx(doomed);
    return doomed.length;
  } catch (err) {
    console.warn(`[sessions] eviction failed for ${userId}: ${err.message}`);
    return 0;
  }
}

/**
 * Rotate the session id before logging someone in, so a cookie an attacker
 * planted beforehand does not become an authenticated one (session fixation).
 * `req.session.regenerate` is absent in the test harness and in any mounting
 * without session middleware — fall through to a plain login there.
 */
function loginWithFreshSession(req, user, done) {
  if (!req.session || typeof req.session.regenerate !== 'function') {
    return req.login(user, done);
  }
  // The cloud edition parks the active organization on the session before the
  // login call; carry it across the new session rather than losing it.
  const activeOrgId = req.session.activeOrgId;
  return req.session.regenerate((err) => {
    if (err) return done(err);
    if (activeOrgId) req.session.activeOrgId = activeOrgId;
    return req.login(user, done);
  });
}

module.exports = { useDatabase, destroySessionsForUser, loginWithFreshSession };
