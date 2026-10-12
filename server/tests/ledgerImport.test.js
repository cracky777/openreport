// A general ledger exported to CSV — the books of countries with no standard
// audit file — is read with the columns and chart the user names, and its
// accounts can be placed by hand: the placing changes the books' figures and
// survives a refresh of the file.
const request = require('supertest');
const pcmn = require('../utils/accounting/pcmn');

// Every import runs in a child process (utils/fileImport.js).
jest.setTimeout(60000);
const { buildApp, seedUser } = require('./helpers/testApp');

const app = buildApp();
const as = (uid) => (r) => r.set('x-test-user', uid);

// A Belgian ledger: semicolons, decimal commas, dates as DD/MM/YYYY.
const BELGIAN = [
  'Date;Compte;Intitulé;Journal;Pièce;Libellé;Débit;Crédit;Tiers',
  '15/01/2024;400000;Clients;VEN;V1;Facture 1;1 210,00;0;Brasserie Sainte-Catherine',
  '15/01/2024;700000;Ventes;VEN;V1;Facture 1;0;1 000,00;',
  '15/01/2024;451000;TVA à payer;VEN;V1;Facture 1;0;210,00;',
  '20/01/2024;604000;Achats de marchandises;ACH;A1;Farine;400,00;0;',
  '20/01/2024;440000;Fournisseurs;ACH;A1;Farine;0;400,00;Moulin de Gand',
  '31/01/2024;620000;Rémunérations;OD;O1;Salaires;300,00;0;',
  '31/01/2024;550000;Banque;OD;O1;Salaires;0;300,00;',
  '31/12/2024;630000;Amortissements;OD;O2;Dotation;50,00;0;',
  '31/12/2024;240000;Matériel;OD;O2;Dotation;0;50,00;',
  '31/12/2024;670000;Impôts sur le résultat;OD;O3;ISOC;40,00;0;',
  '31/12/2024;450000;Dettes fiscales;OD;O3;ISOC;0;40,00;',
].join('\r\n');
const LEDGER = { chart: 'pcmn', currency: 'EUR', amounts: 'debitCredit', columns: { date: 'Date', account: 'Compte', accountName: 'Intitulé', journal: 'Journal', entry: 'Pièce', label: 'Libellé', debit: 'Débit', credit: 'Crédit', partyName: 'Tiers' } };

async function upload(uid, name, content, fields = {}) {
  let req = request(app).post('/api/upload').use(as(uid));
  for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
  return req.attach('file', Buffer.from(content, 'utf8'), name);
}
const sql = async (uid, id, text) => {
  const res = await request(app).post(`/api/datasources/${id}/query`).use(as(uid)).send({ sql: text });
  expect(res.status).toBe(200);
  return res.body.rows;
};

describe('Belgian chart (PCMN)', () => {
  test.each([
    ['700000', 1], ['710000', 2], ['720000', 3], ['740000', 4], ['760000', 4], ['604000', 5], ['610000', 6], ['620000', 7],
    ['640000', 8], ['631000', 8], ['630000', 9], ['750000', 10], ['650000', 11], ['670000', 12], ['680000', 13],
  ])('%s sits on line %i', (account, no) => {
    expect(pcmn.classifyAccount(account)).toMatchObject({ statement: 'Income statement', lineNo: no });
  });
  test('appropriations stand apart', () => {
    expect(pcmn.classifyAccount('693000').statement).toBe('Result allocation');
    expect(pcmn.classifyAccount('400000').line).toBe('Class 4 Amounts receivable & payable within one year');
  });
});

describe('Ledger import', () => {
  test('a Belgian ledger CSV read with its columns and the PCMN: classified, the books\' result, the Finance package', async () => {
    const u = seedUser({ role: 'editor' });
    const res = await upload(u, 'grand-livre-2024.csv', BELGIAN, { delimiter: 'semicolon', decimalSeparator: 'comma', ledger: JSON.stringify(LEDGER) });
    expect(res.status).toBe(201);
    expect(res.body.accounting).toMatchObject({
      kind: 'ledger', chart: 'pcmn', currency: 'EUR', fiscalYear: 2024, balanced: true, unbalancedEntries: 0,
      netIncome: 1000 - 400 - 300 - 50 - 40, unclassifiedAccounts: [],
    });
    const id = res.body.datasource.id;
    // The source holds the books only, not the raw sheet.
    expect(res.body.datasource.tables.map((t) => t.tableName)).toEqual(['entries']);
    const [sale] = await sql(u, id, "SELECT Line, EcritureLib, CompteLib, strftime(EcritureDate, '%Y-%m-%d') AS d FROM entries WHERE CompteNum = '700000'");
    expect(sale).toEqual({ Line: '01 Turnover', EcritureLib: 'Facture 1', CompteLib: 'Ventes', d: '2024-01-15' });
    const [party] = await sql(u, id, "SELECT CompAuxLib FROM entries WHERE CompteNum = '400000'");
    expect(party.CompAuxLib).toBe('Brasserie Sainte-Catherine');
    const pack = await request(app).get(`/api/upload/${id}/fec-pack`).use(as(u));
    expect(pack.status).toBe(200);
  });

  test('a ledger on no known chart: accounts placed by hand, the placing kept through a refresh', async () => {
    const u = seedUser({ role: 'editor' });
    const generic = { ...LEDGER, chart: 'generic' };
    const res = await upload(u, 'ledger.csv', BELGIAN, { delimiter: 'semicolon', decimalSeparator: 'comma', ledger: JSON.stringify(generic) });
    expect(res.status).toBe(201);
    expect(res.body.accounting.netIncome).toBe(0);
    expect(res.body.accounting.unclassifiedAccounts).toHaveLength(11);
    const id = res.body.datasource.id;

    const list = await request(app).get(`/api/upload/${id}/accounts`).use(as(u));
    expect(list.status).toBe(200);
    expect(list.body).toMatchObject({ chart: 'generic', canEdit: true });
    expect(list.body.targets.map((t) => t.line)).toContain('01 Revenue');
    expect(list.body.accounts.find((a) => a.account === '700000')).toMatchObject({ lineNo: 999, debit: 0, credit: 1000, mapped: false });

    const put = await request(app).put(`/api/upload/${id}/accounts`).use(as(u))
      .send({ changes: { 700000: 1, 604000: 3, 620000: 4, 630000: 6, 670000: 9, 400000: 103 } });
    expect(put.status).toBe(200);
    expect(put.body.mapped).toBe(6);
    expect(put.body.files[0].accounting.netIncome).toBe(210);
    const [revenue] = await sql(u, id, "SELECT Line, Statement FROM entries WHERE CompteNum = '700000' LIMIT 1");
    expect(revenue).toEqual({ Line: '01 Revenue', Statement: 'Income statement' });

    // The next export, refreshed: same columns, same placing.
    const refreshed = await request(app).put(`/api/upload/${id}`).use(as(u)).field('delimiter', 'semicolon').field('decimalSeparator', 'comma')
      .attach('file', Buffer.from(BELGIAN, 'utf8'), 'ledger.csv');
    expect(refreshed.status).toBe(200);
    const [still] = await sql(u, id, "SELECT Line FROM entries WHERE CompteNum = '604000' LIMIT 1");
    expect(still.Line).toBe('03 Cost of sales & materials');

    // Placing an account back where the chart left it forgets the mapping.
    const back = await request(app).put(`/api/upload/${id}/accounts`).use(as(u)).send({ changes: { 670000: 999 } });
    expect(back.body.mapped).toBe(5);
    const bad = await request(app).put(`/api/upload/${id}/accounts`).use(as(u)).send({ changes: { 700000: 4242 } });
    expect(bad.status).toBe(400);
  });

  test('a ledger whose columns are not in the file is refused with what is missing', async () => {
    const u = seedUser({ role: 'editor' });
    const res = await upload(u, 'bad.csv', BELGIAN, { delimiter: 'semicolon', ledger: JSON.stringify({ ...LEDGER, columns: { ...LEDGER.columns, debit: 'Debit' } }) });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body.error).toMatch(/"Debit"/);
  });

  test('a viewer reads the accounts but cannot place them', async () => {
    const u = seedUser({ role: 'editor' });
    const res = await upload(u, 'mine.csv', BELGIAN, { delimiter: 'semicolon', decimalSeparator: 'comma', ledger: JSON.stringify(LEDGER) });
    const stranger = seedUser({ role: 'editor' });
    const denied = await request(app).put(`/api/upload/${res.body.datasource.id}/accounts`).use(as(stranger)).send({ changes: { 700000: 4 } });
    expect([403, 404]).toContain(denied.status);
  });
});
