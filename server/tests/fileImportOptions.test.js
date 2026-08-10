// CSV parse options: the whitelisted tokens (delimiter, header, …) must reach
// DuckDB's read_csv. We probe the two most observable ones — a ';' separator and
// header on/off — via the shape of the resulting datasource.
const request = require('supertest');
const XLSX = require('xlsx');
const { buildApp, seedUser } = require('./helpers/testApp');

const app = buildApp();
const as = (uid) => (r) => r.set('x-test-user', uid);

// Build an in-memory .xlsx buffer from { sheetName: aoa } maps.
function xlsxBuffer(sheets) {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

describe('File import parse options', () => {
  test('semicolon delimiter, header off → both rows kept, split into 2 columns', async () => {
    const u = seedUser({ role: 'editor' });
    const res = await request(app).post('/api/upload').use(as(u))
      .field('delimiter', 'semicolon').field('hasHeader', 'false')
      .attach('file', Buffer.from('1;2\n3;4\n'), 'semi_noheader.csv');
    expect(res.status).toBe(201);
    expect(res.body.datasource.rowCount).toBe(2);       // no header row was consumed
    expect(res.body.datasource.columns.length).toBe(2); // ';' actually split the columns
  });

  test('auto delimiter (no token) detects a semicolon-separated file', async () => {
    // A forced delim=',' would sniff to a single column / fail; auto must split.
    const u = seedUser({ role: 'editor' });
    const res = await request(app).post('/api/upload').use(as(u))
      .attach('file', Buffer.from('a;b;c\n1;2;3\n4;5;6\n'), 'auto_semi.csv');
    expect(res.status).toBe(201);
    expect(res.body.datasource.columns.length).toBe(3);
  });

  test('full auto: a Latin-1 + semicolon file imports with no options at all', async () => {
    // 'coût' in Latin-1 has byte 0xFB (invalid UTF-8) → the UTF-8 attempt fails
    // and the Latin-1 fallback kicks in, while the delimiter is sniffed as ';'.
    const u = seedUser({ role: 'editor' });
    const res = await request(app).post('/api/upload').use(as(u))
      .attach('file', Buffer.from('ville;coût\nParis;12\nLyon;9\n', 'latin1'), 'fr.csv');
    expect(res.status).toBe(201);
    expect(res.body.datasource.rowCount).toBe(2);
    expect(res.body.datasource.columns.length).toBe(2);
  });

  test('semicolon delimiter, header on (default) → first row becomes the column names', async () => {
    const u = seedUser({ role: 'editor' });
    const res = await request(app).post('/api/upload').use(as(u))
      .field('delimiter', 'semicolon')
      .attach('file', Buffer.from('a;b\n1;2\n3;4\n'), 'semi_header.csv');
    expect(res.status).toBe(201);
    expect(res.body.datasource.rowCount).toBe(2);
    expect(res.body.datasource.columns.map((c) => c.column_name).sort()).toEqual(['a', 'b']);
  });

  test('Excel: two selected sheets become two tables', async () => {
    const u = seedUser({ role: 'editor' });
    const buf = xlsxBuffer({ Sales: [['a', 'b'], [1, 2], [3, 4]], Costs: [['x'], [9]] });
    const res = await request(app).post('/api/upload').use(as(u))
      .field('sheets', JSON.stringify(['Sales', 'Costs']))
      .attach('file', buf, 'book.xlsx');
    expect(res.status).toBe(201);
    expect(res.body.datasource.tables.map((t) => t.tableName).sort()).toEqual(['Costs', 'Sales']);
    const sales = res.body.datasource.tables.find((t) => t.tableName === 'Sales');
    expect(sales.rowCount).toBe(2); // header row consumed
    expect(sales.columns.map((c) => c.column_name).sort()).toEqual(['a', 'b']);
  });

  test('Excel: only the selected sheet is imported', async () => {
    const u = seedUser({ role: 'editor' });
    const buf = xlsxBuffer({ Keep: [['a'], [1]], Skip: [['b'], [2]] });
    const res = await request(app).post('/api/upload').use(as(u))
      .field('sheets', JSON.stringify(['Keep']))
      .attach('file', buf, 'pick.xlsx');
    expect(res.status).toBe(201);
    expect(res.body.datasource.tables.map((t) => t.tableName)).toEqual(['Keep']);
  });

  test('Excel: header off keeps the first row as data', async () => {
    const u = seedUser({ role: 'editor' });
    const buf = xlsxBuffer({ S: [['a', 'b'], [1, 2], [3, 4]] });
    const res = await request(app).post('/api/upload').use(as(u))
      .field('sheets', JSON.stringify(['S'])).field('hasHeader', 'false')
      .attach('file', buf, 'noheader.xlsx');
    expect(res.status).toBe(201);
    expect(res.body.datasource.tables[0].rowCount).toBe(3); // header row kept as data
  });
});
