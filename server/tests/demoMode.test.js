// The public demo answers only what the demo editor reads; everything else is
// refused before any route runs, and the app's other pages open the demo.
const express = require('express');
const request = require('supertest');

const REPORT = 'rep-demo';
const MODEL = 'mod-demo';
const fakeDb = {
  prepare: () => ({ get: (id) => (id === REPORT ? { model_id: MODEL } : undefined) }),
};

function demoApp() {
  process.env.OPENREPORT_DEMO = '1';
  process.env.OPENREPORT_DEMO_REPORT = REPORT;
  jest.resetModules();
  const demoMode = require('../utils/demoMode');
  const app = express();
  app.use(express.json());
  demoMode.install(app, fakeDb);
  // Behind the lock, every route answers 200: whatever gets through shows.
  app.all('*', (req, res) => res.json({ reached: req.path, body: req.body }));
  return app;
}

afterAll(() => {
  delete process.env.OPENREPORT_DEMO;
  delete process.env.OPENREPORT_DEMO_REPORT;
});

describe('demo mode', () => {
  const app = demoApp();

  test('names its report', async () => {
    const res = await request(app).get('/api/demo');
    expect(res.body).toEqual({ reportId: REPORT });
  });

  test.each([
    ['get', `/api/reports/${REPORT}`],
    ['get', `/api/models/${MODEL}`],
    ['post', `/api/models/${MODEL}/query`],
    ['post', '/api/models/cancel-query'],
    ['get', '/api/auth/me'],
    ['get', '/api/geo/maps'],
  ])('lets %s %s through', async (method, url) => {
    const res = await request(app)[method](url).send({});
    expect(res.status).toBe(200);
    expect(res.body.reached).toBe(url);
  });

  test.each([
    ['post', '/api/auth/login'],
    ['post', '/api/auth/register'],
    ['put', `/api/reports/${REPORT}`],
    ['delete', `/api/reports/${REPORT}`],
    ['post', '/api/reports'],
    ['post', `/api/reports/${REPORT}/duplicate`],
    ['post', `/api/reports/${REPORT}/embed-token`],
    ['put', `/api/models/${MODEL}`],
    ['get', `/api/models/${MODEL}/export`],
    ['get', '/api/models'],
    ['get', '/api/reports'],
    ['get', '/api/reports/another-report'],
    ['post', '/api/models/another-model/query'],
    ['get', '/api/datasources'],
    ['post', '/api/upload'],
    ['post', '/api/images'],
    ['get', '/api/ai/status'],
    ['post', `/api/ai/models/${MODEL}/chat`],
    ['get', '/api/admin/settings'],
    ['get', '/api/v1/metadata/models'],
    ['get', '/api/anything-added-later'],
  ])('refuses %s %s', async (method, url) => {
    const res = await request(app)[method](url).send({});
    expect(res.status).toBe(403);
    expect(res.body.reached).toBeUndefined();
  });

  test.each(['/', '/login', '/admin', `/edit/${REPORT}`, `/view/${REPORT}`, '/API/models'])('sends %s to the demo', async (url) => {
    const res = await request(app).get(url);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/demo');
  });

  test('serves the demo page and the build files', async () => {
    expect((await request(app).get('/demo')).body.reached).toBe('/demo');
    expect((await request(app).get('/assets/index-abc.js')).body.reached).toBe('/assets/index-abc.js');
  });

  test('a query never bypasses the cache', async () => {
    const res = await request(app).post(`/api/models/${MODEL}/query`).send({ bypassCache: true, measureNames: ['m'] });
    expect(res.body.body).toEqual({ measureNames: ['m'] });
  });
});

describe('outside the demo', () => {
  test('installs nothing', () => {
    delete process.env.OPENREPORT_DEMO;
    jest.resetModules();
    const app = express();
    require('../utils/demoMode').install(app, fakeDb);
    expect(app._router).toBeUndefined();
  });
});
