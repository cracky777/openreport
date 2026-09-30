import { describe, it, expect } from 'vitest';
import { matchColumns, allFlagged, toggleRole } from './bulkFlag';

const tables = {
  orders: [
    { column_name: 'order_id', data_type: 'integer' },
    { column_name: 'amount', data_type: 'numeric' },
    { column_name: 'order_date', data_type: 'date' },
  ],
  customers: [
    { column_name: 'customer_id', data_type: 'integer' },
    { column_name: 'name', data_type: 'text' },
  ],
};
const typeOf = () => 'string';

describe('matchColumns', () => {
  it('matches column names case-insensitively, across tables', () => {
    const m = matchColumns(tables, ' ID ');
    expect(m.map(({ table, col }) => `${table}.${col.column_name}`)).toEqual(['orders.order_id', 'customers.customer_id']);
  });

  it('matches nothing on an empty search, and never on the table name', () => {
    expect(matchColumns(tables, '  ')).toEqual([]);
    expect(matchColumns(tables, 'customers')).toEqual([]);
  });
});

describe('toggleRole', () => {
  it('flags the missing matches as measures, a sum for numbers and a max otherwise', () => {
    const matches = matchColumns(tables, 'order');
    const next = toggleRole({ dimensions: [], measures: [] }, matches, 'measure', { typeOf });
    expect(next.measures.map((m) => m.name)).toEqual(['orders.order_id_sum', 'orders.order_date_max']);
    expect(next.dimensions).toEqual([]);
  });

  it('keeps what is already flagged and labels a clash after its role', () => {
    const state = {
      dimensions: [{ name: 'orders.amount', table: 'orders', column: 'amount', type: 'decimal', label: 'amount' }],
      measures: [],
    };
    const next = toggleRole(state, matchColumns(tables, 'amount'), 'measure', { typeOf });
    expect(next.dimensions).toEqual(state.dimensions);
    expect(next.measures[0].label).toBe('amount (sum)');
  });

  it('unflags every match when all of them already carry the role, and only that role', () => {
    const matches = matchColumns(tables, 'id');
    const flagged = toggleRole({ dimensions: [], measures: [] }, matches, 'dimension', { typeOf });
    const withMeasure = toggleRole(flagged, matches, 'measure', { typeOf });
    expect(allFlagged(withMeasure, matches, 'dimension')).toBe(true);
    const next = toggleRole(withMeasure, matches, 'dimension', { typeOf });
    expect(next.dimensions).toEqual([]);
    expect(next.measures).toHaveLength(2);
  });

  it('leaves calculated fields alone', () => {
    const calc = { name: '_calcdim.x', table: 'orders', column: '', expression: 'amount * 2', label: 'x' };
    const state = { dimensions: [calc], measures: [] };
    const matches = matchColumns(tables, 'amount');
    const on = toggleRole(state, matches, 'dimension', { typeOf });
    const off = toggleRole(on, matches, 'dimension', { typeOf });
    expect(off.dimensions).toEqual([calc]);
  });
});
