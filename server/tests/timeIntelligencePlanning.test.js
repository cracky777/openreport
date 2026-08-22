// Time-intelligence presets (widget binding `timePeriod = {dim, preset}`)
// fire a runtime `between` widget filter on a date dim. For the rollup
// cache to serve those widgets, the planner must fold that dim into the
// planned grain — otherwise every preset widget MISSes to live forever.
const { seedUser, seedDatasource, seedModel, seedReport } = require('./helpers/testApp');
const { planRollupsForModel } = require('../utils/rollupBuilder');

const seedTimeModel = () => {
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
  return { owner, model };
};

describe('planRollupsForModel — timePeriod dim folds into the grain', () => {
  test('scorecard with a preset plans a rollup carrying the date dim', () => {
    const { owner, model } = seedTimeModel();
    seedReport({
      userId: owner, modelId: model,
      widgets: {
        w1: {
          type: 'scorecard',
          dataBinding: {
            selectedMeasures: ['data.Sales_sum'],
            timePeriod: { dim: 'data.Date', preset: 'ytd' },
          },
        },
      },
    });
    const { plan } = planRollupsForModel(model);
    expect(plan).toHaveLength(1);
    expect(plan[0].grain).toContain('data.Date');
  });

  test('bar chart keeps its display dims AND gains the preset dim', () => {
    const { owner, model } = seedTimeModel();
    seedReport({
      userId: owner, modelId: model,
      widgets: {
        w1: {
          type: 'bar',
          dataBinding: {
            selectedDimensions: ['data.Country'],
            selectedMeasures: ['data.Sales_sum'],
            timePeriod: { dim: 'data.Date', preset: 'last_30_days' },
          },
        },
      },
    });
    const { plan } = planRollupsForModel(model);
    expect(plan).toHaveLength(1);
    expect(plan[0].grain).toEqual(expect.arrayContaining(['data.Country', 'data.Date']));
  });

  test('incomplete preset (dim pending) changes nothing', () => {
    const { owner, model } = seedTimeModel();
    seedReport({
      userId: owner, modelId: model,
      widgets: {
        w1: {
          type: 'bar',
          dataBinding: {
            selectedDimensions: ['data.Country'],
            selectedMeasures: ['data.Sales_sum'],
            timePeriod: { dim: null, preset: 'ytd' },
          },
        },
      },
    });
    const { plan } = planRollupsForModel(model);
    expect(plan).toHaveLength(1);
    expect(plan[0].grain).toEqual(['data.Country']);
  });
});
