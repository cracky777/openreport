// Books from Denmark (SAF-T DK, standard chart by ranges), Austria (SAF-T AT,
// EKR accounts), Poland (JPK_KR_PD, accounts placed by their markers) and
// Bulgaria (SAF-T BG, no chart read here: every account to be placed by
// hand) become the same `entries` table, each with its own income statement
// and the books' own result.
const request = require('supertest');
const dk = require('../utils/accounting/dk');
const at = require('../utils/accounting/at');
const pl = require('../utils/accounting/pl');
const { rangePrefixes } = require('../utils/accounting/prefixChart');

// Every import runs in a child process (utils/fileImport.js).
jest.setTimeout(60000);
const { buildApp, seedUser } = require('./helpers/testApp');

const app = buildApp();
const as = (uid) => (r) => r.set('x-test-user', uid);

async function upload(uid, name, content) {
  return request(app).post('/api/upload').use(as(uid)).attach('file', Buffer.from(content, 'utf8'), name);
}
const sql = async (uid, id, text) => {
  const res = await request(app).post(`/api/datasources/${id}/query`).use(as(uid)).send({ sql: text });
  expect(res.status).toBe(200);
  return res.body.rows;
};
const incomeLines = (uid, id) => sql(uid, id, "SELECT Line, SUM(Amount)::DOUBLE AS amount FROM entries WHERE Statement = 'Income statement' GROUP BY 1 ORDER BY 1");

// An OECD-style audit file: `accounts` [id, name, standard, opening],
// `entries` [id, date, text, [[account, debit, credit]]]; `bare` writes
// amounts flat (SAF-T 1.0, Austria), `lineTag` the line element's name.
function auditFile({ ns, country, header, accounts, entries, bare = false, lineTag = 'Line', standardTag = 'StandardAccountID' }) {
  const amount = (side, v) => (bare ? `<${side}>${v.toFixed(2)}</${side}>` : `<${side}><Amount>${v.toFixed(2)}</Amount></${side}>`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<AuditFile xmlns="${ns}">
<Header>${country ? `<AuditFileCountry>${country}</AuditFileCountry>` : ''}${header}</Header>
<MasterFiles><GeneralLedgerAccounts>${accounts.map(([id, name, std, opening = 0]) => `<Account><AccountID>${id}</AccountID><AccountDescription>${name}</AccountDescription>${std ? `<${standardTag}>${std}</${standardTag}>` : ''}<AccountType>GL</AccountType>${opening >= 0 ? `<OpeningDebitBalance>${opening}</OpeningDebitBalance>` : `<OpeningCreditBalance>${-opening}</OpeningCreditBalance>`}</Account>`).join('')}</GeneralLedgerAccounts></MasterFiles>
<GeneralLedgerEntries><Journal><JournalID>GL</JournalID><Description>General</Description>
${entries.map(([id, date, text, lines]) => `<Transaction><TransactionID>${id}</TransactionID><TransactionDate>${date}</TransactionDate><Description>${text}</Description>${lines.map(([acc, d, c], i) => `<${lineTag}><RecordID>${i + 1}</RecordID><AccountID>${acc}</AccountID><Description>${text}</Description>${d ? amount('DebitAmount', d) : amount('CreditAmount', c)}</${lineTag}>`).join('')}</Transaction>`).join('\n')}
</Journal></GeneralLedgerEntries>
</AuditFile>`;
}

describe('Denmark', () => {
  test('ranges become the prefixes that cover them exactly', () => {
    expect(rangePrefixes(1010, 1389)).toEqual(['101', '102', '103', '104', '105', '106', '107', '108', '109', '11', '12', '130', '131', '132', '133', '134', '135', '136', '137', '138']);
    expect(rangePrefixes(6935, 6949)).toEqual(['6935', '6936', '6937', '6938', '6939', '694']);
  });

  test.each([['1010', 1], ['1389', 1], ['1390', null], ['1610', 5], ['2200', 6], ['2850', 7], ['3170', 8], ['3050', 9], ['3300', 10], ['3610', 11], ['3740', 12]])('%s → line %s', (account, no) => {
    expect(dk.classifyAccount(account).lineNo).toBe(no ?? 999);
  });

  test('a Danish SAF-T on the standard chart, closed into retained earnings: the books\' result', async () => {
    const u = seedUser({ role: 'editor' });
    const xml = auditFile({
      ns: 'urn:StandardAuditFile-Taxation-Financial:DK',
      country: 'DK',
      header: '<Company><RegistrationNumber>12345678</RegistrationNumber><Name>Bageriet ApS</Name></Company><DefaultCurrencyCode>DKK</DefaultCurrencyCode><SelectionCriteria><SelectionStartDate>2024-01-01</SelectionStartDate><SelectionEndDate>2024-12-31</SelectionEndDate></SelectionCriteria>',
      accounts: [['1000', 'Salg', '1010'], ['1600', 'Varekøb', '1610'], ['2800', 'Løn', '2850'], ['3000', 'Afskrivninger', '3000'], ['3600', 'Renteudgifter', '3610'],
        ['3700', 'Skat', '3740'], ['5600', 'Debitorer', '6190'], ['7400', 'Kreditorer', '7440'], ['6400', 'Bank', '6470', 1000], ['6500', 'Selskabskapital', '6510', -1000], ['6940', 'Overført resultat', '6940']],
      entries: [
        ['1', '2024-02-01', 'Faktura', [['5600', 1000, 0], ['1000', 0, 1000]]],
        ['2', '2024-02-10', 'Varekøb', [['1600', 300, 0], ['7400', 0, 300]]],
        ['3', '2024-03-31', 'Løn', [['2800', 200, 0], ['6400', 0, 200]]],
        ['4', '2024-12-31', 'Afskrivning, renter, skat', [['3000', 50, 0], ['3600', 10, 0], ['3700', 40, 0], ['6400', 0, 100]]],
        ['5', '2024-12-31', 'Årsafslutning', [['1000', 1000, 0], ['1600', 0, 300], ['2800', 0, 200], ['3000', 0, 50], ['3600', 0, 10], ['3700', 0, 40], ['6940', 0, 400]]],
      ],
    });
    const res = await upload(u, 'SAF-T_DK_2024.xml', xml);
    expect(res.status).toBe(201);
    expect(res.body.accounting).toMatchObject({ kind: 'saft', chart: 'dk', country: 'DK', currency: 'DKK', companyId: '12345678', balanced: true, netIncome: 400, unclassifiedAccounts: [] });
    expect(await incomeLines(u, res.body.datasource.id)).toEqual([
      { Line: '01 Net turnover', amount: 1000 }, { Line: '05 Raw materials & consumables', amount: -300 }, { Line: '07 Staff costs', amount: -200 },
      { Line: '09 Depreciation, amortisation & impairment', amount: -50 }, { Line: '11 Financial expenses', amount: -10 }, { Line: '12 Tax on the result for the year', amount: -40 },
    ]);
  });
});

describe('Austria', () => {
  test.each([['4000', 1], ['4500', 2], ['4800', 3], ['5000', 4], ['6000', 5], ['7400', 6], ['7000', 7], ['8100', 8], ['8210', 8], ['8231', 9], ['8280', 9], ['8500', 11]])('EKR %s → line %i', (account, no) => {
    expect(at.classifyAccount(account)).toMatchObject({ statement: 'Income statement', lineNo: no });
  });
  test('a fixed asset numbered on three digits is not revenue', () => {
    expect(at.classifyAccount('400')).toMatchObject({ statement: 'Balance sheet', line: 'Class 0 Fixed assets' });
    expect(at.classifyAccount('9890').statement).toBe('Result allocation');
  });

  test('an Austrian SAF-T 1.01: EKR accounts, flat amounts, the result before and after taxes', async () => {
    const u = seedUser({ role: 'editor' });
    const xml = auditFile({
      ns: 'urn:OECD:StandardAuditFile-Taxation:AT_1.01',
      bare: true,
      standardTag: 'AccountID_oeEKR',
      header: '<CompanyID>FN 123456a</CompanyID><TaxRegistrationNumber>ATU12345678</TaxRegistrationNumber><CompanyName>Bäckerei Wien GmbH</CompanyName><CurrencyCode>EUR</CurrencyCode><StartDate>2024-01-01</StartDate><EndDate>2024-12-31</EndDate>',
      accounts: [['400', 'Maschinen', '400', 500], ['2000', 'Forderungen Inland', '2000'], ['2800', 'Bank', '2800', 1000], ['3300', 'Lieferverbindlichkeiten', '3300'], ['3500', 'Umsatzsteuer', '3500'],
        ['9000', 'Stammkapital', '9000', -1500], ['4000', 'Erlöse 20 %', '4000'], ['5000', 'Wareneinsatz', '5000'], ['6000', 'Löhne', '6000'], ['7000', 'Abschreibung', '7000'], ['7400', 'Miete', '7400'],
        ['8280', 'Zinsen Bankkredite', '8280'], ['8500', 'Körperschaftsteuer', '8500']],
      entries: [
        ['1', '2024-02-01', 'Rechnung', [['2000', 1200, 0], ['4000', 0, 1000], ['3500', 0, 200]]],
        ['2', '2024-02-05', 'Einkauf', [['5000', 400, 0], ['3300', 0, 400]]],
        ['3', '2024-03-31', 'Löhne', [['6000', 300, 0], ['2800', 0, 300]]],
        ['4', '2024-04-01', 'Miete', [['7400', 100, 0], ['2800', 0, 100]]],
        ['5', '2024-12-31', 'AfA', [['7000', 50, 0], ['400', 0, 50]]],
        ['6', '2024-12-31', 'Zinsen und KöSt', [['8280', 10, 0], ['8500', 30, 0], ['2800', 0, 40]]],
      ],
    });
    const res = await upload(u, 'SAF-T_AT_2024.xml', xml);
    expect(res.status).toBe(201);
    expect(res.body.accounting).toMatchObject({ kind: 'saft', chart: 'at', country: 'AT', companyId: 'ATU12345678', companyName: 'Bäckerei Wien GmbH', fiscalYear: 2024, balanced: true, netIncome: 110, unclassifiedAccounts: [] });
    const id = res.body.datasource.id;
    const pack = await request(app).get(`/api/upload/${id}/fec-pack`).use(as(u));
    const m = await request(app).post('/api/models/import').use(as(u)).send({ yaml: pack.body.plan.model.yaml, datasourceId: id });
    const q = await request(app).post(`/api/models/${m.body.model.id}/query`).use(as(u)).send({ measureNames: ['_calc.ebitda', '_calc.operatingIncome', '_calc.currentIncome', '_calc.netIncome'] });
    const [row] = q.body.rows;
    expect([row.EBITDA, row['Operating result (EBIT)'], row['Result before taxes'], row['Net income for the year']].map(Number)).toEqual([200, 150, 140, 110]);
  });
});

describe('Poland', () => {
  test.each([['RPAI_RKAI_POZ', 1], ['RPAII', 2], ['RPAIII', 3], ['RPAIV_RKAII_POZ', 4], ['RPBII', 5], ['RPBIII', 6], ['RPBIV_POZ', 7], ['RPBV', 8], ['RPBVI_E', 9],
    ['RPBVII', 10], ['RPBVIII_RKBII_POZ', 11], ['RKD', 13], ['RPDII_RKGII', 15], ['RPEIII_RKHIII_P', 16], ['RPBI', 17], ['RPGII_RKJII_POW', 18], ['RPHI_RKKI_POW', 19], ['RPJ_RKM_B', 20]])('marker %s → line %i', (marker, no) => {
    expect(pl.classifyAccount(marker)).toMatchObject({ statement: 'Income statement', lineNo: no });
  });
  test('balance markers, the net profit apart, INNE outside the statements', () => {
    expect(pl.classifyAccount('BABII3a_D12').line).toBe('BA-B.II Trade receivables');
    expect(pl.classifyAccount('BPBIII3d_D12').line).toBe('BP-B.III Trade payables');
    expect(pl.classifyAccount('BPAVI').statement).toBe('Result allocation');
    expect(pl.classifyAccount('INNE').statement).toBe('Other accounts');
  });

  const NS = 'http://jpk.mf.gov.pl/wzor/2024/09/04/09041/';
  const ACCOUNTS = [
    ['201', 'Rozrachunki z odbiorcami', '', 'BABII3a_D12', 1000], ['201-1', 'Odbiorca Kowalski', '201', 'BABII3a_D12', 1000],
    ['130', 'Rachunek bankowy', '', 'BABIII1c', 4000], ['801', 'Kapitał podstawowy', '', 'BPAI', -5000], ['202', 'Rozrachunki z dostawcami', '', 'BPBIII3d_D12', 0],
    ['071', 'Umorzenie środków trwałych', '', 'BAAII1c_U', 0], ['700', 'Przychody ze sprzedaży produktów', '', 'RPAI_RKAI_POZ', 0], ['401', 'Amortyzacja', '', 'RPBI', 0],
    ['402', 'Zużycie materiałów i energii', '', 'RPBII', 0], ['404', 'Wynagrodzenia', '', 'RPBV', 0], ['870', 'Podatek dochodowy', '', 'RPJ_RKM_B', 0], ['860', 'Wynik finansowy', '', 'BPAVI', 0],
    ['490', 'Rozliczenie kosztów', '', 'INNE', 0],
  ];
  const ENTRIES = [
    ['1', 'Sprzedaż', '2024-02-01', 'FV/1', 'K1', [['201-1', 1000, 0], ['700', 0, 1000]]],
    ['2', 'Zakupy', '2024-02-10', 'FZ/7', 'D1', [['402', 300, 0], ['202', 0, 300]]],
    ['3', 'Płace', '2024-03-31', 'LP/3', '', [['404', 200, 0], ['130', 0, 200]]],
    ['4', 'Księgowania', '2024-12-31', 'PK/1', '', [['401', 50, 0], ['071', 0, 50], ['870', 40, 0], ['130', 0, 40]]],
    ['5', 'Zamknięcie', '2024-12-31', 'PK/2', '', [['700', 1000, 0], ['860', 0, 1000], ['860', 590, 0], ['402', 0, 300], ['404', 0, 200], ['401', 0, 50], ['870', 0, 40]]],
  ];
  const jpkFile = (ns = NS) => `<?xml version="1.0" encoding="UTF-8"?>
<tns:JPK xmlns:tns="${ns}" xmlns:etd="http://crd.gov.pl/xml/schematy/dziedzinowe/mf/2022/09/13/eD/DefinicjeTypy/">
<tns:Naglowek><tns:KodFormularza kodSystemowy="JPK_KR_PD (1)" wersjaSchemy="1-1">JPK_KR_PD</tns:KodFormularza><tns:DataOd>2024-01-01</tns:DataOd><tns:DataDo>2024-12-31</tns:DataDo><tns:RokDataOd>2024-01-01</tns:RokDataOd><tns:RokDataDo>2024-12-31</tns:RokDataDo><tns:DomyslnyKodWaluty>PLN</tns:DomyslnyKodWaluty></tns:Naglowek>
<tns:Podmiot1><tns:IdentyfikatorPodmiotu><etd:NIP>5250001009</etd:NIP><etd:PelnaNazwa>Piekarnia Łódź Sp. z o.o.</etd:PelnaNazwa></tns:IdentyfikatorPodmiotu></tns:Podmiot1>
<tns:Kontrahent><tns:T_1>K1</tns:T_1><tns:T_3>7770001111</tns:T_3></tns:Kontrahent>
<tns:ZOiS>${ACCOUNTS.map(([id, name, parent, marker, opening]) => `<tns:ZOiS7><tns:S_1>${id}</tns:S_1><tns:S_2>${name}</tns:S_2>${parent ? `<tns:S_3>${parent}</tns:S_3>` : ''}<tns:S_4>${opening > 0 ? opening : 0}</tns:S_4><tns:S_5>${opening < 0 ? -opening : 0}</tns:S_5><tns:S_12_1>${marker}</tns:S_12_1></tns:ZOiS7>`).join('')}</tns:ZOiS>
${ENTRIES.map(([n, journal, date, doc, party, lines]) => `<tns:Dziennik><tns:D_1>${n}</tns:D_1><tns:D_2>${journal}</tns:D_2>${party ? `<tns:D_3>${party}</tns:D_3>` : ''}<tns:D_4>${doc}</tns:D_4><tns:D_6>${date}</tns:D_6><tns:D_7>${date}</tns:D_7><tns:D_8>${date}</tns:D_8><tns:D_10>${journal}</tns:D_10>${lines.map(([acc, d, c], i) => `<tns:KontoZapis><tns:Z_1>${i + 1}</tns:Z_1><tns:Z_3>${acc}</tns:Z_3>${d ? `<tns:Z_4>${d.toFixed(2)}</tns:Z_4>` : `<tns:Z_7>${c.toFixed(2)}</tns:Z_7>`}</tns:KontoZapis>`).join('')}</tns:Dziennik>`).join('\n')}
</tns:JPK>`;

  test('a JPK_KR_PD: accounts placed by marker, parent accounts not opened twice, the year closed into 860 set apart', async () => {
    const u = seedUser({ role: 'editor' });
    const res = await upload(u, 'JPK_KR_PD_2024.xml', jpkFile());
    expect(res.status).toBe(201);
    expect(res.body.accounting).toMatchObject({
      kind: 'jpk', chart: 'pl', country: 'PL', currency: 'PLN', companyId: '5250001009', companyName: 'Piekarnia Łódź Sp. z o.o.',
      fiscalYear: 2024, balanced: true, unbalancedEntries: 0, netIncome: 410, unclassifiedAccounts: [],
    });
    const id = res.body.datasource.id;
    expect(await incomeLines(u, id)).toEqual([
      { Line: '01 Net revenue from sales of products', amount: 1000 }, { Line: '05 Materials & energy', amount: -300 }, { Line: '08 Salaries', amount: -200 },
      { Line: '17 Depreciation', amount: -50 }, { Line: '20 Income tax', amount: -40 },
    ]);
    const opening = await sql(u, id, "SELECT CompteNum, Debit::DOUBLE AS d, Credit::DOUBLE AS c FROM entries WHERE JournalCode = 'BO' ORDER BY 1");
    expect(opening).toEqual([{ CompteNum: '130', d: 4000, c: 0 }, { CompteNum: '201-1', d: 1000, c: 0 }, { CompteNum: '801', d: 0, c: 5000 }]);
    const [sale] = await sql(u, id, "SELECT CompAuxLib, PieceRef FROM entries WHERE CompteNum = '201-1' AND JournalCode <> 'BO'");
    expect(sale).toEqual({ CompAuxLib: 'K1 (7770001111)', PieceRef: 'FV/1' });
  });

  test('a JPK_KR (1) without markers is refused with what to export', async () => {
    const u = seedUser({ role: 'editor' });
    const res = await upload(u, 'JPK_KR_2018.xml', jpkFile('http://jpk.mf.gov.pl/wzor/2016/03/09/03091/'));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body.error).toMatch(/JPK_KR_PD/);
  });
});

describe('Bulgaria', () => {
  test('a SAF-T BG with TransactionLine entries: read whole, every account to be placed by hand, the package on offer', async () => {
    const u = seedUser({ role: 'editor' });
    const xml = auditFile({
      ns: 'mf:nra:dgti:dxxxx:declaration:v1',
      country: 'BG',
      lineTag: 'TransactionLine',
      header: '<Company><RegistrationNumber>201234567</RegistrationNumber><Name>Хлебозавод ЕООД</Name></Company><DefaultCurrencyCode>BGN</DefaultCurrencyCode>',
      accounts: [['411', 'Клиенти'], ['702', 'Приходи от продажби на стоки'], ['503', 'Разплащателна сметка']],
      entries: [['1', '2024-01-10', 'Фактура', [['411', 500, 0], ['702', 0, 500]]], ['2', '2024-01-20', 'Плащане', [['503', 500, 0], ['411', 0, 500]]]],
    });
    const res = await upload(u, 'SAF-T_BG_202401.xml', xml);
    expect(res.status).toBe(201);
    expect(res.body.accounting).toMatchObject({ kind: 'saft', chart: 'generic', country: 'BG', companyName: 'Хлебозавод ЕООД', balanced: true, netIncome: 0 });
    expect(res.body.accounting.unclassifiedAccounts.sort()).toEqual(['411', '503', '702']);
    const pack = await request(app).get(`/api/upload/${res.body.datasource.id}/fec-pack`).use(as(u));
    expect(pack.status).toBe(200);
  });
});
