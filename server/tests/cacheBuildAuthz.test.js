// Authorization for cache/rollup builds. Triggering a build runs /query AS THE
// MODEL OWNER (rollupBuilder), which bypasses the free-SQL gate in models.js
// /query. Two barriers must hold:
//   3a — a user who owns a report but only READS its model cannot create /
//        trigger a build (cacheSchedules canTriggerBuild → canWriteModel).
//   3b — free-SQL extras (custom aggregation / raw expression) authored on a
//        report by anyone other than the model owner are dropped from the
//        owner-identity build (rollupBuilder planRollupsForModel).
const express = require('express');
const request = require('supertest');
const { seedUser, seedDatasource, seedModel, seedReport, db } = require('./helpers/testApp');
const rollupBuilder = require('../utils/rollupBuilder');

// cacheSchedules is not mounted by the shared testApp helper; mount it here
// behind the same x-test-user auth shim.
function appWithSchedules() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const uid = req.headers['x-test-user'];
    const user = uid ? db.prepare('SELECT id, email, display_name, role FROM users WHERE id = ?').get(String(uid)) : null;
    if (user) { req.user = user; req.isAuthenticated = () => true; } else { req.isAuthenticated = () => false; }
    next();
  });
  app.use('/api/cache-schedules', require('../routes/cacheSchedules'));
  return app;
}

describe('Barrier 3a — cache build requires write access to the model', () => {
  test('report owner with only read access to the model cannot create a schedule (403); model owner can (201)', async () => {
    const victim = seedUser({ role: 'editor' });
    const attacker = seedUser({ role: 'editor' });
    const ds = seedDatasource({ userId: victim });
    const model = seedModel({ userId: victim, datasourceId: ds });
    // A public report by the victim makes the model read-reachable to anyone.
    seedReport({ userId: victim, modelId: model, isPublic: 1 });
    const victimReport = seedReport({ userId: victim, modelId: model });
    // The attacker owns their OWN report on the victim's model.
    const attackerReport = seedReport({ userId: attacker, modelId: model });

    const app = appWithSchedules();
    const body = { cronExpression: '0 * * * *', enabled: false };

    const atk = await request(app)
      .post(`/api/cache-schedules/by-report/${attackerReport}`)
      .set('x-test-user', attacker).send(body);
    expect(atk.status).toBe(403);

    const own = await request(app)
      .post(`/api/cache-schedules/by-report/${victimReport}`)
      .set('x-test-user', victim).send(body);
    expect(own.status).toBe(201);
  });
});

describe('Barrier 3b — untrusted free-SQL rollup extras are stripped', () => {
  const { stripUntrustedFreeSql } = rollupBuilder;
  const OWNER = 'owner-1';
  const extras = () => ({
    extraMeasures: [
      { name: 'add', aggregation: 'sum', table: 't', column: 'x' },      // additive — always kept
      { name: 'evil', aggregation: 'custom', expression: 'SUM(x)/0' },   // free-SQL — untrusted-only drop
    ],
    extraDimensions: [{ name: 'ed', expression: 'lower(x)' }],           // free-SQL dimension
    measureOverrides: { m1: { aggregation: 'custom', expression: 'x' } },
    dimensionOverrides: { d1: { label: 'plain' } },                      // not free-SQL
  });

  test('a non-owner, non-admin author loses every free-SQL extra, keeps additive/plain', () => {
    const out = stripUntrustedFreeSql(extras(), { authorId: 'someone-else', modelOwnerId: OWNER, authorRole: 'editor' });
    expect(out.extraMeasures.map((m) => m.name)).toEqual(['add']);
    expect(out.extraDimensions).toEqual([]);
    expect(out.measureOverrides).toEqual({});
    expect(out.dimensionOverrides).toEqual({ d1: { label: 'plain' } });
  });

  test('the model owner keeps their free-SQL extras (no regression)', () => {
    const out = stripUntrustedFreeSql(extras(), { authorId: OWNER, modelOwnerId: OWNER, authorRole: 'editor' });
    expect(out.extraMeasures.map((m) => m.name)).toEqual(['add', 'evil']);
    expect(out.extraDimensions).toHaveLength(1);
    expect(Object.keys(out.measureOverrides)).toEqual(['m1']);
  });

  test('a non-owner admin keeps free-SQL extras', () => {
    const out = stripUntrustedFreeSql(extras(), { authorId: 'admin-2', modelOwnerId: OWNER, authorRole: 'admin' });
    expect(out.extraMeasures.map((m) => m.name)).toEqual(['add', 'evil']);
  });
});
