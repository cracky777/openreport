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

// ─── General expression decomposer ─────────────────────────────────────
// Any custom expression whose ${refs} are ALL additive can be re-computed
// from the component sums at any grain. We:
//   1. extract refs via regex
//   2. verify every ref decomposes recursively to additive components
//   3. transpile the SQL-ish expression into a JS function string that
//      takes a `_v` object (ref name → accumulated sum) and returns the
//      final value
// The compiled function lives in a per-process cache keyed by the
// expression string — V8 keeps the hot ones JIT'd.
//
// Supported SQL constructs in the expression:
//   - operators: + - * /
//   - parentheses
//   - comparison: =  <>  <  >  <=  >=
//   - `CASE WHEN cond THEN a ELSE b END`
//   - `NULLIF(x, y)`           → x === y ? null : x
//   - `COALESCE(x, y, …)`      → x ?? y ?? …
//   - `CAST(x AS <type>)`      → x (cast is a no-op in JS)
//   - numeric literals (integer + decimal)
//   - `${name}` refs (resolved at eval time from _v)
//
// Anything else (function calls, string literals, AND/OR boolean logic,
// etc.) is rejected — the measure falls back to the SQL-keyed cache /
// DB. Better to refuse than to silently return wrong numbers.
const EXPR_REF_PATTERN = /\$\{([A-Za-z0-9_.$-]+)\}/g;
function extractRefs(expression) {
  if (!expression || typeof expression !== 'string') return [];
  const out = new Set();
  let m;
  EXPR_REF_PATTERN.lastIndex = 0;
  // eslint-disable-next-line no-cond-assign
  while ((m = EXPR_REF_PATTERN.exec(expression)) !== null) out.add(m[1]);
  return [...out];
}

// SQL functions whitelisted for evaluation on aggregated additive sums.
// Anything operating on a SUM(col) is mathematically defined (the sum is
// just a number after aggregation), so any pure math function is fair
// game. Date / string functions are NOT included — they don't make sense
// on already-aggregated numeric sums and would surface confusing errors.
// Each SQL name maps to a JS callable that gets emitted inline in the
// compiled function body. `Math.*` covers most of it.
const SQL_TO_JS_FUNCS = {
  // Basic
  ABS: 'Math.abs', SIGN: 'Math.sign', SQRT: 'Math.sqrt',
  EXP: 'Math.exp', LN: 'Math.log', LOG: 'Math.log',
  LOG2: 'Math.log2', LOG10: 'Math.log10',
  POW: 'Math.pow', POWER: 'Math.pow',
  // Rounding
  ROUND: 'Math.round', FLOOR: 'Math.floor',
  CEIL: 'Math.ceil', CEILING: 'Math.ceil',
  TRUNC: 'Math.trunc',
  // Trig
  COS: 'Math.cos', SIN: 'Math.sin', TAN: 'Math.tan',
  ACOS: 'Math.acos', ASIN: 'Math.asin', ATAN: 'Math.atan',
  ATAN2: 'Math.atan2',
  COSH: 'Math.cosh', SINH: 'Math.sinh', TANH: 'Math.tanh',
  // Min/max (multi-arg)
  GREATEST: 'Math.max', LEAST: 'Math.min',
};

// Step-by-step SQL → JS translation. Returns null if the transpilation
// hits something we can't safely emit (unknown function, date function,
// suspicious identifier, etc.) — safer to fall back than to risk wrong
// numbers or arbitrary code exec via Function constructor.
function transpileSqlToJs(expression) {
  let js = expression;
  // 1. Drop CAST(x AS type) wrappers — the cast is a no-op once we're
  //    working with numbers in JS. Loop for nested casts.
  let prev;
  do {
    prev = js;
    js = js.replace(/CAST\s*\(\s*([\s\S]+?)\s+AS\s+[A-Za-z0-9_(),\s]+\)/gi, '($1)');
  } while (js !== prev);
  // 2. NULLIF(x, y) → ((x) === (y) ? null : (x))
  js = js.replace(/NULLIF\s*\(\s*([\s\S]+?)\s*,\s*([\s\S]+?)\s*\)/gi, '((($1) === ($2)) ? null : ($1))');
  // 3. COALESCE(a, b, c, …) → ((a) ?? (b) ?? (c) ?? …)
  js = js.replace(/COALESCE\s*\(([\s\S]+?)\)/gi, (match, inner) => {
    const args = splitTopLevelCommas(inner);
    if (args.length === 0) return 'null';
    return '(' + args.map((a) => `(${a.trim()})`).join(' ?? ') + ')';
  });
  // 4. CASE WHEN cond THEN a ELSE b END → ((cond) ? (a) : (b))
  //    Nested CASE is handled by re-running until no further match.
  do {
    prev = js;
    js = js.replace(
      /CASE\s+WHEN\s+([\s\S]+?)\s+THEN\s+([\s\S]+?)\s+ELSE\s+([\s\S]+?)\s+END/gi,
      '(($1) ? ($2) : ($3))',
    );
  } while (js !== prev);
  // 5. Boolean operators (case-insensitive, word-boundaries so `AND_x`
  //    doesn't get caught). NOT → !, AND → &&, OR → ||.
  js = js.replace(/\bNOT\b/gi, '!');
  js = js.replace(/\bAND\b/gi, '&&');
  js = js.replace(/\bOR\b/gi, '||');
  // 5.5 ROUND(x, n) with explicit precision — SQL rounds x to n decimal
  //     places, but JS Math.round ignores any second argument and rounds
  //     to integer. Transform to `Math.round(x * 10^n) / 10^n` so the
  //     runtime evaluator matches the SQL fallback. Single-arg ROUND(x)
  //     is left untouched (returns null) and falls through to step 6
  //     where the generic Math.* mapping replaces it with Math.round.
  js = rewriteFunctionCall(js, 'ROUND', (args) => {
    if (args.length !== 2) return null;
    const x = args[0].trim();
    const n = args[1].trim();
    return `(Math.round((${x}) * Math.pow(10, (${n}))) / Math.pow(10, (${n})))`;
  });
  // 5.6 IF(cond, a, b) → ternary. MySQL / SQLite-style alias for
  //     `CASE WHEN cond THEN a ELSE b END`.
  js = rewriteFunctionCall(js, 'IF', (args) => {
    if (args.length !== 3) return null;
    return `((${args[0].trim()}) ? (${args[1].trim()}) : (${args[2].trim()}))`;
  });
  // 5.7 IFNULL(x, y) → 2-arg COALESCE. Common SQL alias.
  js = rewriteFunctionCall(js, 'IFNULL', (args) => {
    if (args.length !== 2) return null;
    return `((${args[0].trim()}) ?? (${args[1].trim()}))`;
  });
  // 5.8 MOD(x, y) → SQL modulo with null/zero propagation. JS coerces
  //     `null % n` to 0 and `n % 0` to NaN; both diverge from SQL
  //     (which returns NULL). Guard explicitly so the cached value
  //     matches what live SQL would produce.
  js = rewriteFunctionCall(js, 'MOD', (args) => {
    if (args.length !== 2) return null;
    const x = args[0].trim();
    const y = args[1].trim();
    return `(((${x}) == null || (${y}) == null || (${y}) === 0) ? null : ((${x}) % (${y})))`;
  });
  // 6. Whitelisted SQL math functions → JS Math.* equivalents. Matches
  //    UPPERCASE-ish identifiers (SQL is typically uppercase) followed by
  //    `(` so we don't catch identifier prefixes by accident. The
  //    `(?<!\.)` lookbehind skips method-access calls like `Math.round(`
  //    that earlier passes (e.g. step 5.5 ROUND(x, n)) already emitted —
  //    without it, `Math.round(` would get rewritten to `Math.Math.round(`.
  js = js.replace(/(?<!\.)\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g, (match, name) => {
    const up = name.toUpperCase();
    if (up === 'CAST' || up === 'NULLIF' || up === 'COALESCE') return match; // already handled
    const jsName = SQL_TO_JS_FUNCS[up];
    return jsName ? `${jsName}(` : match;
  });
  // 7. ${refs} → _v["ref"]
  js = js.replace(EXPR_REF_PATTERN, (_m, name) => `_v[${JSON.stringify(name)}]`);
  // 8. SQL comparison operators → JS equivalents. Order matters: replace
  //    `<>` (NEQ) and `<=`/`>=` (compounds) before the bare `=`.
  js = js.replace(/<>/g, '!==');
  js = js.replace(/(^|[^!<>=])=(?!=)/g, '$1===');
  // 9. Validate the resulting JS only contains whitelisted characters.
  //    Rejects raw strings/keywords we didn't translate (SELECT, WHERE,
  //    function bodies, etc.).
  const ALLOWED = /^[\s0-9_a-zA-Z."'!<>=\-+*/%().?:[\],&|]+$/;
  if (!ALLOWED.test(js)) return null;
  // 10. Block dangerous identifiers as a belt-and-braces — `Math` and the
  //     handful of SQL_TO_JS_FUNCS values are the only globals an
  //     expression should ever reach. Anything else (require, process,
  //     Function, eval, constructor, …) is rejected.
  const BANNED = /\b(require|process|global(?:This)?|module|exports|Function|eval|constructor|prototype|__proto__|window|document|this|new|delete|throw|while|for|return|typeof|instanceof|void|import|export|class|async|await|yield)\b/;
  if (BANNED.test(js)) return null;
  // 11. Final pass: only identifiers we explicitly allow can appear as
  //     bare words. Strip string literals first — `${refs}` got rewritten
  //     to `_v["refname"]`, so the ref names live INSIDE string content
  //     and would otherwise be flagged by the bare-word scan. String
  //     contents are inert data (used as object keys) so it's safe to
  //     ignore them here. `_v`, `Math`, and `null`/`true`/`false`
  //     literals are fine; anything else (a misspelled SQL function, a
  //     stray keyword) means we missed a translation — bail out.
  const codeOnly = js
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''");
  const idents = codeOnly.match(/\b[A-Za-z_][A-Za-z0-9_]*\b/g) || [];
  for (const id of idents) {
    if (id === '_v' || id === 'Math' || id === 'null' || id === 'true' || id === 'false') continue;
    // Math.* members (cos, sin, log, abs, …) are accessed via the
    // `Math.<name>` pattern; the parser sees them as separate idents.
    if (Object.prototype.hasOwnProperty.call(Math, id)) continue;
    return null;
  }
  return js;
}

// Find the index of the `)` that matches the `(` at position `openIdx`.
// Returns -1 if no match (unbalanced parens — caller bails out).
function matchingClose(s, openIdx) {
  let depth = 1;
  for (let i = openIdx + 1; i < s.length; i++) {
    const c = s[i];
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// Replace every `FNNAME(<args>)` call in `s` with `transform(args)`. Uses
// balanced-paren matching so nested calls (e.g. `ROUND(ABS(x), 2)`) are
// handled correctly — the simpler `\([\s\S]+?\)` regex breaks on nesting.
// If `transform(args)` returns null, the call is left untouched and the
// search continues after it (useful when only certain arities need a
// rewrite, e.g. ROUND with 2 args).
function rewriteFunctionCall(s, fnName, transform) {
  const re = new RegExp(`\\b${fnName}\\s*\\(`, 'gi');
  let startSearch = 0;
  while (true) {
    re.lastIndex = startSearch;
    const m = re.exec(s);
    if (!m) break;
    const openIdx = m.index + m[0].length - 1;
    const closeIdx = matchingClose(s, openIdx);
    if (closeIdx < 0) break;
    const args = splitTopLevelCommas(s.slice(openIdx + 1, closeIdx));
    const replacement = transform(args);
    if (replacement == null) {
      startSearch = closeIdx + 1;
      continue;
    }
    s = s.slice(0, m.index) + replacement + s.slice(closeIdx + 1);
    startSearch = m.index + replacement.length;
  }
  return s;
}

// Top-level comma splitter — respects nested parens so `COALESCE(NULLIF(a,
// b), c)` splits into 2 args, not 3.
function splitTopLevelCommas(s) {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 0) { out.push(s.slice(start, i)); start = i + 1; }
  }
  out.push(s.slice(start));
  return out;
}

// Compile-cache for transpiled expressions. Keyed by raw expression
// string so repeated aggregate calls don't re-parse.
const _exprCache = new Map();
function compileExpression(rawExpression, refs) {
  const cached = _exprCache.get(rawExpression);
  if (cached !== undefined) return cached;
  const js = transpileSqlToJs(rawExpression, refs);
  if (js == null) {
    _exprCache.set(rawExpression, null);
    return null;
  }
  let fn;
  try {
    // Strict mode + return wrapper. The Function constructor isolates the
    // body from outer scope; only `_v` is accessible.
    // eslint-disable-next-line no-new-func
    fn = new Function('_v', `"use strict"; return (${js});`);
  } catch {
    fn = null;
  }
  _exprCache.set(rawExpression, fn);
  return fn;
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

// Returns a decomposition spec describing how to store + recompose a
// measure in the pre-agg cache, or `null` if non-decomposable (the visual
// then falls back to the SQL-keyed cache or the DB).
//
// Spec shape:
//   { type: 'simple', innerType: 'sum'|'count'|'min'|'max' }
//     — fire the measure as-is at warm; aggregate combines with `innerType`.
//
//   { type: 'avg', column, table }
//     — fire SUM(col) + COUNT(col) at warm under synthetic aliases;
//       aggregate divides totals.
//
//   { type: 'ratio', numRef, denRef, hasGuard, numSpec, denSpec }
//     — both refs must themselves be decomposable (recursively).
//       At warm, store the underlying simples; at recompose, sum num + den
//       and divide.
function decomposeMeasure(measure, allMeasures) {
  if (!measure) return null;
  const simple = additiveTypeForMeasure(measure, allMeasures);
  if (simple) return { type: 'simple', innerType: simple };
  // AVG decomposes to SUM + COUNT of the same column. Trivial expressions
  // like `aggregation: 'custom'` with `AVG(col)` aren't recognised here —
  // users should use `aggregation: 'avg'` in the model for those.
  if (measure.aggregation === 'avg' && measure.column) {
    // Carry dataType so the synthetic SUM component gets the SAME
    // interval→EXTRACT(EPOCH) treatment models.js applies to a normal
    // measure on an INTERVAL column. Without it the numerator is
    // SUM(interval) → not coercible to a number → atom stored NULL →
    // AVG broken.
    return { type: 'avg', column: measure.column, table: measure.table || '', dataType: measure.dataType };
  }
  // Ratio of two additive (or recursively decomposable) measures.
  if (measure.aggregation === 'custom') {
    // Fast path: recognise the ratio pattern (numRef / denRef [* scale])
    // and store explicit num/den keys + scale + hasGuard so the runtime
    // doesn't have to compile a JS expression for these very common
    // shapes. Falls through to the general expression decomposer below
    // if the pattern doesn't match.
    const ratio = detectRatio(measure.expression);
    if (ratio) {
      const numMeasure = findMeasureByName(ratio.numRef, allMeasures);
      const denMeasure = findMeasureByName(ratio.denRef, allMeasures);
      if (numMeasure && denMeasure) {
        const numSpec = decomposeMeasure(numMeasure, allMeasures);
        const denSpec = decomposeMeasure(denMeasure, allMeasures);
        if (numSpec && denSpec) {
          return {
            type: 'ratio',
            numRef: ratio.numRef,
            denRef: ratio.denRef,
            guard: ratio.guard,
            guardThen: ratio.guardThen,
            hasGuard: ratio.hasGuard,
            scale: ratio.scale,
            numSpec,
            denSpec,
          };
        }
      }
    }
    // COUNT(DISTINCT col) — non-additive in the classic sense, but
    // re-aggregatable across partitions via mergeable HyperLogLog
    // sketches. Decompose only if the expression is a clean
    // `COUNT(DISTINCT "tbl"."col")`; arithmetic / wrappers around it
    // fall through to decomposeAsExpression (which rejects DISTINCT
    // refs anywhere) → live SQL keeps doing the exact count.
    //
    // Whether HLL is actually USED for the recognition is decided at
    // the plan layer: `componentPlanForMeasures({hllReady})` reads
    // `isHllReady(db)` on the destination DuckDB and marks distinct
    // outputs `supported:false` when the DataSketches extension
    // failed to load (air-gapped install, repo unreachable, …). The
    // spec itself stays recognised; only the materialisation is
    // gated. Three layers of defence — extension load is a no-op on
    // failure, plan opts mark the output, the build path try/catches
    // the staging→rollup transition — so a recognised spec on a host
    // without the extension is always safe.
    const distinct = detectCountDistinct(measure.expression);
    if (distinct) {
      return {
        type: 'distinct',
        kind: 'hll',
        column: distinct.column,
        table: distinct.table,
        lgK: 12,
      };
    }
    // General path: any custom expression whose ${refs} are all simple
    // additive measures can be re-evaluated at any grain from their
    // component sums. Handles arbitrary math (COS, LOG, division,
    // CASE, …) — see transpileSqlToJs for the supported SQL subset.
    return decomposeAsExpression(measure, allMeasures);
  }
  return null;
}

// Build an expression spec from a custom measure whose `${refs}` are all
// simple additive measures. Returns null when:
//   - the measure isn't `aggregation: 'custom'` with a string expression
//   - no `${ref}` placeholders are present (purely-constant expression
//     can't be re-grouped meaningfully — fire it through SQL instead)
//   - any ref resolves to a non-simple measure (ratio of ratios, AVG,
//     COUNT DISTINCT, etc.) — we'd need nested recomposition which the
//     current bucket evaluator doesn't do
//   - the expression doesn't transpile cleanly (unknown function,
//     suspicious identifier, etc.)
function decomposeAsExpression(measure, allMeasures) {
  if (!measure || measure.aggregation !== 'custom') return null;
  const expression = measure.expression;
  if (!expression || typeof expression !== 'string') return null;
  const refNames = extractRefs(expression);
  if (refNames.length === 0) return null;
  // Phase A+B widening (2026-05): the previous gate refused EVERY
  // function call except NULLIF. The transpiler is now the single
  // source of truth on what's safely re-evaluable at the rollup grain
  // — its step-11 bare-identifier scan rejects any unknown name (so a
  // typo / a non-whitelisted SQL function still falls back to live).
  // Applying `f(ΣA, ΣB, …)` at the group grain is mathematically exact
  // for every f in the math whitelist (pure of additive sums), so we
  // let the transpiler decide; the gate here only fast-fails when an
  // obviously unknown function name appears in the expression, to
  // produce a planner `MISS: non-decomposable:<measure>` early instead
  // of compiling-then-throwing at recompose time.
  {
    const ALLOWED_FUNCS = new Set([
      // Transpiler-rewritten by name (handled before SQL_TO_JS_FUNCS):
      'CAST', 'NULLIF', 'COALESCE', 'IFNULL', 'IF', 'MOD', 'ROUND',
      // Pure math whitelist (SQL_TO_JS_FUNCS keys), evaluated on the
      // additive sums at the requested grain:
      'ABS', 'SIGN', 'SQRT', 'EXP', 'LN', 'LOG', 'LOG2', 'LOG10',
      'POW', 'POWER', 'FLOOR', 'CEIL', 'CEILING', 'TRUNC',
      'COS', 'SIN', 'TAN', 'ACOS', 'ASIN', 'ATAN', 'ATAN2',
      'COSH', 'SINH', 'TANH',
      'GREATEST', 'LEAST',
    ]);
    let scan = String(expression);
    let prev;
    do { prev = scan; scan = scan.replace(/CAST\s*\(/gi, '('); } while (scan !== prev);
    scan = scan.replace(EXPR_REF_PATTERN, '_R_');
    const callRe = /([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
    let m;
    while ((m = callRe.exec(scan)) !== null) {
      if (!ALLOWED_FUNCS.has(m[1].toUpperCase())) return null;
    }
  }
  const refs = [];
  for (const name of refNames) {
    const compM = findMeasureByName(name, allMeasures);
    if (!compM) return null;
    // Fast path: simple additive ref (SUM/COUNT/MIN/MAX, or a custom
    // expression that reduces to a single additive). One atom per ref.
    const innerType = additiveTypeForMeasure(compM, allMeasures);
    if (innerType) {
      refs.push({ name, innerType });
      continue;
    }
    // Phase C (2026-05-20): a ref can also be a fully-decomposable
    // AVG or ratio measure. We carry the nested spec; at recompose
    // time the wrapper recurses (sum_for_avg / count_for_avg, or
    // num/den + guard) and feeds the resolved scalar into _v before
    // calling the compiled fn. Mathematically exact at any grain —
    // the wrapping function f(AVG(a), SUM(b)) operates on numbers
    // once AVG is resolved, and AVG is itself reconstructable from
    // its component atoms at the requested grain. Other spec types
    // (a custom expression as a nested ref, DISTINCT, …) are still
    // rejected here — keeps recursion depth bounded and avoids
    // accidental cycles via co-referencing custom expressions.
    const nested = decomposeMeasure(compM, allMeasures);
    if (!nested) return null;
    if (nested.type !== 'avg' && nested.type !== 'ratio') return null;
    refs.push({ name, innerType: 'nested', spec: nested });
  }
  // Compile up-front to validate the expression; the compiled function is
  // cached in _exprCache by raw string so the runtime gets it for free.
  const fn = compileExpression(expression);
  if (!fn) return null;
  return { type: 'expression', refs, rawExpression: expression };
}

// Collect the set of base measures (by name) that need to actually be
// fired by the warmer's SQL so the pre-agg dataset has the raw components
// it needs to recompose every visual measure at runtime.
//
// Returns:
//   { baseMeasureNames: [...names from the model],
//     syntheticMeasures: [{ alias, column, table, type: 'sum'|'count' }] }
//
// `baseMeasureNames` get sent verbatim to /query (they exist in the model
// + report extras). `syntheticMeasures` need to be injected as inline
// extraMeasures because they're decompositions of AVG that don't have a
// named definition (e.g. SUM(amount) component of AVG(amount)).
function collectComponentsForVisual(specs) {
  const baseNames = new Set();
  const synthetic = [];
  const visit = (spec) => {
    if (!spec) return;
    if (spec.type === 'simple') return; // handled by the visual measure itself, fired normally
    if (spec.type === 'avg') {
      const aliasBase = avgAliasBase(spec);
      synthetic.push({ alias: `${aliasBase}_sum`, column: spec.column, table: spec.table, kind: 'sum', dataType: spec.dataType });
      // Denominator MUST be COUNT(<column>) — count of NON-NULL values —
      // so AVG = SUM(x)/COUNT(x) matches SQL AVG semantics (NULLs skipped
      // by both SUM and COUNT). Plain `count` is COUNT(*) in models.js
      // (counts NULL-x rows too) → would understate the average whenever
      // the averaged column has NULLs. `count_col` is a dedicated kind
      // handled as COUNT(col) and never used by user `count` measures.
      synthetic.push({ alias: `${aliasBase}_count`, column: spec.column, table: spec.table, kind: 'count_col', dataType: spec.dataType });
      return;
    }
    if (spec.type === 'ratio') {
      // The ratio's components are named measures in the model — the
      // warmer should fire them directly. Recurse in case a component is
      // itself decomposable (rare but possible).
      if (spec.numSpec.type === 'simple') baseNames.add(spec.numRef);
      else visit(spec.numSpec);
      if (spec.denSpec.type === 'simple') baseNames.add(spec.denRef);
      else visit(spec.denSpec);
      return;
    }
    if (spec.type === 'distinct') {
      // One mergeable HyperLogLog sketch column per (table, column, lgK).
      // The builder fires `datasketch_hll(lgK, col)` over the deduped
      // (grain ∪ col) tuples it pulled from the source; the planner emits
      // `datasketch_hll_estimate(datasketch_hll_union(lgK, sketch))` to
      // get the approximate cardinality at any requested grain.
      const aliasBase = hllAliasBase(spec);
      synthetic.push({
        alias: aliasBase,
        column: spec.column,
        table: spec.table,
        kind: 'hll',
        lgK: spec.lgK || 12,
      });
      return;
    }
    if (spec.type === 'expression') {
      // Each ref is either a simple additive (one atom in the model)
      // or a Phase C nested decomposition (avg / ratio — its own
      // synthetic / base components, collected by recursing).
      for (const r of spec.refs) {
        if (r.spec) visit(r.spec);
        else baseNames.add(r.name);
      }
    }
  };
  for (const s of specs) visit(s);
  return { baseMeasureNames: [...baseNames], syntheticMeasures: synthetic };
}

// ─── Rollup component planning + runtime recompose ──────────────────────
// Used by the rollup builder (what additive component columns to
// materialise) and the rollup planner (how to recombine them at any
// grain). This is the same math the deleted inMemoryAgg did, sourced
// from a DuckDB GROUP BY instead of an in-RAM columnar dataset.

// SQL re-aggregation function for an additive component at a coarser
// grain. sum & count both fold with SUM (count-of-counts = total count);
// min/max fold with themselves.
function sqlAggForAdditive(t) {
  if (t === 'min') return 'MIN';
  if (t === 'max') return 'MAX';
  return 'SUM'; // sum, count
}

// Stable alias base for an AVG measure's SUM/COUNT components. The SINGLE
// source of truth — collectComponentsForVisual calls THIS so the build
// alias and the runtime-recompose lookup can never diverge.
//
// MUST stay ≤ 63 chars: PostgreSQL truncates every result-set column
// alias to NAMEDATALEN (63 bytes). The old `_avg_<schema>_<table>_<col>`
// scheme produced 70+ char aliases on real models (e.g.
// `_avg_nyukom_appel_entrant_f_appel_entrant_agg_duree_sonnerie_totale_sum`),
// so PG truncated the SELECT alias, the build response key no longer
// matched the atom name, and buildRollupToDuckDB stored NULL → every
// AVG-from-rollup returned null. A short stable hash of table.column
// keeps the full alias (`_avg_<16hex>_sum`/`_count`) ~27 chars.
function avgAliasBase(spec) {
  const key = `${spec.table || ''}.${spec.column}`;
  const h = require('crypto').createHash('sha1').update(key).digest('hex').slice(0, 16);
  return `_avg_${h}`;
}

// Stable alias for an HLL sketch atom — same `<short-hash>` shape as
// `avgAliasBase`, so two DISTINCT measures targeting the same column
// share ONE sketch column in the rollup (idempotent). lgK is part of
// the hash because two specs with the same column but different
// precisions can't share the underlying sketch (HLL sketches are not
// mergeable across lg_k values).
function hllAliasBase(spec) {
  const key = `${spec.table || ''}.${spec.column}|lgk=${spec.lgK || 12}`;
  const h = require('crypto').createHash('sha1').update(key).digest('hex').slice(0, 16);
  return `_hll_${h}`;
}

// Given the measure DEFs a rollup must serve + the full measure pool,
// returns everything the builder and planner need:
//   outputs:       [{ name, label, spec, supported }]
//   fireNames:     measure names to request from /query by name
//   extraMeasures: synthetic AVG components to pass as extraMeasures
//   atoms:         [{ col, agg }] physical component columns + re-agg fn
function componentPlanForMeasures(outputDefs, allMeasures, opts) {
  const hllReady = !!(opts && opts.hllReady);
  const outputs = [];
  const fireNames = new Set();
  const extraByAlias = new Map();
  const atomByCol = new Map(); // col -> agg ('sum'|'min'|'max') | {agg, lgK}

  for (const m of outputDefs) {
    if (!m || !m.name) continue;
    const label = m.label || m.name;
    // Override-mode filtered measures (or anything referencing one) can't
    // be safely re-aggregated from atoms — never materialise them; the
    // planner MISSes → live query (always correct). See isOverrideTainted.
    if (isOverrideTainted(m, allMeasures)) {
      outputs.push({ name: m.name, label, spec: null, supported: false });
      continue;
    }
    const spec = decomposeMeasure(m, allMeasures);
    if (!spec) {
      outputs.push({ name: m.name, label, spec: null, supported: false });
      continue;
    }
    // DISTINCT measures need the DataSketches DuckDB extension to
    // materialise their HLL sketch atoms. If the extension didn't load
    // (offline / unreachable community repo), drop the output to
    // `supported:false` so the planner MISSes → live SQL (correct,
    // unaccelerated). Generic for every DISTINCT shape — never
    // materialise an HLL atom we can't read back.
    if (spec.type === 'distinct' && !hllReady) {
      outputs.push({ name: m.name, label, spec: null, supported: false });
      continue;
    }
    let supported = true;
    if (spec.type === 'simple') {
      fireNames.add(m.name);
      atomByCol.set(m.name, sqlAggForAdditive(spec.innerType));
    } else {
      if (spec.type === 'expression' && !compileExpression(spec.rawExpression)) {
        supported = false;
      }
      const { baseMeasureNames, syntheticMeasures } = collectComponentsForVisual([spec]);
      for (const b of baseMeasureNames) {
        fireNames.add(b);
        const bd = allMeasures.find((x) => x && x.name === b);
        atomByCol.set(b, sqlAggForAdditive(additiveTypeForMeasure(bd, allMeasures)));
      }
      for (const s of syntheticMeasures) {
        if (s.kind === 'hll') {
          // HLL sketch atom: stored as BLOB in the rollup, re-aggregated
          // via datasketch_hll_union(lgK, sketch) and unwrapped by
          // datasketch_hll_estimate(...) — the planner branches on
          // `agg === 'HLL_UNION'` and reads `lgK` from the atom. The
          // builder branches on `aggregation: 'hll'` to fetch (grain ∪
          // col) deduped rows and run `datasketch_hll(lgK, col)` in
          // DuckDB at staging→rollup time.
          extraByAlias.set(s.alias, {
            name: s.alias, aggregation: s.kind, column: s.column, table: s.table, lgK: s.lgK,
          });
          atomByCol.set(s.alias, { agg: 'HLL_UNION', lgK: s.lgK });
          continue;
        }
        extraByAlias.set(s.alias, {
          name: s.alias, aggregation: s.kind, column: s.column, table: s.table, dataType: s.dataType,
        });
        atomByCol.set(s.alias, 'SUM');
      }
    }
    outputs.push({ name: m.name, label, spec, supported });
  }

  return {
    outputs,
    fireNames: [...fireNames],
    extraMeasures: [...extraByAlias.values()],
    // Atoms can carry extra metadata (lgK for HLL) — accept both the
    // legacy string form ('SUM' / 'MIN' / 'MAX') and the object form
    // (`{agg, lgK}`) here.
    atoms: [...atomByCol.entries()].map(([col, meta]) => (
      typeof meta === 'string' ? { col, agg: meta } : { col, ...meta }
    )),
  };
}

// Recombine one decomposed measure for a single output row. `getAtom`
// returns the already-grain-aggregated numeric value of a component
// column. `refName` is the measure name whose column holds a `simple`
// value (only used for the simple/leaf case).
function recomposeMeasure(spec, refName, getAtom) {
  if (!spec) return null;
  if (spec.type === 'simple') {
    const v = getAtom(refName);
    return (v === undefined) ? null : v;
  }
  if (spec.type === 'avg') {
    const base = avgAliasBase(spec);
    const s = getAtom(`${base}_sum`);
    const c = getAtom(`${base}_count`);
    return c ? (s / c) : null;
  }
  if (spec.type === 'distinct') {
    // The planner SQL wraps the merged sketch with
    // `datasketch_hll_estimate(datasketch_hll_union(lgK, sketch))` so
    // the atom we receive is already the scalar cardinality estimate
    // (a number, not the BLOB sketch). Pass it through unchanged.
    const v = getAtom(hllAliasBase(spec));
    return (v === undefined) ? null : v;
  }
  if (spec.type === 'ratio') {
    const n = recomposeMeasure(spec.numSpec, spec.numRef, getAtom);
    const d = recomposeMeasure(spec.denSpec, spec.denRef, getAtom);
    // SQL NULL propagation: A/<anything-NULL> and <NULL>/B are NULL.
    if (n == null || d == null) return null;
    let divisor;
    if (d === 0) {
      // Reproduce the denominator's div-by-zero guard exactly, as the
      // live SQL does:
      //   guard 'case'  → CASE WHEN den=0 THEN <guardThen> ELSE den END
      //                   ⇒ divisor = guardThen (numeric, e.g. 1)
      //   guard 'nullif'→ NULLIF(den,0) ⇒ den/NULL ⇒ NULL
      //   guard 'none'  → real /0 ⇒ undefined
      // Legacy manifests built before this change have no `spec.guard`;
      // they fall through to `null` here — i.e. exactly the prior
      // behaviour, so no regression until the rollup is re-warmed.
      if (spec.guard === 'case') {
        divisor = (spec.guardThen != null ? spec.guardThen : 1);
      } else {
        return null;
      }
    } else {
      divisor = d;
    }
    if (!divisor) return null; // guardThen could itself be 0
    let v = n / divisor;
    if (spec.scale && spec.scale !== 1) v *= spec.scale;
    return Number.isFinite(v) ? v : null;
  }
  if (spec.type === 'expression') {
    const fn = compileExpression(spec.rawExpression);
    if (!fn) return null;
    const _v = {};
    for (const r of spec.refs) {
      if (r.spec) {
        // Phase C nested ref: resolve avg / ratio at the requested
        // grain from its own atoms, then feed the scalar into _v.
        const v = recomposeMeasure(r.spec, r.name, getAtom);
        _v[r.name] = (v === undefined) ? null : v;
      } else {
        const a = getAtom(r.name);
        _v[r.name] = (a === undefined) ? null : a;
      }
    }
    let v;
    try { v = fn(_v); } catch { return null; }
    // NaN / +-Infinity bubble up from JS arithmetic where SQL would
    // have produced NULL (e.g. `100 / NULLIF(0, 0)` → `100 / null` →
    // `Infinity` in JS, NULL in SQL). Normalise to null so the cached
    // value matches the live query at the same grain.
    if (typeof v === 'number' && !Number.isFinite(v)) return null;
    return (v == null) ? null : v;
  }
  return null;
}

// Fact table(s) a custom-SQL expression reads DIRECTLY, parsed from its
// raw column references. The UI generates fully-qualified, double-quoted
// refs like `"schema"."fact"."col"` (or `"fact"."col"`); the fact table
// is every quoted part except the trailing column, dot-joined — the same
// `schema.table` form `measure.table` carries for model measures, so the
// builder's fact-grouping and the planner's findBestRollup line up.
//
// Only QUOTED multi-part runs are matched. `${ref}` placeholders (handled
// by recursion) and bare function names like `COUNT` carry no quotes and
// are correctly ignored, so a ratio-of-refs isn't mis-attributed here.
function tablesInExpression(expr) {
  if (!expr || typeof expr !== 'string') return [];
  const out = new Set();
  // A run = one quoted ident followed by ≥1 (`.` quoted ident). Requires
  // at least two parts so a lone quoted alias is never read as a table.
  const RUN = /"(?:[^"]|"")*"(?:\s*\.\s*"(?:[^"]|"")*")+/g;
  const PART = /"((?:[^"]|"")*)"/g;
  let run;
  while ((run = RUN.exec(expr)) !== null) {
    const parts = [];
    let p;
    PART.lastIndex = 0;
    while ((p = PART.exec(run[0])) !== null) parts.push(p[1].replace(/""/g, '"'));
    if (parts.length >= 2) out.add(parts.slice(0, -1).join('.'));
  }
  return [...out];
}

// Fact table(s) a measure DEF reads directly (not via `${ref}`s). Prefers
// the explicit `.table` (model measures); falls back to parsing the raw
// SQL of a custom expression (calc/extra measures where the fact is
// embedded in the expression and `.table` is empty).
function factTablesFromDef(measure) {
  if (!measure) return [];
  if (measure.table) return [measure.table];
  if (measure.aggregation === 'custom' && measure.expression) {
    return tablesInExpression(measure.expression);
  }
  return [];
}

// Distinct fact tables a measure reads from, after decomposition. A
// constellation model has several fact tables sharing conformed
// dimensions; a rollup must aggregate ONE fact at a time (joining facts
// together fans out into a cartesian product). This tells the builder
// which fact-group a measure belongs to:
//   - 1 table  → single-fact measure (rollupable in that fact's rollup)
//   - 0 tables → unknown (no `table` on the def — e.g. a bare COUNT(*));
//                treated as cross/unrollable in v1
//   - >1 tables→ cross-fact (ratio/expr whose refs span facts) — v1
//                falls back to the live query for these
function factsForMeasure(measure, allMeasures, _seen) {
  if (!measure) return [];
  const seen = _seen || new Set();
  if (measure.name) {
    if (seen.has(measure.name)) return [];
    seen.add(measure.name);
  }
  const spec = decomposeMeasure(measure, allMeasures);
  const uniq = (arr) => [...new Set(arr.filter(Boolean))];
  if (!spec) return factTablesFromDef(measure);
  if (spec.type === 'simple') return factTablesFromDef(measure);
  if (spec.type === 'avg') return spec.table ? [spec.table] : factTablesFromDef(measure);
  if (spec.type === 'distinct') return spec.table ? [spec.table] : factTablesFromDef(measure);
  if (spec.type === 'ratio') {
    const n = findMeasureByName(spec.numRef, allMeasures);
    const d = findMeasureByName(spec.denRef, allMeasures);
    return uniq([
      ...factsForMeasure(n, allMeasures, seen),
      ...factsForMeasure(d, allMeasures, seen),
    ]);
  }
  if (spec.type === 'expression') {
    const out = [];
    for (const r of spec.refs) {
      out.push(...factsForMeasure(findMeasureByName(r.name, allMeasures), allMeasures, seen));
    }
    return uniq(out);
  }
  return factTablesFromDef(measure);
}

// True if a measure is "override-tainted": it (or any measure it
// transitively references) drops the widget/global filter on its rule
// fields via `overrideFilters` (the /query path emits it as a correlated
// subquery — see routes/models.js). Such a measure is NOT safely
// re-aggregatable from rollup atoms: its value deliberately ignores
// filters the atoms were grouped/baked by, so serving it from a rollup
// at any grain/filter ≠ the bake would return a WRONG number. The rollup
// builder marks these `supported:false` → planner MISS → live query
// (always correct, just not accelerated). INTERSECTION-mode filtered
// measures (`filterRules` WITHOUT `overrideFilters`) are SAFE — their
// `CASE WHEN` is inside the aggregate and the global WHERE still applies,
// so they're additive and bake/re-aggregate correctly; they are NOT
// tainted by this check.
function isOverrideTainted(measure, allMeasures, _seen) {
  if (!measure) return false;
  const seen = _seen || new Set();
  if (measure.name) {
    if (seen.has(measure.name)) return false;
    seen.add(measure.name);
  }
  if (Array.isArray(measure.filterRules) && measure.filterRules.length > 0
      && measure.overrideFilters) {
    return true;
  }
  const spec = decomposeMeasure(measure, allMeasures);
  if (!spec) return false;
  if (spec.type === 'ratio') {
    return isOverrideTainted(findMeasureByName(spec.numRef, allMeasures), allMeasures, seen)
      || isOverrideTainted(findMeasureByName(spec.denRef, allMeasures), allMeasures, seen);
  }
  if (spec.type === 'expression') {
    return spec.refs.some((r) =>
      isOverrideTainted(findMeasureByName(r.name, allMeasures), allMeasures, seen));
  }
  return false;
}

// Per-widget aggregation override → a stable "effective measure" key.
// A widget can display a model measure with a different aggregation
// (`measureAggOverrides[name]` in /query; models.js applies it ONLY when
// the model agg isn't 'custom'). The rollup builder materialises a
// synthetic measure under this key (decomposed with the overridden agg —
// e.g. sum/count/min/max → that additive atom; avg → the usual
// _avg_*_sum/_count atoms), and the planner looks the manifest output up
// under the SAME key, so an aggregation-overridden widget is served from
// the rollup (correct AND cached) instead of bypassing it.
//
// Returns `baseName` when there is no real override (no override, same as
// model agg, or model agg is 'custom' — mirrors models.js exactly), else
// `<baseName>@@<overrideAgg>`. Generic for ALL aggregation types.
function effectiveMeasureName(baseName, modelAgg, overrideAgg) {
  if (!overrideAgg) return baseName;
  if (modelAgg === 'custom') return baseName;
  if (overrideAgg === modelAgg) return baseName;
  return `${baseName}@@${overrideAgg}`;
}

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
