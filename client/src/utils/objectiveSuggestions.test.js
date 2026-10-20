import { describe, it, expect } from 'vitest';
import { startingQuestions, followUps } from './objectiveSuggestions';

const catalogue = [
  { id: 'ecommerce', label: 'E-commerce', roles: [], objectives: [
    { id: 'sales_overview', label: 'Sales overview', asks: 'How is the shop doing?', needs: ['ecommerce.order_date', 'ecommerce.order', 'ecommerce.revenue'] },
    { id: 'acquisition', label: 'Acquisition and conversion', asks: 'Where do the sales come from?', needs: ['ecommerce.source', 'ecommerce.revenue'] },
    { id: 'products', label: 'Products and catalogue', asks: 'Which products carry the revenue?', needs: ['ecommerce.product', 'ecommerce.revenue'] },
  ] },
  { id: 'finance', label: 'Finance', roles: [], objectives: [{ id: 'cash', label: 'Cash', asks: 'How much do we have?', needs: ['finance.cash_account'] }] },
];
const model = {
  domains: ['ecommerce', 'finance'],
  dimensions: [{ name: 'd', role: 'ecommerce.order_date' }, { name: 'o', role: 'ecommerce.order' }, { name: 'p', role: 'ecommerce.product' }],
  measures: [{ name: 'm', role: 'ecommerce.revenue' }],
};

describe('questions from the catalogue', () => {
  it('offers the objectives whose roles the model carries, phrased with their name', () => {
    expect(startingQuestions(model, catalogue)).toEqual(['Sales overview: how is the shop doing?', 'Products and catalogue: which products carry the revenue?']);
    expect(startingQuestions({ domains: ['ecommerce'], dimensions: [], measures: [] }, catalogue)).toEqual([]);
    expect(startingQuestions(model, [])).toEqual([]);
  });

  it('follows up with the other objectives of the same domain', () => {
    const understood = { domain: { id: 'ecommerce' }, objective: { id: 'sales_overview' } };
    expect(followUps(model, catalogue, understood)).toEqual(['Products and catalogue: which products carry the revenue?']);
    expect(followUps(model, catalogue, { domain: { id: 'ecommerce' } })).toEqual([]);
    expect(followUps(model, catalogue, null)).toEqual([]);
  });
});
