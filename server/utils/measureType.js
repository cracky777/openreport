/**
 * Single source of truth for "is this measure additive?" — used by the
 * pre-agg path (runtime cache lookup + warm-time eligibility).
 *
 * A measure is additive when its rows can be re-aggregated in-memory
 * after filtering: SUM, COUNT, MIN, MAX. AVG, COUNT(DISTINCT …),
 * MEDIAN, percentiles and most custom expressions are not.
 *
 * For `aggregation: 'custom'` measures we still try to recognise the
 * trivial wrappers a user typically writes — `COUNT(col)`, `SUM(col)`,
 * `MIN(col)`, `MAX(col)`, plus `COUNT(*)`. Anything richer (DISTINCT,
 * arithmetic, multiple aggregates, CASE, etc.) drops back to null and
 * the visual falls through to the SQL-keyed cache or the source DB.
 *
 * Lives in server/utils so both routes/models.js (and its cloud shadow)
 * and cacheWarmer.js (OSS + cloud) can share the exact same logic — a
 * mismatch between warm-time and runtime eligibility would silently
 * break the pre-agg cache for half the visuals.
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
  // COUNT(DISTINCT …) is non-additive — finer-grain distincts can
  // overlap and double-counting them at the coarser grain is wrong.
  if (type === 'count' && /\bDISTINCT\b/i.test(inner)) return null;
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
function additiveTypeForMeasure(m) {
  if (!m) return null;
  if (m.aggregation === 'custom') {
    return inferAdditiveTypeFromExpression(m.expression);
  }
  return additiveTypeForAggregation(m.aggregation);
}

// ─── Phase 3: non-additive measure decomposition ────────────────────────
// AVG, ratios of additive measures, etc. can't be re-aggregated in-memory
// from already-aggregated values, but they CAN be re-aggregated from their
// underlying additive components. `decomposeMeasure` returns a spec that
// tells the warmer + aggregate runtime what to store and how to recompose
// the final value at drill / cross-filter time.

// Ratio patterns recognised in `aggregation: 'custom'` measures. All three
// produce `{ numRef, denRef, hasGuard, scale }` — the denominator's div-by-
// zero guard is dropped at recompose time (we apply it ourselves in
// inMemoryAgg), and an optional `* <number>` multiplier at the end of the
// expression (common pattern for percentages: `… * 100`) is captured into
// `scale` and applied after the division.
//
// Pattern 1: ${A} / ${B}                                            [* N]
// Pattern 2: ${A} / NULLIF(${B}, 0)                                 [* N]
// Pattern 3: ${A} / CASE WHEN ${B} = 0 THEN <anything> ELSE ${B} END [* N]
const REF = '[A-Za-z0-9_.$\\-]+';
const SCALE_TAIL = `(?:\\s*\\*\\s*([0-9]+(?:\\.[0-9]+)?))?`;
const RATIO_PATTERNS = [
  { hasGuard: false, re: new RegExp(`^\\s*\\$\\{(${REF})\\}\\s*\\/\\s*\\$\\{(${REF})\\}${SCALE_TAIL}\\s*$`) },
  { hasGuard: true, re: new RegExp(`^\\s*\\$\\{(${REF})\\}\\s*\\/\\s*NULLIF\\s*\\(\\s*\\$\\{(${REF})\\}\\s*,\\s*0\\s*\\)${SCALE_TAIL}\\s*$`, 'i') },
  { hasGuard: true, re: new RegExp(`^\\s*\\$\\{(${REF})\\}\\s*\\/\\s*CASE\\s+WHEN\\s+\\$\\{(${REF})\\}\\s*=\\s*0\\s+THEN\\s+[^\\s]+\\s+ELSE\\s+\\$\\{(${REF})\\}\\s+END${SCALE_TAIL}\\s*$`, 'i') },
];

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
  const ALLOWED = /^[\s0-9_a-zA-Z."'!<>=\-+*/().?:[\],&|]+$/;
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
  for (const { hasGuard, re } of RATIO_PATTERNS) {
    const m = expression.match(re);
    if (!m) continue;
    const numRef = m[1];
    const denRef = m[2];
    // Pattern 3 has an extra denRef capture for the backref-style
    // duplicate (CASE WHEN … END must reference the same measure on both
    // sides) — when present, it MUST equal the first denRef capture.
    // Pattern 1 & 2 have just (num, den, scale); pattern 3 has (num, den,
    // den2, scale). We disambiguate by the regex's capture count.
    let scaleStr;
    if (m.length === 5) {
      // Pattern 3: m[1]=num, m[2]=den, m[3]=den2, m[4]=scale
      if (m[3] !== denRef) return null;
      scaleStr = m[4];
    } else {
      // Patterns 1 & 2: m[1]=num, m[2]=den, m[3]=scale
      scaleStr = m[3];
    }
    const scale = scaleStr ? Number(scaleStr) : 1;
    if (!Number.isFinite(scale) || scale === 0) return null;
    return { numRef, denRef, hasGuard, scale };
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
  const simple = additiveTypeForMeasure(measure);
  if (simple) return { type: 'simple', innerType: simple };
  // AVG decomposes to SUM + COUNT of the same column. Trivial expressions
  // like `aggregation: 'custom'` with `AVG(col)` aren't recognised here —
  // users should use `aggregation: 'avg'` in the model for those.
  if (measure.aggregation === 'avg' && measure.column) {
    return { type: 'avg', column: measure.column, table: measure.table || '' };
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
            hasGuard: ratio.hasGuard,
            scale: ratio.scale,
            numSpec,
            denSpec,
          };
        }
      }
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
  const refs = [];
  for (const name of refNames) {
    const compM = findMeasureByName(name, allMeasures);
    if (!compM) return null;
    const innerType = additiveTypeForMeasure(compM);
    if (!innerType) return null;
    refs.push({ name, innerType });
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
      const aliasBase = `_avg_${spec.table || ''}_${spec.column}`.replace(/[^A-Za-z0-9_]/g, '_');
      synthetic.push({ alias: `${aliasBase}_sum`, column: spec.column, table: spec.table, kind: 'sum' });
      synthetic.push({ alias: `${aliasBase}_count`, column: spec.column, table: spec.table, kind: 'count' });
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
    if (spec.type === 'expression') {
      // Each ref is a simple additive measure named in the model.
      for (const r of spec.refs) baseNames.add(r.name);
    }
  };
  for (const s of specs) visit(s);
  return { baseMeasureNames: [...baseNames], syntheticMeasures: synthetic };
}

module.exports = {
  additiveTypeForMeasure,
  additiveTypeForAggregation,
  inferAdditiveTypeFromExpression,
  decomposeMeasure,
  detectRatio,
  collectComponentsForVisual,
  // Exposed so inMemoryAgg.aggregate can compile (and cache) the JS
  // evaluator for each `type: 'expression'` measure at output time.
  compileExpression,
  extractRefs,
};
