const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { passport, requireAuth } = require('../middleware/auth');
const db = require('../db');
const authHooks = require('../hooks/auth');

const router = express.Router();

router.post('/register', async (req, res) => {
  const { email, password, displayName } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    return res.status(409).json({ error: 'Email already registered' });
  }

  const id = uuidv4();
  const passwordHash = bcrypt.hashSync(password, 10);
  // First user becomes admin
  const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get();
  const role = userCount.c === 0 ? 'admin' : 'viewer';

  db.prepare('INSERT INTO users (id, email, password_hash, display_name, role) VALUES (?, ?, ?, ?, ?)').run(
    id, email, passwordHash, displayName || email.split('@')[0], role
  );

  const user = { id, email, display_name: displayName || email.split('@')[0], role };

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

  req.login(user, (err) => {
    if (err) return res.status(500).json({ error: 'Login failed after registration' });
    res.status(201).json({ user });
  });
});

router.post('/login', (req, res, next) => {
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

    req.login(user, (err) => {
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
    res.json({ message: 'Logged out' });
  });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// Search users by email (for autocomplete)
router.get('/users/search', requireAuth, (req, res) => {
  const q = req.query.q || '';
  if (q.length < 2) return res.json({ users: [] });
  const users = db.prepare("SELECT id, email, display_name FROM users WHERE email LIKE ? OR display_name LIKE ? LIMIT 10")
    .all(`%${q}%`, `%${q}%`);
  res.json({ users });
});

module.exports = router;
