// A Swedish SIE 4 file is recognised by its first record, read in its PC8
// code page, its vouchers written out as entries classified on the BAS chart
// and its opening balances as an opening entry — and offered the Finance
// package, whose figures must be the books' own.
const request = require('supertest');
const bas = require('../utils/accounting/bas');
const { fieldsOf, decodeCp437 } = require('../utils/accounting/sie');

// Every import runs in a child process (utils/fileImport.js).
jest.setTimeout(60000);
const { buildApp, seedUser } = require('./helpers/testApp');

const app = buildApp();
const as = (uid) => (r) => r.set('x-test-user', uid);

// PC8 (code page 437), as the spec has SIE files written.
const HIGH = decodeCp437(Buffer.from(Array.from({ length: 128 }, (_, i) => 0x80 + i)));
const pc8 = (text) => Buffer.from([...text].map((c) => (c.charCodeAt(0) < 0x80 ? c.charCodeAt(0) : 0x80 + HIGH.indexOf(c))));

function sieFile({ orgnr = '556677-8899', year = 2024 } = {}) {
  return pc8([
    '#FLAGGA 0',
    '#FORMAT PC8',
    '#SIETYP 4',
    '#PROGRAM "Testprogram" 1.0',
    `#GEN ${year + 1}0115`,
    '#FNAMN "Älvsjö Bageri AB"',
    `#ORGNR ${orgnr}`,
    `#RAR 0 ${year}0101 ${year}1231`,
    `#RAR -1 ${year - 1}0101 ${year - 1}1231`,
    '#KPTYP BAS2014',
    '#VALUTA SEK',
    '#KONTO 1510 Kundfordringar',
    '#KONTO 1930 "Företagskonto"',
    '#KONTO 2081 "Aktiekapital"',
    '#KONTO 2440 "Leverantörsskulder"',
    '#KONTO 2611 "Utgående moms 25 %"',
    '#KONTO 3001 "Försäljning inom Sverige, 25 % moms"',
    '#KONTO 4010 "Inköp material och varor"',
    '#KONTO 5010 Lokalhyra',
    '#KONTO 7010 "Löner till kollektivanställda"',
    '#KONTO 7832 "Avskrivningar på inventarier"',
    '#KONTO 8310 Ränteintäkter',
    '#KONTO 8910 "Skatt som belastar årets resultat"',
    `#IB 0 1930 50000.00`,
    `#IB 0 2081 -50000.00`,
    `#IB -1 1930 20000.00`,
    `#VER A 1 ${year}0115 "Faktura \\"Kafé Linnéa\\"" ${year}0116`,
    '{',
    '   #TRANS 1510 {} 12500.00',
    '   #TRANS 3001 {} -10000.00',
    '   #TRANS 2611 {} -2500.00',
    '}',
    `#VER A 2 ${year}0201 "Mjöl" ${year}0201`,
    '{',
    '   #TRANS 4010 {} 4000.00',
    '   #TRANS 2440 {} -4000.00',
    '}',
    `#VER A 3 ${year}0228 "Hyra februari"`,
    '{',
    '   #TRANS 5010 {} 1500.00 "" "Lokal"',
    '   #TRANS 1930 {} -1500.00',
    // A correction: the removed line is gone from the books, the added one
    // is repeated as a #TRANS.
    '   #BTRANS 1930 {} -1000.00',
    '   #RTRANS 7010 {} 0.00',
    '}',
    `#VER L 1 ${year}0325 "Löner mars"`,
    '{',
    '   #TRANS 7010 {1 "Nord"} 2000.00',
    '   #TRANS 1930 {} -2000.00',
    '}',
    `#VER B 1 ${year}1231 "Avskrivning, ränta, skatt"`,
    '{',
    '   #TRANS 7832 {} 300.00',
    '   #TRANS 8310 {} -100.00',
    '   #TRANS 8910 {} 500.00',
    '   #TRANS 1930 {} -700.00',
    '}',
  ].join('\r\n'));
}

async function upload(uid, name, content) {
  return request(app).post('/api/upload').use(as(uid)).attach('file', content, name);
}
const sql = async (uid, id, text) => {
  const res = await request(app).post(`/api/datasources/${id}/query`).use(as(uid)).send({ sql: text });
  expect(res.status).toBe(200);
  return res.body.rows;
};

describe('SIE parsing', () => {
  test('fields: words, quoted strings with escaped quotes, object lists kept whole', () => {
    expect(fieldsOf('#VER A 1 20240115 "Faktura \\"Kafé\\"" 20240116')).toEqual(['#VER', 'A', '1', '20240115', 'Faktura "Kafé"', '20240116']);
    expect(fieldsOf('#TRANS 7010 {1 "Nord" 6 "P1"} 2000.00 20240325 "Lön"')).toEqual(['#TRANS', '7010', '{1 "Nord" 6 "P1"}', '2000.00', '20240325', 'Lön']);
  });

  test('PC8 reads the Swedish letters', () => {
    expect(decodeCp437(Buffer.from([0x86, 0x84, 0x94, 0x8f, 0x8e, 0x99]))).toBe('åäöÅÄÖ');
  });

  test.each([
    ['3001', 1], ['3740', 1], ['3800', 2], ['3990', 3], ['4010', 4], ['4990', 4], ['5010', 5], ['6570', 5], ['7010', 6], ['7510', 6],
    ['7990', 7], ['7832', 8], ['7720', 8], ['8310', 9], ['8410', 10], ['8810', 11], ['8910', 12],
  ])('BAS %s sits on line %i', (account, no) => {
    expect(bas.classifyAccount(account)).toMatchObject({ statement: 'Income statement', lineNo: no });
  });

  test('the year-end result stands apart, the lines are numbered without gaps', () => {
    expect(bas.classifyAccount('8999').statement).toBe('Result allocation');
    expect(bas.classifyAccount('1510')).toMatchObject({ statement: 'Balance sheet', line: 'Class 15-17 Receivables & prepayments' });
    expect(bas.LINES.map((l) => l.no)).toEqual(bas.LINES.map((_, i) => i + 1));
  });
});

describe('SIE import', () => {
  test('a SIE 4 file becomes one classified table, opening balances included, the books\' result', async () => {
    const u = seedUser({ role: 'editor' });
    const res = await upload(u, 'Bageri 2024.se', sieFile());
    expect(res.status).toBe(201);
    expect(res.body.accounting).toMatchObject({
      kind: 'sie', chart: 'bas', country: 'SE', currency: 'SEK', companyId: '556677-8899', companyName: 'Älvsjö Bageri AB',
      fiscalYear: 2024, balanced: true, unbalancedEntries: 0, netIncome: 10000 - 4000 - 1500 - 2000 - 300 + 100 - 500, unclassifiedAccounts: [],
    });
    const id = res.body.datasource.id;
    const opening = await sql(u, id, "SELECT CompteNum, Debit::DOUBLE AS d, Credit::DOUBLE AS c, strftime(EcritureDate, '%Y-%m-%d') AS day FROM entries WHERE JournalCode = 'IB' ORDER BY 1");
    expect(opening).toEqual([{ CompteNum: '1930', d: 50000, c: 0, day: '2024-01-01' }, { CompteNum: '2081', d: 0, c: 50000, day: '2024-01-01' }]);
    const [sale] = await sql(u, id, "SELECT EcritureNum, EcritureLib, CompteLib, Line, Credit::DOUBLE AS c FROM entries WHERE CompteNum = '3001'");
    expect(sale).toEqual({ EcritureNum: 'A1', EcritureLib: 'Faktura "Kafé Linnéa"', CompteLib: 'Försäljning inom Sverige, 25 % moms', Line: '01 Net sales', c: 10000 });
    // The correction's lines are not entries of their own.
    const [rent] = await sql(u, id, "SELECT COUNT(*)::INTEGER AS n FROM entries WHERE EcritureNum = 'A3'");
    expect(rent.n).toBe(2);
    const [line] = await sql(u, id, "SELECT EcritureLib FROM entries WHERE CompteNum = '5010'");
    expect(line.EcritureLib).toBe('Lokal');

    const pack = await request(app).get(`/api/upload/${id}/fec-pack`).use(as(u));
    expect(pack.status).toBe(200);
    const buildUp = pack.body.plan.report.bundle.report.pages.find((p) => p.name === 'Profit build-up');
    expect(Object.values(buildUp.widgets).filter((w) => w.type === 'scorecard').map((w) => w.config.label))
      .toEqual(['Gross profit', 'EBITDA', 'Operating result', 'Result after financial items', 'Net result for the year', 'Net margin (net result for the year ÷ revenue)']);
    const m = await request(app).post('/api/models/import').use(as(u)).send({ yaml: pack.body.plan.model.yaml, datasourceId: id });
    const q = await request(app).post(`/api/models/${m.body.model.id}/query`).use(as(u)).send({ measureNames: ['_calc.revenue', '_calc.ebitda', '_calc.operatingIncome', '_calc.netIncome'] });
    const [row] = q.body.rows;
    expect([row.Revenue, row.EBITDA, row['Operating result'], row['Net result for the year']].map(Number)).toEqual([10000, 2500, 2200, 1800]);
  });

  test('two years of one company merge; a .se file that is not SIE is refused', async () => {
    const u = seedUser({ role: 'editor' });
    const y2024 = await upload(u, 'b2024.se', sieFile({ orgnr: '559900-0011' }));
    const y2023 = await upload(u, 'b2023.se', sieFile({ orgnr: '559900-0011', year: 2023 }));
    expect(y2023.body.sameCompany.map((s) => s.id)).toEqual([y2024.body.datasource.id]);
    const merged = await request(app).post(`/api/upload/${y2024.body.datasource.id}/fec-years`).use(as(u)).send({ from: y2023.body.datasource.id });
    expect(merged.body.years.map((y) => y.year)).toEqual([2023, 2024]);
    const bad = await upload(u, 'notes.se', Buffer.from('hello'));
    expect(bad.status).toBeGreaterThanOrEqual(400);
    expect(bad.body.error).toMatch(/SIE/);
  });
});
