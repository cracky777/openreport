// What the rollup cache holds for a model, in the terms the assistant uses:
// which dimensions can be combined with which measures. Handed to the model up
// front so it aims its questions and proposals at data that is actually cached
// instead of discovering every miss one tool call at a time.

const rollupBuilder = require('../rollupBuilder');

const MAX_GRAINS = 30;

function getCoverage({ modelId, orgId }) {
  return rollupBuilder.getManifest({ modelId, orgId })
    .slice(0, MAX_GRAINS)
    .map((r) => ({
      dimensions: r.grainDims,
      measures: r.measureNames,
      // Field and operator only: the baked VALUES are report data.
      bakedFilters: (r.baseFilters || []).map((f) => ({ field: f.field, op: f.op })),
      rowCount: r.rowCount,
      builtAt: r.builtAt,
    }));
}

module.exports = { getCoverage };
