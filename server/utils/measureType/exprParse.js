/* SQL-ish expression → JS compiler + balanced-paren parsing primitives.
 * Part of the measureType decomposition engine — see ./index.js for the
 * module-level contract. Split out of the former single-file measureType.js
 * (pure relocation, no logic change). ROLLUP-CACHE.md §6 documents the math.
 */

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
    fn = new Function('_v', `"use strict"; return (${js});`);
  } catch {
    fn = null;
  }
  _exprCache.set(rawExpression, fn);
  return fn;
}


module.exports = { matchingClose, extractRefs, compileExpression, EXPR_REF_PATTERN };
