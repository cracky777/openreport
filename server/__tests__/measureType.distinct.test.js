/**
 * Phase D-2 — DISTINCT decomposition into a mergeable HyperLogLog spec.
 *
 * The recognition is gated behind `ROLLUP_HLL_ENABLED=1`; D-3 (build
 * SQL emitting `datasketch_hll(lgK, col)`) and D-4 (planner SQL emitting
 * `datasketch_hll_estimate(datasketch_hll_union(lgK, sketch))`) land
 * before the flag flips on by default. Until then, distinct measures
 * stay non-decomposable on production installs — the live SQL keeps
 * returning the exact count.
 *
 * These tests cover:
 *   - `detectCountDistinct` parsing (positive + negative shapes)
 *   - `decomposeMeasure` gating + spec shape under the flag
 *   - `hllAliasBase` stability and per-column / per-lgK uniqueness
 *   - `collectComponentsForVisual` synthetic emission
 *   - `componentPlanForMeasures` atom shape (`agg: 'HLL_UNION'`, `lgK`)
 *   - `recomposeMeasure` returning the scalar from the merged sketch
 *   - `factsForMeasure` attributing the spec to the right fact table
 *   - Wrapped DISTINCT (arithmetic, IFNULL, …) staying non-decomposable
 *     so the live SQL handles it exactly.
 */

// `hllEnabled()` reads process.env at call time, so we toggle the flag
// per test rather than reloading the module. `loadModule({hll})` is a
// shim that sets the flag for the lifetime of the returned object's
// caller — every helper that depends on the gate is wrapped here.
function loadModule({ hll }) {
  // The flag must be live when decomposeMeasure runs, so we set it
  // process-wide before returning. The afterEach hook below resets it.
  process.env.ROLLUP_HLL_ENABLED = hll ? '1' : '';
  return require('../utils/measureType');
}

afterEach(() => {
  delete process.env.ROLLUP_HLL_ENABLED;
});

describe('detectCountDistinct — recognised shapes', () => {
  const mt = loadModule({ hll: false }); // parser doesn't need the gate
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
});

describe('detectCountDistinct — rejected shapes', () => {
  const { detectCountDistinct } = loadModule({ hll: false });

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

describe('decomposeMeasure — gating + spec shape', () => {
  const distinctMeasure = {
    name: 'unique_users',
    aggregation: 'custom',
    expression: 'COUNT(DISTINCT "events"."user_id")',
  };

  test('flag OFF (default) — returns null (preserves today\'s behaviour)', () => {
    const { decomposeMeasure } = loadModule({ hll: false });
    expect(decomposeMeasure(distinctMeasure)).toBeNull();
  });

  test('flag ON — returns {type:\'distinct\', kind:\'hll\', …}', () => {
    const { decomposeMeasure } = loadModule({ hll: true });
    expect(decomposeMeasure(distinctMeasure)).toEqual({
      type: 'distinct',
      kind: 'hll',
      column: 'user_id',
      table: 'events',
      lgK: 12,
    });
  });

  test('flag ON + wrapped DISTINCT — null (falls through to decomposeAsExpression which rejects)', () => {
    const { decomposeMeasure } = loadModule({ hll: true });
    const m = {
      name: 'pct_unique',
      aggregation: 'custom',
      expression: 'COUNT(DISTINCT "events"."user_id") * 100',
    };
    expect(decomposeMeasure(m)).toBeNull();
  });

  test('flag ON + bare quoted column (no table) — table:\'\'', () => {
    const { decomposeMeasure } = loadModule({ hll: true });
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
  const { hllAliasBase } = loadModule({ hll: false }); // pure function

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
    const mt = loadModule({ hll: true });
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

    const plan = mt.componentPlanForMeasures([m], [m]);
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
    const mt = loadModule({ hll: true });
    const m1 = { name: 'unique_a', aggregation: 'custom',
      expression: 'COUNT(DISTINCT "events"."user_id")' };
    const m2 = { name: 'unique_b', aggregation: 'custom',
      expression: 'COUNT(DISTINCT "events"."user_id")' };
    const plan = mt.componentPlanForMeasures([m1, m2], [m1, m2]);
    // Both outputs supported, both reference the SAME atom (same alias).
    expect(plan.outputs.map((o) => o.supported)).toEqual([true, true]);
    expect(plan.atoms).toHaveLength(1);
  });

  test('two distinct measures on different columns → two atoms', () => {
    const mt = loadModule({ hll: true });
    const m1 = { name: 'unique_u', aggregation: 'custom',
      expression: 'COUNT(DISTINCT "events"."user_id")' };
    const m2 = { name: 'unique_s', aggregation: 'custom',
      expression: 'COUNT(DISTINCT "events"."session_id")' };
    const plan = mt.componentPlanForMeasures([m1, m2], [m1, m2]);
    expect(plan.outputs.map((o) => o.supported)).toEqual([true, true]);
    expect(plan.atoms).toHaveLength(2);
    expect(new Set(plan.atoms.map((a) => a.agg))).toEqual(new Set(['HLL_UNION']));
  });

  test('mixed: simple sum + distinct → one base measure + one HLL atom', () => {
    const mt = loadModule({ hll: true });
    const m1 = { name: 'total', aggregation: 'sum', table: 'events', column: 'amount' };
    const m2 = { name: 'unique_u', aggregation: 'custom',
      expression: 'COUNT(DISTINCT "events"."user_id")' };
    const plan = mt.componentPlanForMeasures([m1, m2], [m1, m2]);
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
    const mt = loadModule({ hll: true });
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
    const mt = loadModule({ hll: true });
    const m = { name: 'unique_users', aggregation: 'custom',
      expression: 'COUNT(DISTINCT "events"."user_id")' };
    const spec = mt.decomposeMeasure(m);
    const v = mt.recomposeMeasure(spec, 'unique_users', () => undefined);
    expect(v).toBeNull();
  });
});

describe('factsForMeasure — distinct attributes to its column\'s table', () => {
  test('table from spec', () => {
    const mt = loadModule({ hll: true });
    const m = { name: 'unique_users', aggregation: 'custom',
      expression: 'COUNT(DISTINCT "events"."user_id")' };
    expect(mt.factsForMeasure(m, [m])).toEqual(['events']);
  });

  test('bare quoted column → falls back to factTablesFromDef (empty)', () => {
    const mt = loadModule({ hll: true });
    const m = { name: 'unique_tags', aggregation: 'custom',
      expression: 'COUNT(DISTINCT "tag")' };
    // No fact attribution → builder treats as cross/unrollable v1.
    expect(mt.factsForMeasure(m, [m])).toEqual([]);
  });
});

describe('Distinct as nested ref in a custom expression — rejected', () => {
  test('${distinct} + ${additive} → null (Phase C policy preserved)', () => {
    const mt = loadModule({ hll: true });
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
