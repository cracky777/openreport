// The business glossary: the catalogue of domains and roles, the attributes a
// field may carry (role, synonyms, description), who may add to them, and what
// of it the assistant is shown.
const request = require('supertest');
const domains = require('../utils/ai/domains');
const { sanitizeFieldMeta, applyGlossaryPatch } = require('../utils/glossary');
const { buildEffectiveModel, toPromptSchema, businessLines } = require('../utils/ai/effectiveModel');
const { buildSystemPrompt } = require('../utils/ai/prompt');
const { cleanDraft, validateModelProposal, buildModelPrompt } = require('../utils/ai/modelAssistant');
const { modelToYaml, yamlToModelFields } = require('../utils/modelYaml');
const { buildApp, seedUser, seedDatasource, seedModel, seedReport, seedWorkspace, db } = require('./helpers/testApp');

const app = buildApp();
const as = (uid) => (r) => r.set('x-test-user', uid);

describe('the catalogue', () => {
  test('ids are unique, every role has a known kind, every domain a required role', () => {
    const ids = domains.DOMAINS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const d of domains.DOMAINS) {
      expect(['function', 'sector']).toContain(d.kind);
      const roleIds = d.roles.map((r) => r.id);
      expect(new Set(roleIds).size).toBe(roleIds.length);
      expect(d.roles.some((r) => r.required)).toBe(true);
      for (const r of d.roles) expect(domains.ROLE_KINDS).toContain(r.kind);
    }
  });

  test('a role fits the kind of field it is made for', () => {
    expect(domains.roleFits('ecommerce.revenue', 'measure')).toBe(true);
    expect(domains.roleFits('ecommerce.revenue', 'dimension')).toBe(false);
    expect(domains.roleFits('ecommerce.order_date', 'dimension')).toBe(true);
    expect(domains.roleFits('ecommerce.order', 'dimension')).toBe(true);
    expect(domains.roleFits('ecommerce.nope', 'dimension')).toBe(false);
    expect(domains.roleFits(undefined, 'dimension')).toBe(false);
  });

  test('domains are checked, deduplicated and capped', () => {
    expect(domains.cleanDomains(['ecommerce', 'ghost', 'ecommerce', 'finance'])).toEqual(['ecommerce', 'finance']);
    expect(domains.cleanDomains(['finance', 'hr', 'sales', 'retail', 'banking'])).toHaveLength(domains.MAX_DOMAINS);
    expect(domains.cleanDomains('finance')).toEqual([]);
  });

  test('the prompt lists every domain when none is declared, else the declared ones in full and the others by name', () => {
    const all = domains.roleLines([]);
    expect(all).toHaveLength(domains.DOMAINS.length);
    expect(all.find((l) => l.startsWith('- ecommerce'))).toContain('ecommerce.revenue#');
    expect(all.find((l) => l.startsWith('- ecommerce'))).toContain('ecommerce.order_date@');
    const some = domains.roleLines(['finance']);
    expect(some).toHaveLength(2);
    expect(some[0]).toContain('finance.amount#');
    expect(some[1]).toContain('ecommerce (E-commerce)');
    expect(some[1]).not.toContain('ecommerce.revenue');
  });
});

describe('what a field may carry', () => {
  test('an unknown role, a role of the wrong kind, and oversize text are dropped or bounded', () => {
    const m = sanitizeFieldMeta({ name: 'x', role: 'ecommerce.order_date', synonyms: ['CA', ' ca ', '', 7, 'ventes'], description: 'a'.repeat(300) }, 'measure');
    expect(m.role).toBeUndefined();
    expect(m.synonyms).toEqual(['CA', 'ventes']);
    expect(m.description).toHaveLength(200);
    expect(sanitizeFieldMeta({ name: 'x', role: 'ecommerce.revenue' }, 'measure').role).toBe('ecommerce.revenue');
    expect(sanitizeFieldMeta({ name: 'x', synonyms: [] }, 'dimension')).toEqual({ name: 'x' });
  });

  test('a patch adds synonyms, replaces role and description, null clears, unknown fields are reported', () => {
    const model = {
      domains: [],
      dimensions: [{ name: 'd', table: 't', column: 'c', synonyms: ['pays'] }],
      measures: [{ name: 'm', table: 't', column: 'a', aggregation: 'sum', role: 'sales.revenue', description: 'old' }],
    };
    const out = applyGlossaryPatch(model, {
      domains: ['ecommerce'],
      fields: { d: { role: 'ecommerce.country', synonyms: ['country', 'Pays'] }, m: { description: 'new' }, ghost: { role: 'x' } },
    });
    expect(out.domains).toEqual(['ecommerce']);
    expect(out.dimensions[0]).toEqual({ name: 'd', table: 't', column: 'c', role: 'ecommerce.country', synonyms: ['pays', 'country'], glossaryUpdatedAt: expect.any(String) });
    expect(out.measures[0]).toMatchObject({ role: 'sales.revenue', description: 'new' });
    expect(out.errors).toEqual(['ghost: not a field of the model']);
    const cleared = applyGlossaryPatch(model, { fields: { m: null } });
    // Cleared is a change too: dated.
    expect(cleared.measures[0]).toEqual({ name: 'm', table: 't', column: 'a', aggregation: 'sum', glossaryUpdatedAt: expect.any(String) });
    const wrong = applyGlossaryPatch(model, { fields: { m: { role: 'ecommerce.country' } } });
    expect(wrong.errors[0]).toMatch(/not a measure role/);
    expect(wrong.measures[0].role).toBe('sales.revenue');
  });
});

describe('PUT /models/:id/glossary', () => {
  let owner, builder, reader, stranger, model;
  beforeAll(() => {
    owner = seedUser({ role: 'editor' });
    builder = seedUser({ role: 'viewer' });
    reader = seedUser({ role: 'viewer' });
    stranger = seedUser({ role: 'editor' });
    const ws = seedWorkspace({ ownerId: owner });
    db.prepare('INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?,?,?)').run(ws, builder, 'editor');
    db.prepare('INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?,?,?)').run(ws, reader, 'viewer');
    model = seedModel({ userId: owner, datasourceId: seedDatasource({ userId: owner }) });
    db.prepare('INSERT INTO workspace_models (workspace_id, model_id) VALUES (?, ?)').run(ws, model);
    seedReport({ userId: owner, modelId: model, workspaceId: ws });
  });
  const patch = (uid, body) => request(app).put(`/api/models/${model}/glossary`).use(as(uid)).send(body);

  test('whoever may build on the model teaches it; a reader of its reports and a stranger may not', async () => {
    expect((await patch(stranger, { fields: { 'items.label': { synonyms: ['x'] } } })).status).toBe(403);
    expect((await patch(reader, { fields: { 'items.label': { synonyms: ['x'] } } })).status).toBe(403);
    const res = await patch(builder, { domains: ['sales'], fields: { 'items.label': { role: 'sales.product', synonyms: ['article'] }, 'items.amt_sum': { role: 'sales.revenue', synonyms: ['CA'] } } });
    expect(res.status).toBe(200);
    expect(res.body.domains).toEqual(['sales']);
    const got = await request(app).get(`/api/models/${model}`).use(as(owner));
    expect(got.body.model.domains).toEqual(['sales']);
    expect(got.body.model.dimensions[0]).toMatchObject({ role: 'sales.product', synonyms: ['article'] });
    expect(got.body.model.measures[0]).toMatchObject({ role: 'sales.revenue', synonyms: ['CA'] });
  });

  test('a second teaching adds a synonym without undoing the first; a bad patch is a 400', async () => {
    const res = await patch(owner, { fields: { 'items.amt_sum': { synonyms: ['chiffre d\'affaires'] } } });
    expect(res.status).toBe(200);
    expect(res.body.measures[0].synonyms).toEqual(['CA', 'chiffre d\'affaires']);
    expect((await patch(owner, { fields: { nope: { role: 'sales.revenue' } } })).status).toBe(400);
    expect((await patch(owner, { fields: { 'items.amt_sum': { role: 'sales.product' } } })).status).toBe(400);
  });

  test('saving the model keeps only what fits the catalogue, and the domains', async () => {
    const res = await request(app).put(`/api/models/${model}`).use(as(owner)).send({
      domains: ['sales', 'ghost'],
      measures: [{ name: 'items.amt_sum', table: 'items', column: 'amt', aggregation: 'sum', label: 'amt', role: 'sales.product', synonyms: ['CA'] }],
    });
    expect(res.status).toBe(200);
    expect(res.body.model.domains).toEqual(['sales']);
    expect(res.body.model.measures[0]).toEqual({ name: 'items.amt_sum', table: 'items', column: 'amt', aggregation: 'sum', label: 'amt', synonyms: ['CA'], glossaryUpdatedAt: expect.any(String) });
  });

  test('the catalogue is served to signed-in users', async () => {
    const res = await request(app).get('/api/models/business-domains').use(as(reader));
    expect(res.status).toBe(200);
    expect(res.body.domains.find((d) => d.id === 'ecommerce').roles.find((r) => r.id === 'ecommerce.revenue')).toEqual({ id: 'ecommerce.revenue', label: 'Revenue', kind: 'measure', required: true });
    expect((await request(app).get('/api/models/business-domains')).status).toBe(401);
  });
});

describe('what the assistant is shown', () => {
  const model = {
    domains: ['ecommerce', 'ghost'],
    description: 'Online clothing shop',
    dimensions: [{ name: 'd', table: 't', column: 'c', type: 'string', label: 'Country', role: 'ecommerce.country', synonyms: ['pays'], expression: 'SECRET' }],
    measures: [{ name: 'm', table: 't', column: 'a', aggregation: 'sum', label: 'Amount', role: 'ecommerce.country', description: 'Net of shipping', expression: 'SUM(secret)' }],
  };

  test('the schema carries role, synonyms and description, never an expression; a role of the wrong kind is not shown', () => {
    const schema = toPromptSchema(buildEffectiveModel(model, {}));
    expect(schema.dimensions[0]).toEqual({ name: 'd', label: 'Country', type: 'string', role: 'ecommerce.country', synonyms: ['pays'] });
    expect(schema.measures[0]).toEqual({ name: 'm', label: 'Amount', aggregation: 'sum', description: 'Net of shipping' });
    expect(JSON.stringify(schema)).not.toMatch(/SECRET|secret/);
  });

  test('a measure of a table listing things is marked as counted once per item, and no join leaves', () => {
    const schema = toPromptSchema(buildEffectiveModel({
      dimensions: [],
      measures: [
        { name: 'clients.objectif_sum', table: 'clients', column: 'objectif', aggregation: 'sum' },
        { name: 'activites.rdv_sum', table: 'activites', column: 'rdv', aggregation: 'sum' },
      ],
      joins: [{ from_table: 'activites', from_column: 'client', to_table: 'clients', to_column: 'client', cardinality: { from: '*', to: '1' } }],
    }, {}));
    expect(schema.measures.map((m) => !!m.oncePerItem)).toEqual([true, false]);
    expect(JSON.stringify(schema)).not.toMatch(/activites"|from_table|"client"/);
  });

  test('a measure the assistant made says what it is made of, in field names; an author\'s SQL never', () => {
    const schema = toPromptSchema(buildEffectiveModel({
      dimensions: [{ name: 'contrats.police', table: 'contrats', column: 'police' }],
      measures: [
        { name: 'contrats.prime_sum', table: 'contrats', column: 'prime', aggregation: 'sum' },
        { name: '_calc.contrats', table: 'contrats', column: 'prime', aggregation: 'count_distinct' },
        { name: '_calc.ratio', aggregation: 'custom', expression: '100.0 * (${a}) / NULLIF((${b}), 0)' },
        { name: '_calc.own_sql', aggregation: 'custom', expression: 'SUM(CASE WHEN x THEN 1 END)' },
        { name: 'm.author', aggregation: 'custom', expression: '(${a}) - (${b})' },
      ],
    }, {}));
    expect(schema.measures.map((m) => m.madeOf || null)).toEqual([null, 'count_distinct of contrats.prime_sum', '100.0 * (${a}) / NULLIF((${b}), 0)', null, null]);
  });

  test('tables no join links: each field says its group, the prompt says never to mix them', () => {
    const fields = {
      dimensions: [{ name: 'contrats.produit', table: 'contrats', column: 'produit' }, { name: 'sinistres.garantie', table: 'sinistres', column: 'garantie' }],
      measures: [{ name: 'contrats.prime_sum', table: 'contrats', column: 'prime', aggregation: 'sum' }, { name: 'sinistres.regle_sum', table: 'sinistres', column: 'regle', aggregation: 'sum' }],
    };
    const apart = toPromptSchema(buildEffectiveModel({ ...fields, joins: [] }, {}));
    expect([...apart.dimensions, ...apart.measures].map((f) => f.group)).toEqual([1, 2, 1, 2]);
    expect(JSON.stringify(apart)).not.toMatch(/"contrats"|"sinistres"|from_table/);
    const base = { coverage: [], pageContext: { pageWidth: 1000, pageHeight: 800, widgets: [], themes: [], theme: 'light', pageBackground: '#fff', palette: [] }, mode: 'ask', canQueryData: false };
    expect(buildSystemPrompt({ ...base, schema: apart })).toContain('no join links two groups');
    const joined = toPromptSchema(buildEffectiveModel({ ...fields, joins: [{ from_table: 'sinistres', from_column: 'police', to_table: 'contrats', to_column: 'police' }] }, {}));
    expect([...joined.dimensions, ...joined.measures].some((f) => f.group)).toBe(false);
    expect(buildSystemPrompt({ ...base, schema: joined })).not.toContain('no join links two groups');
  });

  test('the prompt names the domains and the description, and explains the glossary only when a field has one', () => {
    const effective = buildEffectiveModel(model, {});
    expect(effective.domains).toEqual(['ecommerce']);
    const base = { schema: toPromptSchema(effective), coverage: [], pageContext: { pageWidth: 1000, pageHeight: 800, widgets: [], themes: [], theme: 'light', pageBackground: '#fff', palette: [] }, mode: 'ask', canQueryData: false };
    const prompt = buildSystemPrompt({ ...base, businessLines: businessLines(effective) });
    expect(prompt).toContain('This model is about: E-commerce.');
    expect(prompt).toContain('"Online clothing shop"');
    expect(prompt).toContain('Glossary, on some fields');
    const bare = buildEffectiveModel({ dimensions: [{ name: 'x' }], measures: [] }, {});
    const plain = buildSystemPrompt({ ...base, schema: toPromptSchema(bare), businessLines: businessLines(bare) });
    expect(plain).not.toContain('Business context');
    expect(plain).not.toContain('Glossary, on some fields');
  });
});

describe('the model assistant and the glossary', () => {
  const DRAFT = {
    tables: {
      orders: [{ column: 'id', type: 'integer' }, { column: 'amount', type: 'numeric' }, { column: 'ordered_at', type: 'date' }, { column: 'country', type: 'text' }],
    },
    joins: [], roles: {},
    dimensions: [{ table: 'orders', column: 'country', role: 'ecommerce.country' }, { table: 'orders', column: 'ordered_at' }],
    measures: [{ table: 'orders', column: 'amount', aggregation: 'sum', role: 'ecommerce.order_date' }],
    domains: ['ecommerce', 'ghost'],
  };
  const READING = { joins: false, fields: false, measures: false, tableRoles: false, layout: false, glossary: true };

  test('the draft keeps the declared domains and the roles that fit', () => {
    const d = cleanDraft(DRAFT);
    expect(d.domains).toEqual(['ecommerce']);
    expect(d.fieldRoles).toEqual({ 'orders.country': 'ecommerce.country' });
    const prompt = buildModelPrompt({ modelName: 'm', draft: d, topics: [], canReadColumns: false });
    expect(prompt).toContain('Business domains: ecommerce');
    expect(prompt).toContain('country text D =ecommerce.country');
    expect(prompt).toContain('- ecommerce (E-commerce): ecommerce.order_date@');
    expect(prompt).toContain('other domains, roles listed once declared: finance');
  });

  test('a glossary proposal is held to the catalogue and to the flagged fields', () => {
    const d = cleanDraft(DRAFT);
    const out = validateModelProposal({
      reading: READING, summary: 's', domains: ['ecommerce', 'sales'],
      glossary: [
        { table: 'orders', column: 'ordered_at', as: 'dimension', role: 'ecommerce.order_date' },
        { table: 'orders', column: 'amount', as: 'measure', role: 'ecommerce.revenue', description: 'Paid amount' },
        { table: 'orders', column: 'amount', as: 'measure', role: 'ecommerce.country' },
        { table: 'orders', column: 'id', as: 'dimension', role: 'ecommerce.order' },
        { table: 'orders', column: 'nope', as: 'dimension', role: 'ecommerce.order' },
      ],
    }, d);
    expect(out.payload.domains).toEqual(['ecommerce', 'sales']);
    expect(out.payload.glossary).toEqual([
      { table: 'orders', column: 'ordered_at', as: 'dimension', role: 'ecommerce.order_date' },
      { table: 'orders', column: 'amount', as: 'measure', role: 'ecommerce.revenue', description: 'Paid amount' },
    ]);
    expect(out.errors).toHaveLength(3);
    expect(out.errors[1]).toMatch(/flag it in `fields` first/);
    // Flagged in the same proposal: accepted.
    const withField = validateModelProposal({ reading: { ...READING, fields: true }, summary: 's', fields: [{ table: 'orders', column: 'id', as: 'dimension' }], glossary: [{ table: 'orders', column: 'id', as: 'dimension', role: 'ecommerce.order' }] }, d);
    expect(withField.payload.glossary).toEqual([{ table: 'orders', column: 'id', as: 'dimension', role: 'ecommerce.order' }]);
    expect(withField.errors).toEqual([]);
  });

  test('without reading.glossary, domains and glossary are ignored', () => {
    const out = validateModelProposal({ reading: { ...READING, glossary: false }, summary: 's', domains: ['ecommerce'], glossary: [{ table: 'orders', column: 'amount', as: 'measure', role: 'ecommerce.revenue' }] }, cleanDraft(DRAFT));
    expect(out.payload).toBeNull();
  });
});

describe('models as code', () => {
  test('domains and field glossary round-trip through YAML', () => {
    const text = modelToYaml({ name: 'm', domains: ['sales'], dimensions: [{ name: 'd', role: 'sales.product', synonyms: ['article'] }], measures: [] }, 'ds');
    const back = yamlToModelFields(text);
    expect(back.domains).toEqual(['sales']);
    expect(back.dimensions[0]).toMatchObject({ role: 'sales.product', synonyms: ['article'] });
    expect(modelToYaml({ name: 'm', domains: [], dimensions: [], measures: [] }, 'ds')).not.toContain('domains');
    expect(() => yamlToModelFields(text.replace('domains:\n  - sales', 'domains: sales'))).toThrow(/domains/);
  });
});
