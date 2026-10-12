// A German DATEV bookings export (EXTF Buchungsstapel) is recognised by its
// first line, each booking split into its two sides — and into net and VAT
// where DATEV would — customers and suppliers rolled up to their collective
// accounts, and offered the Finance package on SKR03 or SKR04.
const request = require('supertest');
const SKR = require('../utils/accounting/skr');
const { bookingDate, splitCsv } = require('../utils/accounting/datev');

// Every import runs in a child process (utils/fileImport.js).
jest.setTimeout(60000);
const { buildApp, seedUser } = require('./helpers/testApp');

const app = buildApp();
const as = (uid) => (r) => r.set('x-test-user', uid);

const COLUMNS = 'Umsatz (ohne Soll/Haben-Kz);Soll/Haben-Kennzeichen;WKZ Umsatz;Kurs;Basis-Umsatz;WKZ Basis-Umsatz;Konto;Gegenkonto (ohne BU-Schlüssel);BU-Schlüssel;Belegdatum;Belegfeld 1;Belegfeld 2;Skonto;Buchungstext';
// [amount, S/H, Konto, Gegenkonto, BU key, date, document, text]
function datevFile(rows, { adviser = '1001', client = '456', start = '20240101', from = '20240101', to = '20241231', skr = '' } = {}) {
  const header = `"EXTF";700;21;"Buchungsstapel";13;20250115120000000;;"RE";"Kanzlei";;${adviser};${client};${start};4;${from};${to};"Buchungen 2024";;1;;0;"EUR";;;;;"${skr}";;;;`;
  const body = rows.map(([amount, side, konto, gegen, key, date, doc, text]) => `${amount};"${side}";"EUR";;;;${konto};${gegen};"${key}";${date};"${doc}";;;"${text}"`);
  // Windows-1252, as DATEV writes it.
  return Buffer.from([header, COLUMNS, ...body].join('\r\n'), 'latin1');
}

async function upload(uid, name, content) {
  return request(app).post('/api/upload').use(as(uid)).attach('file', content, name);
}
const sql = async (uid, id, text) => {
  const res = await request(app).post(`/api/datasources/${id}/query`).use(as(uid)).send({ sql: text });
  expect(res.status).toBe(200);
  return res.body.rows;
};

describe('DATEV parsing', () => {
  test('quoted fields keep their semicolons and quotes', () => {
    expect(splitCsv('1,00;"S";"Miete; Büro ""Nord""";;8400')).toEqual(['1,00', 'S', 'Miete; Büro "Nord"', '', '8400']);
  });

  test('a booking date takes its year from the batch period, across a fiscal year that starts in July', () => {
    expect(bookingDate('102', { from: '20240101', to: '20241231' })).toBe('2024-02-01');
    expect(bookingDate('3112', { from: '20240101', to: '20241231' })).toBe('2024-12-31');
    expect(bookingDate('1503', { from: '20240701', to: '20250630' })).toBe('2025-03-15');
    expect(bookingDate('1508', { from: '20240701', to: '20250630' })).toBe('2024-08-15');
    expect(bookingDate('15032025', {})).toBe('2025-03-15');
  });

  test.each([
    ['skr03', '8400', 1], ['skr03', '8960', 2], ['skr03', '8990', 3], ['skr03', '2700', 4], ['skr03', '3400', 5], ['skr03', '4120', 6],
    ['skr03', '4210', 7], ['skr03', '2400', 7], ['skr03', '4830', 8], ['skr03', '2650', 9], ['skr03', '2100', 10], ['skr03', '4320', 11], ['skr03', '4340', 12],
    ['skr04', '4400', 1], ['skr04', '4800', 2], ['skr04', '4830', 4], ['skr04', '5400', 5], ['skr04', '6020', 6], ['skr04', '6310', 7], ['skr04', '6220', 8],
    ['skr04', '7100', 9], ['skr04', '7300', 10], ['skr04', '7610', 11], ['skr04', '7685', 12],
  ])('%s %s sits on line %i', (chart, account, no) => {
    expect(SKR[chart].classifyAccount(account)).toMatchObject({ statement: 'Income statement', lineNo: no });
  });

  test('stocks inside SKR03 class 3 are on the balance sheet, carry-forwards in neither statement', () => {
    expect(SKR.skr03.classifyAccount('3980').statement).toBe('Balance sheet');
    expect(SKR.skr03.classifyAccount('9000').statement).toBe('Carry-forward');
    expect(SKR.skr04.classifyAccount('1800').statement).toBe('Balance sheet');
  });
});

describe('DATEV import', () => {
  const SKR03_ROWS = [
    // Opening balances against the carry-forward account.
    ['10000,00', 'S', '1200', '9000', '', '101', 'EB', 'Saldovortrag Bank'],
    ['10000,00', 'H', '0800', '9000', '', '101', 'EB', 'Saldovortrag Kapital'],
    // A sale to customer 10001 on the 19 % automatic account: gross, split by the import.
    ['1190,00', 'S', '10001', '8400', '', '1501', 'RE-1', 'Verkauf Brötchen'],
    // A purchase from supplier 70001 on the 19 % automatic purchase account.
    ['595,00', 'H', '70001', '3400', '', '2001', 'ER-7', 'Mehl Großhandel'],
    // Office supplies paid by bank with tax key 9 (19 % input VAT).
    ['119,00', 'H', '1200', '4930', '9', '502', 'K-3', 'Bürobedarf'],
    // Salaries, no VAT; trade tax.
    ['300,00', 'S', '4120', '1200', '', '3103', 'L-3', 'Gehälter März'],
    ['50,00', 'S', '4320', '1200', '', '1012', 'GewSt', 'Gewerbesteuer'],
    // Key 40: DATEV's automatic split switched off for this booking.
    ['100,00', 'S', '1200', '8400', '40', '1112', 'RE-2', 'Erlös ohne Automatik'],
  ];

  test('an SKR03 export: bookings in two sides, VAT split, customers on 1400, the result the books add up to', async () => {
    const u = seedUser({ role: 'editor' });
    const res = await upload(u, 'EXTF_Buchungsstapel_2024.csv', datevFile(SKR03_ROWS));
    expect(res.status).toBe(201);
    expect(res.body.accounting).toMatchObject({
      kind: 'datev', chart: 'skr03', country: 'DE', currency: 'EUR', companyId: '1001-456', fiscalYear: 2024,
      balanced: true, unbalancedEntries: 0, netIncome: 1000 - 500 - 100 - 300 - 50 + 100, unclassifiedAccounts: [],
    });
    const id = res.body.datasource.id;
    const rows = await sql(u, id, "SELECT CompteNum, SUM(Debit)::DOUBLE AS d, SUM(Credit)::DOUBLE AS c FROM entries GROUP BY 1 ORDER BY 1");
    const by = Object.fromEntries(rows.map((r) => [r.CompteNum, [r.d, r.c]]));
    expect(by['8400']).toEqual([0, 1100]);
    expect(by['1776']).toEqual([0, 190]);
    expect(by['3400']).toEqual([500, 0]);
    expect(by['1576']).toEqual([95 + 19, 0]);
    expect(by['1400']).toEqual([1190, 0]);
    expect(by['1600']).toEqual([0, 595]);
    const [sale] = await sql(u, id, "SELECT CompAuxNum, CompAuxLib, strftime(EcritureDate, '%Y-%m-%d') AS d, PieceRef, EcritureLib FROM entries WHERE CompteNum = '1400'");
    expect(sale).toEqual({ CompAuxNum: '10001', CompAuxLib: 'Customer 10001', d: '2024-01-15', PieceRef: 'RE-1', EcritureLib: 'Verkauf Brötchen' });
    const [carry] = await sql(u, id, "SELECT DISTINCT Statement FROM entries WHERE CompteNum = '9000'");
    expect(carry.Statement).toBe('Carry-forward');

    const pack = await request(app).get(`/api/upload/${id}/fec-pack`).use(as(u));
    expect(pack.status).toBe(200);
    const m = await request(app).post('/api/models/import').use(as(u)).send({ yaml: pack.body.plan.model.yaml, datasourceId: id });
    const q = await request(app).post(`/api/models/${m.body.model.id}/query`).use(as(u)).send({ measureNames: ['_calc.revenue', '_calc.netIncome', '_calc.receivables', '_calc.payables'] });
    expect([q.body.rows[0].Revenue, q.body.rows[0]['Net income for the year'], q.body.rows[0]['Customer balance'], q.body.rows[0]['Supplier balance']].map(Number)).toEqual([1100, 150, 1190, 595]);
  });

  test('an SKR04 export is told from its accounts when the batch does not say', async () => {
    const u = seedUser({ role: 'editor' });
    const res = await upload(u, 'export.txt', datevFile([
      ['2380,00', 'S', '10002', '4400', '', '1004', 'A1', 'Umsatz'],
      ['500,00', 'S', '6020', '1800', '', '3004', 'L1', 'Gehälter'],
    ], { client: '789' }));
    expect(res.status).toBe(201);
    expect(res.body.accounting).toMatchObject({ kind: 'datev', chart: 'skr04', netIncome: 1500 });
    const rows = await sql(u, res.body.datasource.id, "SELECT CompteNum FROM entries WHERE CompAuxNum = '10002'");
    expect(rows).toEqual([{ CompteNum: '1200' }]);
  });

  test('two years of one client merge; a DATEV file of another kind is refused', async () => {
    const u = seedUser({ role: 'editor' });
    const y2024 = await upload(u, 'EXTF_2024.csv', datevFile(SKR03_ROWS, { client: '901' }));
    const y2023 = await upload(u, 'EXTF_2023.csv', datevFile(SKR03_ROWS, { client: '901', start: '20230101', from: '20230101', to: '20231231' }));
    expect(y2023.body.accounting.fiscalYear).toBe(2023);
    expect(y2023.body.sameCompany.map((s) => s.id)).toEqual([y2024.body.datasource.id]);
    const merged = await request(app).post(`/api/upload/${y2024.body.datasource.id}/fec-years`).use(as(u)).send({ from: y2023.body.datasource.id });
    expect(merged.body.years.map((y) => y.year)).toEqual([2023, 2024]);

    const names = Buffer.from('"EXTF";700;20;"Kontenbeschriftungen";2;20250115120000000;;"RE";"Kanzlei";;1001;456;20240101;4;;;"";;;;;;;;;;;;;\r\nKonto;Kontenbeschriftung\r\n8400;Erlöse 19 % USt', 'latin1');
    const refused = await upload(u, 'EXTF_Kontenbeschriftungen.csv', names);
    expect(refused.status).toBeGreaterThanOrEqual(400);
    expect(refused.body.error).toMatch(/Buchungsstapel/);
  });
});
