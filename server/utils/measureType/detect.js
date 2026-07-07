/* Measure-shape analysis: additivity inference + ratio/distinct/trivial detectors.
 * Part of the measureType decomposition engine — see ./index.js for the
 * module-level contract. Split out of the former single-file measureType.js
 * (pure relocation, no logic change). ROLLUP-CACHE.md §6 documents the math.
 */

const { matchingClose } = require('./exprParse');

// Generic additive-aggregation detector for `aggregation: 'custom'`
// measures. The mathematical contract:
//
//   SUM(<row-level x>), MIN(<x>), MAX(<x>) over a group are ALWAYS
//   re-aggregatable across finer splits — sum-of-sums = sum, min-of-mins
//   = min, max-of-maxes = max. The body `<x>` can be any pure row-level
//   expression: a bare column, an arithmetic expression, a CASE WHEN …,
//   etc. The aggregator never sees the body — it only sums/min/max the
//   per-row resulting numbers.
//
//   COUNT(<x>) is additive too — it counts non-null values, and
//   count(A ∪ B) = count(A) + count(B). Only COUNT(DISTINCT …) breaks
//   the rule (distinct counts don't combine).
//
// What we REJECT:
//   - DISTINCT anywhere inside a COUNT argument
//   - Anything that ISN'T a single top-level aggregation, e.g.
//     `SUM(x) + 5` (the +5 on the aggregate result poisons additivity)
//   - Nested aggregations like `SUM(COUNT(x))` (invalid SQL anyway, but
//     defend so a typo doesn't sneak through)
//   - CAST(<non-additive> AS …) — we peel leading CAST(<…> AS T) and
//     keep parsing, since CAST AS NUMERIC/INTEGER/etc. is identity on
//     numeric aggregates.
function inferAdditiveTypeFromExpression(expr) {
  if (!expr || typeof expr !== 'string') return null;
  let s = expr.trim();
  if (!s) return null;
  // Peel leading CAST(<expr> AS <type>) wrappers iteratively. CAST is
  // identity on numeric aggregates, so the additivity of the inner
  // expression carries through. Stop as soon as we hit something that
  // isn't a CAST.
  let safety = 8; // bail if someone nests CASTs absurdly deep
  while (safety-- > 0 && /^CAST\s*\(/i.test(s)) {
    const openIdx = s.indexOf('(');
    if (openIdx < 0) break;
    const closeIdx = matchingClose(s, openIdx);
    if (closeIdx < 0 || closeIdx !== s.length - 1) break; // CAST not at top
    const inner = s.slice(openIdx + 1, closeIdx);
    const m = inner.match(/^([\s\S]+)\s+AS\s+[A-Za-z0-9_(),\s]+$/i);
    if (!m) break;
    s = m[1].trim();
  }
  // Top-level aggregation match: `<FN>(<…>)` with `<FN>` ∈ {SUM, COUNT,
  // MIN, MAX} and nothing trailing after the close paren.
  const head = s.match(/^(SUM|COUNT|MIN|MAX)\s*\(/i);
  if (!head) return null;
  const type = head[1].toLowerCase();
  const openIdx = head[0].length - 1;
  const closeIdx = matchingClose(s, openIdx);
  if (closeIdx < 0 || closeIdx !== s.length - 1) return null;
  const inner = s.slice(openIdx + 1, closeIdx);
  // DISTINCT breaks additive re-aggregation for ANY aggregate, not just
  // COUNT: finer-grain distinct sets overlap, so SUM(DISTINCT x) /
  // COUNT(DISTINCT x) over partitions ≠ the whole-set distinct value.
  // (MIN/MAX(DISTINCT) is value-equivalent but we stay conservative and
  // route it to the live path rather than claim additivity.)
  if (/\bDISTINCT\b/i.test(inner)) return null;
  // Nested aggregations: defend against pathological/typo inputs. SQL
  // engines reject these anyway (outside of subqueries/windows we don't
  // support here), so if one slips through it's safer to fall back to
  // the SQL-keyed cache than to claim additivity we can't prove.
  if (/\b(?:SUM|COUNT|AVG|MIN|MAX|MEDIAN|PERCENTILE|STDDEV|VAR(?:IANCE|_POP|_SAMP)?|ARRAY_AGG|STRING_AGG|GROUP_CONCAT)\s*\(/i.test(inner)) {
    return null;
  }
  return type;
}

function additiveTypeForAggregation(agg) {
  switch (agg) {
    case 'sum': return 'sum';
    case 'count': return 'count';
    case 'min': return 'min';
    case 'max': return 'max';
    default: return null;
  }
}

// Public API. Pass the model measure object — `aggregation` is the
// primary signal, with `expression` consulted only for `aggregation:
// 'custom'` to recover the additive trivial cases.
function additiveTypeForMeasure(m, allMeasures, _seen) {
  if (!m) return null;
  if (m.aggregation === 'custom') {
    const direct = inferAdditiveTypeFromExpression(m.expression);
    if (direct) return direct;
    // A custom measure whose expression is EXACTLY a single `${ref}` is
    // as additive as that ref. Resolving it here matters when the
    // measure also carries intersection `filterRules`: an interval/count
    // filter doesn't break additivity (COUNT(CASE WHEN f THEN x END) is
    // still additive), so it becomes a `simple` atom fired BY NAME —
    // /query then inlines the ref AND applies the filterRules. Without
    // this it falls to decomposeAsExpression, which expands the ref to
    // the UNFILTERED base and silently drops the filter (wrong rollup
    // value while the live query stays correct).
    const ex = String(m.expression || '').trim();
    const sole = ex.match(/^\$\{([A-Za-z0-9_.$-]+)\}$/);
    if (sole && Array.isArray(allMeasures)) {
      const seen = _seen || new Set();
      if (seen.has(sole[1])) return null; // ref cycle → bail
      seen.add(sole[1]);
      const ref = allMeasures.find((x) => x && x.name === sole[1]);
      return ref ? additiveTypeForMeasure(ref, allMeasures, seen) : null;
    }
    return null;
  }
  return additiveTypeForAggregation(m.aggregation);
}

// ─── Phase 3: non-additive measure decomposition ────────────────────────
// AVG, ratios of additive measures, etc. can't be re-aggregated in-memory
// from already-aggregated values, but they CAN be re-aggregated from their
// underlying additive components. `decomposeMeasure` returns a spec that
// tells the warmer + aggregate runtime what to store and how to recompose
// the final value at drill / cross-filter time.

// Ratio patterns recognised in `aggregation: 'custom'` measures. They
// produce `{ numRef, denRef, guard, guardThen, hasGuard, scale }`. The
// denominator's div-by-zero guard is NOT just dropped — `recomposeMeasure`
// must reproduce it exactly so a rollup-served ratio matches the live SQL:
//   guard 'none'   → A / B            (B=0 → undefined → null, like SQL)
//   guard 'nullif' → A / NULLIF(B,0)  (B=0 → A/NULL → null)
//   guard 'case'   → A / CASE WHEN B=0 THEN <t> ELSE B END
//                       (B=0 → A / <t>; <t> captured into `guardThen`)
// An optional `* <number>` tail (percentages: `… * 100`) goes into
// `scale`, applied after the division. The `case` THEN value MUST be a
// finite number; a non-numeric THEN makes detectRatio bail so the general
// expression decomposer (or the live path) handles it exactly.
const REF = '[A-Za-z0-9_.$\\-]+';
const SCALE_TAIL = `(?:\\s*\\*\\s*([0-9]+(?:\\.[0-9]+)?))?`;
const RATIO_PATTERNS = [
  { guard: 'none', re: new RegExp(`^\\s*\\$\\{(${REF})\\}\\s*\\/\\s*\\$\\{(${REF})\\}${SCALE_TAIL}\\s*$`) },
  { guard: 'nullif', re: new RegExp(`^\\s*\\$\\{(${REF})\\}\\s*\\/\\s*NULLIF\\s*\\(\\s*\\$\\{(${REF})\\}\\s*,\\s*0\\s*\\)${SCALE_TAIL}\\s*$`, 'i') },
  { guard: 'case', re: new RegExp(`^\\s*\\$\\{(${REF})\\}\\s*\\/\\s*CASE\\s+WHEN\\s+\\$\\{(${REF})\\}\\s*=\\s*0\\s+THEN\\s+(\\S+)\\s+ELSE\\s+\\$\\{(${REF})\\}\\s+END${SCALE_TAIL}\\s*$`, 'i') },
];

// ─── COUNT(DISTINCT col) recogniser (Phase D — HLL sketches) ───────────
// DISTINCT counts aren't classically additive: count_distinct(A ∪ B) ≠
// count_distinct(A) + count_distinct(B) because the two sets overlap.
// HyperLogLog sketches DO merge across partitions exactly (with bounded
// ~1.6% error at lg_k=12), so a rollup can persist one sketch per group
// at build time and merge them at any coarser grain at query time.
//
// We only recognise the literal shape `COUNT(DISTINCT "table"."col")`
// (with optional schema) — anything wrapped (`COUNT(DISTINCT … ) * 100`,
// arithmetic, CASE, IFNULL, …) bails so the live SQL handles it exactly.
// Returns `{ column, table }` or null. `table` is `''` when the inner
// reference is a bare `"col"` with no qualifier.
// SQL accepts two equivalent DISTINCT shapes — `COUNT(DISTINCT col)`
// (whitespace-separated) and `COUNT(DISTINCT(col))` (parenthesised).
// `(?=[\s(])` requires DISTINCT to be followed by whitespace OR `(`
// (never an identifier char), so a typo like `DISTINCTcol` doesn't
// match. The englobing parens of the second shape land inside the
// capture group; the helper peels them off below.
const COUNT_DISTINCT_RE = /^\s*COUNT\s*\(\s*DISTINCT(?=[\s(])\s*([\s\S]+?)\s*\)\s*$/i;
function detectCountDistinct(expression) {
  if (!expression || typeof expression !== 'string') return null;
  const m = expression.match(COUNT_DISTINCT_RE);
  if (!m) return null;
  let inner = m[1].trim();
  // Peel englobing parens — `COUNT(DISTINCT("col"))` arrives as
  // `("col")` in the capture, which the PART_RE below would reject.
  // Loop in case someone writes `COUNT(DISTINCT(("col")))`. Stop as
  // soon as the outer parens stop balancing the entire inner.
  while (inner.startsWith('(') && inner.endsWith(')')) {
    const close = matchingClose(inner, 0);
    if (close !== inner.length - 1) break;
    inner = inner.slice(1, -1).trim();
  }
  // The inner reference must be a sequence of double-quoted idents
  // joined by `.` and nothing else (no expressions, no functions).
  const PART_RE = /^"((?:[^"]|"")*)"(?:\s*\.\s*"((?:[^"]|"")*)")*$/;
  if (!PART_RE.test(inner)) return null;
  const parts = [];
  const re = /"((?:[^"]|"")*)"/g;
  let p;
  while ((p = re.exec(inner)) !== null) parts.push(p[1].replace(/""/g, '"'));
  if (parts.length < 1) return null;
  return {
    column: parts[parts.length - 1],
    table: parts.length > 1 ? parts.slice(0, -1).join('.') : '',
  };
}

// ─── Trivial single-aggregate fast path ────────────────────────────────
// A custom-mode expression that is JUST one of `SUM/AVG/MIN/MAX(col_ref)`
// or `COUNT(*)`, with nothing wrapping it. Lets the rollup builder treat
// the custom measure as the structurally-equivalent aggregation so the
// usual simple/avg decomposition kicks in, instead of bailing to
// decomposeAsExpression (which needs `${ref}` placeholders and would
// return non-decomposable for these). COUNT(col) is deliberately NOT
// matched — the structured 'count' path emits COUNT(*), which would
// silently change the semantic of an explicit COUNT("col").
const TRIVIAL_AGG_RE = /^\s*(SUM|AVG|MIN|MAX|COUNT)\s*\(\s*([\s\S]+?)\s*\)\s*$/i;
function detectTrivialAggregate(expression) {
  if (!expression || typeof expression !== 'string') return null;
  const m = expression.match(TRIVIAL_AGG_RE);
  if (!m) return null;
  const agg = m[1].toUpperCase();
  const arg = m[2].trim();
  if (agg === 'COUNT') {
    if (arg === '*') return { agg: 'count', table: '', column: '*' };
    // COUNT("col") would be ambiguous against the structured `count`
    // path (= COUNT(*)). Skip; user can still write the structured
    // measure if they want COUNT-of-column.
    return null;
  }
  // Reuse the same shape check the COUNT(DISTINCT …) helper uses: arg
  // must be a sequence of double-quoted idents joined by `.`, nothing
  // else (no nested function call, no arithmetic).
  const PART_RE = /^"((?:[^"]|"")*)"(?:\s*\.\s*"((?:[^"]|"")*)")*$/;
  if (!PART_RE.test(arg)) return null;
  const parts = [];
  const re = /"((?:[^"]|"")*)"/g;
  let p;
  while ((p = re.exec(arg)) !== null) parts.push(p[1].replace(/""/g, '"'));
  if (parts.length < 1) return null;
  return {
    agg: agg.toLowerCase(),
    column: parts[parts.length - 1],
    table: parts.length > 1 ? parts.slice(0, -1).join('.') : '',
  };
}

function detectRatio(expression) {
  if (!expression || typeof expression !== 'string') return null;
  for (const { guard, re } of RATIO_PATTERNS) {
    const m = expression.match(re);
    if (!m) continue;
    const numRef = m[1];
    const denRef = m[2];
    let guardThen = null;
    let scaleStr;
    if (guard === 'case') {
      // m[1]=num, m[2]=den, m[3]=THEN, m[4]=den2, m[5]=scale.
      // The CASE's ELSE ref MUST be the same measure as the WHEN ref,
      // otherwise this isn't a div-by-zero guard on `den`.
      if (m[4] !== denRef) return null;
      const t = Number(m[3]);
      // Non-numeric THEN (a ${ref} or expression) can't be reproduced
      // safely here — bail so the general expression decomposer (or the
      // live SQL) evaluates the real CASE exactly.
      if (!Number.isFinite(t)) return null;
      guardThen = t;
      scaleStr = m[5];
    } else {
      // none / nullif: m[1]=num, m[2]=den, m[3]=scale
      scaleStr = m[3];
    }
    const scale = scaleStr ? Number(scaleStr) : 1;
    if (!Number.isFinite(scale) || scale === 0) return null;
    return { numRef, denRef, guard, guardThen, hasGuard: guard !== 'none', scale };
  }
  return null;
}

// Resolve a `${name}` ref to its measure object in the model + report
// extras pool. Used during decomposition to walk ratio chains.
function findMeasureByName(name, allMeasures) {
  if (!Array.isArray(allMeasures)) return null;
  return allMeasures.find((m) => m && m.name === name) || null;
}


module.exports = {
  inferAdditiveTypeFromExpression,
  additiveTypeForAggregation,
  additiveTypeForMeasure,
  detectRatio,
  detectCountDistinct,
  detectTrivialAggregate,
  findMeasureByName,
};
