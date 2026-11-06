// Public demo instance (demo.openreport.io): anyone opens ONE report in the
// editor, without an account, and nothing they do reaches the database.
//
// The editor keeps every change in the browser; the server only answers what
// a public report already answers to an anonymous reader — the report, its
// model, queries on that model. Everything else is refused here, before any
// route runs: deny by default, so a route added later is closed until it is
// listed. No login, no registration, no write of any kind, no assistant.
//
// OPENREPORT_DEMO=1 turns it on; OPENREPORT_DEMO_REPORT names the report
// (which must be public — the query route's own access check still applies).

const rateLimit = require('express-rate-limit');

const DEMO_PATH = '/demo';

function isDemo() {
  return process.env.OPENREPORT_DEMO === '1';
}

function demoReportId() {
  return String(process.env.OPENREPORT_DEMO_REPORT || '');
}

function demoModelId(db) {
  const row = db.prepare('SELECT model_id FROM reports WHERE id = ? AND is_public = 1').get(demoReportId());
  return row ? row.model_id : null;
}

// The few calls the demo editor makes. `modelId` is read per request: the
// report can be re-pointed without a restart.
function allowed(req, modelId) {
  const { method } = req;
  const p = req.path;
  if (method === 'GET' || method === 'HEAD') {
    if (p === '/api/health' || p === '/api/demo') return true;
    if (p === '/api/auth/me') return true; // answers 401: no session is ever opened here
    if (p === `/api/reports/${demoReportId()}`) return true;
    if (modelId && p === `/api/models/${modelId}`) return true;
    if (p === '/api/geo/maps' || /^\/api\/geo\/maps\/[\w-]+$/.test(p)) return true;
    return !p.startsWith('/api/');
  }
  if (method === 'POST') {
    if (modelId && p === `/api/models/${modelId}/query`) return true;
    if (p === '/api/models/cancel-query') return true;
  }
  return false;
}

// Several visuals query at once on every change; 240 a minute is a busy
// visitor, far from what a script would want.
const queryLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.DEMO_QUERY_RATE_LIMIT) || 240,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many queries. Wait a moment.' },
});

// The pages of the app other than the demo open the demo instead: there is
// no login screen to reach, no dashboard to list.
function isAppPage(req) {
  if (req.method !== 'GET' || req.path.startsWith('/api/')) return false;
  if (req.path === DEMO_PATH || req.path.startsWith('/assets/') || req.path.startsWith('/geo/')) return false;
  if (req.path.startsWith('/uploads/images/')) return false;
  return !/\.[a-z0-9]+$/i.test(req.path); // a file of the build (favicon, logo…)
}

function install(app, db) {
  if (!isDemo()) return;
  if (!demoReportId()) {
    console.error('[demo] FATAL: OPENREPORT_DEMO=1 needs OPENREPORT_DEMO_REPORT (the id of a public report).');
    process.exit(1);
  }
  app.use((req, res, next) => {
    if (isAppPage(req)) return res.redirect(302, DEMO_PATH);
    if (!allowed(req, demoModelId(db))) return res.status(403).json({ error: 'Not available in the demo' });
    if (req.method === 'POST' && req.path.endsWith('/query')) {
      // What only a signed-in owner may send is ignored anyway; drop it here
      // too so the demo never runs a query the cache could have answered.
      if (req.body && typeof req.body === 'object') delete req.body.bypassCache;
      return queryLimiter(req, res, next);
    }
    return next();
  });
  app.get('/api/demo', (_req, res) => res.json({ reportId: demoReportId() }));
}

module.exports = { install, isDemo, allowed, isAppPage };
