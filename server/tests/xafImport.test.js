// A Dutch XML Auditfile Financieel (XAF 3.2 or 4.0) is recognised by its root
// element, its accounts classified by the RGS code their package ties them to
// (leadReference in 3.2, RGScode in 4.0), its opening balance written once,
// and offered the Finance package — whose figures must be the books' own.
const request = require('supertest');
const rgs = require('../utils/accounting/rgs');

// Every import runs in a child process (utils/fileImport.js).
jest.setTimeout(60000);
const { buildApp, seedUser } = require('./helpers/testApp');

const app = buildApp();
const as = (uid) => (r) => r.set('x-test-user', uid);

const ACCOUNTS = [
  ['1000', 'Kas', 'B', 'BLimKasKas'], ['1300', 'Debiteuren', 'B', 'BVorDebHad'], ['1600', 'Crediteuren', 'B', 'BSchCreHac'],
  ['0500', 'Geplaatst kapitaal', 'B', 'BEivGokGea'], ['1500', 'Af te dragen btw', 'B', 'BSchBepBtwAfo'],
  ['8000', 'Omzet', 'P', 'WOmzNopOlh'], ['7000', 'Inkoopwaarde', 'P', 'WKprInhInh'], ['4000', 'Lonen', 'P', 'WPerLesLon'],
  ['4300', 'Huur', 'P', 'WBedHuiHur'], ['4800', 'Afschrijvingen', 'P', 'WAfsAmvBeg'], ['9000', 'Rentebaten', 'P', 'WFbeRlmOvr'],
  ['9100', 'Rentelasten', 'P', 'WFbeRlsKbk'], ['9500', 'Vennootschapsbelasting', 'P', 'WBelBgrBgr'], ['4999', 'Zonder code', 'P', ''],
];
const LINES = [
  ['S', 'V1', '03-01', 'Verkoop', [['1300', 1210, 'D', 'K1'], ['8000', 1000, 'C'], ['1500', 210, 'C']]],
  ['P', 'I1', '03-05', 'Inkoop', [['7000', 400, 'D'], ['1600', 400, 'C', 'L1']]],
  ['M', 'M1', '03-31', 'Lonen maart', [['4000', 300, 'D'], ['1000', 300, 'C']]],
  ['M', 'M2', '04-01', 'Huur', [['4300', 100, 'D'], ['1000', 100, 'C']]],
  ['M', 'M3', '12-31', 'Afschrijving', [['4800', 50, 'D'], ['1000', 50, 'C']]],
  ['M', 'M4', '12-31', 'Rente', [['1000', 20, 'D'], ['9000', 20, 'C'], ['9100', 10, 'D'], ['1000', 10, 'C']]],
  ['M', 'M5', '12-31', 'Vpb', [['9500', 40, 'D'], ['1000', 40, 'C']]],
  ['M', 'M6', '12-31', 'Diverse', [['4999', 5, 'D'], ['1000', 5, 'C']]],
  // The opening balance again as a journal of type O: listed once.
  ['O', 'B1', '01-01', 'Beginbalans', [['1000', 5000, 'D'], ['0500', 5000, 'C']]],
];

// XAF 3.2 (RGS in leadReference) or 4.0 (RGScode); `latin1`: the bytes of
// Windows-1252 under a UTF-8 declaration, as some packages write them.
function xafFile({ version = '3.2', year = 2024, vat = 'NL123456789B01', latin1 = false } = {}) {
  const v4 = version === '4.0';
  const ns = v4 ? 'http://www.odb.belastingdienst.nl/Belastingdienst/BCPP/1.1/structures/XmlauditfileXAF_4.0' : 'http://www.auditfiles.nl/XAF/3.2';
  const account = ([id, desc, tp, code]) => `<ledgerAccount><accID>${id}</accID><accDesc>${desc}</accDesc><accTp>${tp}</accTp>${code ? (v4 ? `<RGScode>${code}</RGScode>` : `<leadCode>${id.slice(0, 2)}</leadCode><leadReference>${code}</leadReference>`) : ''}</ledgerAccount>`;
  const journals = [...new Set(LINES.map((l) => l[0]))].map((j) => `<journal><jrnID>${j}</jrnID><desc>Dagboek ${j}</desc><jrnTp>${j}</jrnTp>${
    LINES.filter((l) => l[0] === j).map(([, nr, date, desc, lines]) => `<transaction><nr>${nr}</nr><desc>${desc}</desc><periodNumber>${Number(date.slice(0, 2))}</periodNumber><trDt>${year}-${date}</trDt>${
      lines.map(([acc, amnt, tp, party], i) => `<trLine><nr>${i + 1}</nr><accID>${acc}</accID><docRef>${nr}</docRef><effDate>${year}-${date}</effDate><desc>${desc} - café</desc><amnt>${amnt.toFixed(2)}</amnt><amntTp>${tp}</amntTp>${party ? `<custSupID>${party}</custSupID>` : ''}</trLine>`).join('')
    }</transaction>`).join('')}</journal>`).join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<auditfile xmlns="${ns}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<header><fiscalYear>${year}</fiscalYear><startDate>${year}-01-01</startDate><endDate>${year}-12-31</endDate><curCode>EUR</curCode><dateCreated>${year + 1}-01-10</dateCreated>${v4 ? '<RGSVersion>3.8</RGSVersion>' : ''}</header>
<company>${v4 ? '<Commercenr>12345678</Commercenr>' : '<companyIdent>1</companyIdent>'}<companyName>Bakkerij Één B.V.</companyName><taxRegistrationCountry>NL</taxRegistrationCountry><taxRegIdent>${vat}</taxRegIdent>
<customersSuppliers><customerSupplier><custSupID>K1</custSupID><custSupName>Café De Gouden Leeuw</custSupName><custSupTp>C</custSupTp></customerSupplier><customerSupplier><custSupID>L1</custSupID><custSupName>Meelfabriek Noord</custSupName><custSupTp>S</custSupTp></customerSupplier></customersSuppliers>
<generalLedger>${ACCOUNTS.map(account).join('')}</generalLedger>
<openingBalance><opBalDate>${year}-01-01</opBalDate><linesCount>2</linesCount><totalDebit>5000.00</totalDebit><totalCredit>5000.00</totalCredit><obLine><nr>1</nr><accID>1000</accID><amnt>5000.00</amnt><amntTp>D</amntTp></obLine><obLine><nr>2</nr><accID>0500</accID><amnt>5000.00</amnt><amntTp>C</amntTp></obLine></openingBalance>
<transactions><linesCount>20</linesCount><totalDebit>0</totalDebit><totalCredit>0</totalCredit>
${journals}
</transactions>
</company>
</auditfile>
`;
  return Buffer.from(xml, latin1 ? 'latin1' : 'utf8');
}

async function upload(uid, name, content) {
  return request(app).post('/api/upload').use(as(uid)).attach('file', content, name);
}
const sql = async (uid, id, text) => {
  const res = await request(app).post(`/api/datasources/${id}/query`).use(as(uid)).send({ sql: text });
  expect(res.status).toBe(200);
  return res.body.rows;
};

describe('RGS chart', () => {
  test.each([
    ['WOmzNopOlh', 1], ['WWivWgp', 2], ['WWivGpv', 3], ['WOvbOvo', 4], ['WKprInhInh', 5], ['WKprKuw', 6], ['WPerLesLon', 7], ['WBedHuiHur', 8],
    ['WAfsAmvBeg', 9], ['WBwvObw', 10], ['WFbeRlmOvr', 11], ['WFbeRlsKbk', 12], ['WFbeWis', 12], ['WBelBgr', 13], ['WRedAir', 14],
  ])('%s sits on line %i', (code, no) => {
    expect(rgs.classifyAccount(code)).toMatchObject({ statement: 'Income statement', lineNo: no });
  });

  test('balance-sheet groups, the net result apart, lines without gaps', () => {
    expect(rgs.classifyAccount('BVorDebHad').line).toBe('B04 Trade receivables');
    expect(rgs.classifyAccount('BVorOvr').line).toBe('B05 Other receivables');
    expect(rgs.classifyAccount('BSchCreHac').line).toBe('B10 Trade payables');
    expect(rgs.classifyAccount('WNerNew').statement).toBe('Result allocation');
    expect(rgs.classifyAccount('8000').statement).toBe('Unclassified');
    expect(rgs.LINES.map((l) => l.no)).toEqual(rgs.LINES.map((_, i) => i + 1));
  });
});

describe('XAF import', () => {
  const RESULT = 1000 - 400 - 300 - 100 - 50 + 20 - 10 - 40;

  test('XAF 3.2 under a wrong UTF-8 declaration: RGS from leadReference, the opening balance once, the books\' result', async () => {
    const u = seedUser({ role: 'editor' });
    const res = await upload(u, 'auditfile_2024.xaf', xafFile({ latin1: true }));
    expect(res.status).toBe(201);
    expect(res.body.accounting).toMatchObject({
      kind: 'xaf', chart: 'rgs', country: 'NL', currency: 'EUR', companyId: 'NL123456789B01', companyName: 'Bakkerij Één B.V.',
      fiscalYear: 2024, balanced: true, unbalancedEntries: 0, rgsAccounts: 13, unclassifiedAccounts: ['4999'],
    });
    // The account without a code stays out of the result until it is mapped.
    expect(res.body.accounting.netIncome).toBe(RESULT);
    const id = res.body.datasource.id;
    const [opening] = await sql(u, id, "SELECT COUNT(*)::INTEGER AS n, SUM(Debit)::DOUBLE AS d FROM entries WHERE CompteNum = '1000' AND Debit = 5000");
    expect(opening).toEqual({ n: 1, d: 5000 });
    const [sale] = await sql(u, id, "SELECT CompAuxLib, EcritureLib, Line FROM entries WHERE CompteNum = '1300'");
    expect(sale).toEqual({ CompAuxLib: 'Café De Gouden Leeuw', EcritureLib: 'Verkoop - café', Line: 'B04 Trade receivables' });

    const pack = await request(app).get(`/api/upload/${id}/fec-pack`).use(as(u));
    expect(pack.status).toBe(200);
    const m = await request(app).post('/api/models/import').use(as(u)).send({ yaml: pack.body.plan.model.yaml, datasourceId: id });
    const q = await request(app).post(`/api/models/${m.body.model.id}/query`).use(as(u)).send({ measureNames: ['_calc.revenue', '_calc.ebitda', '_calc.netIncome', '_calc.receivables', '_calc.payables'] });
    const [row] = q.body.rows;
    expect([row.Revenue, row.EBITDA, row['Net result after taxes'], row['Customer balance'], row['Supplier balance']].map(Number)).toEqual([1000, 200, RESULT, 1210, 400]);
  });

  test('XAF 4.0: RGScode, the Chamber of Commerce number when there is no VAT number; years merge', async () => {
    const u = seedUser({ role: 'editor' });
    const y2024 = await upload(u, 'xaf4_2024.xaf', xafFile({ version: '4.0', vat: '' }));
    expect(y2024.status).toBe(201);
    expect(y2024.body.accounting).toMatchObject({ companyId: '12345678', rgsAccounts: 13, netIncome: RESULT });
    const y2023 = await upload(u, 'xaf4_2023.xml', xafFile({ version: '4.0', vat: '', year: 2023 }));
    expect(y2023.body.sameCompany.map((s) => s.id)).toEqual([y2024.body.datasource.id]);
  });

  test('an auditfile with no transactions is refused with what to export', async () => {
    const u = seedUser({ role: 'editor' });
    const res = await upload(u, 'leeg.xaf', Buffer.from('<?xml version="1.0"?><auditfile xmlns="http://www.auditfiles.nl/XAF/3.2"><header><fiscalYear>2024</fiscalYear></header><company><companyName>X</companyName></company></auditfile>'));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body.error).toMatch(/no transactions/);
  });
});
