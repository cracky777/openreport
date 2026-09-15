import { describe, test, expect } from 'vitest';
import { readableTables } from './readableTables';

// orders (*) → customers (1) → countries (1); orders (1) ↔ invoices (1); the
// regions join has no cardinality and must not be crossed either way.
const joins = [
  { from_table: 'orders', to_table: 'customers', cardinality: { from: '*', to: '1' } },
  { from_table: 'customers', to_table: 'countries', cardinality: { from: '*', to: '1' } },
  { from_table: 'orders', to_table: 'invoices', cardinality: { from: '1', to: '1' } },
  { from_table: 'regions', to_table: 'countries' },
];

describe('readableTables', () => {
  test('a fact reads its dimensions transitively, and 1:1 tables', () => {
    expect([...readableTables('orders', joins)].sort()).toEqual(['countries', 'customers', 'invoices', 'orders']);
  });

  test('a dimension reads its parents but never its children', () => {
    expect([...readableTables('customers', joins)].sort()).toEqual(['countries', 'customers']);
  });

  test('a join without cardinality is never crossed', () => {
    expect([...readableTables('countries', joins)].sort()).toEqual(['countries']);
    expect([...readableTables('regions', joins)].sort()).toEqual(['regions']);
  });

  test('no home table → nothing is readable', () => {
    expect(readableTables('', joins).size).toBe(0);
  });
});
