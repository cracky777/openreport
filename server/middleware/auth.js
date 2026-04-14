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
    return done(null, { id: user.id, email: user.email, display_name: user.display_name });
  }
));

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser((id, done) => {
  const user = db.prepare('SELECT id, email, display_name FROM users WHERE id = ?').get(id);
  done(null, user || null);
});

function requireAuth(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ error: 'Authentication required' });
}

module.exports = { passport, requireAuth };
