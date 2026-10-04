jest.mock('../utils/ai/providers', () => ({
  ...jest.requireActual('../utils/ai/providers'),
  chat: jest.fn(),
}));

const request = require('supertest');
const providers = require('../utils/ai/providers');
const { setAiConfig } = require('../utils/settingsHelper');
const { parseHelp, helpTopics, readHelp } = require('../utils/ai/help');
const { buildApp, seedUser, seedDatasource, seedModel, seedReport } = require('./helpers/testApp');

const app = buildApp();
const say = (text) => ({ text, toolCalls: [], usage: null });
const call = (name, args) => ({ text: '', toolCalls: [{ id: `c_${name}`, name, args, argsError: null }], usage: null });

describe('the user guide the assistant answers "how do I…?" from', () => {
  test('sections are read by their heading', () => {
    const parsed = parseHelp('# Guide\n\n## a-b — First one\n- line\n\n## c - Second\n1. step\n## not a section heading\n');
    expect(parsed.map((s) => [s.id, s.title])).toEqual([['a-b', 'First one'], ['c', 'Second']]);
    expect(parsed[1].body).toBe('## c - Second\n1. step\n## not a section heading');
  });

  test('the shipped guide has the sections a question needs, and says how to schedule a report', () => {
    const ids = helpTopics().map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining(['schedules', 'alerts', 'sharing', 'export', 'datasources', 'models', 'ask']));
    expect(new Set(ids).size).toBe(ids.length);
    expect(readHelp(['schedules']).help).toMatch(/More actions \(⋮\) → Schedule refresh/);
    expect(readHelp(['nope']).error).toMatch(/One of: .*schedules/);
  });
});

describe('asked how to use OpenReport', () => {
  let owner, report;
  beforeAll(() => {
    owner = seedUser({ role: 'editor' });
    report = seedReport({ userId: owner, modelId: seedModel({ userId: owner, datasourceId: seedDatasource({ userId: owner }) }) });
  });
  beforeEach(() => {
    providers.chat.mockReset();
    setAiConfig({ provider: 'openai-compat', baseUrl: 'http://llm.test/v1', model: 'm', enabled: true, dataSharing: 'schema' });
  });
  const chat = (text, mode) => request(app).post(`/api/ai/reports/${report}/chat`).set('x-test-user', owner)
    .send({ messages: [{ role: 'user', text }], pageContext: { widgets: [] }, ...(mode ? { mode } : {}) });

  test('the guide is one tool away in every mode, and the answer comes from what it returned', async () => {
    for (const mode of [undefined, 'design']) {
      providers.chat.mockReset();
      providers.chat
        .mockResolvedValueOnce(call('read_help', { topics: ['schedules'] }))
        .mockResolvedValueOnce(say('1. More actions (⋮) → Schedule refresh.'));
      const res = await chat('Comment planifier un rapport ?', mode);
      const first = providers.chat.mock.calls[0][0];
      const tool = first.tools.find((t) => t.name === 'read_help');
      expect(tool.parameters.properties.topics.items.enum).toContain('schedules');
      expect(first.system).toContain('call `read_help`');
      expect(first.system).toContain('schedules (Scheduling a report)');
      const result = providers.chat.mock.calls[1][0].messages.find((m) => m.role === 'tool');
      expect(JSON.parse(result.content).help).toMatch(/Schedule refresh/);
      expect(res.body.reply).toBe('1. More actions (⋮) → Schedule refresh.');
    }
  });

  // Asked HOW, the user wanted to learn: a real model scheduled instead.
  test('a question gets the steps; a card only when the model read a request to do it', async () => {
    providers.chat
      .mockResolvedValueOnce(call('propose_action', { userAsked: 'how', action: 'schedule_cache_refresh', frequency: 'daily', summary: 's' }))
      .mockResolvedValueOnce(say('1. More actions (⋮) → Schedule refresh. Want me to set it up?'));
    const res = await chat('How do I schedule a report?');
    expect(providers.chat.mock.calls[1][0].messages.find((m) => m.role === 'tool').content).toMatch(/asked HOW/);
    expect(res.body.proposals).toEqual([]);
  });
});

// The help panel: no model, no report — a viewer or a newcomer asks how to use
// the tool, and only the guide is ever read.
describe('the help assistant', () => {
  let viewer;
  beforeAll(() => { viewer = seedUser({ role: 'viewer' }); });
  beforeEach(() => {
    providers.chat.mockReset();
    setAiConfig({ provider: 'openai-compat', baseUrl: 'http://llm.test/v1', model: 'm', enabled: true, dataSharing: 'schema+cache' });
  });
  const ask = (messages) => request(app).post('/api/ai/help/chat').set('x-test-user', viewer).send({ messages });

  test('answers a viewer from the guide, with read_help as its only tool', async () => {
    providers.chat
      .mockResolvedValueOnce(call('read_help', { topics: ['viewer'] }))
      .mockResolvedValueOnce(say('1. Open the report from Reports.'));
    const res = await ask([{ role: 'user', text: 'How do I read a report on my phone?' }]);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reply: '1. Open the report from Reports.', proposals: [] });
    const first = providers.chat.mock.calls[0][0];
    expect(first.tools.map((t) => t.name)).toEqual(['read_help']);
    expect(first.system).toContain('app role is viewer');
    const result = providers.chat.mock.calls[1][0].messages.find((m) => m.role === 'tool');
    expect(JSON.parse(result.content).help).toMatch(/## viewer/);
  });

  test('any other tool the model makes up is refused, never run', async () => {
    providers.chat
      .mockResolvedValueOnce(call('query_cache', { measures: ['x'] }))
      .mockResolvedValueOnce(say('I cannot read data here.'));
    await ask([{ role: 'user', text: 'What was revenue last year?' }]);
    const result = providers.chat.mock.calls[1][0].messages.find((m) => m.role === 'tool');
    expect(JSON.parse(result.content).error).toMatch(/Unknown tool/);
  });

  test('who may add data gets a card with the steps: the connection form, never the details in the chat', async () => {
    const editor = seedUser({ role: 'editor' });
    providers.chat
      .mockResolvedValueOnce(call('read_help', { topics: ['datasources'] }))
      .mockResolvedValueOnce(call('propose_action', { userAsked: 'how', action: 'connect_database', summary: 'Open the connection form.' }));
    const res = await request(app).post('/api/ai/help/chat').set('x-test-user', editor)
      .send({ messages: [{ role: 'user', text: 'Comment créer une connexion ?' }] });
    expect(res.body.proposals).toEqual([{ kind: 'action', action: 'connect_database', summary: 'Open the connection form.', request: '' }]);
    const first = providers.chat.mock.calls[0][0];
    expect(first.tools.map((t) => t.name)).toEqual(['read_help', 'propose_action']);
    expect(first.tools[1].parameters.properties.action.enum).toEqual(['connect_database', 'import_file', 'build_model']);
    expect(first.system).toMatch(/never in the chat/);
  });

  test('a viewer is offered no card, and one the model makes up anyway is refused', async () => {
    providers.chat
      .mockResolvedValueOnce(call('propose_action', { userAsked: 'do', action: 'import_file', summary: 's' }))
      .mockResolvedValueOnce(say('Ask an editor to import it.'));
    const res = await ask([{ role: 'user', text: 'Import my file' }]);
    expect(res.body).toEqual({ reply: 'Ask an editor to import it.', proposals: [] });
    expect(providers.chat.mock.calls[0][0].tools.map((t) => t.name)).toEqual(['read_help']);
  });

  test('closed to whoever has no assistant, and a malformed conversation is refused', async () => {
    expect((await ask([{ role: 'assistant', text: 'hi' }])).status).toBe(400);
    setAiConfig({ provider: 'openai-compat', baseUrl: 'http://llm.test/v1', model: 'm', enabled: false, dataSharing: 'schema' });
    expect((await ask([{ role: 'user', text: 'How do I share?' }])).status).toBe(409);
    expect(providers.chat).not.toHaveBeenCalled();
  });
});

describe('GET /api/help: the guide as a page, without the assistant', () => {
  test('any signed-in user reads every section, heading apart; nobody else', async () => {
    setAiConfig({ enabled: false });
    const viewer = seedUser({ role: 'viewer' });
    const res = await request(app).get('/api/help').set('x-test-user', viewer);
    expect(res.status).toBe(200);
    expect(res.body.sections.map((s) => s.id)).toEqual(helpTopics().map((t) => t.id));
    const sharing = res.body.sections.find((s) => s.id === 'sharing');
    expect(sharing.title).toBeTruthy();
    expect(sharing.body).not.toMatch(/^## /m);
    expect((await request(app).get('/api/help')).status).toBe(401);
  });
});
