// Reads just enough of a Power Query (M) partition expression to know where a
// table comes from: the connector call, the schema/table it navigates to, and
// whether anything beyond column selection/renaming happens on the way. The
// import deliberately does NOT translate transformations — a table that is
// filtered, grouped or merged in Power Query is imported raw and flagged.

// Split `s` on `sep` occurring at nesting depth 0, ignoring string literals.
function splitTopLevel(s, sep) {
  const parts = [];
  let depth = 0;
  let inStr = false;
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      cur += ch;
      if (ch === '"') {
        if (s[i + 1] === '"') { cur += '"'; i++; } else inStr = false;
      }
      continue;
    }
    if (ch === '"') { inStr = true; cur += ch; continue; }
    if (ch === '(' || ch === '{' || ch === '[') depth++;
    else if (ch === ')' || ch === '}' || ch === ']') depth--;
    if (ch === sep && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

function stripComments(s) {
  let out = '';
  let inStr = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      out += ch;
      if (ch === '"') { if (s[i + 1] === '"') { out += '"'; i++; } else inStr = false; }
      continue;
    }
    if (ch === '"') { inStr = true; out += ch; continue; }
    if (ch === '/' && s[i + 1] === '/') { while (i < s.length && s[i] !== '\n') i++; out += '\n'; continue; }
    if (ch === '/' && s[i + 1] === '*') { i += 2; while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) i++; i++; continue; }
    out += ch;
  }
  return out;
}

const unquote = (lit) => String(lit).trim().replace(/^"|"$/g, '').replace(/""/g, '"');

// {"a", "b"} → ['a', 'b']
function parseStringList(s) {
  const m = String(s).trim().match(/^\{([\s\S]*)\}$/);
  if (!m) return null;
  return splitTopLevel(m[1], ',').map((x) => x.trim()).filter(Boolean).map(unquote);
}

// {{"old", "new"}, ...} → [['old','new'], ...]
function parsePairList(s) {
  const m = String(s).trim().match(/^\{([\s\S]*)\}$/);
  if (!m) return null;
  return splitTopLevel(m[1], ',').map((p) => parseStringList(p.trim())).filter((p) => p && p.length === 2);
}

// Identifier at the start of an expression: `Source`, `#"Colonnes renommées"`.
function readIdentifier(s) {
  const t = s.trim();
  const m = t.match(/^#"((?:[^"]|"")*)"/) || t.match(/^([A-Za-z_][\w.]*)/);
  return m ? { name: m[1].replace(/""/g, '"'), rest: t.slice(m[0].length) } : null;
}

// `Fn.Name(arg, arg, ...)` → { fn, args } for a call at the start of s.
function readCall(s) {
  const t = s.trim();
  const m = t.match(/^([A-Za-z_][\w.]*)\s*\(/);
  if (!m) return null;
  const open = m[0].length - 1;
  let depth = 0;
  let inStr = false;
  for (let i = open; i < t.length; i++) {
    const ch = t[i];
    if (inStr) { if (ch === '"') { if (t[i + 1] === '"') i++; else inStr = false; } continue; }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '(' || ch === '{' || ch === '[') depth++;
    else if (ch === ')' || ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) {
        return { fn: m[1], args: splitTopLevel(t.slice(open + 1, i), ',').map((a) => a.trim()), rest: t.slice(i + 1) };
      }
    }
  }
  return null;
}

// Record navigation `X{[Schema="s",Item="t"]}[Data]` → { on: 'X', keys: {Schema, Item}, field: 'Data' }
function readNavigation(s) {
  const id = readIdentifier(s);
  if (!id) return null;
  const m = id.rest.match(/^\s*\{\s*\[([^\]]*)\]\s*\}\s*(?:\[(\w+)\])?\s*$/);
  if (!m) return null;
  const keys = {};
  for (const kv of splitTopLevel(m[1], ',')) {
    const km = kv.trim().match(/^(\w+)\s*=\s*([\s\S]+)$/);
    if (km) keys[km[1]] = unquote(km[2]);
  }
  return { on: id.name, keys, field: m[2] || null };
}

const SOURCE_CALLS = {
  'PostgreSQL.Database': (a) => ({ kind: 'postgres', ...splitHostPort(unquote(a[0]), 5432), database: a[1] ? unquote(a[1]) : null }),
  'Sql.Database': (a) => ({ kind: 'sqlserver', ...splitHostPort(unquote(a[0]), 1433), database: a[1] ? unquote(a[1]) : null }),
  'Sql.Databases': (a) => ({ kind: 'sqlserver', ...splitHostPort(unquote(a[0]), 1433), database: null }),
  'MySQL.Database': (a) => ({ kind: 'mysql', ...splitHostPort(unquote(a[0]), 3306), database: a[1] ? unquote(a[1]) : null }),
  'Oracle.Database': (a) => ({ kind: 'oracle', ...splitHostPort(unquote(a[0]), 1521), database: null }),
  'GoogleBigQuery.Database': () => ({ kind: 'bigquery', host: null, port: null, database: null }),
  'Snowflake.Databases': (a) => ({ kind: 'snowflake', ...splitHostPort(unquote(a[0]), 443), database: null, warehouse: a[1] ? unquote(a[1]) : null }),
  'Databricks.Catalogs': (a) => ({ kind: 'databricks', ...splitHostPort(unquote(a[0]), 443), database: null }),
  'AmazonRedshift.Database': (a) => ({ kind: 'redshift', ...splitHostPort(unquote(a[0]), 5439), database: a[1] ? unquote(a[1]) : null }),
  'Csv.Document': () => ({ kind: 'file', fileType: 'csv' }),
  'Excel.Workbook': () => ({ kind: 'file', fileType: 'excel' }),
  'Json.Document': () => ({ kind: 'file', fileType: 'json' }),
  'Table.FromRows': () => ({ kind: 'inline' }),
  'Table.FromRecords': () => ({ kind: 'inline' }),
  '#table': () => ({ kind: 'inline' }),
};

function splitHostPort(hostSpec, defaultPort) {
  const m = String(hostSpec || '').match(/^(.*?)(?:[:,](\d+))?$/);
  return { host: m ? m[1] : hostSpec, port: m && m[2] ? Number(m[2]) : defaultPort };
}

// Steps that only shape the column list — safe to read through.
const BENIGN_STEPS = new Set([
  'Table.SelectColumns', 'Table.RemoveColumns', 'Table.RenameColumns',
  'Table.TransformColumnTypes', 'Table.ReorderColumns', 'Table.Buffer',
]);

// Parse one partition expression. Returns a description; never throws on
// unknown shapes — an unparseable expression yields { source: null } and the
// caller decides what to do with the table.
function parseMExpression(text) {
  const result = {
    source: null,          // connector call, see SOURCE_CALLS
    schema: null,          // navigation target
    table: null,
    reference: null,       // `Source = other_query` — a table derived from another
    combine: null,         // Table.Combine({a, b}) — union of other queries
    nativeQuery: null,     // Value.NativeQuery(..., "SELECT ...")
    renames: {},           // output name → input name
    removedColumns: [],
    keptColumns: null,
    complexSteps: [],      // [{ step, fn }] — transformations we do not translate
    filePath: null,
  };
  const src = stripComments(Array.isArray(text) ? text.join('\n') : String(text || '')).trim();
  if (!src) return result;

  const letMatch = src.match(/^let\b([\s\S]*)\bin\b([\s\S]*)$/i);
  const bindings = [];
  if (letMatch) {
    for (const part of splitTopLevel(letMatch[1], ',')) {
      const t = part.trim();
      if (!t) continue;
      const id = readIdentifier(t);
      if (!id) continue;
      const eq = id.rest.match(/^\s*=\s*([\s\S]*)$/);
      if (!eq) continue;
      bindings.push({ name: id.name, expr: eq[1].trim() });
    }
  } else {
    bindings.push({ name: 'Source', expr: src });
  }
  const stepNames = new Set();

  for (const b of bindings) {
    const expr = b.expr;
    const call = readCall(expr);
    if (call && SOURCE_CALLS[call.fn]) {
      result.source = SOURCE_CALLS[call.fn](call.args);
      if (result.source.kind === 'file') {
        const inner = call.args[0] ? readCall(call.args[0]) : null;
        if (inner && /File\.Contents|Web\.Contents/.test(inner.fn) && inner.args[0]) result.filePath = unquote(inner.args[0]);
      }
      stepNames.add(b.name);
      continue;
    }
    const nav = readNavigation(expr);
    if (nav) {
      const k = nav.keys;
      if (k.Schema && k.Item) { result.schema = k.Schema; result.table = k.Item; }
      else if (k.Item && !result.table) { result.table = k.Item; }
      else if (k.Name && (k.Kind === 'Table' || k.Kind === 'View')) { result.table = k.Name; }
      else if (k.Name && k.Kind === 'Schema') { result.schema = k.Name; }
      else if (k.Name && k.Kind === 'Dataset') { result.schema = k.Name; }
      else if (k.Name && result.source && !result.source.database) { result.source.database = k.Name; }
      else if (k.Name && !result.table && result.source && result.source.kind === 'file') { result.table = k.Name; }
      stepNames.add(b.name);
      continue;
    }
    if (call) {
      stepNames.add(b.name);
      if (call.fn === 'Table.Combine') {
        // {query_a, #"query b"} — a list of query identifiers, not strings.
        result.combine = splitTopLevel(String(call.args[0] || '').trim().replace(/^\{|\}$/g, ''), ',')
          .map((x) => { const id = readIdentifier(x); return id ? id.name : x.trim(); })
          .filter(Boolean);
        continue;
      }
      if (call.fn === 'Value.NativeQuery') {
        result.nativeQuery = call.args[1] ? unquote(call.args[1]) : '';
        continue;
      }
      if (call.fn === 'Table.SelectColumns') { result.keptColumns = parseStringList(call.args[1]) || result.keptColumns; continue; }
      if (call.fn === 'Table.RemoveColumns') { result.removedColumns.push(...(parseStringList(call.args[1]) || [])); continue; }
      if (call.fn === 'Table.RenameColumns') {
        for (const [from, to] of parsePairList(call.args[1]) || []) {
          // Chain renames: the source name of `from` (if it was itself renamed) carries over.
          result.renames[to] = result.renames[from] || from;
          if (result.renames[from]) delete result.renames[from];
        }
        continue;
      }
      if (BENIGN_STEPS.has(call.fn)) continue;
      result.complexSteps.push({ step: b.name, fn: call.fn });
      continue;
    }
    const id = readIdentifier(expr);
    if (id && id.rest.trim() === '' && !stepNames.has(id.name)) {
      // `Source = other_query` — a reference to another table/query of the model.
      result.reference = id.name;
      stepNames.add(b.name);
      continue;
    }
    stepNames.add(b.name);
    if (expr && !id) result.complexSteps.push({ step: b.name, fn: 'expression' });
  }
  return result;
}

module.exports = { parseMExpression, splitTopLevel, stripComments, unquote };
