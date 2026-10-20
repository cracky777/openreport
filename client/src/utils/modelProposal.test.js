import { describe, it, expect } from 'vitest';
import { applyModelProposal, describeModelProposal, keepModelChoices } from './modelProposal';
import { describeProposal } from './aiProposal';

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

  it('a date with its breakdowns: one dimension per part beside the date, named after the column', () => {
    const out = applyModelProposal(state, { fields: [{ table: 'orders', column: 'ordered_at', as: 'dimension', dateParts: ['year_month', 'week', 'nope'] }] }, columns);
    expect(out.dimensions.slice(1)).toEqual([
      { name: 'orders.ordered_at', table: 'orders', column: 'ordered_at', type: 'date', label: 'ordered_at' },
      { name: 'orders.ordered_at_year_month', table: 'orders', column: 'ordered_at', type: 'string', label: 'ordered_at (Year-month)', datePartOf: 'orders.ordered_at', datePart: 'year_month' },
      { name: 'orders.ordered_at_week', table: 'orders', column: 'ordered_at', type: 'integer', label: 'ordered_at (Week)', datePartOf: 'orders.ordered_at', datePart: 'num_week' },
    ]);
    // Applied again: nothing doubled; flagged `none`: the date and its parts go together.
    expect(applyModelProposal(out, { fields: [{ table: 'orders', column: 'ordered_at', as: 'dimension', dateParts: ['week'] }] }, columns).dimensions).toHaveLength(4);
    expect(applyModelProposal(out, { fields: [{ table: 'orders', column: 'ordered_at', as: 'none' }] }, columns).dimensions).toHaveLength(1);
  });

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

describe('unticking lines of a model card', () => {
  const proposal = {
    kind: 'model',
    joins: [{ from_table: 'orders', from_column: 'customer_id', to_table: 'customers', to_column: 'id' }, { from_table: 'orders', from_column: 'product_id', to_table: 'products', to_column: 'id' }],
    tableRoles: { orders: 'fact', customers: 'dimension' },
    fields: [{ table: 'orders', column: 'amount', as: 'measure' }],
    measures: [],
    positions: { orders: { x: 0, y: 0 } },
  };

  it('keeps every line that stays ticked', () => {
    const kept = keepModelChoices(proposal, new Set(['join0', 'role:customers', 'positions']));
    expect(kept.joins).toEqual([proposal.joins[1]]);
    expect(kept.tableRoles).toEqual({ orders: 'fact' });
    expect(kept.fields).toEqual(proposal.fields);
    expect(kept.positions).toBeNull();
    expect(keepModelChoices(proposal, new Set())).toBe(proposal);
  });

  it('the next turn hears only what was kept', () => {
    const kept = keepModelChoices(proposal, new Set(['join0', 'field0', 'positions', 'role:orders', 'role:customers']));
    expect(describeProposal(proposal, { status: 'partial', kept })).toBe('[Proposed — partly applied by the user — only what follows was kept, the rest turned down: join orders.product_id → products.id]');
  });
});

describe('the glossary of a model card', () => {
  const glossaryState = {
    joins: [], tablePositions: {}, domains: ['sales'],
    dimensions: [
      { name: 'orders.country', table: 'orders', column: 'country', type: 'string', label: 'Country' },
      { name: 'calc', table: 'orders', column: 'country', type: 'string', label: 'Calc', expression: 'UPPER(country)' },
    ],
    measures: [
      { name: 'orders.amount_sum', table: 'orders', column: 'amount', aggregation: 'sum', label: 'Amount', role: 'sales.cost', synonyms: ['CA'] },
      { name: 'orders.amount_avg', table: 'orders', column: 'amount', aggregation: 'avg', label: 'Average' },
    ],
  };
  const proposal = {
    domains: ['ecommerce'],
    glossary: [
      { table: 'orders', column: 'country', as: 'dimension', role: 'ecommerce.country' },
      { table: 'orders', column: 'amount', as: 'measure', role: 'ecommerce.revenue', description: 'Paid amount' },
    ],
  };

  it('lands on every field of the column, keeps the users\' synonyms, leaves SQL fields alone', () => {
    const next = applyModelProposal(glossaryState, proposal, columns);
    expect(next.domains).toEqual(['ecommerce']);
    expect(next.dimensions[0].role).toBe('ecommerce.country');
    expect(next.dimensions[1].role).toBeUndefined();
    expect(next.measures[0]).toMatchObject({ role: 'ecommerce.revenue', description: 'Paid amount', synonyms: ['CA'] });
    expect(next.measures[1]).toMatchObject({ role: 'ecommerce.revenue', description: 'Paid amount' });
    // No domains in the proposal: the model keeps its own.
    expect(applyModelProposal(glossaryState, { glossary: [] }, columns).domains).toEqual(['sales']);
  });

  it('unticks per line and reads back for the next turn', () => {
    const kept = keepModelChoices(proposal, new Set(['domains', 'glossary0']));
    expect(kept.domains).toBeNull();
    expect(kept.glossary).toEqual([proposal.glossary[1]]);
    expect(describeModelProposal(proposal, 'applied')).toBe('[Proposed — applied by the user: domains: ecommerce; orders.country = ecommerce.country; orders.amount = ecommerce.revenue (described)]');
  });
});
