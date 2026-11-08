// The daily ping of a self-hosted instance sends exactly what the admin page
// shows, stays silent when turned off, and the collector keeps one row per
// instance without the caller's address.
const express = require('express');
const request = require('supertest');
const db = require('../db');
const telemetry = require('../utils/telemetry');
const { setSetting } = require('../utils/settingsHelper');

const okFetch = (body) => jest.fn(async () => ({ ok: true, json: async () => body }));

afterEach(() => {
  delete process.env.OPENREPORT_TELEMETRY;
  delete process.env.OPENREPORT_CLOUD;
  setSetting('telemetry_enabled', true);
});

describe('telemetry ping', () => {
  test('sends the five announced fields and nothing else', async () => {
    const fetchImpl = okFetch({ latest: '9.0.0' });
    await telemetry.ping({ fetchImpl });
    const sent = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(Object.keys(sent).sort()).toEqual(['ai', 'databases', 'install', 'instanceId', 'version']);
    expect(sent).toEqual(telemetry.payload());
    expect(sent.instanceId).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('keeps the same instance id between pings', () => {
    expect(telemetry.payload().instanceId).toBe(telemetry.payload().instanceId);
  });

  test('brings back the latest release for the update notice', async () => {
    await telemetry.ping({ fetchImpl: okFetch({ latest: '9.0.0' }) });
    expect(telemetry.status()).toMatchObject({ latest: '9.0.0', updateAvailable: true });
  });

  test('sends nothing when the admin turned it off', async () => {
    telemetry.setEnabled(false);
    const fetchImpl = okFetch({});
    expect(await telemetry.ping({ fetchImpl })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(telemetry.status()).toMatchObject({ enabled: false, updateAvailable: false, latest: null });
  });

  test.each([['OPENREPORT_TELEMETRY', '0', 'env'], ['OPENREPORT_TELEMETRY', 'off', 'env'], ['OPENREPORT_CLOUD', '1', 'hosted']])(
    '%s=%s turns it off whatever the admin chose', async (name, value, reason) => {
      process.env[name] = value;
      const fetchImpl = okFetch({});
      await telemetry.ping({ fetchImpl });
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(telemetry.forcedOff()).toBe(reason);
    });

  test('an unreachable server is ignored', async () => {
    await expect(telemetry.ping({ fetchImpl: async () => { throw new Error('offline'); } })).resolves.toBeNull();
  });

  test('compares versions', () => {
    expect(telemetry.isNewer('0.10.0', '0.9.3')).toBe(true);
    expect(telemetry.isNewer('0.6.0', '0.6.0')).toBe(false);
    expect(telemetry.isNewer('0.6.0-rc.1', '0.6.0')).toBe(false);
  });
});

describe('telemetry collector', () => {
  const { createRouter, validPing } = require('../routes/telemetry');
  const app = express();
  app.use(express.json());
  app.use('/api/telemetry', createRouter({ fetchImpl: okFetch({ tag_name: 'v0.7.0' }) }));
  const good = { instanceId: '0b7a4c1e-2f3d-4e5a-8b9c-0d1e2f3a4b5c', version: '0.6.0', install: 'docker', databases: ['postgres', 'duckdb'], ai: true };

  test('stores one row per instance and answers the latest release', async () => {
    const res = await request(app).post('/api/telemetry/ping').send(good);
    expect(res.body).toEqual({ latest: '0.7.0' });
    await request(app).post('/api/telemetry/ping').send({ ...good, version: '0.7.0' });
    const rows = db.prepare('SELECT * FROM telemetry_instances WHERE instance_id = ?').all(good.instanceId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ version: '0.7.0', install: 'docker', databases: '["duckdb","postgres"]', ai: 1 });
    expect(Object.keys(rows[0]).join(' ')).not.toMatch(/ip|addr|host/i);
  });

  test.each([
    ['an extra field', { ...good, email: 'a@b.c' }],
    ['a made-up id', { ...good, instanceId: 'me' }],
    ['a free-text database', { ...good, databases: ['prod.acme.internal:5432'] }],
    ['an unknown install', { ...good, install: 'k8s' }],
  ])('refuses %s', async (_, body) => {
    expect(validPing(body)).toBeNull();
    expect((await request(app).post('/api/telemetry/ping').send(body)).status).toBe(400);
  });
});
