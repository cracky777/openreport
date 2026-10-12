import { describe, it, expect } from 'vitest';
import { waterfallSteps } from './waterfall';

const SIG = [
  { after: '02 Cost of goods sold', label: 'Gross margin' },
  { after: '06 Other purchases', label: 'Value added' },
  { after: '09 Staff costs', label: 'EBITDA' },
];
const brief = (steps) => steps.map((s) => [s.name, s.kind, s.start, s.end]);

describe('waterfallSteps', () => {
  it('runs a total through the categories and closes on it', () => {
    const steps = waterfallSteps([{ name: 'Sales', value: 100 }, { name: 'Costs', value: -30 }], { totalLabel: 'Net' });
    expect(brief(steps)).toEqual([
      ['Sales', 'increase', 0, 100],
      ['Costs', 'decrease', 100, 70],
      ['Net', 'total', 0, 70],
    ]);
  });

  it('places a subtotal after its category, or where that category would sort when absent', () => {
    // A services company: no line 01 or 02, so "Gross margin" has nothing
    // before it and is left out; "Value added" follows line 06 though 05 is absent.
    const items = [{ name: '03 Production sold', value: 1000 }, { name: '06 Other purchases', value: -300 }, { name: '09 Staff costs', value: -400 }, { name: '11 Depreciation', value: -50 }];
    expect(brief(waterfallSteps(items, { subtotals: SIG, totalLabel: 'Net income' }))).toEqual([
      ['03 Production sold', 'increase', 0, 1000],
      ['06 Other purchases', 'decrease', 1000, 700],
      ['Value added', 'total', 0, 700],
      ['09 Staff costs', 'decrease', 700, 300],
      ['EBITDA', 'total', 0, 300],
      ['11 Depreciation', 'decrease', 300, 250],
      ['Net income', 'total', 0, 250],
    ]);
  });

  it('a subtotal anchored on a missing category between two present ones still lands between them', () => {
    const items = [{ name: '01 Sales of goods', value: 50 }, { name: '03 Production sold', value: 20 }];
    expect(brief(waterfallSteps(items, { subtotals: SIG, showTotal: false }))).toEqual([
      ['01 Sales of goods', 'increase', 0, 50],
      ['Gross margin', 'total', 0, 50],
      ['03 Production sold', 'increase', 50, 70],
      ['Value added', 'total', 0, 70],
    ]);
  });

  it('after the last category, a subtotal gives way to the closing total it would repeat', () => {
    const items = [{ name: '01 Sales of goods', value: 50 }, { name: '03 Production sold', value: 20 }];
    expect(waterfallSteps(items, { subtotals: SIG, totalLabel: 'Net' }).map((s) => s.name))
      .toEqual(['01 Sales of goods', 'Gross margin', '03 Production sold', 'Net']);
  });

  it('two subtotals with no category between them keep only the first', () => {
    const items = [{ name: '06 Other purchases', value: -10 }, { name: '12 Other', value: 5 }];
    const steps = waterfallSteps(items, { subtotals: [{ after: '06 Other purchases', label: 'Value added' }, { after: '09 Staff costs', label: 'EBITDA' }], showTotal: false });
    expect(steps.map((s) => s.name)).toEqual(['06 Other purchases', 'Value added', '12 Other']);
  });

  it('no data, no bars — not even the total', () => {
    expect(waterfallSteps([], { subtotals: SIG })).toEqual([]);
  });
});
