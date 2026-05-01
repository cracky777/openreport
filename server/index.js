require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const session = require('express-session');
const SqliteStore = require('better-sqlite3-session-store')(session);
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const { passport, requireAuth } = require('./middleware/auth');

const authRoutes = require('./routes/auth');
const reportRoutes = require('./routes/reports');
const datasourceRoutes = require('./routes/datasources');
const modelRoutes = require('./routes/models');
const adminRoutes = require('./routes/admin');
const workspaceRoutes = require('./routes/workspaces');
const customVisualRoutes = require('./routes/customVisuals');
const fileUploadRoutes = require('./routes/fileUpload');

const app = express();
const PORT = process.env.PORT || 3001;

// CORS — in production, CORS_ORIGIN can be a single origin or a comma-separated
// list (e.g. "https://app.openreport.io,https://openreport.io" so the static
// marketing site can POST to /api/billing/waitlist). In dev we accept any
// localhost origin so the static site (served from any port via python -m
// http.server, http-server, etc.) can hit the API while you iterate.
function buildCorsOrigin() {
  // In dev, accept any origin (localhost ports, file:// pages, etc.). The cors
  // package reflects the request's Origin header back so credentials still
  // work. Production stays strict via CORS_ORIGIN.
  if (process.env.NODE_ENV !== 'production') return true;
  const raw = process.env.CORS_ORIGIN;
  if (!raw) return true;
  const list = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return list.length > 1 ? list : list[0];
}

// Middleware
app.use(cors({
  origin: buildCorsOrigin(),
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
const sessionsDir = path.join(__dirname, 'data');
if (!fs.existsSync(sessionsDir)) fs.mkdirSync(sessionsDir, { recursive: true });
const sessionsDb = new Database(path.join(sessionsDir, 'sessions.db'));

const isProduction = process.env.NODE_ENV === 'production';
if (isProduction) app.set('trust proxy', 1);

app.use(session({
  store: new SqliteStore({ client: sessionsDb, expired: { clear: true, intervalMs: 900000 } }),
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    // 'auto' = Secure flag set only when req.secure is true. Combined with
    // `trust proxy 1` it respects X-Forwarded-Proto from a TLS-terminating
    // reverse proxy, so the same image works behind nginx/Caddy AND on
    // direct http://localhost without requiring NODE_ENV=development.
    secure: 'auto',
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    sameSite: isProduction ? 'strict' : 'lax',
  },
}));
app.use(passport.initialize());
app.use(passport.session());

// Cloud edition extension point — loaded BEFORE OSS routes so the cloud module
// can mount tenant-scoped shadows for /api/workspaces, /api/reports, etc. that
// take precedence (Express picks the first matching handler). In OSS mode this
// is a no-op and the OSS routes below run as today.
if (process.env.OPENREPORT_CLOUD === '1') {
  try {
    require('./cloud').register(app);
  } catch (err) {
    console.error('[cloud] Failed to load cloud module:', err.message);
    process.exit(1);
  }
}

// Personal-workspace bootstrap. Backfill once at boot (idempotent), and have
// every newly-registered user get a Personal workspace via the post-register
// hook. Without this, custom visuals — which require a workspace_id — would
// not be available outside of shared workspaces.
//
// Skipped in cloud mode: the cloud edition runs its own per-(user, org)
// backfill in cloud.register() and its own post-register hook. Running the
// OSS variant on top would create orphan workspaces with organization_id=NULL
// for every user (invisible to cloud routes, but noisy in the DB).
if (process.env.OPENREPORT_CLOUD !== '1') {
  const authHooks = require('./hooks/auth');
  const { ensurePersonalWorkspace, backfillPersonalWorkspaces } = require('./utils/personalWorkspace');
  backfillPersonalWorkspaces();
  authHooks.registerPostRegister(({ user }) => {
    ensurePersonalWorkspace(user.id);
  });
}

// Routes — only reached for paths the cloud module didn't shadow
app.use('/api/auth', authRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/datasources', datasourceRoutes);
app.use('/api/models', modelRoutes);
app.use('/api/admin', adminRoutes);
// Custom visuals share the /api/workspaces prefix — mount BEFORE workspaces so
// /:wsId/visuals/... is matched here instead of falling through to a 404 in the
// workspaces router.
app.use('/api/workspaces', customVisualRoutes);
app.use('/api/workspaces', workspaceRoutes);
app.use('/api/upload', fileUploadRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '0.1.0' });
});

// Custom visual starter template — packaged on the fly from examples/custom-visual-template/
// so the contract documentation always tracks the running server version.
app.get('/api/custom-visual-template.zip', requireAuth, (req, res) => {
  try {
    const AdmZip = require('adm-zip');
    const dir = path.join(__dirname, '..', 'examples', 'custom-visual-template');
    if (!fs.existsSync(dir)) return res.status(404).json({ error: 'Template not found on server' });
    const zip = new AdmZip();
    for (const name of ['manifest.json', 'visual.js', 'icon.svg', 'README.md']) {
      const p = path.join(dir, name);
      if (fs.existsSync(p)) zip.addLocalFile(p);
    }
    res.type('application/zip')
       .setHeader('Content-Disposition', 'attachment; filename="custom-visual-template.zip"')
       .send(zip.toBuffer());
  } catch (err) {
    console.error('[custom-visual-template]', err);
    res.status(500).json({ error: 'Failed to build template' });
  }
});

// Serve React frontend in production (BEFORE Cube.js to avoid route conflicts)
const clientDistPath = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientDistPath)) {
  app.use(express.static(clientDistPath));
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api/') && !req.path.startsWith('/cubejs-api/')) {
      res.sendFile(path.join(clientDistPath, 'index.html'));
    }
  });
}

// Cube.js semantic layer
try {
  const { setupCube } = require('./cube/cubeSetup');
  setupCube(app);
} catch (err) {
  console.warn('Cube.js setup skipped:', err.message);
}

// Global safety nets — prevent the server from crashing on async DB errors (e.g. ECONNRESET on a pool socket)
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

// Graceful shutdown — release DuckDB file locks so the next restart can reopen them
const shutdown = async (signal) => {
  console.log(`\n[shutdown] received ${signal}, closing DuckDB instances...`);
  if (global._duckdbInstances) {
    for (const [path, db] of Object.entries(global._duckdbInstances)) {
      try { await db.close(); console.log(`  closed ${path}`); }
      catch (err) { console.error(`  failed to close ${path}:`, err.message); }
    }
  }
  process.exit(0);
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Open Report running on http://0.0.0.0:${PORT}`);
});
