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
