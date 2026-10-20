jest.mock('../utils/ai/providers', () => ({
  ...jest.requireActual('../utils/ai/providers'),
  chat: jest.fn(),
}));

const request = require('supertest');
const providers = require('../utils/ai/providers');
const { setAiConfig } = require('../utils/settingsHelper');
const { cleanDraft, validateModelProposal, arrangeTables, readTableColumns } = require('../utils/ai/modelAssistant');
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

  test('a date column takes its breakdowns; a text column or a measure cannot', () => {
    const { payload, errors } = validateModelProposal({ reading: ALL, summary: 's', fields: [
      { table: 'orders', column: 'ordered_at', as: 'dimension', dateParts: ['year_month', 'week', 'year_month', 'decade'] },
      { table: 'customers', column: 'name', as: 'dimension', dateParts: ['year'] },
      { table: 'orders', column: 'ordered_at', as: 'measure', dateParts: ['year'] },
    ] }, draft());
    expect(payload.fields).toEqual([{ table: 'orders', column: 'ordered_at', as: 'dimension', dateParts: ['year_month', 'week'] }]);
    expect(errors).toHaveLength(2);
    expect(errors.join(' ')).toMatch(/dateParts go on a date or timestamp column flagged as dimension/);
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
    ['an aggregation that is not one', { measures: [{ table: 'orders', column: 'amount', aggregation: 'SUM(amount) * 2' }] }, /aggregation among sum, avg, count, count_distinct, min, max/],
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

describe('adding tables of the source', () => {
  const NEW_MODEL = { tables: {}, available: ['orders', 'customers', 'audit_log'] };

  test('a model with no table yet has a draft: the tables it may add', () => {
    const d = cleanDraft(NEW_MODEL);
    expect(d.tables).toEqual({});
    expect(d.available).toEqual(['orders', 'customers', 'audit_log']);
    // A table already in the model is not offered again.
    expect(cleanDraft({ ...DRAFT, available: ['orders', 'regions'] }).available).toEqual(['regions']);
  });

  test('only tables the source offered, and only when the reading asks for tables', () => {
    const { payload, errors } = validateModelProposal({
      reading: { tables: true }, summary: 's', addTables: ['orders', 'customers', 'orders', 'pg_shadow'],
    }, cleanDraft(NEW_MODEL));
    expect(payload.addTables).toEqual(['orders', 'customers']);
    expect(errors).toEqual([expect.stringMatching(/pg_shadow.*not a table of the source/)]);
    expect(validateModelProposal({ reading: { tables: false }, summary: 's', addTables: ['orders'] }, cleanDraft(NEW_MODEL)).payload).toBeNull();
  });

  test('columns are read only for tables the source offered, ten at most', async () => {
    const read = jest.fn(async (t) => [{ column_name: 'id', data_type: 'integer' }, { column_name: `${t}_name`, data_type: 'text' }]);
    const draft = cleanDraft({ tables: {}, available: Array.from({ length: 12 }, (_, i) => `t${i}`) });
    const out = await readTableColumns(['t0', 'nope', ...draft.available], draft, read);
    expect(read.mock.calls.map(([t]) => t)).toEqual(['t0', 't1', 't2', 't3', 't4', 't5', 't6', 't7', 't8', 't9']);
    expect(out.columns.t0).toEqual(['id integer', 't0_name text']);
    expect(await readTableColumns(['nope'], draft, read)).toHaveProperty('error');
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

  test('a model with no table: the tables of the source are named, and the card adds some', async () => {
    providers.chat.mockResolvedValueOnce(call('propose_model_changes', { reading: { tables: true }, summary: 'Add orders and customers.', addTables: ['orders', 'customers'] }));
    const res = await send(owner, { messages: [{ role: 'user', text: 'Sales by country' }], draft: { tables: {}, available: ['orders', 'customers', 'audit_log'] } });
    expect(res.status).toBe(200);
    const { system, tools } = providers.chat.mock.calls[0][0];
    expect(system).toContain('Other tables of the source (not in the model): "orders", "customers", "audit_log"');
    expect(tools.map((t) => t.name)).toContain('read_table_columns');
    expect(res.body.proposals[0]).toMatchObject({ kind: 'model', addTables: ['orders', 'customers'] });
  });

  test('a plain answer stays a plain answer', async () => {
    providers.chat.mockResolvedValueOnce(say('Orders is your fact table.'));
    expect((await send(owner, ask('Which table is the fact?'))).body).toEqual({ reply: 'Orders is your fact table.', proposals: [] });
  });
});

// Reshaping a file table (utils/fileShape.js): offered only to a caller that
// can apply the card (`shapes: true`), on a model built on imported files; the
// first rows are readable only where the instance shares data values.
describe('hand_to_report', () => {
  let owner, model;
  const DRAFT = { tables: { orders: [{ column: 'id', type: 'INTEGER' }, { column: 'amount', type: 'DOUBLE' }, { column: 'cost', type: 'DOUBLE' }] }, joins: [], roles: {}, dimensions: [], measures: [] };
  beforeAll(() => { owner = seedUser({ role: 'editor' }); model = seedModel({ userId: owner, datasourceId: seedDatasource({ userId: owner }) }); });
  beforeEach(() => { providers.chat.mockReset(); setAiConfig({ provider: 'openai-compat', baseUrl: 'http://llm.test/v1', model: 'm', enabled: true, dataSharing: 'schema' }); });
  const send = (body) => request(app).post(`/api/ai/models/${model}/model-chat`).set('x-test-user', owner).send({ messages: [{ role: 'user', text: 'Add a margin column: amount minus cost' }], draft: DRAFT, ...body });

  test('beside a report, what is the report\'s is handed to its assistant as a card', async () => {
    providers.chat.mockResolvedValueOnce(call('hand_to_report', { summary: 'The report assistant adds the margin.', request: 'Add a margin measure: amount minus cost' }));
    const res = await send({ report: true });
    expect(res.status).toBe(200);
    const { system, tools } = providers.chat.mock.calls[0][0];
    expect(tools.map((t) => t.name)).toContain('hand_to_report');
    expect(system).toContain('Never send the user to the report editor');
    expect(res.body.proposals).toEqual([{ kind: 'action', action: 'open_report_assistant', summary: 'The report assistant adds the margin.', request: 'Add a margin measure: amount minus cost' }]);
  });

  test('without a report beside, the tool is not offered and the prompt points to the report editor', async () => {
    // A tool not offered is refused as a mistake; the model then answers in words.
    providers.chat
      .mockResolvedValueOnce(call('hand_to_report', { summary: 's', request: 'r' }))
      .mockResolvedValueOnce(say('Add it by hand in the report editor.'));
    const res = await send({});
    expect(res.status).toBe(200);
    const { system, tools } = providers.chat.mock.calls[0][0];
    expect(tools.map((t) => t.name)).not.toContain('hand_to_report');
    expect(system).toContain('by hand in the report editor');
    expect(res.body.proposals).toEqual([]);
    expect(res.body.reply).toBe('Add it by hand in the report editor.');
  });
});

describe('propose_file_shape', () => {
  let owner, model, seedSource;
  const BUDGET = {
    tables: { budget: [{ column: 'BP budget', type: 'VARCHAR' }, { column: 'column1', type: 'VARCHAR' }, { column: 'column2', type: 'VARCHAR' }] },
    joins: [], roles: {}, dimensions: [], measures: [],
  };
  const RECIPE = { summary: 'Months as rows.', table: 'budget', steps: [{ op: 'header', row: 2 }, { op: 'unpivot', keep: ['Compte'], name: 'Month', value: 'Amount' }, { op: 'calendar', name: 'calendar', column: 'Month' }] };
  beforeAll(async () => {
    owner = seedUser({ role: 'editor' });
    const up = await request(app).post('/api/upload').set('x-test-user', owner)
      .attach('file', Buffer.from('BP budget,,\nCompte,janv.-24,févr.-24\n601,100,110\n706,200,220\n'), 'budget.csv');
    expect(up.status).toBe(201);
    seedSource = up.body.datasource.id;
    model = seedModel({ userId: owner, datasourceId: up.body.datasource.id });
  });
  beforeEach(() => { providers.chat.mockReset(); });
  const send = (body, dataSharing = 'schema') => {
    setAiConfig({ provider: 'openai-compat', baseUrl: 'http://llm.test/v1', model: 'm', enabled: true, dataSharing });
    return request(app).post(`/api/ai/models/${model}/model-chat`).set('x-test-user', owner).send({ messages: [{ role: 'user', text: 'Make the budget joinable' }], draft: BUDGET, ...body });
  };

  test('without `shapes`, or on a database model, the tool is not offered', async () => {
    providers.chat.mockResolvedValueOnce(say('ok'));
    await send({});
    expect(providers.chat.mock.calls[0][0].tools.map((t) => t.name)).not.toContain('propose_file_shape');
  });

  test('the recipe comes back as a card with its steps in words; nothing is rewritten', async () => {
    providers.chat.mockResolvedValueOnce(call('propose_file_shape', RECIPE));
    const res = await send({ shapes: true });
    expect(res.status).toBe(200);
    const { system, tools } = providers.chat.mock.calls[0][0];
    expect(tools.map((t) => t.name)).toContain('propose_file_shape');
    expect(tools.map((t) => t.name)).not.toContain('read_table_sample');
    expect(system).toContain('Tables of imported files (may be reshaped): "budget"');
    expect(system).toContain('propose_file_shape');
    expect(res.body.proposals[0]).toMatchObject({
      kind: 'shape', table: 'budget', outputs: ['budget', 'calendar'],
      shape: { table: 'budget', output: 'budget', steps: [{ op: 'header', row: 2 }, { op: 'unpivot', keep: ['Compte'], name: 'Month', value: 'Amount' }, { op: 'calendar', name: 'calendar', column: 'Month' }] },
    });
    expect(res.body.proposals[0].lines[0]).toBe('Row 2 holds the column names; the rows above it are dropped');
    expect(res.body.proposals[0].sourceId).toBeTruthy();
    // The file is untouched: the as-imported columns are still what the source lists.
    const cols = await request(app).get(`/api/models/${model}/tables/budget/columns`).set('x-test-user', owner);
    expect(cols.body.columns.map((c) => c.column_name)).toEqual(['BP budget', 'column1', 'column2']);
  });

  test('a mistake goes back once; a table that is not a file table is refused', async () => {
    providers.chat
      .mockResolvedValueOnce(call('propose_file_shape', { ...RECIPE, table: 'orders' }))
      .mockResolvedValueOnce(call('propose_file_shape', { ...RECIPE, steps: [{ op: 'drop', columns: ['nope'] }] }));
    const res = await send({ shapes: true });
    expect(providers.chat.mock.calls[1][0].messages.find((m) => m.role === 'tool').content).toMatch(/not a table of an imported file/);
    expect(res.body.proposals).toEqual([]);
    expect(res.body.reply).toMatch(/Left out:.*not a column of budget/);
  });

  test('a model that has a calendar table gets no second one: the step is refused, the prompt names it', async () => {
    const withCalendar = { ...BUDGET, tables: { ...BUDGET.tables, calendar: [{ column: 'Date', type: 'DATE' }, { column: 'Year', type: 'INTEGER' }, { column: 'Month', type: 'INTEGER' }] } };
    providers.chat
      .mockResolvedValueOnce(call('propose_file_shape', { ...RECIPE, steps: [...RECIPE.steps.slice(0, 2), { op: 'calendar', name: 'budget_calendar', column: 'Month' }] }))
      .mockResolvedValueOnce(call('propose_file_shape', { ...RECIPE, steps: RECIPE.steps.slice(0, 2) }));
    setAiConfig({ provider: 'openai-compat', baseUrl: 'http://llm.test/v1', model: 'm', enabled: true, dataSharing: 'schema' });
    const res = await request(app).post(`/api/ai/models/${model}/model-chat`).set('x-test-user', owner).send({ messages: [{ role: 'user', text: 'Make the budget joinable' }], draft: withCalendar, shapes: true });
    expect(res.status).toBe(200);
    expect(providers.chat.mock.calls[0][0].system).toContain("This model already has one: calendar — never add another; join the fact's date column to calendar.Date");
    expect(providers.chat.mock.calls[1][0].messages.find((m) => m.role === 'tool').content).toMatch(/already has a calendar table, calendar/);
    expect(res.body.proposals[0]).toMatchObject({ kind: 'shape', outputs: ['budget'] });
  });

  test('a table already reshaped is reshaped again from the file: its recipe is shown, the calendar it made is kept', async () => {
    // Apply the recipe for real, as the Model tab does, then ask for more.
    // The file's first row became DuckDB's header: the real header is the first data row.
    const applied = [{ op: 'header', row: 1 }, RECIPE.steps[1], { op: 'map', column: 'Month', values: { 'janv.-24': '2024-01-01', 'févr.-24': '2024-02-01' } }, { op: 'cast', column: 'Month', type: 'date', format: '%Y-%m-%d' }, RECIPE.steps[2]];
    const first = await request(app).post(`/api/upload/${seedSource}/shape`).set('x-test-user', owner).send({ table: 'budget', shape: { steps: applied, output: 'budget' } });
    expect(first.body.error).toBeUndefined();
    expect(first.status).toBe(200);
    const shaped = { ...BUDGET, tables: {
      budget: [{ column: 'Compte', type: 'VARCHAR' }, { column: 'Month', type: 'VARCHAR' }, { column: 'Amount', type: 'VARCHAR' }],
      calendar: [{ column: 'Date', type: 'DATE' }, { column: 'Year', type: 'INTEGER' }, { column: 'Month', type: 'INTEGER' }],
    } };
    const again = { ...RECIPE, steps: [...applied.slice(0, 4), { op: 'dimension', name: 'comptes', key: 'Compte', columns: [] }, applied[4]] };
    providers.chat
      .mockResolvedValueOnce(call('propose_file_shape', { ...RECIPE, steps: applied.slice(0, 4) }))
      .mockResolvedValueOnce(call('propose_file_shape', again));
    setAiConfig({ provider: 'openai-compat', baseUrl: 'http://llm.test/v1', model: 'm', enabled: true, dataSharing: 'schema' });
    const res = await request(app).post(`/api/ai/models/${model}/model-chat`).set('x-test-user', owner).send({ messages: [{ role: 'user', text: 'Share the accounts' }], draft: shaped, shapes: true });
    expect(res.status).toBe(200);
    const { system, tools } = providers.chat.mock.calls[0][0];
    // The fact is reshapeable, the calendar it made is not a table of the file.
    expect(system).toContain('Tables of imported files (may be reshaped): "budget"');
    expect(system).toContain('"budget" is already reshaped from the file\'s table "budget" by this recipe: Row 1 holds the column names; the rows above it are dropped · Every column but Compte becomes a row: its name in Month, its value in Amount · Month: 2 values rewritten');
    expect(tools.map((t) => t.name)).toContain('propose_file_shape');
    // Dropping the calendar step would drop the model's calendar: refused once; the recipe is not checked against the reshaped columns.
    expect(providers.chat.mock.calls[1][0].messages.find((m) => m.role === 'tool').content).toMatch(/calendar, calendar, is made by this table's recipe/);
    expect(res.body.proposals[0]).toMatchObject({ kind: 'shape', table: 'budget', outputs: ['budget', 'comptes', 'calendar'], shape: { table: 'budget', steps: again.steps } });
    expect(res.body.proposals[0].lines).toContain('Table comptes: one row per Compte, for every fact that has one to share');
    await request(app).post(`/api/upload/${seedSource}/shape`).set('x-test-user', owner).send({ table: 'budget', shape: null });
  });

  test('the first rows are read only where data values are shared', async () => {
    providers.chat
      .mockResolvedValueOnce(call('read_table_sample', { table: 'budget', rows: 2 }))
      .mockResolvedValueOnce(say('Row 2 is the header.'));
    const res = await send({ shapes: true }, 'schema+cache');
    expect(res.body.reply).toBe('Row 2 is the header.');
    expect(providers.chat.mock.calls[0][0].tools.map((t) => t.name)).toContain('read_table_sample');
    const sample = JSON.parse(providers.chat.mock.calls[1][0].messages.find((m) => m.role === 'tool').content);
    expect(sample.columns).toEqual(['BP budget', 'column1', 'column2']);
    expect(sample.rows).toEqual([{ row: 1, cells: ['Compte', 'janv.-24', 'févr.-24'] }, { row: 2, cells: ['601', '100', '110'] }]);
  });
});
