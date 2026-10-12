// A SAF-T Financial audit file (the OECD format Norway asks of companies) is
// recognised by its root element, read as it streams, and becomes the same
// `entries` table a FEC does: classified on the Norwegian standard accounts,
// opening balances written as an opening entry, and offered the same Finance
// package — whose figures must be the books' own.
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const { streamXml } = require('../utils/accounting/xmlStream');
const ns4102 = require('../utils/accounting/ns4102');

// Every import runs in a child process (utils/fileImport.js).
jest.setTimeout(60000);
const { buildApp, seedUser } = require('./helpers/testApp');

const app = buildApp();
const as = (uid) => (r) => r.set('x-test-user', uid);

const ACCOUNTS = [
  ['1500', 'Kundefordringer', '15', 1000],
  ['1920', 'Bankinnskudd', '19', 4000],
  ['2050', 'Annen egenkapital', '20', -5000],
  ['2400', 'Leverandørgjeld', '24', 0],
  ['2500', 'Betalbar skatt', '25', 0],
  ['2700', 'Utgående merverdiavgift', '27', 0],
  ['3000', 'Salgsinntekt, avgiftspliktig', '30', 0],
  ['4300', 'Innkjøp av varer for videresalg', '43', 0],
  ['5000', 'Lønn til ansatte', '50', 0],
  ['6300', 'Leie lokale', '63', 0],
  ['8050', 'Renteinntekt', '80', 0],
  ['8300', 'Betalbar skatt, kostnad', '83', 0],
];
// [journal, id, date, description, lines: [account, debit, credit, party, tax]]
const TRANSACTIONS = [
  ['S', '1', '01-15', 'Salg til Nordlys', [['1500', 1250, 0, 'C:K1'], ['3000', 0, 1000, null, 250], ['2700', 0, 250]]],
  ['K', '2', '02-03', 'Varekjøp', [['4300', 400, 0, null, 100], ['2700', 100, 0], ['2400', 0, 500, 'S:L1']]],
  ['L', '3', '03-31', 'Lønn mars', [['5000', 300, 0], ['1920', 0, 300]]],
  ['B', '4', '04-01', '<![CDATA[Husleie & strøm]]>', [['6300', 100, 0], ['1920', 0, 100]]],
  ['B', '5', '06-30', 'Renter &amp; gebyr', [['1920', 20, 0], ['8050', 0, 20]]],
  ['M', '6', '12-31', 'Skatt', [['8300', 50, 0], ['2500', 0, 50]]],
];

function saftFile({ year = 2024, org = '912345678', country = 'NO' } = {}) {
  const amount = (side, v) => `<n1:${side}><n1:Amount>${v.toFixed(2)}</n1:Amount></n1:${side}>`;
  const line = ([account, debit, credit, party, tax], i) => [
    `<n1:Line><n1:RecordID>${i + 1}</n1:RecordID><n1:AccountID>${account}</n1:AccountID>`,
    party ? `<n1:${party[0] === 'C' ? 'CustomerID' : 'SupplierID'}>${party.slice(2)}</n1:${party[0] === 'C' ? 'CustomerID' : 'SupplierID'}>` : '',
    '<n1:Description>Linje</n1:Description>',
    debit ? amount('DebitAmount', debit) : amount('CreditAmount', credit),
    // A tax amount names its figure Amount too: never the line's.
    tax ? `<n1:TaxInformation><n1:TaxType>MVA</n1:TaxType><n1:TaxCode>3</n1:TaxCode>${amount('DebitTaxAmount', tax)}</n1:TaxInformation>` : '',
    '</n1:Line>',
  ].join('');
  const journals = [...new Set(TRANSACTIONS.map((t) => t[0]))].map((j) => [
    `<n1:Journal><n1:JournalID>${j}</n1:JournalID><n1:Description>Journal ${j}</n1:Description><n1:Type>${j}</n1:Type>`,
    ...TRANSACTIONS.filter((t) => t[0] === j).map(([, id, date, desc, lines]) => [
      `<n1:Transaction><n1:TransactionID>${id}</n1:TransactionID><n1:Period>${date.slice(0, 2)}</n1:Period><n1:PeriodYear>${year}</n1:PeriodYear>`,
      `<n1:TransactionDate>${year}-${date}</n1:TransactionDate><n1:Description>${desc}</n1:Description>`,
      `<n1:SystemEntryDate>${year}-${date}</n1:SystemEntryDate><n1:GLPostingDate>${year}-${date}</n1:GLPostingDate>`,
      ...lines.map(line), '</n1:Transaction>',
    ].join('')),
    '</n1:Journal>',
  ].join('\n'));
  return Buffer.from(`\uFEFF<?xml version="1.0" encoding="UTF-8"?>
<!-- generated for the tests -->
<n1:AuditFile xmlns:n1="urn:StandardAuditFile-Taxation-Financial:NO">
<n1:Header><n1:AuditFileVersion>1.30</n1:AuditFileVersion><n1:AuditFileCountry>${country}</n1:AuditFileCountry>
<n1:Company><n1:RegistrationNumber>${org}</n1:RegistrationNumber><n1:Name>Fjellbekk Verksted AS</n1:Name></n1:Company>
<n1:DefaultCurrencyCode>NOK</n1:DefaultCurrencyCode>
<n1:SelectionCriteria><n1:PeriodStart>1</n1:PeriodStart><n1:PeriodStartYear>${year}</n1:PeriodStartYear><n1:PeriodEnd>12</n1:PeriodEnd><n1:PeriodEndYear>${year}</n1:PeriodEndYear></n1:SelectionCriteria>
</n1:Header>
<n1:MasterFiles><n1:GeneralLedgerAccounts>
${ACCOUNTS.map(([id, desc, std, opening]) => `<n1:Account><n1:AccountID>${id}</n1:AccountID><n1:AccountDescription>${desc}</n1:AccountDescription><n1:StandardAccountID>${std}</n1:StandardAccountID><n1:AccountType>GL</n1:AccountType>${opening >= 0 ? `<n1:OpeningDebitBalance>${opening}</n1:OpeningDebitBalance>` : `<n1:OpeningCreditBalance>${-opening}</n1:OpeningCreditBalance>`}</n1:Account>`).join('\n')}
</n1:GeneralLedgerAccounts>
<n1:Customers><n1:Customer><n1:RegistrationNumber>987654321</n1:RegistrationNumber><n1:Name>Nordlys AS</n1:Name><n1:CustomerID>K1</n1:CustomerID></n1:Customer></n1:Customers>
<n1:Suppliers><n1:Supplier><n1:Name>Fjord Grossist AS</n1:Name><n1:SupplierID>L1</n1:SupplierID></n1:Supplier></n1:Suppliers>
</n1:MasterFiles>
<n1:GeneralLedgerEntries><n1:NumberOfEntries>${TRANSACTIONS.length}</n1:NumberOfEntries><n1:TotalDebit>2220.00</n1:TotalDebit><n1:TotalCredit>2220.00</n1:TotalCredit>
${journals.join('\n')}
</n1:GeneralLedgerEntries>
</n1:AuditFile>
`);
}
const saftName = (year = 2024, org = '912345678') => `SAF-T Financial_${org}_${year}1231235959.xml`;

async function upload(uid, name, content) {
  return request(app).post('/api/upload').use(as(uid)).attach('file', content, name);
}
const sql = async (uid, id, text) => {
  const res = await request(app).post(`/api/datasources/${id}/query`).use(as(uid)).send({ sql: text });
  expect(res.status).toBe(200);
  return res.body.rows;
};

describe('Streaming XML', () => {
  test('values come whole across read chunks, entities decoded, prefixes dropped', async () => {
    const file = path.join(os.tmpdir(), `xml-stream-${process.pid}.xml`);
    fs.writeFileSync(file, `<?xml version="1.0"?><p:r xmlns:p="urn:x">${'<p:v a="1>2">Ø &amp; &#x41;<![CDATA[<b>]]></p:v><p:e/>'.repeat(5000)}</p:r>`);
    const values = [];
    let text = '';
    let empty = 0;
    await streamXml(file, {
      onOpen: () => { text = ''; },
      onText: (t) => { text += t; },
      onClose: (name) => { if (name === 'v') values.push(text); if (name === 'e') empty++; },
    });
    fs.rmSync(file);
    expect(values).toHaveLength(5000);
    expect(new Set(values)).toEqual(new Set(['Ø & A<b>']));
    expect(empty).toBe(5000);
  });
});

describe('Norwegian standard accounts', () => {
  test.each([
    ['30', 1], ['3100', 1], ['33', 1], ['43', 2], ['4000', 2], ['49', 2], ['34', 3], ['36', 3], ['5000', 4], ['54', 4],
    ['45', 5], ['6300', 5], ['7700', 5], ['78', 5], ['60', 6], ['80', 7], ['81', 8], ['83', 9], ['84', 10], ['85', 11], ['86', 12],
  ])('%s sits on line %i', (account, no) => {
    expect(ns4102.classifyAccount(account)).toMatchObject({ statement: 'Income statement', lineNo: no });
  });

  test('the year-end allocation stays out of the income statement, the balance sheet sorts after it', () => {
    expect(ns4102.classifyAccount('8800').statement).toBe('Result allocation');
    expect(ns4102.classifyAccount('1500')).toMatchObject({ statement: 'Balance sheet', line: 'Class 15-17 Receivables' });
    expect(ns4102.classifyAccount('2400').lineNo).toBeGreaterThan(18);
    expect(ns4102.classifyAccount('X1').statement).toBe('Unclassified');
  });
});

describe('SAF-T import', () => {
  test('a Norwegian audit file becomes one classified table, with its opening balances', async () => {
    const u = seedUser({ role: 'editor' });
    const res = await upload(u, saftName(), saftFile());
    expect(res.status).toBe(201);
    expect(res.body.accounting).toMatchObject({
      kind: 'saft', chart: 'ns4102', country: 'NO', currency: 'NOK', companyId: '912345678', companyName: 'Fjellbekk Verksted AS',
      fiscalYear: 2024, debit: 7220, credit: 7220, balanced: true, unbalancedEntries: 0, netIncome: 170, unclassifiedAccounts: [],
    });
    const id = res.body.datasource.id;
    expect(res.body.datasource.tableName).toBe('entries');

    // The file's own totals, its opening entry apart.
    const [totals] = await sql(u, id, "SELECT SUM(Debit)::DOUBLE AS d, SUM(Credit)::DOUBLE AS c FROM entries WHERE JournalCode <> 'OB'");
    expect(totals).toEqual({ d: 2220, c: 2220 });
    const lines = await sql(u, id, "SELECT CompteNum, Debit::DOUBLE AS Debit, Credit::DOUBLE AS Credit, Line, CompAuxLib, EcritureLib, Account FROM entries WHERE JournalCode <> 'OB' ORDER BY EcritureNum, CompteNum");
    const sale = lines.find((l) => l.CompteNum === '3000');
    expect(sale).toMatchObject({ Credit: 1000, Debit: 0, Line: '01 Sales revenue', Account: '3000 Salgsinntekt, avgiftspliktig' });
    expect(lines.find((l) => l.CompteNum === '1500').CompAuxLib).toBe('Nordlys AS');
    expect(lines.find((l) => l.CompteNum === '2400').CompAuxLib).toBe('Fjord Grossist AS');
    expect(lines.find((l) => l.CompteNum === '4300')).toMatchObject({ Debit: 400, Line: '02 Cost of goods sold' });
    const opening = await sql(u, id, "SELECT CompteNum, Debit::DOUBLE AS Debit, Credit::DOUBLE AS Credit, strftime(EcritureDate, '%Y-%m-%d') AS d FROM entries WHERE JournalCode = 'OB' ORDER BY CompteNum");
    expect(opening).toEqual([
      { CompteNum: '1500', Debit: 1000, Credit: 0, d: '2024-01-01' },
      { CompteNum: '1920', Debit: 4000, Credit: 0, d: '2024-01-01' },
      { CompteNum: '2050', Debit: 0, Credit: 5000, d: '2024-01-01' },
    ]);
  });

  test('the Finance package reads it: Norwegian lines, kroner, the same figures', async () => {
    const u = seedUser({ role: 'editor' });
    const up = await upload(u, saftName(2024, '923456789'), saftFile({ org: '923456789' }));
    const id = up.body.datasource.id;
    const pack = await request(app).get(`/api/upload/${id}/fec-pack`).use(as(u));
    expect(pack.status).toBe(200);
    expect(pack.body.plan.model.yaml).toContain("suffix: ' kr'");
    expect(pack.body.plan.report.bundle.report.pages.map((p) => p.name)).toContain('Profit build-up');
    // A Norwegian statement's own running totals, in its order: no French
    // value added; and its lines numbered without gaps.
    const buildUp = pack.body.plan.report.bundle.report.pages.find((p) => p.name === 'Profit build-up');
    const cards = Object.values(buildUp.widgets).filter((w) => w.type === 'scorecard').map((w) => w.config.label);
    expect(cards).toEqual(['Gross profit', 'EBITDA', 'Operating result', 'Ordinary result before tax', 'Net result for the year', 'Net margin (net result for the year ÷ revenue)']);
    expect(ns4102.LINES.map((l) => l.no)).toEqual(ns4102.LINES.map((_, i) => i + 1));
    const m = await request(app).post('/api/models/import').use(as(u)).send({ yaml: pack.body.plan.model.yaml, datasourceId: id });
    expect(m.status).toBe(201);
    const q = await request(app).post(`/api/models/${m.body.model.id}/query`).use(as(u))
      .send({ measureNames: ['_calc.revenue', '_calc.expenses', '_calc.ebitda', '_calc.netIncome', '_calc.receivables', '_calc.payables'] });
    expect(q.status).toBe(200);
    const [row] = q.body.rows;
    expect([row.Revenue, row.Expenses, row.EBITDA, row['Net result for the year'], row['Customer balance'], row['Supplier balance']].map(Number))
      .toEqual([1000, 850, 200, 170, 2250, 500]);
  });

  test('a second fiscal year of the same company is offered and merged', async () => {
    const u = seedUser({ role: 'editor' });
    const org = '934567890';
    const first = await upload(u, saftName(2024, org), saftFile({ year: 2024, org }));
    const second = await upload(u, saftName(2023, org), saftFile({ year: 2023, org }));
    expect(second.body.sameCompany).toEqual([{ id: first.body.datasource.id, name: first.body.datasource.name, years: [2024] }]);
    const merged = await request(app).post(`/api/upload/${first.body.datasource.id}/fec-years`).use(as(u)).send({ from: second.body.datasource.id });
    expect(merged.status).toBe(200);
    expect(merged.body.years.map((y) => y.year)).toEqual([2023, 2024]);
    const pack = await request(app).get(`/api/upload/${first.body.datasource.id}/fec-pack`).use(as(u));
    expect(pack.body.accounting.years).toEqual([2023, 2024]);
  });

  test('a FEC and a SAF-T of the same number are never merged', async () => {
    const u = seedUser({ role: 'editor' });
    const saft = await upload(u, saftName(2024, '945678901'), saftFile({ org: '945678901' }));
    const fec = await upload(u, '945678901FEC20231231.txt', Buffer.from('JournalCode\tJournalLib\tEcritureNum\tEcritureDate\tCompteNum\tCompteLib\tCompAuxNum\tCompAuxLib\tPieceRef\tPieceDate\tEcritureLib\tDebit\tCredit\tEcritureLet\tDateLet\tValidDate\tMontantdevise\tIdevise\nVE\tVentes\t1\t20230105\t706000\tServices\t\t\tF1\t20230105\tSale\t0\t10\t\t\t20230105\t\t\nVE\tVentes\t1\t20230105\t411\tClients\t\t\tF1\t20230105\tSale\t10\t0\t\t\t20230105\t\t\n'));
    expect(fec.body.sameCompany).toEqual([]);
    const res = await request(app).post(`/api/upload/${saft.body.datasource.id}/fec-years`).use(as(u)).send({ from: fec.body.datasource.id });
    expect(res.status).toBe(400);
  });

  test('a country whose chart is not read: every account to be placed by hand, the package on offer', async () => {
    const u = seedUser({ role: 'editor' });
    const res = await upload(u, 'audit-lt.xml', saftFile({ country: 'LT', org: '300000001' }));
    expect(res.status).toBe(201);
    expect(res.body.accounting).toMatchObject({ kind: 'saft', chart: 'generic', country: 'LT', debit: 7220, netIncome: 0 });
    const pack = await request(app).get(`/api/upload/${res.body.datasource.id}/fec-pack`).use(as(u));
    expect(pack.status).toBe(200);
  });

  test('any other XML, and a cash register audit file, are refused', async () => {
    const u = seedUser({ role: 'editor' });
    const other = await upload(u, 'feed.xml', Buffer.from('<?xml version="1.0"?><rss><channel/></rss>'));
    expect(other.status).toBeGreaterThanOrEqual(400);
    expect(other.body.error).toMatch(/SAF-T/);
    const cash = await upload(u, 'kasse.xml', Buffer.from('<?xml version="1.0"?><AuditFile xmlns="urn:StandardAuditFile-Taxation-CashRegister:NO"><Header/></AuditFile>'));
    expect(cash.status).toBeGreaterThanOrEqual(400);
    expect(cash.body.error).toMatch(/Cash Register/);
  });
});

// Portugal: lines split by side, figures bare, Windows-1252, grouping
// accounts listed beside the ones entries go to, and the closing entries
// ("apuramento") that empty classes 6 and 7 into 811.
function ptFile({ nif = '509999990', year = 2024 } = {}) {
  const account = (id, desc, cat, opening = 0) => `<Account><AccountID>${id}</AccountID><AccountDescription>${desc}</AccountDescription>${opening >= 0 ? `<OpeningDebitBalance>${opening}</OpeningDebitBalance><OpeningCreditBalance>0</OpeningCreditBalance>` : `<OpeningDebitBalance>0</OpeningDebitBalance><OpeningCreditBalance>${-opening}</OpeningCreditBalance>`}<ClosingDebitBalance>0</ClosingDebitBalance><ClosingCreditBalance>0</ClosingCreditBalance><GroupingCategory>${cat}</GroupingCategory></Account>`;
  const tx = (id, period, date, desc, party, lines) => `<Transaction><TransactionID>${year}-${date} ${id}</TransactionID><Period>${period}</Period><TransactionDate>${year}-${date}</TransactionDate><SourceID>ana</SourceID><Description>${desc}</Description><DocArchivalNumber>${id}</DocArchivalNumber><TransactionType>N</TransactionType><GLPostingDate>${year}-${date}</GLPostingDate>${party || ''}<Lines>${lines.map(([side, acc, v], i) => `<${side}Line><RecordID>${i + 1}</RecordID><AccountID>${acc}</AccountID><SystemEntryDate>${year}-${date}T10:00:00</SystemEntryDate><Description>${desc}</Description><${side}Amount>${v.toFixed(2)}</${side}Amount></${side}Line>`).join('')}</Lines></Transaction>`;
  const xml = `<?xml version="1.0" encoding="Windows-1252"?>
<AuditFile xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="urn:OECD:StandardAuditFile-Tax:PT_1.04_01">
<Header><AuditFileVersion>1.04_01</AuditFileVersion><CompanyID>Conservatória 1</CompanyID><TaxRegistrationNumber>${nif}</TaxRegistrationNumber><TaxAccountingBasis>C</TaxAccountingBasis><CompanyName>Padaria São João, Lda</CompanyName><FiscalYear>${year}</FiscalYear><StartDate>${year}-01-01</StartDate><EndDate>${year}-12-31</EndDate><CurrencyCode>EUR</CurrencyCode></Header>
<MasterFiles><GeneralLedgerAccounts><TaxonomyReference>S</TaxonomyReference>
${account('11', 'Caixa e depósitos', 'GR', 1000)}${account('111', 'Caixa', 'GA', 1000)}${account('1111', 'Caixa sede', 'GM', 1000)}
${account('21', 'Clientes', 'GR', 500)}${account('211', 'Clientes c/c', 'GA', 500)}${account('2111', 'Clientes gerais', 'GM', 500)}
${account('2211', 'Fornecedores gerais', 'GM', -300)}${account('51', 'Capital', 'GR', -1200)}${account('511', 'Capital subscrito', 'GM', -1200)}
${account('2413', 'Imposto estimado', 'GM')}${account('2433', 'IVA liquidado', 'GM')}${account('611', 'Mercadorias', 'GM')}${account('622', 'Serviços especializados', 'GM')}
${account('711', 'Vendas de mercadorias', 'GM')}${account('721', 'Prestação de serviços', 'GM')}${account('811', 'Resultado antes de impostos', 'GM')}${account('8121', 'Imposto estimado', 'GM')}${account('818', 'Resultado líquido', 'GM')}
</GeneralLedgerAccounts>
<Customer><CustomerID>C1</CustomerID><AccountID>2111</AccountID><CustomerTaxID>500000000</CustomerTaxID><CompanyName>Café Central, Lda</CompanyName></Customer>
<Supplier><SupplierID>F1</SupplierID><AccountID>2211</AccountID><SupplierTaxID>500000001</SupplierTaxID><CompanyName>Moagem do Norte, SA</CompanyName></Supplier>
</MasterFiles>
<GeneralLedgerEntries><NumberOfEntries>8</NumberOfEntries><TotalDebit>4830.00</TotalDebit><TotalCredit>4830.00</TotalCredit>
<Journal><JournalID>V</JournalID><Description>Vendas</Description>
${tx('V1', 3, '03-10', 'Venda de pão', '<CustomerID>C1</CustomerID>', [['Debit', '2111', 1230], ['Credit', '711', 1000], ['Credit', '2433', 230]])}
${tx('V2', 4, '04-02', 'Prestação de serviços', '', [['Debit', '1111', 500], ['Credit', '721', 500]])}
</Journal>
<Journal><JournalID>C</JournalID><Description>Compras</Description>
${tx('C1', 5, '05-20', 'Farinha', '<SupplierID>F1</SupplierID>', [['Debit', '611', 400], ['Credit', '2211', 400]])}
${tx('C2', 6, '06-15', 'Contabilista', '', [['Debit', '622', 100], ['Credit', '1111', 100]])}
</Journal>
<Journal><JournalID>APU</JournalID><Description>Apuramento</Description>
${tx('FC1', 13, '12-31', 'Imposto estimado', '', [['Debit', '8121', 50], ['Credit', '2413', 50]])}
${tx('APU1', 14, '12-31', 'Apuramento de resultados', '', [['Debit', '711', 1000], ['Debit', '721', 500], ['Credit', '611', 400], ['Credit', '622', 100], ['Credit', '811', 1000]])}
${tx('APU2', 15, '12-31', 'Resultado líquido', '', [['Debit', '811', 1000], ['Credit', '818', 1000]])}
${tx('APU3', 15, '12-31', 'Resultado líquido', '', [['Debit', '818', 50], ['Credit', '8121', 50]])}
</Journal>
</GeneralLedgerEntries>
</AuditFile>
`;
  return Buffer.from(xml, 'latin1');
}

// Romania (D406): the OECD 2.0 schema, parties named under CompanyStructure,
// and classes 6 and 7 closed into 121 every month.
function roFile({ cui = 'RO12345678', year = 2024 } = {}) {
  const account = (id, desc, opening = 0) => `<nsSAFT:Account><nsSAFT:AccountID>${id}</nsSAFT:AccountID><nsSAFT:AccountDescription>${desc}</nsSAFT:AccountDescription><nsSAFT:StandardAccountID>${id}</nsSAFT:StandardAccountID><nsSAFT:AccountType>Bifunctional</nsSAFT:AccountType>${opening >= 0 ? `<nsSAFT:OpeningDebitBalance>${opening}</nsSAFT:OpeningDebitBalance>` : `<nsSAFT:OpeningCreditBalance>${-opening}</nsSAFT:OpeningCreditBalance>`}</nsSAFT:Account>`;
  const amount = (side, v) => `<nsSAFT:${side}><nsSAFT:Amount>${v.toFixed(2)}</nsSAFT:Amount></nsSAFT:${side}>`;
  const tx = (id, date, desc, lines) => `<nsSAFT:Transaction><nsSAFT:TransactionID>${id}</nsSAFT:TransactionID><nsSAFT:Period>${Number(date.slice(0, 2))}</nsSAFT:Period><nsSAFT:PeriodYear>${year}</nsSAFT:PeriodYear><nsSAFT:TransactionDate>${year}-${date}</nsSAFT:TransactionDate><nsSAFT:Description>${desc}</nsSAFT:Description><nsSAFT:GLPostingDate>${year}-${date}</nsSAFT:GLPostingDate>${lines.map(([acc, d, c, party], i) => `<nsSAFT:Line><nsSAFT:RecordID>${i + 1}</nsSAFT:RecordID><nsSAFT:AccountID>${acc}</nsSAFT:AccountID>${party || ''}<nsSAFT:Description>${desc}</nsSAFT:Description>${d ? amount('DebitAmount', d) : amount('CreditAmount', c)}</nsSAFT:Line>`).join('')}</nsSAFT:Transaction>`;
  return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<nsSAFT:AuditFile xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:nsSAFT="mfp:anaf:dgti:d406:declaratie:v1">
<nsSAFT:Header><nsSAFT:AuditFileVersion>2.0</nsSAFT:AuditFileVersion><nsSAFT:AuditFileCountry>RO</nsSAFT:AuditFileCountry>
<nsSAFT:Company><nsSAFT:RegistrationNumber>${cui}</nsSAFT:RegistrationNumber><nsSAFT:Name>Brutăria Exemplu SRL</nsSAFT:Name></nsSAFT:Company>
<nsSAFT:DefaultCurrencyCode>RON</nsSAFT:DefaultCurrencyCode>
<nsSAFT:SelectionCriteria><nsSAFT:SelectionStartDate>${year}-01-01</nsSAFT:SelectionStartDate><nsSAFT:SelectionEndDate>${year}-12-31</nsSAFT:SelectionEndDate></nsSAFT:SelectionCriteria>
</nsSAFT:Header>
<nsSAFT:MasterFiles><nsSAFT:GeneralLedgerAccounts>
${account('5121', 'Conturi la bănci în lei', 2000)}${account('1012', 'Capital subscris vărsat', -2000)}${account('4111', 'Clienți')}${account('401', 'Furnizori')}${account('421', 'Personal - salarii datorate')}
${account('4427', 'TVA colectată')}${account('4411', 'Impozitul pe profit')}${account('707', 'Venituri din vânzarea mărfurilor')}${account('607', 'Cheltuieli privind mărfurile')}${account('641', 'Cheltuieli cu salariile personalului')}${account('691', 'Cheltuieli cu impozitul pe profit')}${account('121', 'Profit sau pierdere')}
</nsSAFT:GeneralLedgerAccounts>
<nsSAFT:Customers><nsSAFT:Customer><nsSAFT:CompanyStructure><nsSAFT:RegistrationNumber>RO1</nsSAFT:RegistrationNumber><nsSAFT:Name>Magazin Client SRL</nsSAFT:Name></nsSAFT:CompanyStructure><nsSAFT:CustomerID>C1</nsSAFT:CustomerID><nsSAFT:AccountID>4111</nsSAFT:AccountID></nsSAFT:Customer></nsSAFT:Customers>
<nsSAFT:Suppliers><nsSAFT:Supplier><nsSAFT:CompanyStructure><nsSAFT:RegistrationNumber>RO2</nsSAFT:RegistrationNumber><nsSAFT:Name>Moara Furnizor SA</nsSAFT:Name></nsSAFT:CompanyStructure><nsSAFT:SupplierID>F1</nsSAFT:SupplierID><nsSAFT:AccountID>401</nsSAFT:AccountID></nsSAFT:Supplier></nsSAFT:Suppliers>
</nsSAFT:MasterFiles>
<nsSAFT:GeneralLedgerEntries><nsSAFT:NumberOfEntries>8</nsSAFT:NumberOfEntries>
<nsSAFT:Journal><nsSAFT:JournalID>JV</nsSAFT:JournalID><nsSAFT:Description>Jurnal general</nsSAFT:Description><nsSAFT:Type>GL</nsSAFT:Type>
${tx('1', '01-10', 'Factura vânzare', [['4111', 1190, 0, '<nsSAFT:CustomerID>C1</nsSAFT:CustomerID>'], ['707', 0, 1000], ['4427', 0, 190]])}
${tx('2', '01-12', 'Descărcare gestiune', [['607', 600, 0], ['401', 0, 600, '<nsSAFT:SupplierID>F1</nsSAFT:SupplierID>']])}
${tx('3', '01-31', 'Salarii ianuarie', [['641', 200, 0], ['421', 0, 200]])}
${tx('4', '01-31', 'Închidere venituri', [['707', 1000, 0], ['121', 0, 1000]])}
${tx('5', '01-31', 'Închidere cheltuieli', [['121', 800, 0], ['607', 0, 600], ['641', 0, 200]])}
${tx('6', '12-31', 'Impozit pe profit', [['691', 30, 0], ['4411', 0, 30]])}
${tx('7', '12-31', 'Închidere impozit', [['121', 30, 0], ['691', 0, 30]])}
</nsSAFT:Journal>
</nsSAFT:GeneralLedgerEntries>
</nsSAFT:AuditFile>
`);
}

describe('Portuguese and Romanian charts', () => {
  const snc = require('../utils/accounting/snc');
  const ro = require('../utils/accounting/ro');
  test.each([
    ['711', 1], ['721', 1], ['751', 2], ['731', 3], ['741', 4], ['611', 5], ['612', 5], ['622', 6], ['632', 7], ['651', 8], ['671', 8],
    ['781', 9], ['6811', 10], ['688', 10], ['642', 11], ['6553', 11], ['791', 12], ['691', 13], ['8121', 14],
  ])('SNC %s sits on line %i', (account, no) => {
    expect(snc.classifyAccount(account)).toMatchObject({ statement: 'Income statement', lineNo: no });
  });
  test.each([['707', 1], ['704', 1], ['711', 2], ['722', 3], ['758', 4], ['602', 5], ['605', 6], ['607', 7], ['641', 8], ['628', 9], ['6811', 10],
    ['766', 11], ['786', 11], ['666', 12], ['686', 12], ['691', 13], ['698', 14]])('Romanian %s sits on line %i', (account, no) => {
    expect(ro.classifyAccount(account)).toMatchObject({ statement: 'Income statement', lineNo: no });
  });
  test('result accounts carry the result over, out of the income statement', () => {
    for (const a of ['811', '818', '89']) expect(snc.classifyAccount(a).statement).toBe('Result allocation');
    for (const a of ['121', '129']) expect(ro.classifyAccount(a).statement).toBe('Result allocation');
    expect(ro.classifyAccount('1012').statement).toBe('Balance sheet');
    expect(snc.classifyAccount('2111')).toMatchObject({ statement: 'Balance sheet', line: 'Class 2 Receivables & payables' });
  });
});

describe('Portuguese and Romanian SAF-T', () => {
  test('a Portuguese SAF-T: grouping accounts counted once, the closing entries set apart, the books\' own result', async () => {
    const u = seedUser({ role: 'editor' });
    const res = await upload(u, 'SAFT_509999990.xml', ptFile());
    expect(res.status).toBe(201);
    expect(res.body.accounting).toMatchObject({
      kind: 'saft', chart: 'snc', country: 'PT', currency: 'EUR', companyId: '509999990', companyName: 'Padaria São João, Lda',
      fiscalYear: 2024, debit: 6330, credit: 6330, balanced: true, netIncome: 950, unclassifiedAccounts: [],
    });
    const id = res.body.datasource.id;
    const lines = await sql(u, id, "SELECT Line, SUM(Amount)::DOUBLE AS amount FROM entries WHERE Statement = 'Income statement' GROUP BY 1 ORDER BY 1");
    expect(lines).toEqual([
      { Line: '01 Sales & services rendered', amount: 1500 }, { Line: '05 Cost of goods sold & materials consumed', amount: -400 },
      { Line: '06 External supplies & services', amount: -100 }, { Line: '14 Income tax for the period', amount: -50 },
    ]);
    const [closing] = await sql(u, id, "SELECT COUNT(*)::INTEGER AS n FROM entries WHERE Line = 'Closing entries'");
    expect(closing.n).toBe(5);
    const parties = await sql(u, id, "SELECT DISTINCT CompAuxLib FROM entries WHERE CompAuxLib IS NOT NULL ORDER BY 1");
    expect(parties.map((p) => p.CompAuxLib)).toEqual(['Café Central, Lda', 'Moagem do Norte, SA']);
    const pack = await request(app).get(`/api/upload/${id}/fec-pack`).use(as(u));
    expect(pack.status).toBe(200);
    const m = await request(app).post('/api/models/import').use(as(u)).send({ yaml: pack.body.plan.model.yaml, datasourceId: id });
    const q = await request(app).post(`/api/models/${m.body.model.id}/query`).use(as(u)).send({ measureNames: ['_calc.revenue', '_calc.netIncome', '_calc.receivables'] });
    expect([q.body.rows[0].Revenue, q.body.rows[0]['Net result for the period'], q.body.rows[0]['Customer balance']].map(Number)).toEqual([1500, 950, 1730]);
  });

  test('a Romanian D406: parties under CompanyStructure, monthly closings into 121 set apart, 691 the income tax', async () => {
    const u = seedUser({ role: 'editor' });
    const res = await upload(u, 'D406_RO12345678.xml', roFile());
    expect(res.status).toBe(201);
    expect(res.body.accounting).toMatchObject({
      kind: 'saft', chart: 'ro', country: 'RO', currency: 'RON', companyId: 'RO12345678', companyName: 'Brutăria Exemplu SRL',
      balanced: true, netIncome: 170, unclassifiedAccounts: [],
    });
    const id = res.body.datasource.id;
    const lines = await sql(u, id, "SELECT Line, SUM(Amount)::DOUBLE AS amount FROM entries WHERE Statement = 'Income statement' GROUP BY 1 ORDER BY 1");
    expect(lines).toEqual([
      { Line: '01 Net turnover', amount: 1000 }, { Line: '07 Cost of goods sold', amount: -600 },
      { Line: '08 Staff costs', amount: -200 }, { Line: '13 Income tax', amount: -30 },
    ]);
    const parties = await sql(u, id, "SELECT DISTINCT CompAuxLib FROM entries WHERE CompAuxLib IS NOT NULL ORDER BY 1");
    expect(parties.map((p) => p.CompAuxLib)).toEqual(['Magazin Client SRL', 'Moara Furnizor SA']);
    const pack = await request(app).get(`/api/upload/${id}/fec-pack`).use(as(u));
    expect(pack.body.plan.model.yaml).toContain("suffix: ' lei'");
  });

  test('a Portuguese invoicing SAF-T is refused with what to export instead', async () => {
    const u = seedUser({ role: 'editor' });
    const res = await upload(u, 'SAFT_faturacao.xml', Buffer.from('<?xml version="1.0"?><AuditFile xmlns="urn:OECD:StandardAuditFile-Tax:PT_1.04_01"><Header><TaxAccountingBasis>F</TaxAccountingBasis></Header><MasterFiles/></AuditFile>'));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body.error).toMatch(/invoicing SAF-T/);
  });
});

// Luxembourg (FAIA 2.01, reduced schema: no namespace), PCN accounts, the
// year closed into 142.
function luFile({ vat = 'LU12345678', year = 2024 } = {}) {
  const account = (id, desc, opening = 0) => `<Account><AccountID>${id}</AccountID><AccountDescription>${desc}</AccountDescription><AccountType>GL</AccountType>${opening >= 0 ? `<OpeningDebitBalance>${opening}</OpeningDebitBalance>` : `<OpeningCreditBalance>${-opening}</OpeningCreditBalance>`}<ClosingDebitBalance>0</ClosingDebitBalance></Account>`;
  const amount = (side, v) => `<${side}><Amount>${v.toFixed(2)}</Amount></${side}>`;
  const tx = (id, date, desc, lines) => `<Transaction><TransactionID>${id}</TransactionID><Period>${Number(date.slice(0, 2))}</Period><PeriodYear>${year}</PeriodYear><TransactionDate>${year}-${date}</TransactionDate><Description>${desc}</Description><SystemEntryDate>${year}-${date}</SystemEntryDate><GLPostingDate>${year}-${date}</GLPostingDate>${lines.map(([acc, d, c, party], i) => `<Line><RecordID>${i + 1}</RecordID><AccountID>${acc}</AccountID>${party || ''}<Description>${desc}</Description>${d ? amount('DebitAmount', d) : amount('CreditAmount', c)}</Line>`).join('')}</Transaction>`;
  return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<AuditFile>
<Header><AuditFileVersion>2.01</AuditFileVersion><AuditFileCountry>LU</AuditFileCountry><AuditFileDateCreated>${year + 1}-01-20</AuditFileDateCreated><SoftwareCompanyName>Test</SoftwareCompanyName><SoftwareID>T</SoftwareID><SoftwareVersion>1</SoftwareVersion>
<Company><RegistrationNumber>${vat}</RegistrationNumber><Name>Boulangerie Kirchberg Sàrl</Name></Company><DefaultCurrencyCode>EUR</DefaultCurrencyCode>
<SelectionCriteria><SelectionStartDate>${year}-01-01</SelectionStartDate><SelectionEndDate>${year}-12-31</SelectionEndDate></SelectionCriteria><TaxAccountingBasis>A</TaxAccountingBasis></Header>
<MasterFiles><GeneralLedgerAccounts>
${account('5131', 'Banque', 3000)}${account('101', 'Capital souscrit', -3000)}${account('401', 'Clients')}${account('441', 'Fournisseurs')}${account('461', 'Dettes fiscales')}
${account('702', 'Ventes de produits')}${account('601', 'Achats de matières premières')}${account('621', 'Rémunérations')}${account('633', 'DCV immobilisations corporelles')}${account('646', 'Taxes')}${account('671', 'IRC')}${account('681', 'Impôt sur la fortune')}${account('142', 'Résultat de l\'exercice')}
</GeneralLedgerAccounts>
<Customers><Customer><Name>Hôtel du Parc</Name><CustomerID>C1</CustomerID><AccountID>401</AccountID></Customer></Customers>
</MasterFiles>
<GeneralLedgerEntries><NumberOfEntries>8</NumberOfEntries><TotalDebit>0</TotalDebit><TotalCredit>0</TotalCredit>
<Journal><JournalID>OD</JournalID><Description>Opérations diverses</Description><Type>GL</Type>
${tx('1', '02-10', 'Vente', [['401', 1000, 0, '<CustomerID>C1</CustomerID>'], ['702', 0, 1000]])}
${tx('2', '03-05', 'Farine', [['601', 300, 0], ['441', 0, 300]])}
${tx('3', '03-31', 'Salaires', [['621', 200, 0], ['5131', 0, 200]])}
${tx('4', '06-30', 'Taxe', [['646', 20, 0], ['5131', 0, 20]])}
${tx('5', '12-31', 'Amortissement', [['633', 50, 0], ['5131', 0, 50]])}
${tx('6', '12-31', 'Impôts', [['671', 80, 0], ['681', 10, 0], ['461', 0, 90]])}
${tx('7', '12-31', 'Clôture', [['702', 1000, 0], ['601', 0, 300], ['621', 0, 200], ['646', 0, 20], ['633', 0, 50], ['671', 0, 80], ['681', 0, 10], ['142', 0, 340]])}
</Journal>
</GeneralLedgerEntries>
</AuditFile>
`);
}

describe('Luxembourg FAIA', () => {
  const pcn = require('../utils/accounting/pcn');
  test.each([
    ['702', 1], ['706', 1], ['711', 2], ['721', 3], ['745', 4], ['601', 5], ['606', 5], ['611', 6], ['621', 7], ['634', 8], ['735', 8],
    ['646', 9], ['633', 10], ['732', 10], ['755', 11], ['651', 12], ['655', 13], ['671', 14], ['771', 14], ['681', 15],
  ])('PCN %s sits on line %i', (account, no) => {
    expect(pcn.classifyAccount(account)).toMatchObject({ statement: 'Income statement', lineNo: no });
  });

  test('a FAIA without namespace: the year closed into 142 set apart, the books\' result, the Luxembourg statement', async () => {
    const u = seedUser({ role: 'editor' });
    const res = await upload(u, 'FAIA_LU12345678_2024.xml', luFile());
    expect(res.status).toBe(201);
    expect(res.body.accounting).toMatchObject({
      kind: 'saft', chart: 'pcn', country: 'LU', currency: 'EUR', companyId: 'LU12345678', companyName: 'Boulangerie Kirchberg Sàrl',
      balanced: true, netIncome: 340, unclassifiedAccounts: [],
    });
    const id = res.body.datasource.id;
    const lines = await sql(u, id, "SELECT Line, SUM(Amount)::DOUBLE AS amount FROM entries WHERE Statement = 'Income statement' GROUP BY 1 ORDER BY 1");
    expect(lines).toEqual([
      { Line: '01 Net turnover', amount: 1000 }, { Line: '05 Raw materials & consumables', amount: -300 }, { Line: '07 Staff costs', amount: -200 },
      { Line: '09 Other operating expenses', amount: -20 }, { Line: '10 Value adjustments on formation expenses & fixed assets', amount: -50 },
      { Line: '14 Income taxes', amount: -80 }, { Line: '15 Other taxes', amount: -10 },
    ]);
    const [customer] = await sql(u, id, "SELECT CompAuxLib FROM entries WHERE CompteNum = '401'");
    expect(customer.CompAuxLib).toBe('Hôtel du Parc');
    const pack = await request(app).get(`/api/upload/${id}/fec-pack`).use(as(u));
    const buildUp = pack.body.plan.report.bundle.report.pages.find((p) => p.name === 'Profit build-up');
    expect(Object.values(buildUp.widgets).filter((w) => w.type === 'scorecard').map((w) => w.config.label).slice(0, 6))
      .toEqual(['Gross result', 'EBITDA', 'Operating result', 'Result before taxes', 'Result after income taxes', 'Result for the financial year']);
  });
});
