// Minimal in-process app for supertest: real routers, but auth is injected via
// an `x-test-user` header (user id) instead of passport/session. requireAuth
// only checks req.isAuthenticated(), so this exercises the real access-control
// and SQL-compiler code paths without a live DB or session store.
const express = require('express');
const { v4: uuid } = require('uuid');
const bcrypt = require('bcryptjs');
const db = require('../../db');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const uid = req.headers['x-test-user'];
    const user = uid ? db.prepare('SELECT id, email, display_name, role FROM users WHERE id = ?').get(String(uid)) : null;
    if (user) { req.user = user; req.isAuthenticated = () => true; }
    else { req.isAuthenticated = () => false; }
    next();
  });
  app.use('/api/auth', require('../../routes/auth'));
  app.use('/api/reports', require('../../routes/reports'));
  app.use('/api/datasources', require('../../routes/datasources'));
  app.use('/api/models', require('../../routes/models'));
  return app;
}

function seedUser({ role = 'viewer', email } = {}) {
  const id = uuid();
  db.prepare('INSERT INTO users (id, email, password_hash, display_name, role) VALUES (?,?,?,?,?)')
    .run(id, email || `${id}@test.local`, bcrypt.hashSync('pw', 4), 'Test', role);
  return id;
}

function seedDatasource({ userId, dbType = 'postgres' } = {}) {
  const id = uuid();
  db.prepare(`INSERT INTO datasources (id, user_id, name, db_type, host, port, db_name, db_user, db_password, extra_config)
              VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(id, userId, `ds-${dbType}`, dbType, '', 0, 'testdb', '', '', '{}');
  return id;
}

// A single-table model: dimension `items.label`, measure SUM(items.amt).
// `extraMeasures` lets a test add a measure (e.g. a poisoned label).
function seedModel({ userId, datasourceId, measures } = {}) {
  const id = uuid();
  const dimensions = [{ name: 'items.label', table: 'items', column: 'label', type: 'string', label: 'label' }];
  const meas = measures || [{ name: 'items.amt_sum', table: 'items', column: 'amt', aggregation: 'sum', label: 'amt' }];
  db.prepare(`INSERT INTO models (id, user_id, datasource_id, name, selected_tables, dimensions, measures, joins, rls, column_types)
              VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(id, userId, datasourceId, 'm', JSON.stringify(['items']), JSON.stringify(dimensions),
      JSON.stringify(meas), '[]', '{}', '{}');
  return id;
}

function seedReport({ userId, modelId, isPublic = 0, workspaceId = null, settings = {} } = {}) {
  const id = uuid();
  db.prepare('INSERT INTO reports (id, user_id, model_id, workspace_id, is_public, settings) VALUES (?,?,?,?,?,?)')
    .run(id, userId, modelId, workspaceId, isPublic ? 1 : 0, JSON.stringify(settings));
  return id;
}

module.exports = { buildApp, seedUser, seedDatasource, seedModel, seedReport, db };
