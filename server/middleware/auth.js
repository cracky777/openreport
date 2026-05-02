const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcryptjs');
const db = require('../db');

passport.use(new LocalStrategy(
  { usernameField: 'email' },
  (email, password, done) => {
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user) {
      return done(null, false, { message: 'Invalid email or password' });
    }
    if (!bcrypt.compareSync(password, user.password_hash)) {
      return done(null, false, { message: 'Invalid email or password' });
    }
    // Cloud-only email-verification gate. OSS keeps logging users in
    // regardless of email_verified — the column exists on the users table
    // but no enforcement happens without a transactional mailer in front.
    if (process.env.OPENREPORT_CLOUD === '1' && (user.email_verified || 0) !== 1) {
      return done(null, false, { message: 'Email not verified', code: 'EMAIL_UNVERIFIED', email: user.email });
    }
    return done(null, { id: user.id, email: user.email, display_name: user.display_name, role: user.role || 'viewer' });
  }
));

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser((id, done) => {
  const user = db.prepare('SELECT id, email, display_name, role FROM users WHERE id = ?').get(id);
  done(null, user || null);
});

function requireAuth(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ error: 'Authentication required' });
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: 'Authentication required' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Insufficient permissions' });
    next();
  };
}

function requireAdmin(req, res, next) {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Authentication required' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

module.exports = { passport, requireAuth, requireRole, requireAdmin };
