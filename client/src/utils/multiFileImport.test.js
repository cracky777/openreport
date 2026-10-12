import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./api', () => ({ default: { post: vi.fn(), put: vi.fn() } }));
// The merge call only: what tells books apart is the real thing.
vi.mock('./accountingPack', async (actual) => ({ ...(await actual()), addFecYearsTo: vi.fn() }));

const { addFecYearsTo } = await import('./accountingPack');
const { mergeFecUploads } = await import('./multiFileImport');

const fec = (id, siren, fiscalYear) => ({ data: { datasource: { id }, accounting: { kind: 'fec', siren, fiscalYear } } });
const saft = (id, companyId, fiscalYear, chart = 'ns4102') => ({ data: { datasource: { id }, accounting: { kind: 'saft', chart, companyId, fiscalYear } } });
const csv = (id) => ({ data: { datasource: { id } } });

describe('mergeFecUploads', () => {
  beforeEach(() => {
    addFecYearsTo.mockReset();
    addFecYearsTo.mockImplementation(async () => ({ years: [{ year: 2024 }, { year: 2025 }] }));
  });

  it('merges the books of one company into the first, and leaves other files alone', async () => {
    const results = [fec('a', '111', 2025), csv('c'), fec('b', '111', 2024)];
    const books = await mergeFecUploads(results);
    expect(addFecYearsTo).toHaveBeenCalledWith('a', 'b');
    expect(books.map((b) => [b.datasource.id, b.accounting.years])).toEqual([['a', [2024, 2025]]]);
    expect(results.map((r) => r.mergedInto || null)).toEqual([null, null, 'a']);
  });

  it('never merges books whose company is unknown (a renamed file) or another company\'s', async () => {
    const books = await mergeFecUploads([fec('a', '111', 2025), fec('b', '222', 2024), fec('c', undefined, 2023)]);
    expect(addFecYearsTo).not.toHaveBeenCalled();
    expect(books.map((b) => b.datasource.id)).toEqual(['a', 'b', 'c']);
  });

  it('merges SAF-T years like FEC ones, never with a FEC of the same number, and offers a package only where one exists', async () => {
    const results = [saft('n1', '912345678', 2025), saft('n2', '912345678', 2024), fec('f', '912345678', 2024), saft('lt', '300', 2024, null)];
    const books = await mergeFecUploads(results);
    expect(addFecYearsTo.mock.calls).toEqual([['n1', 'n2']]);
    expect(books.map((b) => b.datasource.id)).toEqual(['n1', 'f']);
  });
});
