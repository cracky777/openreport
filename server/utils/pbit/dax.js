// A deliberately small DAX reader. It parses any measure into an AST, then
// translates the subset that maps cleanly onto an OpenReport measure:
//   - SUM / AVERAGE / MIN / MAX / COUNT / COUNTA / COUNTROWS / DISTINCTCOUNT
//   - CALCULATE(<agg or measure>, <simple column filters>)
//   - CALCULATE(<agg or measure>, <one period back>(date[col])) — the same
//     selection moved in time (SAMEPERIODLASTYEAR, DATEADD, PREVIOUSMONTH…)
//     becomes the measure's `periodShift`, compiled by the query engine
//   - DIVIDE, + - * /, parentheses, numeric literals, [measure] references
//   - VAR … RETURN when every variable is itself translatable
//   - COALESCE(x, literal) and IF(ISBLANK(x), literal, y): the blank fallback
//     is a display concern OpenReport handles elsewhere, so only x/y matters
// Everything else (time intelligence, FORMAT, iterators, ALL…) is reported
// with a reason so the import can keep the DAX as a draft measure.

// ---------------------------------------------------------------- tokenizer

function tokenize(src) {
  const tokens = [];
  let i = 0;
  const s = String(src || '');
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '/' && s[i + 1] === '/') { while (i < s.length && s[i] !== '\n') i++; continue; }
    if (ch === '-' && s[i + 1] === '-') { while (i < s.length && s[i] !== '\n') i++; continue; }
    if (ch === '/' && s[i + 1] === '*') { i += 2; while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) i++; i += 2; continue; }
    if (ch === '"') {
      let j = i + 1; let v = '';
      while (j < s.length) {
        if (s[j] === '"') { if (s[j + 1] === '"') { v += '"'; j += 2; continue; } break; }
        v += s[j++];
      }
      tokens.push({ t: 'str', v }); i = j + 1; continue;
    }
    if (ch === "'") {
      let j = i + 1; let v = '';
      while (j < s.length && s[j] !== "'") v += s[j++];
      tokens.push({ t: 'table', v }); i = j + 1; continue;
    }
    if (ch === '[') {
      let j = i + 1; let v = '';
      while (j < s.length && s[j] !== ']') v += s[j++];
      tokens.push({ t: 'bracket', v }); i = j + 1; continue;
    }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(s[i + 1] || ''))) {
      const m = s.slice(i).match(/^[0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?|^[0-9]+/);
      tokens.push({ t: 'num', v: Number(m[0]) }); i += m[0].length; continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const m = s.slice(i).match(/^[A-Za-z_][A-Za-z0-9_.]*/);
      tokens.push({ t: 'ident', v: m[0] }); i += m[0].length; continue;
    }
    const two = s.slice(i, i + 2);
    if (['<>', '<=', '>=', '&&', '||'].includes(two)) { tokens.push({ t: 'op', v: two }); i += 2; continue; }
    if ('+-*/&=<>(),{}^'.includes(ch)) { tokens.push({ t: 'op', v: ch }); i++; continue; }
    throw new Error(`Unexpected character "${ch}" in DAX`);
  }
  return tokens;
}

// ------------------------------------------------------------------- parser

function parseDax(src) {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];
  const isOp = (v) => peek() && peek().t === 'op' && peek().v === v;
  const isKw = (v) => peek() && peek().t === 'ident' && peek().v.toUpperCase() === v;
  const expect = (v) => { if (!isOp(v)) throw new Error(`Expected "${v}" in DAX`); next(); };

  function parseTop() {
    if (isKw('VAR')) {
      const vars = [];
      while (isKw('VAR')) {
        next();
        const name = next();
        if (!name || name.t !== 'ident') throw new Error('VAR without a name');
        expect('=');
        vars.push({ name: name.v, expr: parseOr() });
      }
      if (!isKw('RETURN')) throw new Error('VAR without RETURN');
      next();
      return { t: 'let', vars, body: parseTop() };
    }
    return parseOr();
  }
  function parseOr() {
    let l = parseAnd();
    while (isOp('||')) { next(); l = { t: 'bin', op: '||', l, r: parseAnd() }; }
    return l;
  }
  function parseAnd() {
    let l = parseCmp();
    while (isOp('&&')) { next(); l = { t: 'bin', op: '&&', l, r: parseCmp() }; }
    return l;
  }
  function parseCmp() {
    let l = parseConcat();
    for (;;) {
      if (peek() && peek().t === 'op' && ['=', '<>', '<', '>', '<=', '>='].includes(peek().v)) {
        const op = next().v; l = { t: 'bin', op, l, r: parseConcat() };
        continue;
      }
      // Infix `T[c] IN { … }` — the only keyword operator we care about.
      if (isKw('IN')) { next(); l = { t: 'in', l, r: parseConcat() }; continue; }
      return l;
    }
  }
  function parseConcat() {
    let l = parseAdd();
    while (isOp('&')) { next(); l = { t: 'bin', op: '&', l, r: parseAdd() }; }
    return l;
  }
  function parseAdd() {
    let l = parseMul();
    while (isOp('+') || isOp('-')) { const op = next().v; l = { t: 'bin', op, l, r: parseMul() }; }
    return l;
  }
  function parseMul() {
    let l = parseUnary();
    while (isOp('*') || isOp('/')) { const op = next().v; l = { t: 'bin', op, l, r: parseUnary() }; }
    return l;
  }
  function parseUnary() {
    if (isOp('-')) { next(); return { t: 'neg', e: parseUnary() }; }
    if (isOp('+')) { next(); return parseUnary(); }
    if (isKw('NOT')) { next(); return { t: 'call', fn: 'NOT', args: [parseUnary()] }; }
    return parsePostfix();
  }
  function parsePostfix() {
    const e = parsePrimary();
    if (isOp('^')) { next(); return { t: 'bin', op: '^', l: e, r: parseUnary() }; }
    return e;
  }
  function parsePrimary() {
    const tk = next();
    if (!tk) throw new Error('Unexpected end of DAX');
    if (tk.t === 'num') return { t: 'num', v: tk.v };
    if (tk.t === 'str') return { t: 'str', v: tk.v };
    if (tk.t === 'bracket') return { t: 'measure', name: tk.v };
    if (tk.t === 'table') {
      if (peek() && peek().t === 'bracket') { const b = next(); return { t: 'col', table: tk.v, column: b.v }; }
      return { t: 'var', name: tk.v };
    }
    if (tk.t === 'op' && tk.v === '(') { const e = parseTop(); expect(')'); return e; }
    if (tk.t === 'op' && tk.v === '{') {
      const items = [];
      if (!isOp('}')) { items.push(parseOr()); while (isOp(',')) { next(); items.push(parseOr()); } }
      expect('}');
      return { t: 'list', items };
    }
    if (tk.t === 'ident') {
      if (peek() && peek().t === 'bracket') { const b = next(); return { t: 'col', table: tk.v, column: b.v }; }
      if (isOp('(')) {
        next();
        const args = [];
        if (!isOp(')')) { args.push(parseTop()); while (isOp(',')) { next(); args.push(parseTop()); } }
        expect(')');
        return { t: 'call', fn: tk.v.toUpperCase(), args };
      }
      const up = tk.v.toUpperCase();
      if (up === 'TRUE' || up === 'FALSE') return { t: 'bool', v: up === 'TRUE' };
      return { t: 'var', name: tk.v };
    }
    throw new Error(`Unexpected token "${tk.v}" in DAX`);
  }
  const ast = parseTop();
  if (p < toks.length) throw new Error(`Unexpected "${toks[p].v}" after expression`);
  return ast;
}

// --------------------------------------------------------------- translator

const AGG_FUNCTIONS = {
  SUM: 'sum', AVERAGE: 'avg', MIN: 'min', MAX: 'max',
  COUNT: 'count', COUNTA: 'count', COUNTROWS: 'count', DISTINCTCOUNT: 'count_distinct',
};
const TIME_FUNCTIONS = {
  SAMEPERIODLASTYEAR: 'n1', PREVIOUSYEAR: 'n1', PARALLELPERIOD: 'n1', DATEADD: 'n1',
  DATESYTD: 'ytd', TOTALYTD: 'ytd', STARTOFYEAR: 'ytd', ENDOFYEAR: 'ytd',
  DATESMTD: 'mtd', TOTALMTD: 'mtd', STARTOFMONTH: 'mtd', ENDOFMONTH: 'mtd',
  DATESQTD: 'qtd', TOTALQTD: 'qtd', STARTOFQUARTER: 'qtd',
  PREVIOUSMONTH: 'n1', PREVIOUSDAY: 'n1', PREVIOUSQUARTER: 'n1', DATESBETWEEN: 'time', DATESINPERIOD: 'time',
};
const TEXT_FUNCTIONS = new Set(['FORMAT', 'CONCATENATE', 'LEFT', 'RIGHT', 'MID', 'UPPER', 'LOWER', 'TRIM', 'SUBSTITUTE', 'REPT', 'LEN', 'UNICHAR']);

class Unsupported extends Error {
  constructor(reason, tag) { super(reason); this.tag = tag || 'unsupported'; }
}

const CMP_OPS = { '=': 'eq', '<>': 'neq', '>': 'gt', '>=': 'gte', '<': 'lt', '<=': 'lte' };

function literalValue(node) {
  if (!node) return undefined;
  if (node.t === 'num') return node.v;
  if (node.t === 'str') return node.v;
  if (node.t === 'bool') return node.v;
  if (node.t === 'neg' && node.e && node.e.t === 'num') return -node.e.v;
  if (node.t === 'call' && node.fn === 'BLANK' && node.args.length === 0) return null;
  return undefined;
}

// One CALCULATE filter argument → an OpenReport filter rule, or throws.
function filterRule(node, ctx) {
  if (node.t === 'call' && node.fn === 'KEEPFILTERS' && node.args.length === 1) return filterRule(node.args[0], ctx);
  if (node.t === 'call' && node.fn === 'NOT' && node.args.length === 1) {
    const inner = filterRule(node.args[0], ctx);
    const flip = { eq: 'neq', neq: 'eq', in: 'not_in', not_in: 'in', is_empty: 'is_not_empty', is_not_empty: 'is_empty', gt: 'lte', lte: 'gt', lt: 'gte', gte: 'lt' };
    if (!flip[inner.op]) throw new Unsupported(`cannot negate "${inner.op}" filter`);
    return { ...inner, op: flip[inner.op] };
  }
  if (node.t === 'bin' && node.op === '&&') {
    throw new Unsupported('compound filter (&&) in CALCULATE');
  }
  if (node.t === 'bin' && CMP_OPS[node.op]) {
    let colNode = node.l; let litNode = node.r; let op = CMP_OPS[node.op];
    if (colNode.t !== 'col' && litNode.t === 'col') {
      [colNode, litNode] = [litNode, colNode];
      op = { gt: 'lt', lt: 'gt', gte: 'lte', lte: 'gte' }[op] || op;
    }
    if (colNode.t !== 'col') throw new Unsupported('filter is not "column = value"');
    const value = literalValue(litNode);
    if (value === undefined) throw new Unsupported('filter compares a column to a non-literal');
    const field = ctx.resolveColumn(colNode.table, colNode.column);
    if (!field) throw new Unsupported(`unknown column ${colNode.table}[${colNode.column}] in filter`, 'missing_field');
    if (value === null) return { field: field.dimName, isMeasure: false, op: op === 'eq' ? 'is_empty' : 'is_not_empty', value: '', values: [] };
    if (typeof value === 'boolean') return { field: field.dimName, isMeasure: false, op, value: value ? 'true' : 'false', values: [] };
    return { field: field.dimName, isMeasure: false, op, value: String(value), values: [] };
  }
  if (node.t === 'call' && node.fn === 'ISBLANK' && node.args.length === 1 && node.args[0].t === 'col') {
    const c = node.args[0];
    const field = ctx.resolveColumn(c.table, c.column);
    if (!field) throw new Unsupported(`unknown column ${c.table}[${c.column}] in filter`, 'missing_field');
    return { field: field.dimName, isMeasure: false, op: 'is_empty', value: '', values: [] };
  }
  if (node.t === 'call' && node.fn === 'IN' && node.args.length === 2) return inRule(node.args[0], node.args[1], ctx);
  if (node.t === 'in') return inRule(node.l, node.r, ctx);
  throw new Unsupported('filter is not a simple column condition');
}

function inRule(colNode, listNode, ctx) {
  if (colNode.t !== 'col' || listNode.t !== 'list') throw new Unsupported('IN filter is not "column IN {literals}"');
  const values = listNode.items.map(literalValue);
  if (values.some((v) => v === undefined || v === null)) throw new Unsupported('IN filter with non-literal values');
  const field = ctx.resolveColumn(colNode.table, colNode.column);
  if (!field) throw new Unsupported(`unknown column ${colNode.table}[${colNode.column}] in filter`, 'missing_field');
  return { field: field.dimName, isMeasure: false, op: 'in', value: '', values: values.map(String) };
}

// Translate an AST into one of:
//   { kind: 'agg', aggregation, table, column, filters: [rule], periodShift? }
//   { kind: 'expr', sql, filters: [rule], periodShift? } — custom SQL, may reference ${measures}
//   { kind: 'const', value }
// `periodShift = { dim, unit, n }` is the OpenReport measure attribute: the
// figure over the report's date selection moved n units (see
// utils/sqlBuilder/periodShift.js).
// ctx: { resolveColumn(table, col) → {sqlRef, dimName, table, column} | null,
//        resolveMeasure(name) → { name } | null,
//        helper({agg}) → measure name for a filtered/distinct aggregate that
//        must live as its own measure to be referenced inside an expression,
//        notes: [] }
function translate(ast, ctx, scope = {}) {
  const node = ast;
  switch (node.t) {
    case 'num': return { kind: 'const', value: node.v };
    case 'bool': return { kind: 'const', value: node.v ? 1 : 0 };
    case 'str': throw new Unsupported('text literal', 'text');
    case 'var': {
      if (scope[node.name] === undefined) throw new Unsupported(`unknown identifier ${node.name}`);
      return translate(scope[node.name], ctx, scope);
    }
    case 'let': {
      const inner = { ...scope };
      for (const v of node.vars) inner[v.name] = v.expr;
      return translate(node.body, ctx, inner);
    }
    case 'measure': {
      const m = ctx.resolveMeasure(node.name);
      if (!m) throw new Unsupported(`depends on measure [${node.name}]`, 'dependency');
      return { kind: 'expr', sql: `\${${m.name}}`, filters: [] };
    }
    case 'col': throw new Unsupported('bare column reference outside an aggregate (row context)');
    case 'neg': {
      const e = translate(node.e, ctx, scope);
      if (e.kind === 'const') return { kind: 'const', value: -e.value };
      return { kind: 'expr', sql: `-(${toSql(e, ctx)})`, filters: [] };
    }
    case 'bin': return translateBinary(node, ctx, scope);
    case 'call': return translateCall(node, ctx, scope);
    case 'list': throw new Unsupported('table constructor');
    default: throw new Unsupported(`unsupported construct ${node.t}`);
  }
}

// Inline SQL for a translated node inside a larger expression. Aggregates
// with their own filters (or DISTINCT) cannot be inlined — OpenReport applies
// filterRules to the whole measure — so they become helper measures.
function toSql(res, ctx) {
  if (res.kind === 'const') return res.value === null ? 'NULL' : String(res.value);
  if (res.kind === 'expr') {
    if (res.filters.length || res.periodShift) return `\${${ctx.helper(res)}}`;
    return res.sql;
  }
  if (res.kind === 'agg') {
    if (res.filters.length || res.periodShift || res.aggregation === 'count_distinct') return `\${${ctx.helper(res)}}`;
    return aggSql(res);
  }
  throw new Unsupported('cannot inline');
}

function aggSql(res) {
  const fn = { sum: 'SUM', avg: 'AVG', min: 'MIN', max: 'MAX', count: 'COUNT', count_distinct: 'COUNT' }[res.aggregation];
  if (res.column === '*') return 'COUNT(*)';
  if (res.aggregation === 'count_distinct') return `COUNT(DISTINCT ${res.sqlRef})`;
  return `${fn}(${res.sqlRef})`;
}

function translateBinary(node, ctx, scope) {
  const { op } = node;
  if (op === '&') throw new Unsupported('text concatenation', 'text');
  if (op === '&&' || op === '||' || CMP_OPS[op]) throw new Unsupported('boolean expression outside CALCULATE', 'logic');
  const l = translate(node.l, ctx, scope);
  const r = translate(node.r, ctx, scope);
  if (l.kind === 'const' && r.kind === 'const') {
    const a = l.value; const b = r.value;
    const v = op === '+' ? a + b : op === '-' ? a - b : op === '*' ? a * b : op === '^' ? a ** b : (b === 0 ? null : a / b);
    return { kind: 'const', value: v };
  }
  if (op === '^') throw new Unsupported('exponent');
  const ls = toSql(l, ctx); const rs = toSql(r, ctx);
  if (op === '/') return { kind: 'expr', sql: r.kind === 'const' ? `(${ls}) / ${rs}` : `(${ls}) / NULLIF((${rs}), 0)`, filters: [] };
  return { kind: 'expr', sql: `(${ls}) ${op} (${rs})`, filters: [] };
}

const SHIFT_UNITS = { YEAR: 'year', QUARTER: 'quarter', MONTH: 'month', DAY: 'day' };
const PREVIOUS_UNIT = { PREVIOUSYEAR: 'year', PREVIOUSQUARTER: 'quarter', PREVIOUSMONTH: 'month', PREVIOUSDAY: 'day' };

// A CALCULATE argument that moves the date selection → { dim, unit, n }.
// SAMEPERIODLASTYEAR and DATEADD are exactly that. PREVIOUSYEAR / MONTH /
// … and PARALLELPERIOD are the WHOLE previous period; read as the selection
// moved by one period, which is the same figure whenever the selection is a
// whole period — the usual case with a year or month slicer — and noted.
function periodShiftArg(node, ctx) {
  const { fn, args } = node;
  const dateDim = (a) => {
    if (!a || a.t !== 'col') throw new Unsupported(`${fn} over an expression`, 'n1');
    const field = ctx.resolveColumn(a.table, a.column);
    if (!field) throw new Unsupported(`unknown column ${a.table}[${a.column}] in ${fn}`, 'missing_field');
    return field.dimName;
  };
  if (fn === 'SAMEPERIODLASTYEAR' && args.length === 1) return { dim: dateDim(args[0]), unit: 'year', n: -1 };
  if (PREVIOUS_UNIT[fn] && args.length === 1) {
    const unit = PREVIOUS_UNIT[fn];
    ctx.notes.push(`${fn} read as the selection moved one ${unit} back (identical when the selection is a whole ${unit})`);
    return { dim: dateDim(args[0]), unit, n: -1 };
  }
  if ((fn === 'DATEADD' || fn === 'PARALLELPERIOD') && args.length === 3) {
    const n = literalValue(args[1]);
    const unit = args[2] && args[2].t === 'var' ? SHIFT_UNITS[args[2].name.toUpperCase()] : null;
    if (!Number.isInteger(n) || n === 0) throw new Unsupported(`${fn} with a non-literal or zero interval`, 'n1');
    if (!unit) throw new Unsupported(`${fn} with an unknown interval unit`, 'n1');
    if (fn === 'PARALLELPERIOD') ctx.notes.push(`PARALLELPERIOD read as the selection moved ${n} ${unit}(s) (identical when the selection is a whole ${unit})`);
    return { dim: dateDim(args[0]), unit, n };
  }
  throw new Unsupported(`time intelligence (${fn})`, 'n1');
}

function translateCall(node, ctx, scope) {
  const fn = node.fn;
  const args = node.args;
  if (AGG_FUNCTIONS[fn]) {
    if (args.length !== 1) throw new Unsupported(`${fn} with ${args.length} arguments`);
    const a = args[0];
    if (fn === 'COUNTROWS') {
      if (a.t !== 'var') throw new Unsupported('COUNTROWS over an expression');
      const table = ctx.resolveTable(a.name);
      if (!table) throw new Unsupported(`unknown table ${a.name}`, 'missing_field');
      return { kind: 'agg', aggregation: 'count', table: table.table, column: '*', sqlRef: null, filters: [] };
    }
    if (a.t !== 'col') throw new Unsupported(`${fn} over an expression (iterator needed)`);
    const field = ctx.resolveColumn(a.table, a.column);
    if (!field) throw new Unsupported(`unknown column ${a.table}[${a.column}]`, 'missing_field');
    return { kind: 'agg', aggregation: AGG_FUNCTIONS[fn], table: field.table, column: field.column, sqlRef: field.sqlRef, dataType: field.dataType, filters: [] };
  }
  if (fn === 'CALCULATE') {
    if (args.length < 1) throw new Unsupported('empty CALCULATE');
    const base = translate(args[0], ctx, scope);
    const rules = [];
    let shift = null;
    for (const f of args.slice(1)) {
      if (f.t === 'call' && TIME_FUNCTIONS[f.fn] === 'n1') {
        if (shift) throw new Unsupported('two period shifts in one CALCULATE', 'n1');
        shift = periodShiftArg(f, ctx);
        continue;
      }
      if (f.t === 'call' && TIME_FUNCTIONS[f.fn]) throw new Unsupported(`time intelligence (${f.fn})`, TIME_FUNCTIONS[f.fn]);
      if (f.t === 'call' && ['ALL', 'ALLEXCEPT', 'ALLSELECTED', 'REMOVEFILTERS', 'FILTER', 'CROSSFILTER', 'USERELATIONSHIP', 'TREATAS', 'VALUES', 'SUMMARIZE', 'CALCULATETABLE'].includes(f.fn)) {
        throw new Unsupported(`filter-context function ${f.fn}`, 'context');
      }
      rules.push(filterRule(f, ctx));
    }
    if (base.kind === 'const') return base;
    if (shift && base.periodShift) throw new Unsupported('a period shift over a shifted measure', 'n1');
    return { ...base, filters: [...base.filters, ...rules], ...(shift ? { periodShift: shift } : {}) };
  }
  if (fn === 'DIVIDE') {
    if (args.length < 2) throw new Unsupported('DIVIDE needs two arguments');
    const a = translate(args[0], ctx, scope);
    const b = translate(args[1], ctx, scope);
    const alt = args[2] ? literalValue(args[2]) : undefined;
    const core = `(${toSql(a, ctx)}) / NULLIF((${toSql(b, ctx)}), 0)`;
    if (alt !== undefined && alt !== null) return { kind: 'expr', sql: `COALESCE(${core}, ${alt})`, filters: [] };
    return { kind: 'expr', sql: core, filters: [] };
  }
  if (fn === 'COALESCE' && args.length >= 1) {
    const rest = args.slice(1);
    if (rest.every((r) => literalValue(r) !== undefined)) {
      if (rest.some((r) => typeof literalValue(r) === 'string')) ctx.notes.push('blank shown as text in Power BI; OpenReport shows an empty value instead');
      return translate(args[0], ctx, scope);
    }
    throw new Unsupported('COALESCE between expressions');
  }
  if (fn === 'IF' && args.length === 3) {
    const cond = args[0];
    const isBlankOf = (c) => (c.t === 'call' && c.fn === 'ISBLANK' && c.args.length === 1) ? c.args[0] : null;
    const tested = isBlankOf(cond);
    if (tested) {
      const thenLit = literalValue(args[1]);
      if (thenLit !== undefined) {
        ctx.notes.push('blank fallback in IF(ISBLANK(…)) ignored');
        return translate(args[2], ctx, scope);
      }
    }
    throw new Unsupported('conditional (IF) measure', 'logic');
  }
  if (fn === 'BLANK' && args.length === 0) return { kind: 'const', value: null };
  if (fn === 'ROUND' && args.length === 2 && literalValue(args[1]) !== undefined) {
    const a = translate(args[0], ctx, scope);
    return { kind: 'expr', sql: `ROUND((${toSql(a, ctx)}), ${literalValue(args[1])})`, filters: [] };
  }
  if (fn === 'ABS' && args.length === 1) {
    const a = translate(args[0], ctx, scope);
    return { kind: 'expr', sql: `ABS(${toSql(a, ctx)})`, filters: [] };
  }
  if (TIME_FUNCTIONS[fn]) throw new Unsupported(`time intelligence (${fn})`, TIME_FUNCTIONS[fn]);
  if (TEXT_FUNCTIONS.has(fn)) throw new Unsupported(`text function ${fn}`, 'text');
  if (['SUMX', 'AVERAGEX', 'MINX', 'MAXX', 'COUNTX', 'MEDIANX', 'RANKX', 'FILTER', 'SUMMARIZE', 'ADDCOLUMNS'].includes(fn)) {
    throw new Unsupported(`iterator ${fn}`, 'iterator');
  }
  if (['SELECTEDVALUE', 'HASONEVALUE', 'ISINSCOPE', 'ISFILTERED', 'USERNAME', 'USERPRINCIPALNAME', 'TODAY', 'NOW'].includes(fn)) {
    throw new Unsupported(`context function ${fn}`, 'context');
  }
  throw new Unsupported(`function ${fn}`);
}

// Which time-intelligence flavour a DAX text uses, if any — used to point the
// author at OpenReport's native N-1 / MTD / YTD instead of a translation.
function detectTimeIntelligence(src) {
  const found = new Set();
  const re = /\b([A-Z]+)\s*\(/gi;
  let m;
  while ((m = re.exec(String(src || ''))) !== null) {
    const tag = TIME_FUNCTIONS[m[1].toUpperCase()];
    if (tag) found.add(tag);
  }
  return [...found];
}

function translateDax(src, ctx) {
  let ast;
  try {
    ast = parseDax(src);
  } catch (e) {
    return { ok: false, reason: `unparseable: ${e.message}`, tag: 'parse', notes: [] };
  }
  return translateDaxAst(ast, ctx);
}

function translateDaxAst(ast, ctx) {
  const notes = [];
  const localCtx = { ...ctx, notes };
  try {
    const res = translate(ast, localCtx);
    return { ok: true, result: res, notes };
  } catch (e) {
    if (e instanceof Unsupported) return { ok: false, reason: e.message, tag: e.tag, notes };
    return { ok: false, reason: e.message, tag: 'error', notes };
  }
}

// ------------------------------------------------------- calculated columns
// A calculated column is DAX evaluated once per ROW, with no aggregation:
// arithmetic, MOD / INT / ROUND / ABS / DIVIDE, IF over comparisons, and the
// columns of its own table. That maps onto an OpenReport calculated dimension,
// one SQL expression over the row. `ctx.table` is the column's own table
// (a bare [col] means that table's column) and `ctx.resolveColumn` gives the
// SQL reference of a column, including calculated ones registered before.

const ROW_CMP = { '=': '=', '<>': '<>', '>': '>', '>=': '>=', '<': '<', '<=': '<=' };

function translateRowDax(src, ctx) {
  let ast;
  try { ast = parseDax(src); } catch (e) { return { ok: false, reason: `unparseable: ${e.message}` }; }
  const col = (table, column) => {
    const f = ctx.resolveColumn(table || ctx.table, column);
    if (!f) throw new Unsupported(`unknown column ${table || ctx.table}[${column}]`, 'missing_field');
    return f.sqlRef;
  };
  const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;
  const row = (node, scope) => {
    switch (node.t) {
      case 'num': return String(node.v);
      case 'bool': return node.v ? '1' : '0';
      case 'str': return lit(node.v);
      case 'var': {
        if (node.name in scope) return scope[node.name];
        throw new Unsupported(`unknown name ${node.name}`);
      }
      case 'let': {
        const inner = { ...scope };
        for (const v of node.vars) inner[v.name] = row(v.expr, inner);
        return row(node.body, inner);
      }
      // [col] with no table inside a calculated column is a column of its own table.
      case 'measure': return col(null, node.name);
      case 'col': return col(node.table, node.column);
      case 'neg': return `(-(${row(node.e, scope)}))`;
      case 'bin': {
        const { op } = node;
        if (op === '&') throw new Unsupported('text concatenation', 'text');
        if (op === '^') return `POWER((${row(node.l, scope)}), (${row(node.r, scope)}))`;
        if (op === '&&') return `((${row(node.l, scope)}) AND (${row(node.r, scope)}))`;
        if (op === '||') return `((${row(node.l, scope)}) OR (${row(node.r, scope)}))`;
        if (ROW_CMP[op]) return `((${row(node.l, scope)}) ${ROW_CMP[op]} (${row(node.r, scope)}))`;
        if (op === '/') return `((${row(node.l, scope)}) / NULLIF((${row(node.r, scope)}), 0))`;
        return `((${row(node.l, scope)}) ${op} (${row(node.r, scope)}))`;
      }
      case 'call': return call(node, scope);
      default: throw new Unsupported(`unsupported construct ${node.t}`);
    }
  };
  const call = (node, scope) => {
    const { fn, args } = node;
    const a = (i) => row(args[i], scope);
    if (fn === 'MOD' && args.length === 2) return `MOD((${a(0)}), (${a(1)}))`;
    if ((fn === 'INT' || fn === 'TRUNC' || fn === 'ROUNDDOWN') && args.length >= 1) return `FLOOR(${a(0)})`;
    if (fn === 'ROUND' && args.length === 2) return `ROUND((${a(0)}), (${a(1)}))`;
    if (fn === 'ROUND' && args.length === 1) return `ROUND(${a(0)})`;
    if (fn === 'ABS' && args.length === 1) return `ABS(${a(0)})`;
    if (fn === 'DIVIDE' && args.length >= 2) {
      const core = `((${a(0)}) / NULLIF((${a(1)}), 0))`;
      return args[2] ? `COALESCE(${core}, ${a(2)})` : core;
    }
    if (fn === 'COALESCE' && args.length >= 1) return `COALESCE(${args.map((_, i) => a(i)).join(', ')})`;
    if (fn === 'IF' && (args.length === 2 || args.length === 3)) return `CASE WHEN ${a(0)} THEN ${a(1)} ELSE ${args[2] ? a(2) : 'NULL'} END`;
    if (fn === 'ISBLANK' && args.length === 1) return `((${a(0)}) IS NULL)`;
    if (fn === 'NOT' && args.length === 1) return `(NOT (${a(0)}))`;
    if (fn === 'AND' && args.length === 2) return `((${a(0)}) AND (${a(1)}))`;
    if (fn === 'OR' && args.length === 2) return `((${a(0)}) OR (${a(1)}))`;
    if (fn === 'BLANK' && args.length === 0) return 'NULL';
    if ((fn === 'TRUE' || fn === 'FALSE') && args.length === 0) return fn;
    if ((fn === 'YEAR' || fn === 'MONTH' || fn === 'DAY') && args.length === 1) return `EXTRACT(${fn} FROM ${a(0)})`;
    if (TEXT_FUNCTIONS.has(fn)) throw new Unsupported(`text function ${fn}`, 'text');
    if (AGG_FUNCTIONS[fn] || fn === 'CALCULATE') throw new Unsupported(`${fn} in a calculated column (needs a row context OpenReport does not have)`, 'context');
    throw new Unsupported(`function ${fn}`);
  };
  try {
    return { ok: true, sql: row(ast, {}) };
  } catch (e) {
    if (e instanceof Unsupported) return { ok: false, reason: e.message, tag: e.tag };
    return { ok: false, reason: e.message, tag: 'error' };
  }
}

// ------------------------------------------------------------- evolution
// "(X - Y) / X" or "(X - Y) / Y", however it is wrapped (IF, FORMAT, VAR):
// the change of a measure against another. The caller checks that Y is X
// shifted to the previous period; here only the shape is read.
// → { current, previous, divideBy: 'current' | 'previous' } as AST nodes, or null.
function findEvolution(ast) {
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const walk = (node, scope) => {
    if (!node || typeof node !== 'object') return null;
    if (node.t === 'let') {
      const inner = { ...scope };
      for (const v of node.vars) inner[v.name] = resolve(v.expr, inner);
      return walk(resolve(node.body, inner), inner);
    }
    const isDivide = node.t === 'call' && node.fn === 'DIVIDE' && node.args.length >= 2;
    if ((node.t === 'bin' && node.op === '/') || isDivide) {
      const num = resolve(isDivide ? node.args[0] : node.l, scope);
      const den = resolve(isDivide ? node.args[1] : node.r, scope);
      if (num.t === 'bin' && num.op === '-') {
        const cur = resolve(num.l, scope); const prev = resolve(num.r, scope);
        if (same(den, cur)) return { current: cur, previous: prev, divideBy: 'current' };
        if (same(den, prev)) return { current: cur, previous: prev, divideBy: 'previous' };
      }
    }
    const kids = node.t === 'call' ? node.args : node.t === 'bin' ? [node.l, node.r] : node.t === 'neg' ? [node.e] : [];
    for (const k of kids) { const r = walk(resolve(k, scope), scope); if (r) return r; }
    return null;
  };
  // A name bound by VAR stands for its expression.
  const resolve = (node, scope) => (node && node.t === 'var' && node.name in scope ? resolve(scope[node.name], scope) : node);
  return walk(ast, {});
}

// A column built as SELECTEDVALUE(T[c], "placeholder") — with or without a
// HASONEVALUE guard — is a slicer trick: it shows the selection, or a caption
// when there is none. The field behind it is T[c]. → { table, column } or null.
function selectedValueAlias(src) {
  let ast;
  try { ast = parseDax(src); } catch { /* not DAX we read */ return null; }
  let found = null;
  const walk = (node) => {
    if (found || !node || typeof node !== 'object') return;
    if (node.t === 'call' && node.fn === 'SELECTEDVALUE' && node.args[0] && node.args[0].t === 'col') { found = { table: node.args[0].table, column: node.args[0].column }; return; }
    if (node.t === 'let') { node.vars.forEach((v) => walk(v.expr)); walk(node.body); return; }
    if (node.t === 'call') node.args.forEach(walk);
    else if (node.t === 'bin') { walk(node.l); walk(node.r); }
    else if (node.t === 'neg') walk(node.e);
  };
  walk(ast);
  return found;
}

module.exports = { parseDax, translateDax, translateDaxAst, translateRowDax, findEvolution, selectedValueAlias, detectTimeIntelligence, aggSql, Unsupported, TIME_FUNCTIONS };
