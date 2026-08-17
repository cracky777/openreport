// A second harness, deliberately NOT the one in testApp.js.
//
// testApp injects `req.user` from an `x-test-user` header, which is what makes
// the route tests readable — but it also means passport, bcrypt, the session
// cookie, the rate limiters and the internal-token guard have never run in a
// test. Those are the pieces that decide who you are; they deserve to be
// exercised by something.
//
// Everything here is real except the session store, which is in-memory so the
// suite doesn't write a sessions.db.
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const internalToken = require('../../utils/internalToken');

require('../../middleware/auth'); // registers the local strategy + (de)serialize

function buildRealAuthApp({ withInternalToken = false } = {}) {
  const app = express();
  app.use(express.json());
  app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
  }));
  app.use(passport.initialize());
  app.use(passport.session());
  if (withInternalToken) app.use(internalToken.middleware);
  app.use('/api/auth', require('../../routes/auth'));
  // A route that only says who the caller is, so a test can assert the identity
  // the chain settled on without dragging a business route into it.
  app.get('/whoami', (req, res) => {
    res.json({ authenticated: !!(req.isAuthenticated && req.isAuthenticated()), id: req.user?.id || null, role: req.user?.role || null });
  });
  return app;
}

module.exports = { buildRealAuthApp };
