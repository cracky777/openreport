// Client-side SQL synthesis for the measure wizard / edit panel.
// Originally lived inline at the bottom of DataPanel.jsx — extracted as a
// pure utility (no React) so the wizard hook and the field-edit hook can
// share it without circular imports back into the panel module.

// Paren-aware aggregate transform — client port of the server helper.
// Walks the expression and applies `transform(fn, arg)` to each top-level
// SUM/AVG/MIN/MAX/COUNT call, tracking paren depth and string literals so
// a CASE WHEN containing `IN (...)` doesn't break the matcher.
export function transformAggregates(expression, fns, transform) {
  if (!expression) return expression;
  const s = String(expression);
  const fnRegex = new RegExp(`^(${fns.join('|')})\\(`, 'i');
  let out = '';
  let i = 0;
  while (i < s.length) {
    if (s[i] === "'") {
      const end = s.indexOf("'", i + 1);
      if (end === -1) { out += s.slice(i); break; }
      out += s.slice(i, end + 1);
      i = end + 1;
      continue;
    }
    const prev = i > 0 ? s[i - 1] : '';
    const atBoundary = !/[A-Za-z0-9_]/.test(prev);
    const m = atBoundary ? s.slice(i).match(fnRegex) : null;
    if (!m) { out += s[i]; i++; continue; }
    const fn = m[1];
    let depth = 1;
    let j = i + m[0].length;
    let inStr = false;
    while (j < s.length && depth > 0) {
      const ch = s[j];
      if (inStr) {
        if (ch === "'") inStr = false;
      } else if (ch === "'") {
        inStr = true;
      } else if (ch === '(') {
        depth++;
      } else if (ch === ')') {
        depth--;
        if (depth === 0) break;
      }
      j++;
    }
    if (depth !== 0) { out += s[i]; i++; continue; }
    const arg = s.slice(i + m[0].length, j);
    out += transform(fn, arg);
    i = j + 1;
  }
  return out;
}

// Synthesize the SQL of a measure from its structured fields. Used by the
// wizard to keep the SQL editor in sync with the user's choices. The
// expression always comes through here so the user actually SEES what the
// server will run — including the CASE WHEN wrap when a filter is active,
// even for custom-expression measures.
export function buildMeasureSql({ aggregation, table, column, filterRules, overrideFilters, expression }) {
  const hasFilter = Array.isArray(filterRules) && filterRules.length > 0;
  const fmtVal = (v) => {
    if (v == null) return 'NULL';
    if (Array.isArray(v)) return v.map(fmtVal).join(', ');
    if (typeof v === 'number' || /^-?\d+(\.\d+)?$/.test(String(v))) return String(v);
    return `'${String(v).replace(/'/g, "''")}'`;
  };
  const renderRule = (r) => {
    if (!r || !r.field || !r.op) return null;
    // Field may be a dotted identifier ("schema.table.column"). Quote each
    // segment separately so Postgres sees three identifiers, not one weird
    // name. Mirrors server-side `quoteCol` (server/utils/sqlDialect.js).
    const f = String(r.field).split('.').map((p) => `"${p.replace(/"/g, '""')}"`).join('.');
    const list = Array.isArray(r.values) ? r.values : (Array.isArray(r.value) ? r.value : null);
    switch (r.op) {
      case 'in': return list?.length ? `${f} IN (${list.map(fmtVal).join(', ')})` : null;
      case 'not_in': return list?.length ? `${f} NOT IN (${list.map(fmtVal).join(', ')})` : null;
      case 'eq': return `${f} = ${fmtVal(r.value)}`;
      case 'neq': return `${f} <> ${fmtVal(r.value)}`;
      case 'gt': return `${f} > ${fmtVal(r.value)}`;
      case 'gte': return `${f} >= ${fmtVal(r.value)}`;
      case 'lt': return `${f} < ${fmtVal(r.value)}`;
      case 'lte': return `${f} <= ${fmtVal(r.value)}`;
      case 'between': return list?.length === 2 ? `${f} BETWEEN ${fmtVal(list[0])} AND ${fmtVal(list[1])}` : null;
      case 'contains': return `${f} LIKE '%${String(r.value).replace(/'/g, "''")}%'`;
      case 'not_contains': return `${f} NOT LIKE '%${String(r.value).replace(/'/g, "''")}%'`;
      case 'starts_with': return `${f} LIKE '${String(r.value).replace(/'/g, "''")}%'`;
      case 'ends_with': return `${f} LIKE '%${String(r.value).replace(/'/g, "''")}'`;
      case 'is_empty': return `(${f} IS NULL OR ${f} = '')`;
      case 'is_not_empty': return `(${f} IS NOT NULL AND ${f} <> '')`;
      default: return null;
    }
  };
  const whenSql = hasFilter ? filterRules.map(renderRule).filter(Boolean).join(' AND ') : '';

  // Custom expression: optionally wrap each aggregate inside the expression
  // with CASE WHEN — same shape as what the server's transformAggregates
  // produces at query time.
  if (aggregation === 'custom') {
    const bare = expression || '';
    if (hasFilter && whenSql && !overrideFilters) {
      return transformAggregates(
        bare,
        ['SUM', 'AVG', 'MIN', 'MAX', 'COUNT'],
        (fn, arg) => `${fn}(CASE WHEN ${whenSql} THEN ${arg} END)`,
      );
    }
    if (hasFilter && whenSql && overrideFilters) {
      return `(SELECT ${bare}\n FROM <model>\n WHERE <visual filters except override fields>\n   AND ${whenSql})`;
    }
    return bare;
  }
  // Structured path: synthesize <AGG>(col) or <AGG>(CASE WHEN ... THEN col END)
  const isCount = aggregation === 'count' || (column === '*' && !table);
  const colExpr = isCount ? null : (table && column ? `"${table}"."${column}"` : null);
  const aggFn = isCount ? 'COUNT' : (aggregation || 'sum').toUpperCase();
  const baseAgg = isCount ? 'COUNT(*)' : `${aggFn}(${colExpr || 'col'})`;
  if (!hasFilter || !whenSql) return baseAgg;
  if (overrideFilters) {
    return `(SELECT ${baseAgg}\n FROM <model>\n WHERE <visual filters except override fields>\n   AND ${whenSql})`;
  }
  const inner = isCount ? '1' : colExpr;
  return `${aggFn}(CASE WHEN ${whenSql}\n     THEN ${inner} END)`;
}
