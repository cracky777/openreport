// A measure's SQL as the query compiler writes it — never a second compiler.
//
// The measure is compiled alone by this server's own /query, over loopback and
// AS THE CALLER (their model access, their RLS), with `metadataCompile`: SQL
// only, no row, no connection to the source (routes/models.js). From the
// statement it returns, the measure's own expression is cut out of the SELECT
// list by its alias. A measure whose meaning needs a query around it — a
// window over periods, a period shift, a read across two facts — keeps the
// statement and says why, rather than handing out an expression that would
// read wrong on its own.

const internalToken = require('../internalToken');
const { quoteAlias } = require('../sqlDialect');

const CACHE_MAX = 2000;
const cache = new Map();

// How /query is reached: over loopback in the server; a test points it at its
// in-process app.
const transport = { fire: loopbackFire };

async function loopbackFire({ user, orgId, modelId, body }) {
  const token = internalToken.sign({ userId: user.id, organizationId: orgId || null });
  const res = await fetch(`${internalToken.appBase()}/api/models/${modelId}/query`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', [internalToken.HEADER]: token },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error((json && json.error) || `compile failed (${res.status})`);
  return json;
}

// Opening quote → closing one: strings, and identifiers in every dialect's
// quoting (SQL Server's [brackets] included).
const QUOTES = { "'": "'", '"': '"', '`': '`', '[': ']' };

// The top-level pieces of a SELECT list, quotes and parentheses respected,
// and what follows its FROM ('' when the statement has none).
function selectParts(sql) {
  const s = String(sql || '').trim();
  if (!/^SELECT\s/i.test(s)) return null;
  const items = [];
  let depth = 0;
  let quote = null;
  let start = 7;
  let i = 7;
  for (; i < s.length; i++) {
    const ch = s[i];
    if (quote) { if (ch === quote) quote = null; continue; }
    if (QUOTES[ch]) { quote = QUOTES[ch]; continue; }
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (depth === 0 && ch === ',') { items.push(s.slice(start, i).trim()); start = i + 1; }
    else if (depth === 0 && /\s/.test(s[i - 1]) && /^FROM\s/i.test(s.slice(i, i + 5))) break;
  }
  items.push(s.slice(start, i).trim());
  return { items, from: s.slice(i).replace(/^FROM\s+/i, '') };
}

// The measure's expression in the statement, by its alias; null when the
// statement is not a plain SELECT over the model's tables.
function measureExpression(sql, label, dbType) {
  const parts = selectParts(sql);
  if (!parts || parts.from.startsWith('(')) return null;
  const suffix = ` AS ${quoteAlias(label, dbType)}`;
  const item = parts.items.find((x) => x.endsWith(suffix));
  if (!item) return null;
  const expr = item.slice(0, -suffix.length).trim();
  return expr.startsWith('(') && expr.endsWith(')') && balanced(expr.slice(1, -1)) ? expr.slice(1, -1) : expr;
}

function balanced(s) {
  let depth = 0;
  let quote = null;
  for (const ch of s) {
    if (quote) { if (ch === quote) quote = null; continue; }
    if (QUOTES[ch]) quote = QUOTES[ch];
    else if (ch === '(') depth++;
    else if (ch === ')' && --depth < 0) return false;
  }
  return depth === 0;
}

// Why a measure only means something inside a query, read from it and the
// measures it references (none: standalone).
const SCOPES = [
  ['runningTotal', 'window', 'A running total: a window over the periods of the query it is drawn in.'],
  ['periodShift', 'period_shift', 'Read on a period moved back: it follows the date filters of the query it is drawn in.'],
  ['perPeriod', 'per_period', 'A value given per period, read once per period and item the rows reach.'],
];
function scopeOf(measure, refs) {
  for (const [key, scope, why] of SCOPES) {
    if ([measure, ...refs].some((m) => m && m[key])) return { scope, why };
  }
  return null;
}

/**
 * @param {object} p
 * @param {object} p.user, p.orgId        who compiles (the token's owner)
 * @param {object} p.model                parsed model row
 * @param {object} p.measure              the measure, overrides applied (its label is its alias)
 * @param {object[]} p.refs               the measures it reaches (lineage.dependsOn, resolved)
 * @param {string} p.dbType               the source's dialect
 * @param {object} [p.report]             the report whose own measures and overrides apply
 * @param {boolean} p.canCompileReportSql whether /query compiles a report's SQL measures for this caller
 * @param {string} p.version              changes when what the SQL depends on changes (cache key)
 */
async function compileMeasure(p, deps = {}) {
  const { user, orgId, model, measure, refs = [], dbType, report = null, canCompileReportSql, version } = p;
  const key = [user.id, model.id, report ? report.id : '', measure.name, version].join('\u0000');
  if (cache.has(key)) return cache.get(key);

  const freeSql = (m) => m && m._source === 'report' && (m.aggregation === 'custom' || typeof m.expression === 'string');
  let out;
  if (!canCompileReportSql && [measure, ...refs].some(freeSql)) {
    // /query never runs a report's own SQL for someone who could not write it
    // on the model (an RLS bypass otherwise): there is nothing true to show.
    out = { compiled_sql: null, compiled_sql_scope: 'needs_model_editor', compiled_sql_note: 'A SQL measure of the report: compiled only for an editor of the model\'s workspace.' };
  } else {
    let json;
    try {
      json = await (deps.fire || transport.fire)({
        user,
        orgId,
        modelId: model.id,
        body: {
          dimensionNames: [],
          measureNames: [measure.name],
          sqlOnly: true,
          metadataCompile: true,
          ...(report ? { reportId: report.id, ...report.extras } : {}),
        },
      });
    } catch (err) {
      json = { error: err.message };
    }
    out = shape(json, measure, refs, dbType, model);
  }
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, out);
  return out;
}

function shape(json, measure, refs, dbType, model) {
  if (!json || json.error || typeof json.sql !== 'string') {
    return { compiled_sql: null, compiled_sql_scope: 'not_compiled', compiled_sql_note: String((json && json.error) || 'The compiler returned no SQL').slice(0, 300) };
  }
  // Row-level security writes the caller's own allowed keys into the query:
  // neither the statement nor an expression carrying a sub-query goes out.
  const rls = !!(model.rls && model.rls.enabled);
  const label = measure.label || measure.name;
  const expr = measureExpression(json.sql, label, dbType);
  const special = scopeOf(measure, refs);
  const query = rls ? {} : { compiled_query: json.sql };
  if (special) return { compiled_sql: null, compiled_sql_scope: special.scope, compiled_sql_note: special.why, ...query };
  if (expr === null) {
    return { compiled_sql: null, compiled_sql_scope: 'multi_fact', compiled_sql_note: 'Read across several facts: each is aggregated in its own sub-query, joined on the grain.', ...query };
  }
  if (rls && /\bSELECT\b/i.test(expr)) {
    return { compiled_sql: null, compiled_sql_scope: 'rls_dependent', compiled_sql_note: 'Its SQL carries the reader\'s row-level security.' };
  }
  return { compiled_sql: expr, compiled_sql_scope: 'standalone', ...query };
}

module.exports = { compileMeasure, measureExpression, selectParts, transport, _cache: cache };
