require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const session = require('express-session');
const SqliteStore = require('better-sqlite3-session-store')(session);
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const { passport } = require('./middleware/auth');

const authRoutes = require('./routes/auth');
const reportRoutes = require('./routes/reports');
const datasourceRoutes = require('./routes/datasources');
const modelRoutes = require('./routes/models');
const adminRoutes = require('./routes/admin');
const workspaceRoutes = require('./routes/workspaces');
const fileUploadRoutes = require('./routes/fileUpload');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? (process.env.CORS_ORIGIN || true)
    : 'http://localhost:5173',
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
    secure: isProduction,
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    sameSite: isProduction ? 'strict' : 'lax',
  },
}));
app.use(passport.initialize());
app.use(passport.session());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/datasources', datasourceRoutes);
app.use('/api/models', modelRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/workspaces', workspaceRoutes);
app.use('/api/upload', fileUploadRoutes);

// Cube.js semantic layer
const { setupCube } = require('./cube/cubeSetup');
setupCube(app);

// Serve React frontend in production
const clientDistPath = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientDistPath)) {
  app.use(express.static(clientDistPath));
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api/')) {
      res.sendFile(path.join(clientDistPath, 'index.html'));
    }
  });
}

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '0.1.0' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Open Report running on http://0.0.0.0:${PORT}`);
});
