/**
 * Single source of truth for "how does this measure decompose into
 * rollup-storable atoms?" — the math the rollup builder uses at warm
 * time to decide what to materialise, and the rollup planner uses at
 * query time to recombine those atoms into the final value at any
 * grain ⊇ the rollup grain.
 *
 * A measure is *additive* when its rows can be re-aggregated after
 * filtering: SUM, COUNT, MIN, MAX. Non-additive shapes — AVG,
 * COUNT(DISTINCT), ratios, custom expressions — are not additive on
 * their own values, but most can be re-aggregated from their additive
 * COMPONENTS (e.g. AVG = SUM/COUNT, distinct via HyperLogLog sketches
 * mergeable across partitions). `decomposeMeasure` returns the spec
 * that tells the builder what atoms to store and the planner how to
 * recombine them; supported spec types are `simple` / `avg` / `ratio` /
 * `expression` (Phase A+B+C math whitelist) / `distinct` (Phase D HLL).
 * The whole math is documented end-to-end in `ROLLUP-CACHE.md` §6.
 *
 * Lives in server/utils so both routes/models.js (and its cloud shadow
 * server/cloud/routes/models.js) and rollupBuilder.js (OSS + cloud
 * share the same file post-merge) consume the same decomposition —
 * any drift between warm-time and runtime eligibility would silently
 * break the rollup for half the visuals.
 */

const {
  inferAdditiveTypeFromExpression,
  additiveTypeForAggregation,
  additiveTypeForMeasure,
  detectRatio,
  detectCountDistinct,
} = require('./detect');
const {
  decomposeMeasure,
  collectComponentsForVisual,
  sqlAggForAdditive,
  avgAliasBase,
  hllAliasBase,
} = require('./decompose');
const {
  componentPlanForMeasures,
  recomposeMeasure,
  factsForMeasure,
  isOverrideTainted,
  effectiveMeasureName,
} = require('./plan');
const { compileExpression, extractRefs } = require('./exprParse');

module.exports = {
  effectiveMeasureName,
  additiveTypeForMeasure,
  additiveTypeForAggregation,
  inferAdditiveTypeFromExpression,
  decomposeMeasure,
  detectRatio,
  detectCountDistinct,
  collectComponentsForVisual,
  componentPlanForMeasures,
  recomposeMeasure,
  factsForMeasure,
  isOverrideTainted,
  sqlAggForAdditive,
  avgAliasBase,
  hllAliasBase,
  compileExpression,
  extractRefs,
};
