/**
 * Phase D-2 → D-4 — DISTINCT decomposition into a mergeable HyperLogLog
 * spec, threaded end-to-end through the rollup build + planner SQL.
 *
 * `decomposeMeasure` recognises a clean COUNT(DISTINCT col) shape
 * unconditionally; the gate that decides whether the rollup actually
 * materialises an HLL atom lives in `componentPlanForMeasures({hllReady})`
 * — readiness comes from `rollupDuckDB.isHllReady(db)` (only true once
 * the DataSketches extension successfully `LOAD`ed in the destination
 * gen DuckDB). When the extension isn't available, distinct outputs
 * fall to `supported:false` and the planner MISSes → live SQL.
 *
 * These tests cover:
 *   - `detectCountDistinct` parsing (positive + negative shapes,
 *     including the `COUNT(DISTINCT(col))` parenthesised variant)
 *   - `decomposeMeasure` spec shape (always recognised when the parser
 *     accepts the expression)
 *   - `hllAliasBase` stability and per-column / per-lgK uniqueness
 *   - `collectComponentsForVisual` synthetic emission
 *   - `componentPlanForMeasures` atom shape (`agg: 'HLL_UNION'`, `lgK`)
 *     and its `{hllReady}` gate
 *   - `recomposeMeasure` returning the scalar from the merged sketch
 *   - `factsForMeasure` attributing the spec to the right fact table
 *   - Wrapped DISTINCT (arithmetic, IFNULL, …) staying non-decomposable
 *     so the live SQL handles it exactly.
 */

const mt = require('../utils/measureType');

describe('detectCountDistinct — recognised shapes', () => {
  const { detectCountDistinct } = mt;

  test('table-qualified column', () => {
    expect(detectCountDistinct('COUNT(DISTINCT "t"."col")'))
      .toEqual({ column: 'col', table: 't' });
  });

  test('schema-qualified column', () => {
    expect(detectCountDistinct('COUNT(DISTINCT "schema"."t"."col")'))
      .toEqual({ column: 'col', table: 'schema.t' });
  });

  test('bare quoted column', () => {
    expect(detectCountDistinct('COUNT(DISTINCT "col")'))
      .toEqual({ column: 'col', table: '' });
  });

  test('case-insensitive + tolerant whitespace', () => {
    expect(detectCountDistinct('  count ( distinct  "t" . "col" )  '))
      .toEqual({ column: 'col', table: 't' });
  });

  test('quoted column with embedded double-quote escape', () => {
    expect(detectCountDistinct('COUNT(DISTINCT "weird""col")'))
      .toEqual({ column: 'weird"col', table: '' });
  });

  // SQL accepts both forms; the parser must accept both.
  test('parenthesised arg: COUNT(DISTINCT("schema"."t"."col"))', () => {
    expect(detectCountDistinct('COUNT(DISTINCT("nyukom_dimension"."d_date"."nom_mois"))'))
      .toEqual({ column: 'nom_mois', table: 'nyukom_dimension.d_date' });
  });

  test('parenthesised arg, table-qualified', () => {
    expect(detectCountDistinct('COUNT(DISTINCT("t"."col"))'))
      .toEqual({ column: 'col', table: 't' });
  });

  test('parenthesised arg with whitespace inside', () => {
    expect(detectCountDistinct('COUNT(DISTINCT ( "t" . "col" ))'))
      .toEqual({ column: 'col', table: 't' });
  });
});

describe('detectCountDistinct — rejected shapes', () => {
  const { detectCountDistinct } = mt;

  test('arithmetic wrapper — not a clean DISTINCT', () => {
    expect(detectCountDistinct('COUNT(DISTINCT "t"."col") * 100')).toBeNull();
  });

  test('IFNULL wrapper inside DISTINCT', () => {
    expect(detectCountDistinct('COUNT(DISTINCT IFNULL("t"."col", 0))')).toBeNull();
  });

  test('unquoted column reference', () => {
    expect(detectCountDistinct('COUNT(DISTINCT t.col)')).toBeNull();
  });

  test('plain COUNT (no DISTINCT)', () => {
    expect(detectCountDistinct('COUNT("t"."col")')).toBeNull();
  });

  test('SUM(DISTINCT …) — only COUNT is recognised', () => {
    expect(detectCountDistinct('SUM(DISTINCT "t"."col")')).toBeNull();
  });

  test('${placeholder} only — no SQL', () => {
    expect(detectCountDistinct('${ref}')).toBeNull();
  });

  test('empty / whitespace / non-string', () => {
    expect(detectCountDistinct('')).toBeNull();
    expect(detectCountDistinct('   ')).toBeNull();
    expect(detectCountDistinct(null)).toBeNull();
    expect(detectCountDistinct(undefined)).toBeNull();
    expect(detectCountDistinct({})).toBeNull();
  });
});

describe('decomposeMeasure — spec shape (always recognised)', () => {
  const { decomposeMeasure } = mt;
  const distinctMeasure = {
    name: 'unique_users',
    aggregation: 'custom',
    expression: 'COUNT(DISTINCT "events"."user_id")',
  };

  test('canonical shape → {type:\'distinct\', kind:\'hll\', …}', () => {
    expect(decomposeMeasure(distinctMeasure)).toEqual({
      type: 'distinct',
      kind: 'hll',
      column: 'user_id',
      table: 'events',
      lgK: 12,
    });
  });

  test('parenthesised SQL form → same spec', () => {
    const m = {
      name: 'count_mois_distinct',
      aggregation: 'custom',
      expression: 'COUNT(DISTINCT("nyukom_dimension"."d_date"."nom_mois"))',
    };
    expect(decomposeMeasure(m)).toEqual({
      type: 'distinct', kind: 'hll',
      column: 'nom_mois', table: 'nyukom_dimension.d_date',
      lgK: 12,
    });
  });

  test('wrapped DISTINCT (×100) — null (decomposeAsExpression rejects)', () => {
    const m = {
      name: 'pct_unique',
      aggregation: 'custom',
      expression: 'COUNT(DISTINCT "events"."user_id") * 100',
    };
    expect(decomposeMeasure(m)).toBeNull();
  });

  test('bare quoted column (no table) — table:\'\'', () => {
    const m = {
      name: 'unique_tags',
      aggregation: 'custom',
      expression: 'COUNT(DISTINCT "tag")',
    };
    expect(decomposeMeasure(m)).toEqual({
      type: 'distinct', kind: 'hll', column: 'tag', table: '', lgK: 12,
    });
  });
});

describe('hllAliasBase — stable, per-column, per-lgK', () => {
  const { hllAliasBase } = mt;

  test('same (table, column, lgK) → same alias', () => {
    const a = hllAliasBase({ table: 't', column: 'c', lgK: 12 });
    const b = hllAliasBase({ table: 't', column: 'c', lgK: 12 });
    expect(a).toBe(b);
    expect(a).toMatch(/^_hll_[0-9a-f]{16}$/);
  });

  test('different column → different alias', () => {
    const a = hllAliasBase({ table: 't', column: 'c1', lgK: 12 });
    const b = hllAliasBase({ table: 't', column: 'c2', lgK: 12 });
    expect(a).not.toBe(b);
  });

  test('different lgK → different alias (sketches not mergeable across lg_k)', () => {
    const a = hllAliasBase({ table: 't', column: 'c', lgK: 12 });
    const b = hllAliasBase({ table: 't', column: 'c', lgK: 14 });
    expect(a).not.toBe(b);
  });

  test('default lgK = 12', () => {
    const explicit = hllAliasBase({ table: 't', column: 'c', lgK: 12 });
    const implicit = hllAliasBase({ table: 't', column: 'c' });
    expect(explicit).toBe(implicit);
  });
});

describe('collectComponentsForVisual + componentPlanForMeasures — HLL synthetic + atom', () => {
  test('one distinct measure → one HLL synthetic + one HLL atom', () => {

    const m = {
      name: 'unique_users',
      aggregation: 'custom',
      expression: 'COUNT(DISTINCT "events"."user_id")',
    };
    const spec = mt.decomposeMeasure(m);
    const { syntheticMeasures, baseMeasureNames } =
      mt.collectComponentsForVisual([spec]);
    expect(baseMeasureNames).toEqual([]);
    expect(syntheticMeasures).toHaveLength(1);
    const s = syntheticMeasures[0];
    expect(s.kind).toBe('hll');
    expect(s.lgK).toBe(12);
    expect(s.column).toBe('user_id');
    expect(s.table).toBe('events');
    expect(s.alias).toBe(mt.hllAliasBase(spec));

    const plan = mt.componentPlanForMeasures([m], [m], { hllReady: true });
    expect(plan.outputs).toHaveLength(1);
    expect(plan.outputs[0].supported).toBe(true);
    expect(plan.outputs[0].spec).toEqual(spec);
    expect(plan.extraMeasures).toHaveLength(1);
    expect(plan.extraMeasures[0].aggregation).toBe('hll');
    expect(plan.extraMeasures[0].lgK).toBe(12);
    expect(plan.atoms).toHaveLength(1);
    expect(plan.atoms[0]).toEqual({
      col: mt.hllAliasBase(spec),
      agg: 'HLL_UNION',
      lgK: 12,
    });
  });

  test('two distinct measures on same column+lgK share one atom', () => {

    const m1 = { name: 'unique_a', aggregation: 'custom',
      expression: 'COUNT(DISTINCT "events"."user_id")' };
    const m2 = { name: 'unique_b', aggregation: 'custom',
      expression: 'COUNT(DISTINCT "events"."user_id")' };
    const plan = mt.componentPlanForMeasures([m1, m2], [m1, m2], { hllReady: true });
    // Both outputs supported, both reference the SAME atom (same alias).
    expect(plan.outputs.map((o) => o.supported)).toEqual([true, true]);
    expect(plan.atoms).toHaveLength(1);
  });

  test('two distinct measures on different columns → two atoms', () => {

    const m1 = { name: 'unique_u', aggregation: 'custom',
      expression: 'COUNT(DISTINCT "events"."user_id")' };
    const m2 = { name: 'unique_s', aggregation: 'custom',
      expression: 'COUNT(DISTINCT "events"."session_id")' };
    const plan = mt.componentPlanForMeasures([m1, m2], [m1, m2], { hllReady: true });
    expect(plan.outputs.map((o) => o.supported)).toEqual([true, true]);
    expect(plan.atoms).toHaveLength(2);
    expect(new Set(plan.atoms.map((a) => a.agg))).toEqual(new Set(['HLL_UNION']));
  });

  test('hllReady=false in plan opts → distinct outputs supported:false (live fallback)', () => {

    const m = { name: 'unique_users', aggregation: 'custom',
      expression: 'COUNT(DISTINCT "events"."user_id")' };
    const plan = mt.componentPlanForMeasures([m], [m], { hllReady: false });
    expect(plan.outputs[0].supported).toBe(false);
    expect(plan.atoms).toHaveLength(0);
    expect(plan.extraMeasures).toHaveLength(0);
  });

  test('omitted opts → defaults to hllReady=false (live fallback)', () => {

    const m = { name: 'unique_users', aggregation: 'custom',
      expression: 'COUNT(DISTINCT "events"."user_id")' };
    const plan = mt.componentPlanForMeasures([m], [m]); // no opts
    expect(plan.outputs[0].supported).toBe(false);
    expect(plan.atoms).toHaveLength(0);
  });

  test('mixed: simple sum + distinct → one base measure + one HLL atom', () => {

    const m1 = { name: 'total', aggregation: 'sum', table: 'events', column: 'amount' };
    const m2 = { name: 'unique_u', aggregation: 'custom',
      expression: 'COUNT(DISTINCT "events"."user_id")' };
    const plan = mt.componentPlanForMeasures([m1, m2], [m1, m2], { hllReady: true });
    expect(plan.fireNames).toEqual(['total']);
    expect(plan.atoms).toHaveLength(2);
    const byCol = Object.fromEntries(plan.atoms.map((a) => [a.col, a]));
    expect(byCol.total.agg).toBe('SUM');
    const hllAlias = mt.hllAliasBase({ table: 'events', column: 'user_id', lgK: 12 });
    expect(byCol[hllAlias].agg).toBe('HLL_UNION');
    expect(byCol[hllAlias].lgK).toBe(12);
  });
});

describe('recomposeMeasure — distinct passes the merged-estimate scalar through', () => {
  test('returns the atom value when present', () => {

    const m = { name: 'unique_users', aggregation: 'custom',
      expression: 'COUNT(DISTINCT "events"."user_id")' };
    const spec = mt.decomposeMeasure(m);
    const alias = mt.hllAliasBase(spec);
    // Planner emits datasketch_hll_estimate(datasketch_hll_union(…)) which
    // returns a scalar; getAtom hands us that number.
    const atoms = { [alias]: 4217 };
    const v = mt.recomposeMeasure(spec, 'unique_users', (k) => atoms[k]);
    expect(v).toBe(4217);
  });

  test('returns null when atom missing', () => {

    const m = { name: 'unique_users', aggregation: 'custom',
      expression: 'COUNT(DISTINCT "events"."user_id")' };
    const spec = mt.decomposeMeasure(m);
    const v = mt.recomposeMeasure(spec, 'unique_users', () => undefined);
    expect(v).toBeNull();
  });
});

describe('factsForMeasure — distinct attributes to its column\'s table', () => {
  test('table from spec', () => {

    const m = { name: 'unique_users', aggregation: 'custom',
      expression: 'COUNT(DISTINCT "events"."user_id")' };
    expect(mt.factsForMeasure(m, [m])).toEqual(['events']);
  });

  test('bare quoted column → falls back to factTablesFromDef (empty)', () => {

    const m = { name: 'unique_tags', aggregation: 'custom',
      expression: 'COUNT(DISTINCT "tag")' };
    // No fact attribution → builder treats as cross/unrollable v1.
    expect(mt.factsForMeasure(m, [m])).toEqual([]);
  });
});

describe('Distinct as nested ref in a custom expression — rejected', () => {
  test('${distinct} + ${additive} → null (Phase C policy preserved)', () => {

    const distA = {
      name: 'distA', table: 'events', column: 'user_id', aggregation: 'custom',
      expression: 'COUNT(DISTINCT "events"."user_id")',
    };
    const b = { name: 'b', table: 'events', column: 'n', aggregation: 'sum' };
    const wrapped = {
      name: 'kpi', aggregation: 'custom',
      expression: '${distA} + ${b}',
    };
    // decomposeAsExpression only accepts simple / avg / ratio nested
    // refs; distinct is not on the nested-allowed list, so the wrapping
    // expression bails — exactly today's behaviour.
    expect(mt.decomposeMeasure(wrapped, [distA, b, wrapped])).toBeNull();
  });
});

describe('Real-world expressions — parser tolerance audit', () => {
  // The user-facing UI accepts whatever SQL the user types verbatim.
  // We can't normalise it later, so every recogniser MUST be tolerant
  // on whitespace and on the SQL idioms a human actually writes.

  test('COUNT(DISTINCT(...)) parenthesised — same spec as space-separated', () => {
    const parens = mt.decomposeMeasure({
      name: 'a', aggregation: 'custom',
      expression: 'COUNT(DISTINCT("t"."col"))',
    });
    const spaced = mt.decomposeMeasure({
      name: 'b', aggregation: 'custom',
      expression: 'COUNT(DISTINCT "t"."col")',
    });
    expect(parens).toEqual(spaced);
  });

  test('plain COUNT(col) still decomposes additive (Phase A guard untouched)', () => {
    const spec = mt.decomposeMeasure({
      name: 'cnt', aggregation: 'custom',
      expression: 'COUNT("t"."col")',
    });
    expect(spec).toEqual({ type: 'simple', innerType: 'count' });
  });

  test('case-guarded ratio with NO whitespace around operators (real user shape)', () => {
    const num = { name: 'num', table: 't', column: 'a', aggregation: 'sum' };
    const den = { name: 'den', table: 't', column: 'b', aggregation: 'sum' };
    const pct = {
      name: 'pct', aggregation: 'custom',
      expression: '${num}/CASE WHEN ${den}=0 THEN 1 ELSE ${den} END * 100',
    };
    const spec = mt.decomposeMeasure(pct, [num, den, pct]);
    expect(spec).not.toBeNull();
    expect(spec.type).toBe('ratio');
    expect(spec.guard).toBe('case');
    expect(spec.guardThen).toBe(1);
    expect(spec.scale).toBe(100);
  });

  test('ROUND on additive sums — picked up via Phase A whitelist', () => {
    const a = { name: 'a', table: 't', column: 'a', aggregation: 'sum' };
    const b = { name: 'b', table: 't', column: 'b', aggregation: 'sum' };
    const kpi = {
      name: 'kpi', aggregation: 'custom',
      expression: 'ROUND(${a} / ${b}, 2)',
    };
    const spec = mt.decomposeMeasure(kpi, [a, b, kpi]);
    expect(spec).not.toBeNull();
    expect(spec.type).toBe('expression');
    const value = mt.recomposeMeasure(spec, 'kpi', (n) => ({ a: 50, b: 7 }[n]));
    expect(value).toBe(7.14);
  });

  test('GREATEST as guard for non-negative result', () => {
    const a = { name: 'a', table: 't', column: 'a', aggregation: 'sum' };
    const b = { name: 'b', table: 't', column: 'b', aggregation: 'sum' };
    const kpi = {
      name: 'kpi', aggregation: 'custom',
      expression: 'GREATEST(0, ${a} - ${b})',
    };
    const spec = mt.decomposeMeasure(kpi, [a, b, kpi]);
    expect(spec).not.toBeNull();
    expect(spec.type).toBe('expression');
    const value = mt.recomposeMeasure(spec, 'kpi', (n) => ({ a: 5, b: 10 }[n]));
    expect(value).toBe(0); // GREATEST(0, -5) = 0
  });

  test('Phase B IF as guard inside Phase A ROUND', () => {
    const a = { name: 'a', table: 't', column: 'a', aggregation: 'sum' };
    const b = { name: 'b', table: 't', column: 'b', aggregation: 'sum' };
    const kpi = {
      name: 'kpi', aggregation: 'custom',
      expression: 'ROUND(IF(${b} = 0, 0, ${a} / ${b}) * 100, 1)',
    };
    const spec = mt.decomposeMeasure(kpi, [a, b, kpi]);
    expect(spec).not.toBeNull();
    expect(spec.type).toBe('expression');
    const value = mt.recomposeMeasure(spec, 'kpi', (n) => ({ a: 25, b: 100 }[n]));
    expect(value).toBe(25.0);
  });
});
