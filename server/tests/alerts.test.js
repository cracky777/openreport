// Threshold alerts: CRUD/authz on /api/alerts, and the evaluation
// semantics — notifications fire on STATE TRANSITIONS only, with the
// webhook as best-effort and every transition recorded in alert_events.
const request = require('supertest');
const { buildApp, seedUser, seedDatasource, seedModel, db } = require('./helpers/testApp');
const alertRunner = require('../utils/alertRunner');

const app = buildApp();
// Route tests register LIVE cron jobs (create/update hot-reload) — stop
// them or the open handles keep the Jest worker alive forever.
afterAll(() => alertRunner.stopAll());

const MEASURES = [{ name: 'items.amt_sum', table: 'items', column: 'amt', aggregation: 'sum', label: 'total' }];

function seedContext() {
  const owner = seedUser({ role: 'editor' });
  const ds = seedDatasource({ userId: owner });
  const model = seedModel({ userId: owner, datasourceId: ds, measures: MEASURES });
  return { owner, model };
}

const validBody = (model) => ({
  name: 'CA trop bas',
  modelId: model,
  measureName: 'items.amt_sum',
  op: 'lt',
  threshold: 100,
  cronExpression: '*/15 * * * *',
});

const create = (user, body) => request(app).post('/api/alerts').set('x-test-user', user).send(body);

describe('POST /api/alerts — validation and access', () => {
  test('creates a valid alert', async () => {
    const { owner, model } = seedContext();
    const res = await create(owner, validBody(model));
    expect(res.status).toBe(201);
    expect(res.body.alert.enabled).toBe(true);
    expect(res.body.alert.last_state).toBeNull();
  });

  test('rejects bad shapes with explicit messages', async () => {
    const { owner, model } = seedContext();
    const cases = [
      [{ ...validBody(model), op: 'contains' }, /"op"/],
      [{ ...validBody(model), threshold: 'NaN' }, /"threshold"/],
      [{ ...validBody(model), cronExpression: 'every day' }, /cron/i],
      [{ ...validBody(model), measureName: 'items.nope' }, /not in the model/],
      [{ ...validBody(model), name: '' }, /"name"/],
      [{ ...validBody(model), webhookUrl: 'ftp://x/y' }, /http/],
    ];
    for (const [body, pattern] of cases) {
      const res = await create(owner, body);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(pattern);
    }
  });

  test("a model the caller can't read is a 404", async () => {
    const { model } = seedContext();
    const stranger = seedUser({ role: 'editor' });
    const res = await create(stranger, validBody(model));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Model not found/);
  });

  test('webhook host block-list applies when enforced', async () => {
    const { owner, model } = seedContext();
    process.env.OPENREPORT_BLOCK_INTERNAL_HOSTS = '1';
    try {
      const res = await create(owner, { ...validBody(model), webhookUrl: 'http://169.254.169.254/hook' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/not reachable/);
    } finally {
      delete process.env.OPENREPORT_BLOCK_INTERNAL_HOSTS;
    }
  });
});

describe('ownership', () => {
  test("a stranger can't update, run or delete; an admin can", async () => {
    const { owner, model } = seedContext();
    const id = (await create(owner, validBody(model))).body.alert.id;
    const stranger = seedUser({ role: 'editor' });
    const admin = seedUser({ role: 'admin' });

    expect((await request(app).put(`/api/alerts/${id}`).set('x-test-user', stranger).send({ name: 'x' })).status).toBe(403);
    expect((await request(app).post(`/api/alerts/${id}/run`).set('x-test-user', stranger)).status).toBe(403);
    expect((await request(app).delete(`/api/alerts/${id}`).set('x-test-user', stranger)).status).toBe(403);
    expect((await request(app).put(`/api/alerts/${id}`).set('x-test-user', admin).send({ name: 'renamed' })).status).toBe(200);
  });

  test('listing scopes to the caller (admin sees all, labelled)', async () => {
    const { owner, model } = seedContext();
    await create(owner, validBody(model));
    const other = seedUser({ role: 'editor' });
    const mine = await request(app).get('/api/alerts').set('x-test-user', other);
    expect(mine.body.alerts).toHaveLength(0);
    const admin = seedUser({ role: 'admin' });
    const all = await request(app).get('/api/alerts').set('x-test-user', admin);
    expect(all.body.alerts.length).toBeGreaterThan(0);
    // The admin console labels rows without extra fetches.
    const row = all.body.alerts.find((a) => a.model_id === model);
    expect(row.owner_email).toContain('@');
    expect(row.model_name).toBe('m');
  });
});

describe('runOne — transition semantics', () => {
  const seedAlert = (over = {}) => {
    const { owner, model } = seedContext();
    const id = 'al-' + Math.random().toString(36).slice(2);
    db.prepare(`INSERT INTO alerts (id, user_id, model_id, name, measure_name, op, threshold,
                  cron_expression, webhook_url, enabled, notify_on_recover)
                VALUES (?, ?, ?, 'a', 'items.amt_sum', 'gt', 100, '*/15 * * * *', ?, 1, ?)`)
      .run(id, owner, model, over.webhook === false ? null : 'http://example.test/hook', over.notifyOnRecover === false ? 0 : 1);
    return id;
  };
  // rowid = insertion order — created_at only has second precision, and
  // two events in the same second would tie-break on random uuids.
  const events = (id) => db.prepare('SELECT state, message FROM alert_events WHERE alert_id = ? ORDER BY rowid').all(id);

  test('ok→triggered notifies once; staying triggered stays silent', async () => {
    const id = seedAlert();
    const calls = [];
    const deps = {
      fireQuery: async () => [{ total: 150 }],
      postWebhook: async (url, payload) => { calls.push(payload); return null; },
    };
    const r1 = await alertRunner.runOne(id, deps);
    expect(r1).toMatchObject({ state: 'triggered', value: 150, notified: true, transition: true });
    const r2 = await alertRunner.runOne(id, deps);
    expect(r2).toMatchObject({ state: 'triggered', notified: false, transition: false });
    expect(calls).toHaveLength(1);
    expect(calls[0].state).toBe('triggered');
    expect(events(id).map((e) => e.state)).toEqual(['triggered']);
  });

  test('triggered→ok records a recovery (webhook honours notify_on_recover)', async () => {
    const id = seedAlert();
    const calls = [];
    const deps = { fireQuery: async () => [{ total: 150 }], postWebhook: async (u, p) => { calls.push(p); return null; } };
    await alertRunner.runOne(id, deps);
    await alertRunner.runOne(id, { ...deps, fireQuery: async () => [{ total: 50 }] });
    expect(calls.map((c) => c.state)).toEqual(['triggered', 'recovered']);
    expect(events(id).map((e) => e.state)).toEqual(['triggered', 'recovered']);

    const silent = seedAlert({ notifyOnRecover: false });
    const calls2 = [];
    const deps2 = { fireQuery: async () => [{ total: 150 }], postWebhook: async (u, p) => { calls2.push(p); return null; } };
    await alertRunner.runOne(silent, deps2);
    await alertRunner.runOne(silent, { ...deps2, fireQuery: async () => [{ total: 50 }] });
    expect(calls2.map((c) => c.state)).toEqual(['triggered']); // no recover webhook…
    expect(events(silent).map((e) => e.state)).toEqual(['triggered', 'recovered']); // …but the history has it
  });

  test('a failing query lands in error state, once, without webhook', async () => {
    const id = seedAlert();
    const calls = [];
    const deps = {
      fireQuery: async () => { throw new Error('source down'); },
      postWebhook: async (u, p) => { calls.push(p); return null; },
    };
    const r = await alertRunner.runOne(id, deps);
    expect(r.state).toBe('error');
    await alertRunner.runOne(id, deps); // same state — no second event
    expect(calls).toHaveLength(0);
    expect(events(id)).toEqual([{ state: 'error', message: 'source down' }]);
    const row = db.prepare('SELECT last_state, last_error FROM alerts WHERE id = ?').get(id);
    expect(row).toEqual({ last_state: 'error', last_error: 'source down' });
  });

  test('the value resolves by measure LABEL, with numeric fallback', async () => {
    const id = seedAlert();
    const byLabel = await alertRunner.runOne(id, { fireQuery: async () => [{ total: 250 }], postWebhook: async () => null });
    expect(byLabel.value).toBe(250);
    db.prepare("UPDATE alerts SET last_state = NULL WHERE id = ?").run(id);
    const fallback = await alertRunner.runOne(id, { fireQuery: async () => [{ anything: '42' }], postWebhook: async () => null });
    expect(fallback.value).toBe(42);
  });

  test('a webhook failure is recorded but never blocks the transition', async () => {
    const id = seedAlert();
    const r = await alertRunner.runOne(id, {
      fireQuery: async () => [{ total: 150 }],
      postWebhook: async () => 'webhook failed: ECONNREFUSED',
    });
    expect(r).toMatchObject({ state: 'triggered', notified: false });
    expect(events(id)[0].message).toMatch(/ECONNREFUSED/);
  });

  test('disabled alerts are skipped', async () => {
    const id = seedAlert();
    db.prepare('UPDATE alerts SET enabled = 0 WHERE id = ?').run(id);
    const r = await alertRunner.runOne(id, { fireQuery: async () => [{ total: 150 }] });
    expect(r.skipped).toBe(true);
  });

  // The extra-channel hook (cloud e-mail) rides the same transitions as the
  // webhook: fired on triggered, on recovered only when opted in, never on
  // error; a failure is a note on the event, not a blocked transition.
  test('the notify channel follows the webhook transitions and failures are noted', async () => {
    const id = seedAlert({ webhook: false });
    const sent = [];
    const deps = {
      fireQuery: async () => [{ total: 150 }],
      notify: async ({ state, value, payload }) => { sent.push([state, value, payload.alert]); return { delivered: true, note: null }; },
    };
    const r1 = await alertRunner.runOne(id, deps);
    expect(r1).toMatchObject({ state: 'triggered', notified: true });
    await alertRunner.runOne(id, { ...deps, fireQuery: async () => [{ total: 50 }] });
    expect(sent).toEqual([['triggered', 150, 'a'], ['recovered', 50, 'a']]);

    const silent = seedAlert({ webhook: false, notifyOnRecover: false });
    const sent2 = [];
    const deps2 = { ...deps, notify: async ({ state }) => { sent2.push(state); return { delivered: true, note: null }; } };
    await alertRunner.runOne(silent, deps2);
    await alertRunner.runOne(silent, { ...deps2, fireQuery: async () => [{ total: 50 }] });
    expect(sent2).toEqual(['triggered']);

    const broken = seedAlert();
    const r = await alertRunner.runOne(broken, {
      fireQuery: async () => [{ total: 150 }],
      postWebhook: async () => null,
      notify: async () => { throw new Error('smtp down'); },
    });
    // the webhook went through → notified; the e-mail note is kept
    expect(r).toMatchObject({ state: 'triggered', notified: true });
    expect(events(broken)[0].message).toMatch(/smtp down/);

    // a channel with nothing to deliver (no recipients) is not a notification
    const idle = seedAlert({ webhook: false });
    const r2 = await alertRunner.runOne(idle, {
      fireQuery: async () => [{ total: 150 }],
      notify: async () => ({ delivered: false, note: null }),
    });
    expect(r2).toMatchObject({ state: 'triggered', notified: false });
    expect(events(idle)[0].message).toBeNull();
  });
});

describe('listAlerts / canManageAlert hooks — scoping is delegated when set', () => {
  const cloudHooks = require('../cloudHooks');
  afterEach(() => { cloudHooks.listAlerts = null; cloudHooks.canManageAlert = null; });

  test('the hooks replace the OSS owner-or-admin rules', async () => {
    const { owner, model } = seedContext();
    const created = await create(owner, validBody(model));
    expect(created.status).toBe(201);
    const id = created.body.alert.id;

    cloudHooks.listAlerts = () => [];
    cloudHooks.canManageAlert = () => false;
    const list = await request(app).get('/api/alerts').set('x-test-user', owner);
    expect(list.body.alerts).toEqual([]); // even the owner sees nothing when the hook says so
    const put = await request(app).put(`/api/alerts/${id}`).set('x-test-user', owner).send({ name: 'x' });
    expect(put.status).toBe(403);
    const run = await request(app).post(`/api/alerts/${id}/run`).set('x-test-user', owner);
    expect(run.status).toBe(403);

    cloudHooks.canManageAlert = (alert, user) => alert.user_id === user.id;
    const put2 = await request(app).put(`/api/alerts/${id}`).set('x-test-user', owner).send({ name: 'y' });
    expect(put2.status).toBe(200);
  });
});

describe('validateAlertExtras hook — extra columns on create and update', () => {
  const cloudHooks = require('../cloudHooks');
  afterEach(() => { cloudHooks.validateAlertExtras = null; });

  test('the hook can reject, and its fields land in the row on POST and PUT', async () => {
    db.exec('ALTER TABLE alerts ADD COLUMN extra_channel TEXT');
    cloudHooks.validateAlertExtras = (body) => {
      if (body.channel === 'bad') return { error: 'channel rejected' };
      return body.channel !== undefined ? { fields: { extra_channel: body.channel } } : {};
    };
    const { owner, model } = seedContext();
    const bad = await create(owner, { ...validBody(model), channel: 'bad' });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('channel rejected');

    const ok = await create(owner, { ...validBody(model), channel: 'mail' });
    expect(ok.status).toBe(201);
    expect(db.prepare('SELECT extra_channel FROM alerts WHERE id = ?').get(ok.body.alert.id).extra_channel).toBe('mail');

    const put = await request(app).put(`/api/alerts/${ok.body.alert.id}`).set('x-test-user', owner).send({ channel: 'sms' });
    expect(put.status).toBe(200);
    expect(db.prepare('SELECT extra_channel FROM alerts WHERE id = ?').get(ok.body.alert.id).extra_channel).toBe('sms');
  });
});
