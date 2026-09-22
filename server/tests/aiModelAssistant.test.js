jest.mock('../utils/ai/providers', () => ({
  ...jest.requireActual('../utils/ai/providers'),
  chat: jest.fn(),
}));

const request = require('supertest');
const providers = require('../utils/ai/providers');
const { setAiConfig } = require('../utils/settingsHelper');
const { cleanDraft, validateModelProposal, arrangeTables } = require('../utils/ai/modelAssistant');
const { buildApp, seedUser, seedDatasource, seedModel, seedReport, seedWorkspace, db } = require('./helpers/testApp');

const app = buildApp();
const say = (text) => ({ text, toolCalls: [], usage: null });
const call = (name, args) => ({ text: '', toolCalls: [{ id: `c_${name}`, name, args, argsError: null }], usage: null });

// orders (a fact) points to customers and products (dimensions).
const DRAFT = {
  tables: {
    orders: [{ column: 'id', type: 'integer' }, { column: 'customer_id', type: 'integer' }, { column: 'product_id', type: 'integer' }, { column: 'amount', type: 'numeric' }, { column: 'ordered_at', type: 'date' }],
    customers: [{ column: 'id', type: 'integer' }, { column: 'name', type: 'text' }, { column: 'country', type: 'text' }],
    products: [{ column: 'id', type: 'integer' }, { column: 'label', type: 'text' }],
  },
  joins: [],
  roles: {},
  dimensions: [{ table: 'customers', column: 'name' }],
  measures: [{ table: 'orders', column: 'amount', aggregation: 'sum' }],
};
const ALL = { joins: true, fields: true, measures: true, tableRoles: true, layout: true };
const J = (f, fc, t, tc, cardinality = 'many-to-one') => ({ fromTable: f, fromColumn: fc, toTable: t, toColumn: tc, cardinality });

describe('what the model assistant may propose', () => {
  const draft = () => cleanDraft(DRAFT);

  test('the draft is re-projected: only names, types, joins and flags of the tables sent', () => {
    const d = cleanDraft({ ...DRAFT, rows: [{ secret: 1 }], joins: [{ from_table: 'orders', from_column: 'nope', to_table: 'customers', to_column: 'id' }], roles: { orders: 'fact', ghost: 'fact' } });
    expect(Object.keys(d.tables)).toEqual(['orders', 'customers', 'products']);
    expect(d.joins).toEqual([]);
    expect(d.roles).toEqual({ orders: 'fact' });
    expect(d).not.toHaveProperty('rows');
    expect(cleanDraft({ tables: {} })).toBeNull();
  });

  test('a star schema: joins, roles, flags and measures, checked against the tables', () => {
    const { payload, errors } = validateModelProposal({
      reading: ALL,
      summary: 'Star schema around orders.',
      joins: [J('orders', 'customer_id', 'customers', 'id'), J('orders', 'product_id', 'products', 'id')],
      tableRoles: [{ table: 'orders', role: 'fact' }, { table: 'customers', role: 'dimension' }, { table: 'products', role: 'dimension' }],
      fields: [{ table: 'orders', column: 'ordered_at', as: 'dimension' }, { table: 'orders', column: 'customer_id', as: 'none' }],
      measures: [{ table: 'orders', column: 'id', aggregation: 'count', label: 'Orders' }, { table: 'orders', column: 'amount', aggregation: 'avg' }],
    }, draft());
    expect(errors).toEqual([]);
    expect(payload.joins).toEqual([
      { from_table: 'orders', from_column: 'customer_id', to_table: 'customers', to_column: 'id', cardinality: { from: '*', to: '1' } },
      { from_table: 'orders', from_column: 'product_id', to_table: 'products', to_column: 'id', cardinality: { from: '*', to: '1' } },
    ]);
    expect(payload.tableRoles).toEqual({ orders: 'fact', customers: 'dimension', products: 'dimension' });
    expect(payload.measures).toEqual([{ table: 'orders', column: 'id', aggregation: 'count', label: 'Orders' }, { table: 'orders', column: 'amount', aggregation: 'avg', label: '' }]);
    // The fact in the middle, its dimensions on either side.
    expect(payload.positions.orders.x).toBeGreaterThan(payload.positions.customers.x);
    expect(payload.positions.products.x).toBeGreaterThan(payload.positions.orders.x);
  });

  test.each([
    ['a column that does not exist', { joins: [J('orders', 'client_id', 'customers', 'id')] }, /not a column of the tables/],
    ['a table joined to itself', { joins: [J('orders', 'id', 'orders', 'customer_id')] }, /cannot be joined to itself/],
    ['a second join between the same two tables', { joins: [J('orders', 'customer_id', 'customers', 'id'), J('orders', 'id', 'customers', 'id')] }, /already joined/],
    ['a loop of relations', { joins: [J('orders', 'customer_id', 'customers', 'id'), J('customers', 'id', 'products', 'id'), J('products', 'id', 'orders', 'product_id')] }, /would make a loop of relations/],
    ['an aggregation that is not one', { measures: [{ table: 'orders', column: 'amount', aggregation: 'SUM(amount) * 2' }] }, /aggregation among sum, avg, count, min, max/],
    ['a role that is not one', { tableRoles: [{ table: 'orders', role: 'bridge' }] }, /role fact or dimension/],
  ])('%s is refused', (_what, args, message) => {
    const { errors } = validateModelProposal({ reading: ALL, ...args }, draft());
    expect(errors.join(' ')).toMatch(message);
  });

  // Seen on a real model with two fact tables: both point to the same date and
  // client dimensions. That is no loop — the diagram accepts it by hand.
  test('several facts may share a dimension', () => {
    const d = cleanDraft({
      tables: {
        calls: [{ column: 'date_id', type: 'int' }, { column: 'client_id', type: 'int' }],
        availability: [{ column: 'date_id', type: 'int' }, { column: 'client_id', type: 'int' }],
        dates: [{ column: 'id', type: 'int' }],
        clients: [{ column: 'id', type: 'int' }],
      },
    });
    const { payload, errors } = validateModelProposal({
      reading: ALL,
      joins: [J('calls', 'date_id', 'dates', 'id'), J('calls', 'client_id', 'clients', 'id'), J('availability', 'date_id', 'dates', 'id'), J('availability', 'client_id', 'clients', 'id')],
    }, d);
    expect(errors).toEqual([]);
    expect(payload.joins).toHaveLength(4);
  });

  // The same real model: dimension-to-dimension joins on a client id, each a
  // second way from the fact to the clients.
  test('a join that makes a second way between two tables is refused', () => {
    const d = cleanDraft({
      tables: {
        calls: [{ column: 'client_id', type: 'int' }, { column: 'caller_id', type: 'int' }],
        callers: [{ column: 'id', type: 'int' }, { column: 'client_id', type: 'int' }],
        clients: [{ column: 'id', type: 'int' }],
      },
    });
    const { payload, errors } = validateModelProposal({
      reading: ALL,
      joins: [J('calls', 'client_id', 'clients', 'id'), J('calls', 'caller_id', 'callers', 'id'), J('callers', 'client_id', 'clients', 'id')],
    }, d);
    expect(payload.joins.map((j) => j.to_table)).toEqual(['clients', 'callers']);
    expect(errors.join(' ')).toMatch(/second way from calls to clients/);
  });

  // Asked for the joins only, a model that also re-flags every column and
  // moves the tables has its reading to answer to.
  test('only what the reading allows is applied', () => {
    const { payload } = validateModelProposal({
      reading: { joins: true, fields: false, measures: false, tableRoles: false, layout: false },
      joins: [J('orders', 'customer_id', 'customers', 'id')],
      fields: [{ table: 'orders', column: 'amount', as: 'none' }],
      tableRoles: [{ table: 'orders', role: 'fact' }],
    }, draft());
    expect(payload.joins).toHaveLength(1);
    expect(payload.fields).toEqual([]);
    expect(payload.tableRoles).toEqual({});
    expect(payload.positions).toBeNull();
  });

  test('an unjoined table is laid out below the star', () => {
    const pos = arrangeTables({ a: [], b: [], lone: [] }, [{ from_table: 'a', from_column: 'x', to_table: 'b', to_column: 'y' }], { a: 'fact' });
    expect(pos.lone.y).toBeGreaterThan(pos.b.y);
  });
});

describe('POST /api/ai/models/:id/model-chat', () => {
  let owner, editor, model;
  beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    owner = seedUser({ role: 'editor' });
    editor = seedUser({ role: 'editor' });
    model = seedModel({ userId: owner, datasourceId: seedDatasource({ userId: owner }) });
    // A workspace editor may build reports on the model — not change it.
    const ws = seedWorkspace({ ownerId: owner });
    db.prepare('INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?,?,?)').run(ws, editor, 'editor');
    seedReport({ userId: owner, modelId: model, workspaceId: ws });
  });
  afterAll(() => { jest.restoreAllMocks(); });
  beforeEach(() => {
    providers.chat.mockReset();
    setAiConfig({ provider: 'openai-compat', baseUrl: 'http://llm.test/v1', model: 'm', enabled: true, dataSharing: 'schema' });
  });
  const send = (uid, body) => request(app).post(`/api/ai/models/${model}/model-chat`).set('x-test-user', uid).send(body);
  const ask = (text) => ({ messages: [{ role: 'user', text }], draft: DRAFT });

  test('only who may change the model; a draft with no table is a 400', async () => {
    expect((await send(editor, ask('Join the tables'))).status).toBe(403);
    expect((await send(owner, { messages: [{ role: 'user', text: 'x' }], draft: { tables: {} } })).status).toBe(400);
    expect(providers.chat).not.toHaveBeenCalled();
  });

  test('the prompt shows names, types and flags; the proposal comes back, applied nowhere', async () => {
    providers.chat.mockResolvedValueOnce(call('propose_model_changes', { reading: { joins: true, fields: false, measures: false, tableRoles: false, layout: false }, summary: 'Join orders to customers.', joins: [J('orders', 'customer_id', 'customers', 'id')] }));
    const res = await send(owner, ask('Relie les commandes aux clients'));
    const { system, tools } = providers.chat.mock.calls[0][0];
    expect(system).toContain('- customers: id integer, name text D, country text');
    expect(system).toContain('amount numeric M:sum');
    expect(tools.map((t) => t.name).filter((n) => n !== 'read_help')).toEqual(['propose_model_changes']);
    expect(res.body.proposals[0]).toMatchObject({ kind: 'model', joins: [{ from_table: 'orders', to_table: 'customers' }] });
    expect(JSON.parse(db.prepare('SELECT joins FROM models WHERE id = ?').get(model).joins)).toEqual([]);
  });

  test('a mistake goes back once, with what to fix', async () => {
    providers.chat
      .mockResolvedValueOnce(call('propose_model_changes', { reading: ALL, summary: 's', joins: [J('orders', 'client', 'customers', 'id')] }))
      .mockResolvedValueOnce(call('propose_model_changes', { reading: ALL, summary: 's', joins: [J('orders', 'customer_id', 'customers', 'id')] }));
    const res = await send(owner, ask('Join the tables'));
    expect(providers.chat.mock.calls[1][0].messages.find((m) => m.role === 'tool').content).toMatch(/Fix these.*not a column/);
    expect(res.body.proposals[0].joins).toHaveLength(1);
  });

  test('a plain answer stays a plain answer', async () => {
    providers.chat.mockResolvedValueOnce(say('Orders is your fact table.'));
    expect((await send(owner, ask('Which table is the fact?'))).body).toEqual({ reply: 'Orders is your fact table.', proposals: [] });
  });
});
