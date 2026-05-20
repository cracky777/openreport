/**
 * Rollup cache — expression-decomposition coverage (Phase A+B, 2026-05).
 *
 * The transpiler can already evaluate a broad SQL subset (ROUND, ABS,
 * GREATEST/LEAST, COALESCE, SQRT, ROUND-with-precision, NULLIF, CASE,
 * arithmetic + comparisons). Phase A+B drops the previous gate that
 * accepted ONLY plain arithmetic + NULLIF, so every whitelisted math
 * function is now cached: applying `f(ΣA, ΣB, …)` at the requested
 * grain is mathematically exact (the additive sums don't depend on
 * how partitions were rolled up).
 *
 * These tests prove the exact-equality property per shape, end-to-end
 * via the public API (decomposeMeasure + recomposeMeasure). They also
 * lock in the new Phase B aliases (IFNULL / IF / MOD) and the negative
 * paths (unknown function names, DISTINCT, non-additive refs) so the
 * gate widening never accidentally lets a non-decomposable measure
 * through into the cache later.
 */

const {
  decomposeMeasure,
  recomposeMeasure,
  collectComponentsForVisual,
  avgAliasBase,
} = require('../utils/measureType');

// Build a `getAtom`-friendly atom map. `simple` is straight ref→value.
// For each AVG ref in `avg`, we compute the synthetic alias base the
// builder uses (avgAliasBase) and stamp the corresponding `_sum` /
// `_count` atoms — recomposeMeasure reads them exactly that way.
function buildAtoms({ simple = {}, avg = {} } = {}) {
  const atoms = { ...simple };
  for (const { column, table, sum, count } of Object.values(avg)) {
    const base = avgAliasBase({ column, table: table || '' });
    atoms[`${base}_sum`] = sum;
    atoms[`${base}_count`] = count;
  }
  return atoms;
}

// ─── Helpers ────────────────────────────────────────────────────────

// Build a measure list with two simple additive refs `a` and `b` (plus
// `c` when needed). `kpi` is the measure under test.
const refModel = (extraRefs = []) => [
  { name: 'a', table: 't', column: 'a', aggregation: 'sum' },
  { name: 'b', table: 't', column: 'b', aggregation: 'sum' },
  { name: 'c', table: 't', column: 'c', aggregation: 'sum' },
  ...extraRefs,
];

// Build a synthetic dataset of N rows and compute, for each ref, the
// GLOBAL sum (what the rollup atom would hold at the requested grain).
// This is the only input recomposeMeasure needs to produce the final
// value — verifying it matches the direct compute proves the math.
function atomsOf(rows) {
  const sum = (k) => rows.reduce((acc, r) => acc + (r[k] || 0), 0);
  return { a: sum('a'), b: sum('b'), c: sum('c') };
}

// Run decompose + recompose end-to-end. Returns the cached value the
// rollup would serve when this measure is applied at the grain whose
// atoms are `atoms`.
function rollupValue(expression, atoms, extra = {}) {
  const m = { name: 'kpi', aggregation: 'custom', expression };
  const all = refModel(extra.refs);
  all.unshift(m);
  const spec = decomposeMeasure(m, all);
  if (!spec) return { spec: null, value: null };
  const value = recomposeMeasure(spec, 'kpi', (n) => atoms[n]);
  return { spec, value };
}

const ROWS = [
  { a: 10, b: 4, c: 0 },
  { a: 20, b: 5, c: 2 },
  { a: 30, b: 6, c: 4 },
  { a: 40, b: 5, c: 0 },
];
const ATOMS = atomsOf(ROWS); // { a: 100, b: 20, c: 6 }

// ─── Phase A: gate widening for whitelisted math functions ──────────

describe('Phase A — math functions on additive sums', () => {
  test('ROUND(${a}/${b}, 2) — rounded ratio', () => {
    const { spec, value } = rollupValue('ROUND(${a}/${b}, 2)', ATOMS);
    expect(spec).not.toBeNull();
    expect(spec.type).toBe('expression');
    expect(value).toBe(5);                // ROUND(100/20, 2) = 5
  });

  test('ROUND with non-integer ratio', () => {
    const { value } = rollupValue('ROUND(${a}/${c}, 1)', ATOMS);
    expect(value).toBe(16.7);             // ROUND(100/6, 1) = 16.7
  });

  test('ABS(${a} - ${b})', () => {
    const { value } = rollupValue('ABS(${a} - ${b})', ATOMS);
    expect(value).toBe(80);
  });

  test('ABS — negative input', () => {
    const { value } = rollupValue('ABS(${b} - ${a})', ATOMS);
    expect(value).toBe(80);
  });

  test('GREATEST(${a}, ${b}, ${c})', () => {
    const { value } = rollupValue('GREATEST(${a}, ${b}, ${c})', ATOMS);
    expect(value).toBe(100);
  });

  test('LEAST(${a}, ${b}, ${c}) — zero is the smallest', () => {
    const atoms = { a: 100, b: 20, c: 0 };
    const { value } = rollupValue('LEAST(${a}, ${b}, ${c})', atoms);
    expect(value).toBe(0);
  });

  test('COALESCE(${a}, ${b}) — first non-null wins', () => {
    const { value } = rollupValue('COALESCE(${a}, ${b})', { a: 100, b: 20 });
    expect(value).toBe(100);
  });

  test('COALESCE — falls through on null', () => {
    const { value } = rollupValue('COALESCE(${a}, ${b})', { a: null, b: 20 });
    expect(value).toBe(20);
  });

  test('SQRT(${a} * ${a} + ${b} * ${b}) — euclidean distance', () => {
    const { value } = rollupValue('SQRT(${a} * ${a} + ${b} * ${b})', ATOMS);
    expect(value).toBeCloseTo(Math.sqrt(100 * 100 + 20 * 20), 6);
  });

  test('FLOOR / CEIL / TRUNC', () => {
    expect(rollupValue('FLOOR(${a}/${b})', { a: 101, b: 20 }).value).toBe(5);
    expect(rollupValue('CEIL(${a}/${b})',  { a: 101, b: 20 }).value).toBe(6);
    expect(rollupValue('TRUNC(${a}/${b})', { a: 101, b: 20 }).value).toBe(5);
  });

  test('Composed: ROUND(GREATEST(${a}, ${b}) * 100 / NULLIF(${c}, 0), 1)', () => {
    const { value } = rollupValue(
      'ROUND(GREATEST(${a}, ${b}) * 100 / NULLIF(${c}, 0), 1)',
      ATOMS,
    );
    // GREATEST(100, 20) * 100 / NULLIF(6, 0)  = 100 * 100 / 6 ≈ 1666.7
    expect(value).toBe(1666.7);
  });

  test('NULLIF guard — division by zero → null', () => {
    const { value } = rollupValue(
      'ROUND(${a} / NULLIF(${c}, 0), 2)',
      { a: 100, b: 20, c: 0 },
    );
    expect(value).toBeNull();             // 100 / NULL = NULL
  });

  test('CASE WHEN — still works alongside the new math', () => {
    const { value } = rollupValue(
      'CASE WHEN ${a} > ${b} THEN ROUND(${a}/${b}, 2) ELSE 0 END',
      ATOMS,
    );
    expect(value).toBe(5);
  });
});

// ─── Phase B: SQL aliases (IFNULL / IF / MOD) ───────────────────────

describe('Phase B — IFNULL / IF / MOD aliases', () => {
  test('IFNULL(${a}, 0) — passes through non-null', () => {
    expect(rollupValue('IFNULL(${a}, 0)', { a: 100 }).value).toBe(100);
  });

  test('IFNULL — substitutes default on null', () => {
    expect(rollupValue('IFNULL(${a}, 0)', { a: null }).value).toBe(0);
  });

  test('IF(${a} > ${b}, ${a}, ${b}) — picks the bigger one', () => {
    expect(rollupValue('IF(${a} > ${b}, ${a}, ${b})', { a: 100, b: 20 }).value).toBe(100);
    expect(rollupValue('IF(${a} > ${b}, ${a}, ${b})', { a: 10, b: 200 }).value).toBe(200);
  });

  test('MOD(${a}, ${b})', () => {
    expect(rollupValue('MOD(${a}, ${b})', { a: 100, b: 7 }).value).toBe(2);
    expect(rollupValue('MOD(${a}, ${b})', { a: 100, b: 25 }).value).toBe(0);
  });

  test('MOD on null operand → null (SQL semantics, surfaced via recompose)', () => {
    expect(rollupValue('MOD(${a}, ${b})', { a: null, b: 5 }).value).toBeNull();
  });
});

// ─── Phase C: nested AVG / ratio refs inside an expression ─────────

describe('Phase C — AVG ref inside a custom expression', () => {
  const m = { name: 'kpi', aggregation: 'custom', expression: '${avgX} * 100' };
  const all = [
    m,
    { name: 'avgX', table: 't', column: 'x', aggregation: 'avg' },
  ];

  test('decompose recognises the nested AVG and carries its spec', () => {
    const spec = decomposeMeasure(m, all);
    expect(spec).not.toBeNull();
    expect(spec.type).toBe('expression');
    expect(spec.refs[0]).toMatchObject({ name: 'avgX', innerType: 'nested' });
    expect(spec.refs[0].spec).toMatchObject({ type: 'avg', column: 'x', table: 't' });
  });

  test('recompose resolves AVG from its atoms then evaluates the expression', () => {
    const spec = decomposeMeasure(m, all);
    const atoms = buildAtoms({ avg: { avgX: { column: 'x', table: 't', sum: 100, count: 4 } } });
    expect(recomposeMeasure(spec, 'kpi', (n) => atoms[n])).toBe(2500); // (100/4) * 100
  });

  test('AVG=0/0 inside COALESCE(${avgX}, 0) → 0 (user-controlled null fallback)', () => {
    // Empty partition (count=0) → AVG resolves to null → COALESCE picks
    // the fallback. The CALLER controls the null-handling shape here:
    // bare arithmetic on a null operand follows JS coercion (e.g.
    // `null * 100 === 0`), which is the same trade-off the simple-ref
    // path has carried since day one.
    const m2 = { name: 'kpi', aggregation: 'custom', expression: 'COALESCE(${avgX}, 0)' };
    const spec = decomposeMeasure(m2, [m2, { name: 'avgX', table: 't', column: 'x', aggregation: 'avg' }]);
    const atoms = buildAtoms({ avg: { avgX: { column: 'x', table: 't', sum: 0, count: 0 } } });
    expect(recomposeMeasure(spec, 'kpi', (n) => atoms[n])).toBe(0);
  });

  test('collectComponentsForVisual pulls the AVG synthetic atoms (not the avg ref by name)', () => {
    const spec = decomposeMeasure(m, all);
    const { baseMeasureNames, syntheticMeasures } = collectComponentsForVisual([spec]);
    expect(baseMeasureNames).not.toContain('avgX');                   // avgX is decomposed, not fired by name
    expect(syntheticMeasures.length).toBe(2);                          // sum + count_col
    expect(syntheticMeasures.find((s) => s.kind === 'sum').column).toBe('x');
    expect(syntheticMeasures.find((s) => s.kind === 'count_col').column).toBe('x');
  });
});

describe('Phase C — mixed AVG + simple refs', () => {
  test('ROUND(${avgX} / ${b}, 2) — AVG over simple at the rollup grain', () => {
    const m = { name: 'kpi', aggregation: 'custom', expression: 'ROUND(${avgX} / ${b}, 2)' };
    const all = [
      m,
      { name: 'avgX', table: 't', column: 'x', aggregation: 'avg' },
      { name: 'b', table: 't', column: 'b', aggregation: 'sum' },
    ];
    const spec = decomposeMeasure(m, all);
    expect(spec).not.toBeNull();
    const atoms = buildAtoms({
      simple: { b: 5 },
      avg: { avgX: { column: 'x', table: 't', sum: 100, count: 4 } }, // AVG = 25
    });
    expect(recomposeMeasure(spec, 'kpi', (n) => atoms[n])).toBe(5);     // ROUND(25/5, 2)
  });

  test('GREATEST(${avgX}, ${avgY}) — two AVG refs', () => {
    const m = { name: 'kpi', aggregation: 'custom', expression: 'GREATEST(${avgX}, ${avgY})' };
    const all = [
      m,
      { name: 'avgX', table: 't', column: 'x', aggregation: 'avg' },
      { name: 'avgY', table: 't', column: 'y', aggregation: 'avg' },
    ];
    const spec = decomposeMeasure(m, all);
    expect(spec).not.toBeNull();
    const atoms = buildAtoms({
      avg: {
        avgX: { column: 'x', table: 't', sum: 100, count: 4 },           // 25
        avgY: { column: 'y', table: 't', sum:  60, count: 2 },           // 30
      },
    });
    expect(recomposeMeasure(spec, 'kpi', (n) => atoms[n])).toBe(30);
  });
});

describe('Phase C — ratio ref inside an expression', () => {
  test('${ratR} + 100 — ratio resolves to numAtom/denAtom at the grain', () => {
    const m    = { name: 'kpi',  aggregation: 'custom', expression: '${ratR} + 100' };
    const ratR = { name: 'ratR', aggregation: 'custom', expression: '${a}/${b}' };
    const all = [
      m, ratR,
      { name: 'a', table: 't', column: 'a', aggregation: 'sum' },
      { name: 'b', table: 't', column: 'b', aggregation: 'sum' },
    ];
    const spec = decomposeMeasure(m, all);
    expect(spec).not.toBeNull();
    expect(spec.refs[0].spec.type).toBe('ratio');
    const atoms = { a: 100, b: 20 };
    expect(recomposeMeasure(spec, 'kpi', (n) => atoms[n])).toBe(105);   // (100/20) + 100
  });

  test('ROUND(${ratR} * 100, 1) — percent of a ratio', () => {
    const m    = { name: 'kpi',  aggregation: 'custom', expression: 'ROUND(${ratR} * 100, 1)' };
    const ratR = { name: 'ratR', aggregation: 'custom', expression: '${a}/${b}' };
    const all = [
      m, ratR,
      { name: 'a', table: 't', column: 'a', aggregation: 'sum' },
      { name: 'b', table: 't', column: 'b', aggregation: 'sum' },
    ];
    const spec = decomposeMeasure(m, all);
    const atoms = { a: 33, b: 100 };
    expect(recomposeMeasure(spec, 'kpi', (n) => atoms[n])).toBe(33);
  });
});

// ─── Negative paths — must still fall back to live ──────────────────

describe('Negative paths — non-decomposable measures stay rejected', () => {
  test('Unknown function name → decomposeMeasure returns null', () => {
    const { spec } = rollupValue('WEIRD(${a})', { a: 100 });
    expect(spec).toBeNull();
  });

  test('Date/string function (not in whitelist) → null', () => {
    const { spec } = rollupValue('UPPER(${a})', { a: 1 });
    expect(spec).toBeNull();
  });

  test('Function name typo (LOGS) → null', () => {
    const { spec } = rollupValue('LOGS(${a})', { a: 100 });
    expect(spec).toBeNull();
  });

  test('Nested CUSTOM-EXPRESSION ref (not avg / ratio) → null', () => {
    // Phase C accepts AVG and ratio refs nested in an expression, but
    // NOT another custom expression — that would compound depth and
    // cycle risk without a proven need. Confirm it's still rejected.
    const m   = { name: 'kpi',  aggregation: 'custom', expression: '${expr2} + ${b}' };
    const e2  = { name: 'expr2', aggregation: 'custom', expression: '${a} * 2' };
    const all = [
      m, e2,
      { name: 'a', table: 't', column: 'a', aggregation: 'sum' },
      { name: 'b', table: 't', column: 'b', aggregation: 'sum' },
    ];
    expect(decomposeMeasure(m, all)).toBeNull();
  });

  test('DISTINCT inside any aggregate → reference is non-additive → null', () => {
    const m = { name: 'kpi', aggregation: 'custom', expression: '${distA} + ${b}' };
    const all = [
      m,
      { name: 'distA', table: 't', column: 'a', aggregation: 'custom',
        expression: 'COUNT(DISTINCT "t"."a")' },
      { name: 'b', table: 't', column: 'b', aggregation: 'sum' },
    ];
    expect(decomposeMeasure(m, all)).toBeNull();
  });
});
