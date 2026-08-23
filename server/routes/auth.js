const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
const { passport, requireAuth } = require('../middleware/auth');
const db = require('../db');
const authHooks = require('../hooks/auth');
const { loginWithFreshSession, destroySessionsForUser } = require('../utils/sessionRegistry');

const router = express.Router();

// Brute-force protection on the credential surface. Keyed on the caller IP
// (Express's `trust proxy 1` in production makes `req.ip` use X-Forwarded-For
// from the reverse proxy). `skipSuccessfulRequests` means a successful login
// resets nothing but ALSO doesn't count toward the limit — so a user who
// typos a few times then gets it right isn't penalised by the prior misses.
// Numbers: bcrypt at cost 10 is ~80ms/hash, so 10 attempts/15min already
// caps an online attacker far below what an offline attack would manage;
// the visible 429 also surfaces a brute-force burst to the admin via logs.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'Too many login attempts. Try again in a few minutes.' },
});

// Tighter limit on /register — it's an enumeration vector (the 409 leaks
// whether an email exists in the DB) AND a mass-account-creation vector
// (especially in cloud mode where every register provisions an org). 5/h/IP
// is generous for a legitimate signup flow (the user only does it once)
// while killing bot-driven account farming.
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many registration attempts. Try again later.' },
});

// Length is the only rule that matters — composition requirements push people
// towards "Password1!" and nothing else. Applies to new passwords only, so
// nobody with an existing shorter one is locked out.
const MIN_PASSWORD_LENGTH = 12;
function validatePassword(password) {
  if (typeof password !== 'string') return 'Password must be text';
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (password.length > 200) return 'Password is too long (max 200 characters)';
  return null;
}

router.post('/register', registerLimiter, async (req, res) => {
  const { password, displayName } = req.body;
  // Store one canonical form. RLS patterns, workspace shares and the SSO
  // lookup all compare emails case-insensitively, so letting "Bob@x.io" and
  // "bob@x.io" be two accounts would give the second one the first one's
  // row-level grants.
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  const passwordError = validatePassword(password);
  if (passwordError) return res.status(400).json({ error: passwordError });

  const existing = db.prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE').get(email);
  if (existing) {
    return res.status(409).json({ error: 'Email already registered' });
  }

  const id = uuidv4();
  const passwordHash = bcrypt.hashSync(password, 10);
  const name = displayName || email.split('@')[0];
  // First user becomes admin
  const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get();
  const role = userCount.c === 0 ? 'admin' : 'viewer';

  db.prepare('INSERT INTO users (id, email, password_hash, display_name, role) VALUES (?, ?, ?, ?, ?)').run(
    id, email, passwordHash, name, role
  );

  const user = { id, email, display_name: name, role };

  // Post-register hooks (cloud edition uses these to provision a personal
  // organization, send a verification email, and consume pending invitations).
  // Errors are caught inside the registry — never break the signup response.
  await authHooks.runPostRegister({ user, req });

  // In cloud mode email verification is required before login. We DON'T
  // auto-log-in here — the frontend shows a "Check your email" screen and
  // the user comes back through /login once they've clicked the link.
  if (process.env.OPENREPORT_CLOUD === '1') {
    return res.status(201).json({
      user,
      verificationRequired: true,
      message: 'Account created. Check your email to verify your address before signing in.',
    });
  }

  loginWithFreshSession(req, user, (err) => {
    if (err) return res.status(500).json({ error: 'Login failed after registration' });
    res.status(201).json({ user });
  });
});

router.post('/login', loginLimiter, (req, res, next) => {
  passport.authenticate('local', (err, user, info) => {
    if (err) return next(err);
    if (!user) {
      // Surface the structured info from the strategy when present so the
      // frontend can branch on `code` (e.g. EMAIL_UNVERIFIED → resend button).
      const body = { error: info?.message || 'Invalid email or password' };
      if (info?.code) body.code = info.code;
      if (info?.email) body.email = info.email;
      return res.status(401).json(body);
    }

    // Rotate the session id first: a cookie planted before the login must not
    // survive it as an authenticated session (fixation).
    loginWithFreshSession(req, user, (err) => {
      if (err) return next(err);
      // Stamp the last-seen timestamp so the platform supervisor can spot
      // inactive accounts. Cheap UPDATE, no impact on the response.
      try { db.prepare("UPDATE users SET last_seen_at = datetime('now') WHERE id = ?").run(user.id); } catch { /* ignore */ }
      res.json({ user });
    });
  })(req, res, next);
});

router.post('/logout', (req, res) => {
  req.logout((err) => {
    if (err) return res.status(500).json({ error: 'Logout failed' });
    // req.logout only drops passport's key from the session — the sid and its
    // stored row survive, so the cookie a user just "logged out" stays usable.
    // Destroy the session and retire the cookie with it.
    if (req.session && typeof req.session.destroy === 'function') {
      return req.session.destroy(() => {
        res.clearCookie('connect.sid');
        res.json({ message: 'Logged out' });
      });
    }
    return res.json({ message: 'Logged out' });
  });
});

router.get('/me', requireAuth, (req, res) => {
  // `instance` = non-sensitive instance-wide policy the client UI adapts to
  // (e.g. hiding the "Share public link" action). Enforcement stays server-side.
  const { getPublicSharingPolicy } = require('../utils/settingsHelper');
  res.json({ user: req.user, instance: { publicSharingPolicy: getPublicSharingPolicy() } });
});

// Autocomplete for user discovery (RLS assignment, workspace invites). To keep
// it from being a bulk email-enumeration endpoint, a *partial* query only matches
// users the caller already shares a workspace with; a *full email* query does an
// exact lookup (so you can still invite someone new by typing their exact
// address — which isn't enumeration). Rate-limited on top.
const userSearchLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many searches. Try again in a few minutes.' },
});

// "Looks like a complete email" — cheap structural check (no backtracking-prone
// regex): exactly one '@' not at the edges, with a '.' somewhere after it.
const isFullEmail = (s) => {
  const at = s.indexOf('@');
  return at > 0 && at === s.lastIndexOf('@') && at < s.length - 1 && s.indexOf('.', at + 1) > at + 1;
};

// Workspaces the caller belongs to (owns or is a member of).
const MY_WORKSPACES = `
  SELECT id FROM workspaces WHERE owner_id = @me
  UNION
  SELECT workspace_id FROM workspace_members WHERE user_id = @me
`;

router.get('/users/search', requireAuth, userSearchLimiter, (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 3) return res.json({ users: [] });

  // Group suggestions ride along for the RLS dialog: names are org-level and
  // not sensitive, and model editors need them to write `group:<name>` rules.
  const matchGroups = (needle) => db.prepare(`
    SELECT g.id, g.name, COUNT(gm.user_id) AS member_count
    FROM groups g LEFT JOIN group_members gm ON gm.group_id = g.id
    WHERE g.name LIKE @like
    GROUP BY g.id ORDER BY g.name LIMIT 5
  `).all({ like: `%${needle}%` });

  // Full email → exact lookup, allowed even for someone you don't share a
  // workspace with (that's the "invite a new collaborator" path).
  if (isFullEmail(q)) {
    const user = db.prepare('SELECT id, email, display_name FROM users WHERE email = ? COLLATE NOCASE').get(q);
    return res.json({ users: user ? [user] : [], groups: [] });
  }

  // Partial query → only users who share a workspace with the caller.
  const users = db.prepare(`
    SELECT DISTINCT u.id, u.email, u.display_name
    FROM users u
    WHERE (u.email LIKE @like OR u.display_name LIKE @like)
      AND (
        u.id IN (SELECT user_id FROM workspace_members WHERE workspace_id IN (${MY_WORKSPACES}))
        OR u.id IN (SELECT owner_id FROM workspaces WHERE id IN (${MY_WORKSPACES}))
      )
    LIMIT 10
  `).all({ me: req.user.id, like: `%${q}%` });
  res.json({ users, groups: matchGroups(q.replace(/^group:/i, '')) });
});

// ─── OIDC single sign-on ────────────────────────────────────
// Whole flow lives in utils/oidc (env-driven, PKCE); these routes only wire
// it to the session + passport login. All three are no-ops until the OIDC_*
// env vars are set, so OSS deploys without an IdP see no behaviour change.
const oidc = require('../utils/oidc');

// Public: the login page probes this to decide whether to show the SSO button.
router.get('/oidc/config', (req, res) => {
  res.json({ enabled: oidc.isEnabled(), label: oidc.buttonLabel() });
});

router.get('/oidc/login', async (req, res) => {
  if (!oidc.isEnabled()) return res.status(404).json({ error: 'SSO is not configured' });
  try {
    res.redirect(await oidc.buildAuthUrl(req.session));
  } catch (err) {
    res.status(502).json({ error: `SSO provider unreachable: ${err.message}` });
  }
});

router.get('/oidc/callback', async (req, res) => {
  if (!oidc.isEnabled()) return res.status(404).json({ error: 'SSO is not configured' });
  try {
    const { user } = await oidc.completeLogin(req, db);
    loginWithFreshSession(req, user, (err) => {
      if (err) return res.redirect('/login?sso_error=' + encodeURIComponent('Session could not be established'));
      res.redirect('/');
    });
  } catch (err) {
    // Message goes back to the login page banner — our own texts plus
    // openid-client's terse protocol errors, truncated either way.
    res.redirect('/login?sso_error=' + encodeURIComponent(String(err.message || 'SSO failed').slice(0, 140)));
  }
});

module.exports = router;
// Shared with the admin routes so both password entry points enforce one rule.
module.exports.validatePassword = validatePassword;
