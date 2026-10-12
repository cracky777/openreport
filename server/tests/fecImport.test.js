// A French FEC is recognised by its header, whatever its name, imported as one
// typed table classified along the Plan Comptable Général, and offered an
// accounting pack whose figures are the books' own: the pack's model, applied
// through the ordinary import routes, must give back the result the entries
// add up to.
const request = require('supertest');
const { classifyAccount } = require('../utils/accounting/pcg');
const { buildModelFields, buildReport } = require('../utils/accounting/fecPack');

// Every import runs in a child process (utils/fileImport.js).
jest.setTimeout(60000);
const { buildApp, seedUser, seedWorkspace, db } = require('./helpers/testApp');

const app = buildApp();
const as = (uid) => (r) => r.set('x-test-user', uid);

const HEADER = ['JournalCode', 'JournalLib', 'EcritureNum', 'EcritureDate', 'CompteNum', 'CompteLib', 'CompAuxNum', 'CompAuxLib',
  'PieceRef', 'PieceDate', 'EcritureLib', 'Debit', 'Credit', 'EcritureLet', 'DateLet', 'ValidDate', 'Montantdevise', 'Idevise'];
const line = (j, num, date, account, label, aux, debit, credit, text = 'Entry') => [
  j, `Journal ${j}`, num, date, account, label, aux || '', aux ? `Party ${aux}` : '', `P${num}`, date, text,
  debit, credit, '', '', '20251231', '', '',
];
// Opening balance, a sale paid by the customer, a purchase still owed, a
// payroll and a depreciation: revenue 1 000, net income 250.
const ROWS = [
  line('AN', '1', '20250101', '512000', 'Bank', '', '1000,00', '0,00'),
  line('AN', '1', '20250101', '101300', 'Capital', '', '0,00', '1000,00'),
  line('VE', '2', '20250115', '411', 'Customers', 'CLI1', '1200,00', '0,00'),
  line('VE', '2', '20250115', '706000', 'Services', '', '0,00', '1000,00'),
  line('VE', '2', '20250115', '445710', 'VAT collected', '', '0,00', '200,00'),
  line('AC', '3', '20250210', '607000', 'Purchases', '', '300,00', '0,00', 'Achat matériel 300 €'),
  line('AC', '3', '20250210', '445660', 'VAT deductible', '', '60,00', '0,00'),
  line('AC', '3', '20250210', '401', 'Suppliers', 'FOU1', '0,00', '360,00'),
  line('PA', '4', '20250228', '641100', 'Salaries', '', '400,00', '0,00'),
  line('PA', '4', '20250228', '421000', 'Staff payable', '', '0,00', '400,00'),
  line('BQ', '5', '20250301', '512000', 'Bank', '', '1200,00', '0,00'),
  line('BQ', '5', '20250301', '411', 'Customers', 'CLI1', '0,00', '1200,00'),
  line('OD', '6', '20251231', '681120', 'Depreciation', '', '50,00', '0,00'),
  line('OD', '6', '20251231', '281830', 'Accum. depreciation', '', '0,00', '50,00'),
];

// Windows-1252, as accounting packages write it: é is one byte, € is 0x80 —
// a byte DuckDB's own Latin-1 reader refuses.
function windows1252(text) {
  return Buffer.concat(text.split('€').flatMap((part, i) => (i ? [Buffer.from([0x80]), Buffer.from(part, 'latin1')] : [Buffer.from(part, 'latin1')])));
}
// The same books moved to another fiscal year (every date shifted).
const fecFile = (year = 2025) => windows1252([HEADER, ...ROWS.map((r) => r.map((c) => String(c).replace(/^2025(\d{4})$/, `${year}$1`)))]
  .map((r) => r.join('\t')).join('\r\n') + '\r\n');
const fecName = (year = 2025, siren = '123456789') => `${siren}FEC${year}1231.txt`;

async function upload(uid, name, content) {
  return request(app).post('/api/upload').use(as(uid)).attach('file', content, name);
}
const sql = async (uid, id, text) => {
  const res = await request(app).post(`/api/datasources/${id}/query`).use(as(uid)).send({ sql: text });
  expect(res.status).toBe(200);
  return res.body.rows;
};

describe('PCG classification', () => {
  test.each([
    ['707100', 1], ['7097', 1], ['706000', 3], ['709000', 3], ['607000', 2], ['6037', 2], ['6031', 5], ['604100', 6], ['603', 6],
    ['613200', 6], ['622600', 6], ['631200', 8], ['641100', 9], ['645100', 9], ['741000', 7], ['758000', 10], ['781500', 10],
    ['681120', 11], ['651000', 12], ['763800', 13], ['786000', 13], ['661100', 14], ['686000', 14], ['771000', 15],
    ['687000', 16], ['691000', 17], ['695000', 18], ['699400', 18],
  ])('%s sits on line %i', (account, no) => {
    expect(classifyAccount(account).lineNo).toBe(no);
    expect(classifyAccount(account).statement).toBe('Income statement');
  });

  test('balance-sheet accounts sort after the income statement and stay out of its lines', () => {
    expect(classifyAccount('411')).toMatchObject({ statement: 'Balance sheet', line: 'Class 4 Third-party accounts', lineNo: 104 });
    expect(classifyAccount('512200').lineNo).toBeGreaterThan(18);
  });

  test('what is not a PCG account is unclassified, not guessed', () => {
    expect(classifyAccount('801000').statement).toBe('Unclassified');
    expect(classifyAccount('CLIENTS').statement).toBe('Unclassified');
  });
});

describe('FEC import', () => {
  test('a .txt FEC in Windows-1252 becomes one typed, classified table', async () => {
    const u = seedUser({ role: 'editor' });
    const res = await upload(u, '123456789FEC20251231.txt', fecFile());
    expect(res.status).toBe(201);
    expect(res.body.accounting).toMatchObject({
      kind: 'fec', siren: '123456789', closingDate: '2025-12-31', entries: ROWS.length,
      debit: 4210, credit: 4210, balanced: true, unbalancedEntries: 0, netIncome: 250, firstDate: '2025-01-01', lastDate: '2025-12-31',
    });
    const id = res.body.datasource.id;
    expect(res.body.datasource.tableName).toBe('entries');
    const [purchase] = await sql(u, id, "SELECT Debit, Amount, Line, EcritureLib, typeof(EcritureDate) AS t, Period FROM entries WHERE CompteNum = '607000'");
    expect(Number(purchase.Debit)).toBe(300);
    expect(Number(purchase.Amount)).toBe(-300);
    expect(purchase).toMatchObject({ Line: '02 Cost of goods sold', EcritureLib: 'Achat matériel 300 €', t: 'DATE', Period: '2025-02' });
    // Kept on the file entry: the pack is offered from the source later too.
    const extra = JSON.parse(db.prepare('SELECT extra_config FROM datasources WHERE id = ?').get(id).extra_config);
    expect(extra.files[0].accounting.kind).toBe('fec');
  });

  test('the Montant + Sens variant, pipe-separated, any header case', async () => {
    const u = seedUser({ role: 'editor' });
    const head = 'journalcode|JOURNALLIB|EcritureNum|EcritureDate|CompteNum|CompteLib|CompAuxNum|CompAuxLib|PieceRef|PieceDate|EcritureLib|Montant|Sens|EcritureLet|DateLet|ValidDate|Montantdevise|Idevise';
    const body = [head, 'VE|Ventes|1|20250105|706000|Services|||F1|20250105|Sale|150,50|C|||20250105||', 'VE|Ventes|1|20250105|411|Customers|C1|Client|F1|20250105|Sale|150,50|D|||20250105||'].join('\n');
    const res = await upload(u, 'export.txt', Buffer.from(body));
    expect(res.status).toBe(201);
    expect(res.body.accounting).toMatchObject({ debit: 150.5, credit: 150.5, balanced: true, netIncome: 150.5 });
  });

  test('a plain .txt CSV is imported as before, and a .fec that is not one is refused', async () => {
    const u = seedUser({ role: 'editor' });
    const csv = await upload(u, 'cities.txt', Buffer.from('city;cost\nParis;12\n'));
    expect(csv.status).toBe(201);
    expect(csv.body.accounting).toBeFalsy();
    const fake = await upload(u, 'books.fec', Buffer.from('a,b\n1,2\n'));
    expect(fake.status).toBe(500);
    expect(fake.body.error).toMatch(/FEC header/);
  });

  test('a Windows-1252 CSV holding € imports (DuckDB alone refuses it as Latin-1)', async () => {
    const u = seedUser({ role: 'editor' });
    const res = await upload(u, 'prices.csv', windows1252('item;price\nCafé;3 €\n'));
    expect(res.status).toBe(201);
    const [row] = await sql(u, res.body.datasource.id, 'SELECT * FROM prices');
    expect(row).toEqual({ item: 'Café', price: '3 €' });
  });
});

describe('Accounting pack', () => {
  test('applied through the import routes, it gives back the books\' figures', async () => {
    const u = seedUser({ role: 'editor' });
    const up = await upload(u, '123456789FEC20251231.txt', fecFile());
    const dsId = up.body.datasource.id;
    const packRes = await request(app).get(`/api/upload/${dsId}/fec-pack`).use(as(u));
    expect(packRes.status).toBe(200);
    const { plan } = packRes.body;

    const m = await request(app).post('/api/models/import').use(as(u)).send({ yaml: plan.model.yaml, datasourceId: dsId });
    expect(m.status).toBe(201);
    const modelId = m.body.model.id;
    const q = (body) => request(app).post(`/api/models/${modelId}/query`).use(as(u)).send(body);

    const kpis = await q({ dimensionNames: [], measureNames: ['_calc.revenue', '_calc.grossMargin', '_calc.valueAdded', '_calc.ebitda', '_calc.operatingIncome', '_calc.netIncome', '_calc.expenses'] });
    expect(kpis.status).toBe(200);
    const k = kpis.body.rows[0];
    expect([k.Revenue, k['Gross margin'], k['Value added'], k.EBITDA, k['Operating income'], k['Net income'], k.Expenses].map(Number))
      .toEqual([1000, -300, 700, 300, 250, 250, 750]);

    const parties = await q({ dimensionNames: ['entries.CompAuxLib'], measureNames: ['_calc.receivables', '_calc.payables'] });
    const byParty = Object.fromEntries(parties.body.rows.map((r) => [r['Third party'], r]));
    expect(Number(byParty['Party CLI1']['Customer balance'])).toBe(0);
    expect(Number(byParty['Party FOU1']['Supplier balance'])).toBe(360);

    const r = await request(app).post('/api/reports/import').use(as(u)).send({ bundle: plan.report.bundle, modelId });
    expect(r.status).toBe(201);
    expect(r.body.report.settings.pages.map((p) => p.name)).toEqual(['Overview', 'Income statement', 'Management balances', 'Customers & suppliers', 'Trial balance', 'General ledger']);

    // A search slicer's text reaches /query as a contains rule, whatever its case.
    const searched = await q({ dimensionNames: ['entries.Account'], measureNames: ['entries.Amount_sum'], widgetFilters: [{ field: 'entries.Account', isMeasure: false, op: 'contains', value: 'SALAR', values: [] }] });
    expect(searched.body.rows.map((row) => row.Account)).toEqual(['641100 Salaries']);

    // Offered twice, the pack takes the next free model name.
    const again = await request(app).get(`/api/upload/${dsId}/fec-pack`).use(as(u));
    expect(again.body.plan.model.name).toBe(`${plan.model.name} 2`);
  });

  test('every field a widget binds exists in the model', () => {
    const fields = buildModelFields('entries', 'm');
    const known = new Set([...fields.dimensions, ...fields.measures].map((f) => f.name));
    const bundle = buildReport('entries', { title: 't' });
    for (const page of bundle.report.pages) {
      for (const w of Object.values(page.widgets)) {
        const b = w.dataBinding || {};
        const used = [...(b.selectedDimensions || []), ...(b.selectedMeasures || []), ...(b.columnDimensions || []), ...(b.widgetFilters || []).map((f) => f.field)];
        for (const name of used) expect(known.has(name) ? name : `${page.name}: ${name}`).toBe(name);
      }
    }
  });

  test('a source without a FEC has no pack', async () => {
    const u = seedUser({ role: 'editor' });
    const up = await upload(u, 'plain.csv', Buffer.from('a\n1\n'));
    const res = await request(app).get(`/api/upload/${up.body.datasource.id}/fec-pack`).use(as(u));
    expect(res.status).toBe(404);
  });
});

describe('Several fiscal years of the same books', () => {
  const merge = (u, target, from) => request(app).post(`/api/upload/${target}/fec-years`).use(as(u)).send({ from });
  const yearRows = (u, id) => sql(u, id, 'SELECT FiscalYear, COUNT(*)::INTEGER AS n FROM entries GROUP BY 1 ORDER BY 1');

  test('a second year of the same company is offered, merged into one table, and compared', async () => {
    const u = seedUser({ role: 'admin' });
    // A SIREN of its own: an admin sees the sources the other tests imported.
    const name = (year, prefix = '') => `${prefix}${fecName(year, '111111111')}`;
    const first = await upload(u, name(2025), fecFile(2025));
    expect(first.body.accounting.fiscalYear).toBe(2025);
    const second = await upload(u, name(2024), fecFile(2024));
    expect(second.body.sameCompany).toEqual([{ id: first.body.datasource.id, name: first.body.datasource.name, years: [2025] }]);

    const target = first.body.datasource.id;
    const merged = await merge(u, target, second.body.datasource.id);
    expect(merged.status).toBe(200);
    expect(merged.body.years).toEqual([{ year: 2024, rows: ROWS.length }, { year: 2025, rows: ROWS.length }]);
    expect(await yearRows(u, target)).toEqual([{ FiscalYear: 2024, n: ROWS.length }, { FiscalYear: 2025, n: ROWS.length }]);
    const extra = JSON.parse(db.prepare('SELECT extra_config FROM datasources WHERE id = ?').get(target).extra_config);
    expect(extra.files.map((x) => x.accounting.fiscalYear)).toEqual([2024, 2025]);
    expect(extra.tables).toEqual([{ tableName: 'entries', rowCount: 2 * ROWS.length }]);

    // A newer export of a year replaces that year, never doubles it.
    const again = await upload(u, name(2025, 'v2_'), fecFile(2025));
    await merge(u, target, again.body.datasource.id);
    expect(await yearRows(u, target)).toEqual([{ FiscalYear: 2024, n: ROWS.length }, { FiscalYear: 2025, n: ROWS.length }]);

    // Refreshing one year of the source goes through the same merge.
    const refreshed = await request(app).put(`/api/upload/${target}`).use(as(u)).field('sourceFile', name(2024)).attach('file', fecFile(2024), name(2024));
    expect(refreshed.status).toBe(200);
    expect(await yearRows(u, target)).toEqual([{ FiscalYear: 2024, n: ROWS.length }, { FiscalYear: 2025, n: ROWS.length }]);

    const pack = await request(app).get(`/api/upload/${target}/fec-pack`).use(as(u));
    expect(pack.body.accounting.years).toEqual([2024, 2025]);
    expect(pack.body.plan.report.bundle.report.pages.map((p) => p.name)).toContain('Year over year');
    const m = await request(app).post('/api/models/import').use(as(u)).send({ yaml: pack.body.plan.model.yaml, datasourceId: target });
    const byYear = await request(app).post(`/api/models/${m.body.model.id}/query`).use(as(u)).send({ dimensionNames: ['entries.FiscalYear'], measureNames: ['_calc.revenue', '_calc.netIncome'] });
    expect(byYear.body.rows.map((r) => [Number(r['Fiscal year']), Number(r.Revenue), Number(r['Net income'])])).toEqual([[2024, 1000, 250], [2025, 1000, 250]]);
  });

  test('an account renamed between two years stays one account, under its latest label', async () => {
    const u = seedUser({ role: 'admin' });
    const name = (year) => fecName(year, '333333333');
    const recent = await upload(u, name(2025), fecFile(2025));
    const older = await upload(u, name(2024), Buffer.from(fecFile(2024).toString('latin1').replace('641100\tSalaries', '641100\tWages'), 'latin1'));
    await merge(u, recent.body.datasource.id, older.body.datasource.id);
    const rows = await sql(u, recent.body.datasource.id, "SELECT DISTINCT Account FROM entries WHERE CompteNum = '641100'");
    expect(rows).toEqual([{ Account: '641100 Salaries' }]);
  });

  // A merge copies the entries: books of another workspace are never offered
  // nor merged, even to someone who manages both.
  test('books of another workspace are not merged', async () => {
    const u = seedUser({ role: 'editor' });
    const ws = seedWorkspace({ ownerId: u, name: 'Accounting' });
    const team = await request(app).post('/api/upload').use(as(u)).field('workspaceId', ws).attach('file', fecFile(2025), fecName(2025, '444444444'));
    expect(team.status).toBe(201);
    const personal = await upload(u, fecName(2024, '444444444'), fecFile(2024));
    expect(personal.body.sameCompany).toEqual([]);
    expect((await merge(u, team.body.datasource.id, personal.body.datasource.id)).status).toBe(403);
    expect((await merge(u, personal.body.datasource.id, team.body.datasource.id)).status).toBe(403);
  });

  test("another company's books are not merged", async () => {
    const u = seedUser({ role: 'admin' });
    const ours = await upload(u, fecName(2025, '222222222'), fecFile(2025));
    const theirs = await upload(u, fecName(2024, '987654321'), fecFile(2024));
    expect(theirs.body.sameCompany).toEqual([]);
    const res = await merge(u, ours.body.datasource.id, theirs.body.datasource.id);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/another company/);
  });
});
