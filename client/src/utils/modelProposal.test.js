import { describe, it, expect } from 'vitest';
import { applyModelProposal, describeModelProposal } from './modelProposal';

const columns = {
  typeOf: (t, c) => (c === 'ordered_at' ? 'date' : 'string'),
  dataTypeOf: (t, c) => (c === 'amount' ? 'NUMERIC' : 'integer'),
};
const state = {
  joins: [{ from_table: 'orders', from_column: 'x', to_table: 'old', to_column: 'id', cardinality: { from: '*', to: '1' } }],
  dimensions: [{ name: 'orders.customer_id', table: 'orders', column: 'customer_id', type: 'integer', label: 'customer_id' }],
  measures: [{ name: 'orders.customer_id_sum', table: 'orders', column: 'customer_id', aggregation: 'sum', label: 'customer_id' }],
  tablePositions: { orders: { x: 0, y: 0, tableType: 'dimension' }, customers: { x: 300, y: 0 } },
};

describe('applyModelProposal', () => {
  const proposal = {
    joins: [{ from_table: 'orders', from_column: 'customer_id', to_table: 'customers', to_column: 'id', cardinality: { from: '*', to: '1' } }],
    removeJoins: [{ from_table: 'old', from_column: 'id', to_table: 'orders', to_column: 'x' }],
    tableRoles: { orders: 'fact' },
    fields: [
      { table: 'orders', column: 'customer_id', as: 'none' },
      { table: 'orders', column: 'ordered_at', as: 'dimension' },
      { table: 'orders', column: 'amount', as: 'measure' },
    ],
    measures: [{ table: 'orders', column: 'id', aggregation: 'count', label: 'Orders' }],
    positions: { orders: { x: 560, y: 40 }, customers: { x: 40, y: 40 } },
  };

  it('applies every part, with the names the editor itself would give', () => {
    const out = applyModelProposal(state, proposal, columns);
    expect(out.joins).toEqual([proposal.joins[0]]);
    expect(out.dimensions).toEqual([{ name: 'orders.ordered_at', table: 'orders', column: 'ordered_at', type: 'date', label: 'ordered_at' }]);
    expect(out.measures).toEqual([
      { name: 'orders.amount_sum', table: 'orders', column: 'amount', aggregation: 'sum', label: 'amount', dataType: 'numeric' },
      { name: 'orders.id_count', table: 'orders', column: 'id', aggregation: 'count', label: 'Orders', dataType: 'integer' },
    ]);
    // Moved AND re-roled: the one does not wipe the other.
    expect(out.tablePositions.orders).toEqual({ x: 560, y: 40, tableType: 'fact' });
    expect(out.tablePositions.customers).toEqual({ x: 40, y: 40 });
  });

  it('applying twice changes nothing more, and the state passed in is left alone', () => {
    const before = JSON.stringify(state);
    const once = applyModelProposal(state, proposal, columns);
    const twice = applyModelProposal(once, proposal, columns);
    expect(twice).toEqual(once);
    expect(JSON.stringify(state)).toBe(before);
  });

  it('reads back as one line for the next turn', () => {
    expect(describeModelProposal(proposal, 'applied')).toMatch(/^\[Proposed — applied by the user: join orders\.customer_id → customers\.id; remove join .*; orders is a fact; .*measure count\(orders\.id\); tables arranged\]$/);
  });
});
