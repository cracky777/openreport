require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const session = require('express-session');
const cors = require('cors');
const { passport } = require('./middleware/auth');

const authRoutes = require('./routes/auth');
const reportRoutes = require('./routes/reports');
const datasourceRoutes = require('./routes/datasources');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
  },
}));
app.use(passport.initialize());
app.use(passport.session());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/datasources', datasourceRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '0.1.0' });
});

app.listen(PORT, () => {
  console.log(`Open Report API running on http://localhost:${PORT}`);
});
