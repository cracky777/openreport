// Fact detection for the rollup planner. The live /query path recognizes a
// fact as "a `*` side that is never a `1` side" (sqlBuilder/joinGraph
// computeRealFacts) and exempts unjoined tables from the dim-only treatment.
// The rollup planner must agree, or models the live path serves correctly are
// silently never cached: a reverse-declared join (`fact(*) → dim(1)`, the
// shape SchemaCanvas stores when the user drags fact→dim) and single-table
// models both used to yield facts=∅ → plan=[] → {fired:0, built:0}.
const { seedUser, seedDatasource, seedModel, seedReport } = require('./helpers/testApp');
const { factConformedDimTables } = require('../utils/rollupPlanning');
const { planRollupsForModel } = require('../utils/rollupBuilder');

describe('factConformedDimTables — fact = many side never on a one side', () => {
  test('canonical dim(1)→fact(*) declaration', () => {
    const { facts, conformed } = factConformedDimTables([
      { from_table: 'dim', from_column: 'k', to_table: 'fact', to_column: 'k', cardinality: { from: '1', to: '*' } },
    ]);
    expect([...facts]).toEqual(['fact']);
    expect([...conformed.get('fact')]).toEqual(['dim']);
  });

  test('reverse-declared fact(*)→dim(1) is still a fact', () => {
    const { facts, conformed } = factConformedDimTables([
      { from_table: 'fact', from_column: 'k', to_table: 'dim', to_column: 'k', cardinality: { from: '*', to: '1' } },
    ]);
    expect([...facts]).toEqual(['fact']);
    expect([...conformed.get('fact')]).toEqual(['dim']);
  });

  test('legacy join without cardinality keeps the from=dim → to=fact convention', () => {
    const { facts } = factConformedDimTables([
      { from_table: 'dim', from_column: 'k', to_table: 'fact', to_column: 'k' },
    ]);
    expect([...facts]).toEqual(['fact']);
  });

  test('snowflake child dim (a `*` side but also a `1` side) stays a dim', () => {
    const { facts, conformed } = factConformedDimTables([
      { from_table: 'd_client', from_column: 'id', to_table: 'd_dest', to_column: 'client_id', cardinality: { from: '1', to: '*' } },
      { from_table: 'd_dest', from_column: 'id', to_table: 'f_fin', to_column: 'dest_id', cardinality: { from: '1', to: '*' } },
    ]);
    expect([...facts]).toEqual(['f_fin']);
    expect(conformed.get('f_fin').has('d_dest')).toBe(true);
    expect(conformed.get('f_fin').has('d_client')).toBe(true);
  });
});

describe('planRollupsForModel — previously-uncached model shapes now plan', () => {
  const widgetOn = (dim, measure) => ({
    w1: { type: 'bar', dataBinding: { selectedDimensions: [dim], selectedMeasures: [measure] } },
  });

  test('reverse-declared join (fact as from_table) plans a rollup on the fact', () => {
    const owner = seedUser({ role: 'editor' });
    const ds = seedDatasource({ userId: owner });
    const model = seedModel({
      userId: owner, datasourceId: ds,
      selectedTables: ['data', 'country'],
      dimensions: [
        { name: 'data.Country', table: 'data', column: 'Country', label: 'Country' },
        { name: 'country.Country', table: 'country', column: 'Country', label: 'Country (dim)' },
      ],
      measures: [{ name: 'data.Sales_sum', table: 'data', column: 'Sales', aggregation: 'sum', label: 'Sales' }],
      joins: [{ from_table: 'data', from_column: 'Country', to_table: 'country', to_column: 'Country', cardinality: { from: '*', to: '1' } }],
    });
    seedReport({ userId: owner, modelId: model, widgets: widgetOn('data.Country', 'data.Sales_sum') });

    const { plan } = planRollupsForModel(model);
    expect(plan).toHaveLength(1);
    expect(plan[0].factTable).toBe('data');
    expect(plan[0].grain).toEqual(['data.Country']);
    expect(plan[0].measures).toEqual(['data.Sales_sum']);
  });

  test('single-table model (no joins) plans a rollup on its own table', () => {
    const owner = seedUser({ role: 'editor' });
    const ds = seedDatasource({ userId: owner });
    const model = seedModel({
      userId: owner, datasourceId: ds,
      selectedTables: ['data'],
      dimensions: [{ name: 'data.client', table: 'data', column: 'client', label: 'client' }],
      measures: [{ name: 'data.Jours_sum', table: 'data', column: 'Jours', aggregation: 'sum', label: 'Jours' }],
      joins: [],
    });
    seedReport({ userId: owner, modelId: model, widgets: widgetOn('data.client', 'data.Jours_sum') });

    const { plan } = planRollupsForModel(model);
    expect(plan).toHaveLength(1);
    expect(plan[0].factTable).toBe('data');
    expect(plan[0].grain).toEqual(['data.client']);
  });

  test('measure on a joined dim table is still dropped (dim-only → live always)', () => {
    const owner = seedUser({ role: 'editor' });
    const ds = seedDatasource({ userId: owner });
    const model = seedModel({
      userId: owner, datasourceId: ds,
      selectedTables: ['fact', 'dim'],
      dimensions: [{ name: 'fact.g', table: 'fact', column: 'g', label: 'g' }],
      measures: [{ name: 'dim.x_sum', table: 'dim', column: 'x', aggregation: 'sum', label: 'x' }],
      joins: [{ from_table: 'dim', from_column: 'k', to_table: 'fact', to_column: 'k', cardinality: { from: '1', to: '*' } }],
    });
    seedReport({ userId: owner, modelId: model, widgets: widgetOn('fact.g', 'dim.x_sum') });

    const { plan } = planRollupsForModel(model);
    expect(plan).toHaveLength(0);
  });

  test("unjoined fallback fact's grain is clipped to its own dims", () => {
    const owner = seedUser({ role: 'editor' });
    const ds = seedDatasource({ userId: owner });
    // Two tables, NO join (multi-sheet Excel import): the sheet2 dim must not
    // land in sheet1's rollup grain — the build query would cross-join.
    const model = seedModel({
      userId: owner, datasourceId: ds,
      selectedTables: ['sheet1', 'sheet2'],
      dimensions: [
        { name: 'sheet1.a', table: 'sheet1', column: 'a', label: 'a' },
        { name: 'sheet2.b', table: 'sheet2', column: 'b', label: 'b' },
      ],
      measures: [{ name: 'sheet1.v_sum', table: 'sheet1', column: 'v', aggregation: 'sum', label: 'v' }],
      joins: [],
    });
    seedReport({
      userId: owner, modelId: model,
      widgets: { w1: { type: 'bar', dataBinding: { selectedDimensions: ['sheet1.a', 'sheet2.b'], selectedMeasures: ['sheet1.v_sum'] } } },
    });

    const { plan } = planRollupsForModel(model);
    expect(plan).toHaveLength(1);
    expect(plan[0].factTable).toBe('sheet1');
    expect(plan[0].grain).toEqual(['sheet1.a']);
  });
});

describe('planRollupsForModel — multi-page reports', () => {
  test('widgets on pages 2+ (settings.pages) are planned, not just the top-level column', () => {
    const owner = seedUser({ role: 'editor' });
    const ds = seedDatasource({ userId: owner });
    const model = seedModel({
      userId: owner, datasourceId: ds,
      selectedTables: ['data'],
      dimensions: [
        { name: 'data.Country', table: 'data', column: 'Country', label: 'Country', type: 'string' },
        { name: 'data.Date', table: 'data', column: 'Date', label: 'Date', type: 'date' },
      ],
      measures: [{ name: 'data.Sales_sum', table: 'data', column: 'Sales', aggregation: 'sum', label: 'Sales' }],
      joins: [],
    });
    const w1 = { type: 'bar', dataBinding: { selectedDimensions: ['data.Country'], selectedMeasures: ['data.Sales_sum'] } };
    const w2 = { type: 'bar', dataBinding: { selectedDimensions: ['data.Date'], selectedMeasures: ['data.Sales_sum'] } };
    seedReport({
      userId: owner, modelId: model,
      widgets: { w1 }, // top-level mirrors page 1 only
      settings: {
        pages: [
          { id: 'page-1', name: 'P1', layout: [], widgets: { w1 } },
          { id: 'page-2', name: 'P2', layout: [], widgets: { w2 } },
        ],
      },
    });
    const { plan } = planRollupsForModel(model);
    const grains = plan.map((p) => p.grain);
    expect(grains.some((g) => g.includes('data.Country'))).toBe(true);
    expect(grains.some((g) => g.includes('data.Date'))).toBe(true);
  });

  test('legacy report without settings.pages still plans from the top-level widgets', () => {
    const owner = seedUser({ role: 'editor' });
    const ds = seedDatasource({ userId: owner });
    const model = seedModel({
      userId: owner, datasourceId: ds,
      selectedTables: ['data'],
      dimensions: [{ name: 'data.Country', table: 'data', column: 'Country', label: 'Country', type: 'string' }],
      measures: [{ name: 'data.Sales_sum', table: 'data', column: 'Sales', aggregation: 'sum', label: 'Sales' }],
      joins: [],
    });
    seedReport({
      userId: owner, modelId: model,
      widgets: { w1: { type: 'bar', dataBinding: { selectedDimensions: ['data.Country'], selectedMeasures: ['data.Sales_sum'] } } },
    });
    const { plan } = planRollupsForModel(model);
    expect(plan.some((p) => p.grain.includes('data.Country'))).toBe(true);
  });
});
