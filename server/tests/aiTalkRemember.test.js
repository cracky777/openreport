// What Let's Talk learns from the user about the model's fields: the assistant
// declares what was confirmed (utils/ai/remember.js), the field is looked up in
// the schema, and a card the user applies writes it to the glossary.
jest.mock('../utils/ai/providers', () => ({
  ...jest.requireActual('../utils/ai/providers'),
  chat: jest.fn(),
}));
jest.mock('../utils/ai/cardinality', () => ({ dimensionCardinality: jest.fn() }));

const request = require('supertest');
const providers = require('../utils/ai/providers');
const { dimensionCardinality } = require('../utils/ai/cardinality');
const { setAiConfig } = require('../utils/settingsHelper');
const { buildApp, seedUser, seedDatasource, seedModel, db } = require('./helpers/testApp');

const app = buildApp();
const call = (name, args) => ({ text: '', toolCalls: [{ id: `c_${name}`, name, args, argsError: null }], usage: null });
const BAR = { type: 'bar', title: 'Amount by label', rationale: 'r', binding: { selectedDimensions: ['items.label'], selectedMeasures: ['items.amt_sum'] } };

describe("Let's Talk remembers what the user says of the fields", () => {
  let owner, model;
  beforeAll(() => {
    owner = seedUser({ role: 'editor' });
    model = seedModel({ userId: owner, datasourceId: seedDatasource({ userId: owner }) });
  });
  beforeEach(() => {
    providers.chat.mockReset();
    dimensionCardinality.mockResolvedValue({});
    setAiConfig({ provider: 'openai-compat', baseUrl: 'http://llm.test/v1', model: 'm', enabled: true, dataSharing: 'schema' });
  });
  const talk = () => request(app).post(`/api/ai/models/${model}/chat`).set('x-test-user', owner)
    .send({ messages: [{ role: 'user', text: 'yes, label is the product' }], talk: true });

  test('with a visual: the fields of the schema are kept, the user\'s words bounded, the rest refused', async () => {
    const remember = [
      { field: 'items.label', synonyms: ['produit', 'article', 'produit'], description: 'The product sold' },
      { field: 'items.nope', synonyms: ['x'] },
    ];
    // An unknown field goes back once for a fix, like any field of a proposal; then the valid ones stay.
    providers.chat.mockResolvedValueOnce(call('propose_widgets', { widgets: [BAR], remember })).mockResolvedValueOnce(call('propose_widgets', { widgets: [BAR], remember }));
    const [proposal] = (await talk()).body.proposals;
    expect(proposal.remember).toEqual([{ field: 'items.label', label: 'label', synonyms: ['produit', 'article'], description: 'The product sold' }]);
    expect(providers.chat.mock.calls[0][0].system).toMatch(/offer to remember it/);
  });

  test('without a visual: a card of its own, which the glossary route then applies', async () => {
    providers.chat.mockResolvedValueOnce(call('propose_action', { userAsked: 'do', action: 'remember_fields', summary: 'Noted', remember: [{ field: 'items.amt_sum', synonyms: ['CA'] }] }));
    const [card] = (await talk()).body.proposals;
    expect(card).toMatchObject({ kind: 'action', action: 'remember_fields', modelId: model, remember: [{ field: 'items.amt_sum', synonyms: ['CA'] }] });

    const put = await request(app).put(`/api/models/${model}/glossary`).set('x-test-user', owner)
      .send({ fields: { [card.remember[0].field]: { synonyms: card.remember[0].synonyms } } });
    expect(put.status).toBe(200);
    const measures = JSON.parse(db.prepare('SELECT measures FROM models WHERE id = ?').get(model).measures);
    expect(measures.find((m) => m.name === 'items.amt_sum').synonyms).toEqual(['CA']);

    providers.chat.mockReset();
    providers.chat.mockResolvedValueOnce(call('propose_action', { userAsked: 'do', action: 'remember_fields', summary: 'x', remember: [{ field: 'items.nope' }] }))
      .mockResolvedValueOnce({ text: 'ok', toolCalls: [], usage: null });
    const refused = await talk();
    expect(refused.body.proposals).toEqual([]);
    expect(providers.chat.mock.calls[1][0].messages.find((m) => m.role === 'tool').content).toMatch(/not a field of the model/);
  });
});
