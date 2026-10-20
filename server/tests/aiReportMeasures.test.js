// The measures the assistant defines from the chat (utils/ai/reportMeasures.js):
// a count of the distinct values of a dimension — the days of a period — so a
// stock's cover reads in days (it was the last day's stock over a year of
// sales, seen with Karim).
const { validateMeasures } = require('../utils/ai/reportMeasures');

const ctx = {
  effective: {
    dimensions: [
      { name: 'm.date', table: 'm', column: 'date', type: 'date', label: 'date' },
      { name: 'm.date_year_month', table: 'm', column: 'date', type: 'string', datePart: 'year_month', label: 'Month' },
      { name: '_calc.zone', table: 'm', column: '', expression: 'upper(region)', type: 'string', label: 'Zone' },
    ],
    measures: [
      { name: 'm.stock_sum', table: 'm', column: 'stock', aggregation: 'sum', label: 'stock' },
      { name: 'm.served_sum', table: 'm', column: 'served', aggregation: 'sum', label: 'served' },
    ],
  },
};

test('a count of days, then the quantity per day, then the cover in days', () => {
  const { measures, errors } = validateMeasures([
    { label: 'Jours', kind: 'aggregate', aggregation: 'count_distinct', from: 'm.date' },
    { label: 'Stock du dernier jour', kind: 'last', from: 'm.stock_sum', date: 'm.date' },
    { label: 'Servi par jour', kind: 'arithmetic', op: 'divide', left: 'm.served_sum', right: '_calc.jours' },
    { label: 'Couverture en jours', kind: 'arithmetic', op: 'divide', left: '_calc.stock_du_dernier_jour', right: '_calc.servi_par_jour' },
  ], ctx);
  expect(errors).toEqual([]);
  expect(measures[0]).toMatchObject({ name: '_calc.jours', table: 'm', column: 'date', aggregation: 'count_distinct' });
  expect(measures[3].expression).toBe('(${_calc.stock_du_dernier_jour}) / NULLIF((${_calc.servi_par_jour}), 0)');
});

test('only a plain dimension column is counted: never a date part or an expression', () => {
  for (const from of ['m.date_year_month', '_calc.zone', 'nope']) {
    const { measures, errors } = validateMeasures([{ label: 'N', kind: 'aggregate', aggregation: 'count_distinct', from }], ctx);
    expect(measures).toEqual([]);
    expect(errors[0]).toMatch(/count_distinct a dimension/);
  }
});

test('a monthly target of a table read once per item is added month by month; a fact measure is refused', () => {
  const withTargets = {
    effective: {
      ...ctx.effective,
      measures: [...ctx.effective.measures, { name: 'b.target_sum', table: 'b', column: 'target', aggregation: 'sum', label: 'target' }],
      joins: [{ from_table: 'm', from_column: 'branch', to_table: 'b', to_column: 'branch', cardinality: { from: '*', to: '1' } }],
    },
  };
  const ok = validateMeasures([
    { label: 'Objectif', kind: 'per_period', from: 'b.target_sum', period: 'm.date_year_month' },
    { label: 'Réalisation', kind: 'arithmetic', op: 'percent', left: 'm.served_sum', right: '_calc.objectif' },
  ], withTargets);
  expect(ok.errors).toEqual([]);
  expect(ok.measures[0]).toMatchObject({ table: 'b', column: 'target', aggregation: 'sum', perPeriod: { dim: 'm.date_year_month' } });
  const refused = validateMeasures([{ label: 'X', kind: 'per_period', from: 'm.served_sum', period: 'm.date_year_month' }], withTargets);
  expect(refused.errors[0]).toMatch(/once per item/);
  expect(validateMeasures([{ label: 'X', kind: 'per_period', from: 'b.target_sum', period: '_calc.zone' }], withTargets).errors[0]).toMatch(/period must be/);
});

test('a count of distinct values is of a dimension, never of an amount', () => {
  const { measures, errors } = validateMeasures([{ label: 'Nombre de contrats', kind: 'aggregate', aggregation: 'count_distinct', from: 'm.stock_sum' }], ctx);
  expect(measures).toEqual([]);
  expect(errors[0]).toMatch(/DIMENSION/);
});

test('the label of a measure it made before defines that measure again, under its name', () => {
  const made = { effective: { ...ctx.effective, measures: [...ctx.effective.measures, { name: '_calc.nombre_de_contrats', table: 'm', column: 'stock', aggregation: 'count_distinct', label: 'Nombre de contrats' }] } };
  const { measures, errors } = validateMeasures([
    { label: 'Nombre de contrats', kind: 'aggregate', aggregation: 'count_distinct', from: 'm.date' },
    { label: 'Servi par contrat', kind: 'arithmetic', op: 'divide', left: 'm.served_sum', right: '_calc.nombre_de_contrats' },
  ], made);
  expect(errors).toEqual([]);
  expect(measures[0]).toMatchObject({ name: '_calc.nombre_de_contrats', column: 'date', redefines: true });
  expect(measures[1].redefines).toBeUndefined();
  // Never made of itself.
  expect(validateMeasures([{ label: 'Nombre de contrats', kind: 'arithmetic', op: 'add', left: '_calc.nombre_de_contrats', right: 'm.stock_sum' }], made).errors[0]).toMatch(/itself/);
});
