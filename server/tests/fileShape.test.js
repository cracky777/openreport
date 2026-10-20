// Reshaping an imported file (utils/fileShape.js): a wide budget sheet —
// title rows, one column per month, totals, amounts as text — becomes a fact
// table with a dimension and a calendar around it. The recipe is kept on the
// file and replayed on refresh; the table as imported stays in the file's raw
// schema, invisible to models, so the recipe can be changed or removed.
const request = require('supertest');
const XLSX = require('xlsx');
const { validateShape, describeShape, compileFact, headerNames } = require('../utils/fileShape');

jest.setTimeout(60000);
const { buildApp, seedUser, db } = require('./helpers/testApp');

const app = buildApp();
const as = (uid) => (r) => r.set('x-test-user', uid);

function workbook(rows) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'budget');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
const SHEET = [
  ['BP budget mensuel', '', '', '', ''],
  ['Exercice 2024', '', '', '', ''],
  ['Compte', 'Libellé', 'janv.-24', 'févr.-24', 'Total'],
  ['601', 'Achats', '1 200,50', '1 300', '2 500,50'],
  ['706', 'Ventes', '5 000', '5 500', '10 500'],
  ['Total', '', '6 200,50', '6 800', '13 000,50'],
];
const RECIPE = {
  steps: [
    { op: 'header', row: 2 },
    { op: 'drop', columns: ['Total'] },
    { op: 'filter', column: 'Compte', test: 'is_number' },
    { op: 'rename', from: 'Compte', to: 'account_code' },
    { op: 'rename', from: 'Libellé', to: 'account_label' },
    { op: 'unpivot', keep: ['account_code', 'account_label'], name: 'Month', value: 'Amount' },
    { op: 'map', column: 'Month', values: { 'janv.-24': '2024-01-01', 'févr.-24': '2024-02-01' } },
    { op: 'cast', column: 'Month', type: 'date', format: '%Y-%m-%d' },
    { op: 'cast', column: 'Amount', type: 'number', decimal: 'comma' },
    { op: 'dimension', name: 'accounts', key: 'account_code', columns: ['account_label'] },
    { op: 'calendar', name: 'calendar', column: 'Month' },
  ],
};

const upload = (uid, name, content, fields = {}) => {
  let req = request(app).post('/api/upload').use(as(uid));
  for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
  return req.attach('file', content, name);
};
const query = async (uid, id, sql) => {
  const res = await request(app).post(`/api/datasources/${id}/query`).use(as(uid)).send({ sql });
  expect(res.status).toBe(200);
  return res.body.rows;
};
const extraOf = (id) => JSON.parse(db.prepare('SELECT extra_config FROM datasources WHERE id = ?').get(id).extra_config);
const tablesOf = async (uid, id) => (await request(app).get(`/api/datasources/${id}/tables`).use(as(uid))).body.tables.map((t) => (typeof t === 'string' ? t : t.name));

describe('the recipe', () => {
  test('is re-projected and checked against the columns up to the header step', () => {
    const { shape, errors } = validateShape({ table: 'budget', ...RECIPE }, { columns: ['A', 'B'], taken: ['budget', 'other'] });
    expect(errors).toEqual([]);
    expect(shape.output).toBe('budget');
    expect(shape.steps).toHaveLength(11);
    expect(describeShape(shape)).toEqual([
      'Row 2 holds the column names; the rows above it are dropped',
      'Columns dropped: Total',
      'Rows kept where Compte is a number',
      'Column Compte renamed account_code',
      'Column Libellé renamed account_label',
      'Every column but account_code, account_label becomes a row: its name in Month, its value in Amount',
      'Month: 2 values rewritten (janv.-24 → 2024-01-01, févr.-24 → 2024-02-01)',
      'Month read as a date (%Y-%m-%d)',
      'Amount read as a number (decimal comma)',
      'Table accounts extracted: one row per account_code, with account_label (taken out of the fact)',
      'Table calendar: one row per day over the years of Month and the year after, with year, quarter, month, week and month name',
      'Fact table: budget',
    ]);
  });

  test.each([
    ['an unknown column', { steps: [{ op: 'drop', columns: ['nope'] }] }, /not a column of budget/],
    ['an unknown operation', { steps: [{ op: 'sql', text: 'DROP TABLE x' }] }, /op must be one of/],
    ['a header not first', { steps: [{ op: 'drop', columns: ['A'] }, { op: 'header', row: 2 }] }, /header must be the first step/],
    ['a date format outside the list', { steps: [{ op: 'cast', column: 'A', type: 'date', format: '%Q' }] }, /date format among/],
    ['a new table named after an existing one', { steps: [{ op: 'dimension', name: 'other', key: 'A', columns: ['B'] }] }, /already exists/],
    ['a new table with a linked-source marker', { steps: [{ op: 'calendar', name: 'x__cal', column: 'A' }] }, /never __/],
  ])('refuses %s', (_, recipe, message) => {
    const { shape, errors } = validateShape({ table: 'budget', ...recipe }, { columns: ['A', 'B'], taken: ['budget', 'other'] });
    expect(shape).toBeNull();
    expect(errors.join('; ')).toMatch(message);
  });

  test('compiles to quoted SQL, nothing of the recipe interpolated as code', () => {
    const { shape } = validateShape({ table: 't', steps: [
      { op: 'filter', column: 'a"; DROP TABLE t; --', test: 'equals', value: "x' OR 1=1" },
      { op: 'unpivot', columns: ['m1', 'm2'], name: 'Month', value: 'Amount' },
    ] }, {});
    const sql = compileFact(shape);
    expect(sql).toContain(`CAST("a""; DROP TABLE t; --" AS VARCHAR) = 'x'' OR 1=1'`);
    expect(sql).toContain('UNPIVOT s0 ON "m1", "m2" INTO NAME "Month" VALUE "Amount"');
    expect(headerNames(['Compte', ' Libellé ', '', 'Compte', null])).toEqual(['Compte', 'Libellé', 'column_3', 'Compte_2', 'column_5']);
  });
});

describe('POST /api/upload/:id/shape', () => {
  let u, id;
  beforeAll(async () => {
    u = seedUser({ role: 'editor' });
    const res = await upload(u, 'BP budget.xlsx', workbook(SHEET));
    expect(res.status).toBe(201);
    id = res.body.datasource.id;
  });
  const reshape = (uid, body) => request(app).post(`/api/upload/${id}/shape`).use(as(uid)).send(body);

  test('writes the fact, its dimension and the calendar; the raw copy stays out of sight', async () => {
    const res = await reshape(u, { table: 'budget', shape: RECIPE });
    expect(res.status).toBe(200);
    expect(res.body.tables).toEqual([
      // The calendar runs over whole years and the year after: a budget for the coming year joins it.
      { tableName: 'budget', rowCount: 4 }, { tableName: 'accounts', rowCount: 2 }, { tableName: 'calendar', rowCount: 731 },
    ]);
    expect(await query(u, id, 'SELECT account_code, strftime("Month", \'%Y-%m-%d\') AS m, "Amount" FROM budget ORDER BY 1, 2')).toEqual([
      { account_code: '601', m: '2024-01-01', Amount: 1200.5 }, { account_code: '601', m: '2024-02-01', Amount: 1300 },
      { account_code: '706', m: '2024-01-01', Amount: 5000 }, { account_code: '706', m: '2024-02-01', Amount: 5500 },
    ]);
    expect(await query(u, id, 'SELECT * FROM accounts ORDER BY 1')).toEqual([{ account_code: '601', account_label: 'Achats' }, { account_code: '706', account_label: 'Ventes' }]);
    expect((await query(u, id, 'SELECT "YearMonth", "Quarter", "YearWeek" FROM calendar WHERE "Day" = 1 ORDER BY 1 LIMIT 2'))).toEqual([{ YearMonth: '2024-01', Quarter: 'Q1', YearWeek: '2024-W01' }, { YearMonth: '2024-02', Quarter: 'Q1', YearWeek: '2024-W05' }]);
    expect((await query(u, id, 'SELECT MIN("Date")::VARCHAR AS a, MAX("Date")::VARCHAR AS b, MAX("YearWeek") AS w FROM calendar'))[0]).toEqual({ a: '2024-01-01', b: '2025-12-31', w: '2026-W01' });
    expect(await tablesOf(u, id)).toEqual(['accounts', 'budget', 'calendar']);
    const extra = extraOf(id);
    expect(extra.files[0].shape.table).toBe('budget');
    expect(extra.files[0].tables.map((t) => t.tableName)).toEqual(['budget', 'accounts', 'calendar']);
    expect(extra.tableName).toBe('budget');
  });

  test('a refresh of the file replays the recipe on the new export', async () => {
    const rows = [...SHEET.slice(0, 5), ['641', 'Salaires', '2 000', '2 100', '4 100'], SHEET[5]];
    const res = await request(app).put(`/api/upload/${id}`).use(as(u)).attach('file', workbook(rows), 'BP budget v2.xlsx');
    expect(res.status).toBe(200);
    expect(res.body.missingTables).toEqual([]);
    expect(await query(u, id, 'SELECT COUNT(*) AS n FROM budget')).toEqual([{ n: 6 }]);
    expect(await query(u, id, 'SELECT COUNT(*) AS n FROM accounts')).toEqual([{ n: 3 }]);
    expect(extraOf(id).files[0].shape.steps).toHaveLength(11);
  });

  test('a new recipe starts again from the table as imported', async () => {
    const res = await reshape(u, { table: 'budget', shape: { steps: [{ op: 'header', row: 2 }], output: 'budget_wide' } });
    expect(res.status).toBe(200);
    expect(res.body.tables).toEqual([{ tableName: 'budget_wide', rowCount: 4 }]);
    expect(await tablesOf(u, id)).toEqual(['budget_wide']);
    expect(await query(u, id, 'SELECT "Compte", "Total" FROM budget_wide ORDER BY 1')).toEqual([
      { Compte: '601', Total: '2 500,50' }, { Compte: '641', Total: '4 100' }, { Compte: '706', Total: '10 500' }, { Compte: 'Total', Total: '13 000,50' },
    ]);
  });

  test('a dimension copied under a second name: one table per role, both replayed from the file', async () => {
    // Departure and arrival warehouse point to one warehouses table: the model
    // joins warehouses_from and warehouses_to, never one table twice (Jonathan).
    const res = await reshape(u, { table: 'budget', shape: { steps: [{ op: 'header', row: 2 }, { op: 'filter', column: 'Compte', test: 'is_number' }, { op: 'drop', columns: ['Total'] }, { op: 'copy', name: 'comptes_arrivee' }], output: 'comptes_depart' } });
    expect(res.body.error).toBeUndefined();
    const n = Number((await query(u, id, 'SELECT COUNT(*) AS n FROM comptes_depart'))[0].n);
    expect(res.body.tables).toEqual([{ tableName: 'comptes_depart', rowCount: n }, { tableName: 'comptes_arrivee', rowCount: n }]);
    expect(await query(u, id, 'SELECT * FROM comptes_arrivee ORDER BY 1')).toEqual(await query(u, id, 'SELECT * FROM comptes_depart ORDER BY 1'));
    expect(Object.keys((await query(u, id, 'SELECT * FROM comptes_arrivee LIMIT 1'))[0])).not.toContain('Total');
    expect(await tablesOf(u, id)).toEqual(['comptes_arrivee', 'comptes_depart']);
    expect(extraOf(id).files[0].tables.map((t) => t.tableName)).toEqual(['comptes_depart', 'comptes_arrivee']);
    expect(validateShape({ table: 'budget', steps: [{ op: 'copy', name: 'other' }] }, { columns: ['A'], taken: ['other'] }).errors.join(' ')).toMatch(/already exists/);
  });

  test('two columns joined into one key: the pair becomes a column, then a dimension', async () => {
    // Departure and arrival of a transfer point to the same warehouses table:
    // the fact never joins it twice, the pair is read as one dimension (Jonathan).
    const res = await reshape(u, { table: 'budget', shape: { steps: [{ op: 'header', row: 2 }, { op: 'filter', column: 'Compte', test: 'is_number' }, { op: 'concat', name: 'Paire', columns: ['Compte', 'Libellé'], separator: ' → ' }, { op: 'dimension', name: 'paires', key: 'Paire', columns: [] }], output: 'budget_pairs' } });
    expect(res.body.error).toBeUndefined();
    // One pair per account row (the file may hold two or three, depending on the refresh test above).
    const n = Number((await query(u, id, 'SELECT COUNT(*) AS n FROM budget_pairs'))[0].n);
    expect(res.body.tables).toEqual([{ tableName: 'budget_pairs', rowCount: n }, { tableName: 'paires', rowCount: n }]);
    expect(await query(u, id, 'SELECT * FROM paires ORDER BY 1')).toEqual(expect.arrayContaining([{ Paire: '601 → Achats' }, { Paire: '706 → Ventes' }]));
    const { shape, errors } = validateShape({ table: 'budget', steps: [{ op: 'concat', name: 'A', columns: ['A', 'B'] }, { op: 'concat', name: 'AB', columns: ['A'] }] }, { columns: ['A', 'B'], taken: [] });
    expect(shape).toBeNull();
    expect(errors.join('; ')).toMatch(/already a column/);
    expect(errors.join('; ')).toMatch(/at least two columns/);
    expect(describeShape(validateShape({ table: 'budget', steps: [{ op: 'concat', name: 'AB', columns: ['A', 'B'] }] }, { columns: ['A', 'B'], taken: [] }).shape)).toEqual(['AB = A → B (the columns joined into one key)', 'Fact table: budget']);
  });

  test('a dimension with no column but the key: the list of its values, the fact keeps the key', async () => {
    // Sales and targets by department share one `rayons` table: each fact joins
    // it on the key, so a query compares the two without joining fact to fact.
    const res = await reshape(u, { table: 'budget', shape: { steps: [{ op: 'header', row: 2 }, { op: 'filter', column: 'Compte', test: 'is_number' }, { op: 'dimension', name: 'comptes', key: 'Compte', columns: [] }], output: 'budget_keys' } });
    expect(res.status).toBe(200);
    expect(res.body.tables).toEqual([{ tableName: 'budget_keys', rowCount: 3 }, { tableName: 'comptes', rowCount: 3 }]);
    expect(await query(u, id, 'SELECT * FROM comptes ORDER BY 1')).toEqual([{ Compte: '601' }, { Compte: '641' }, { Compte: '706' }]);
    expect((await query(u, id, 'SELECT "Compte", "Libellé" FROM budget_keys ORDER BY 1'))[0]).toMatchObject({ Compte: '601' });
    expect(describeShape(validateShape({ table: 'budget', steps: [{ op: 'dimension', name: 'rayons', key: 'A', columns: [] }] }, { columns: ['A', 'B'], taken: [] }).shape)).toContain('Table rayons: one row per A, for every fact that has one to share');
  });

  test('null puts the table back as imported and forgets the recipe', async () => {
    const res = await reshape(u, { table: 'budget', shape: null });
    expect(res.status).toBe(200);
    expect(res.body.tables).toEqual([{ tableName: 'budget', rowCount: 6 }]);
    expect(extraOf(id).files[0].shape).toBeUndefined();
    expect(await tablesOf(u, id)).toEqual(['budget']);
  });

  test('a bad recipe, an unknown table, another user: refused, the file untouched', async () => {
    const before = db.prepare('SELECT db_name FROM datasources WHERE id = ?').get(id).db_name;
    expect((await reshape(u, { table: 'budget', shape: { steps: [{ op: 'sql' }] } })).status).toBe(400);
    expect((await reshape(u, { table: 'nope', shape: RECIPE })).status).toBe(404);
    expect((await reshape(seedUser({ role: 'editor' }), { table: 'budget', shape: RECIPE })).status).not.toBe(200);
    expect(db.prepare('SELECT db_name FROM datasources WHERE id = ?').get(id).db_name).toBe(before);
  });
});
