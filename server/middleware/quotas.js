const db = require('../db');

// Plan limits configuration
const PLAN_LIMITS = {
  free: {
    maxReports: -1,
    maxDatasources: -1,
    maxModels: -1,
    maxWorkspaces: -1,
    maxFileUploadMB: 10,
    maxRowsPerQuery: 1000000,
    exportEnabled: true,
    publicShareEnabled: true,
  },
  pro: {
    maxReports: -1,
    maxDatasources: -1,
    maxModels: -1,
    maxWorkspaces: -1,
    maxFileUploadMB: 500,
    maxRowsPerQuery: 1000000,
    exportEnabled: true,
    publicShareEnabled: true,
  },
  enterprise: {
    maxReports: -1,
    maxDatasources: -1,
    maxModels: -1,
    maxWorkspaces: -1,
    maxFileUploadMB: 2000,
    maxRowsPerQuery: 1000000,
    exportEnabled: true,
    publicShareEnabled: true,
  },
};

function getUserPlan(userId) {
  const user = db.prepare('SELECT plan, plan_expires_at FROM users WHERE id = ?').get(userId);
  if (!user) return 'free';
  // Check expiration
  if (user.plan !== 'free' && user.plan_expires_at) {
    if (new Date(user.plan_expires_at) < new Date()) return 'free';
  }
  return user.plan || 'free';
}

function getLimits(userId) {
  const plan = getUserPlan(userId);
  return { plan, ...PLAN_LIMITS[plan] || PLAN_LIMITS.free };
}

function getUserCounts(userId) {
  const reports = db.prepare('SELECT COUNT(*) as c FROM reports WHERE user_id = ?').get(userId).c;
  const datasources = db.prepare('SELECT COUNT(*) as c FROM datasources WHERE user_id = ?').get(userId).c;
  const models = db.prepare('SELECT COUNT(*) as c FROM models WHERE user_id = ?').get(userId).c;
  const workspaces = db.prepare('SELECT COUNT(*) as c FROM workspaces WHERE owner_id = ?').get(userId).c;
  return { reports, datasources, models, workspaces };
}

// Middleware: check quota before creating a resource
function checkQuota(resourceType) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });

    const limits = getLimits(req.user.id);
    const counts = getUserCounts(req.user.id);

    const limitMap = {
      report: { current: counts.reports, max: limits.maxReports, label: 'reports' },
      datasource: { current: counts.datasources, max: limits.maxDatasources, label: 'datasources' },
      model: { current: counts.models, max: limits.maxModels, label: 'models' },
      workspace: { current: counts.workspaces, max: limits.maxWorkspaces, label: 'workspaces' },
    };

    const check = limitMap[resourceType];
    if (!check) return next();

    if (check.max !== -1 && check.current >= check.max) {
      return res.status(403).json({
        error: `You have reached the maximum number of ${check.label} for your plan (${limits.plan}). Upgrade to create more.`,
        limit: check.max,
        current: check.current,
        plan: limits.plan,
      });
    }

    next();
  };
}

// Middleware: check feature access
function requireFeature(feature) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    const limits = getLimits(req.user.id);
    if (!limits[feature]) {
      return res.status(403).json({
        error: `This feature is not available on your plan (${limits.plan}). Upgrade to access it.`,
        plan: limits.plan,
      });
    }
    next();
  };
}

module.exports = { PLAN_LIMITS, getUserPlan, getLimits, getUserCounts, checkQuota, requireFeature };
