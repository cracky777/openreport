const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { requireAuth } = require('../middleware/auth');
const db = require('../db');
const { createConnection } = require('../utils/dbConnector');
const { canAccessReport } = require('./reports');
const { getQueryTimeoutMs } = require('../utils/settingsHelper');
const queryCache = require('../utils/queryCache');
const preAggCache = require('../utils/preAggCache');
const { additiveTypeForMeasure, decomposeMeasure } = require('../utils/measureType');
const { quoteIdent, quoteTable, quoteCol, escapeLiteral, quoteLiteral, normalizeAggregation } = require('../utils/sqlDialect');

// Hook for cloud edition to override the global query-timeout with a
// workspace/org-scoped value. Default in OSS just returns the global
// admin setting. Cloud installs `cloudHooks.resolveQueryTimeoutMs(req)`
// to look the value up on the request's active workspace.
const cloudHooks = {
  resolveQueryTimeoutMs: null,
};
function resolveQueryTimeoutMs(req) {
  if (typeof cloudHooks.resolveQueryTimeoutMs === 'function') {
    try {
      const v = cloudHooks.resolveQueryTimeoutMs(req);
      if (Number.isFinite(v) && v > 0) return v;
    } catch { /* fall through to OSS default */ }
  }
  return getQueryTimeoutMs();
}

const router = express.Router();

// In-flight cancellable queries — keyed by client-generated queryId so the
// client can explicitly request cancellation via a separate HTTP endpoint
// (avoids the brittle res.on('close') / req.on('close') listener approach).
// Value: { cancel, userId } so we can refuse cancellation across users.
const inFlightQueries = new Map();

// Returns true if the user has access to the model, either directly (owner / global admin)
// or indirectly through a report that uses the model (public or workspace-shared).
function canAccessModel(model, user) {
  if (!model) return false;
  if (user && user.role === 'admin') return true;
  if (user && user.id === model.user_id) return true;
  // Check every report that uses this model — if the user can access any of them, they can use the model.
  const reports = db.prepare('SELECT * FROM reports WHERE model_id = ?').all(model.id);
  return reports.some((r) => canAccessReport(r, user));
}

// `quoteIdent` / `quoteTable` / `quoteCol` now come from utils/sqlDialect
// (dialect-aware). Calling them without a dbType still works — they fall
// back to PG-style double quotes, matching the previous behaviour.

// Cast an expression to a string type using the dialect's expected keyword.
// PostgreSQL / SQL Server / DuckDB accept VARCHAR; MySQL refuses VARCHAR
// and wants CHAR; BigQuery wants STRING. Used everywhere we coerce values
// to text for IN / LIKE / equality comparisons.
function castToString(expr, dbType) {
  if (dbType === 'mysql') return `CAST(${expr} AS CHAR)`;
  if (dbType === 'bigquery') return `CAST(${expr} AS STRING)`;
  return `CAST(${expr} AS VARCHAR)`;
}

const NUMERIC_TYPES = new Set(['integer', 'decimal', 'number']);

// Convert a list of user-supplied values into native SQL literals when the
// column type lets us — emitting `IN (2024, 2025)` against a numeric column
// is far faster than `CAST(col AS VARCHAR) IN ('2024', '2025')` because
// indexes survive and the engine doesn't materialise per-row casts. Returns
// null when the values can't all be coerced cleanly, signalling the caller
// to fall back to the cast-then-string path.
function literalsForType(values, dimType) {
  if (NUMERIC_TYPES.has(dimType)) {
    const out = [];
    for (const v of values) {
      const n = Number(v);
      if (!Number.isFinite(n)) return null;
      out.push(String(n));
    }
    return out;
  }
  if (dimType === 'boolean') {
    const out = [];
    for (const v of values) {
      const s = String(v).trim().toLowerCase();
      if (['true', 't', 'yes', 'y', '1'].includes(s)) out.push('TRUE');
      else if (['false', 'f', 'no', 'n', '0'].includes(s)) out.push('FALSE');
      else return null;
    }
    return out;
  }
  return null;
}

// Build an `IN`/`NOT IN` clause without an unconditional CAST: native
// literals when the dim is numeric/boolean and the values parse, plain
// quoted strings when the dim is already a string, CAST as the last resort
// for unknown types or value/type mismatches. Single-value lists collapse
// to `=` / `<>` — semantically identical, lighter to read, and on some
// engines avoids a tiny IN-list overhead.
function buildInList(colExpr, dimType, list, dbType, negate) {
  if (!list || list.length === 0) return null;
  const single = list.length === 1;
  const inOp = negate ? 'NOT IN' : 'IN';
  const eqOp = negate ? '<>' : '=';
  const native = literalsForType(list, dimType);
  if (native) {
    return single ? `${colExpr} ${eqOp} ${native[0]}` : `${colExpr} ${inOp} (${native.join(', ')})`;
  }
  const quote = (v) => quoteLiteral(v, dbType);
  if (dimType === 'string') {
    return single ? `${colExpr} ${eqOp} ${quote(list[0])}` : `${colExpr} ${inOp} (${list.map(quote).join(', ')})`;
  }
  const cast = castToString(colExpr, dbType);
  return single ? `${cast} ${eqOp} ${quote(list[0])}` : `${cast} ${inOp} (${list.map(quote).join(', ')})`;
}

// Effective comparison type for a dim. Date-part dims (year, month name,
// etc.) aren't `type='date'` themselves — they're computed numbers/strings
// derived from the underlying date — so derive the type from the date-part
// flavour to keep the IN clause numeric-vs-string aligned.
function effectiveDimType(dim) {
  if (!dim) return 'string';
  if (dim.datePart) return dim.datePart.startsWith('name_') ? 'string' : 'integer';
  return dim.type || 'string';
}

// Generate the SQL expression that converts a (possibly text) column into
// a real DATE for the current dialect, honouring the user-chosen date
// format if any. `fmt` mirrors the values stored in columnTypes:
//   'auto' / 'iso' / 'dd/mm/yyyy' / 'mm/dd/yyyy' / 'dd-mm-yyyy' / 'dd.mm.yyyy' / 'yyyymmdd'
// When the format is 'auto' (or unknown), each dialect falls back to its
// permissive default — usually CAST(... AS DATE) — which works for ISO
// strings and native date columns.
function castToDate(expr, dbType, fmt) {
  const f = fmt || 'auto';

  if (dbType === 'azure_sql' || dbType === 'mssql') {
    // SQL Server style codes consumed by CONVERT/TRY_CONVERT.
    const code = ({
      iso: 23,
      'dd/mm/yyyy': 103,
      'mm/dd/yyyy': 101,
      'dd-mm-yyyy': 105, // Italian style — DD-MM-YYYY
      'dd.mm.yyyy': 104, // German style — DD.MM.YYYY
      yyyymmdd: 112,
    })[f];
    if (code) return `TRY_CONVERT(date, ${expr}, ${code})`;
    return `TRY_CONVERT(date, ${expr})`;
  }

  if (dbType === 'mysql') {
    const m = ({
      iso: '%Y-%m-%d',
      'dd/mm/yyyy': '%d/%m/%Y',
      'mm/dd/yyyy': '%m/%d/%Y',
      'dd-mm-yyyy': '%d-%m-%Y',
      'dd.mm.yyyy': '%d.%m.%Y',
      yyyymmdd: '%Y%m%d',
    })[f];
    if (m) return `STR_TO_DATE(${expr}, '${m}')`;
    return `CAST(${expr} AS DATE)`;
  }

  if (dbType === 'bigquery') {
    const m = ({
      iso: '%Y-%m-%d',
      'dd/mm/yyyy': '%d/%m/%Y',
      'mm/dd/yyyy': '%m/%d/%Y',
      'dd-mm-yyyy': '%d-%m-%Y',
      'dd.mm.yyyy': '%d.%m.%Y',
      yyyymmdd: '%Y%m%d',
    })[f];
    if (m) return `PARSE_DATE('${m}', ${expr})`;
    return `CAST(${expr} AS DATE)`;
  }

  if (dbType === 'duckdb') {
    const m = ({
      iso: '%Y-%m-%d',
      'dd/mm/yyyy': '%d/%m/%Y',
      'mm/dd/yyyy': '%m/%d/%Y',
      'dd-mm-yyyy': '%d-%m-%Y',
      'dd.mm.yyyy': '%d.%m.%Y',
      yyyymmdd: '%Y%m%d',
    })[f];
    if (m) return `CAST(STRPTIME(${expr}, '${m}') AS DATE)`;
    return `CAST(${expr} AS DATE)`;
  }

  // PostgreSQL / Azure PostgreSQL — TO_DATE for explicit formats.
  const m = ({
    iso: 'YYYY-MM-DD',
    'dd/mm/yyyy': 'DD/MM/YYYY',
    'mm/dd/yyyy': 'MM/DD/YYYY',
    'dd-mm-yyyy': 'DD-MM-YYYY',
    'dd.mm.yyyy': 'DD.MM.YYYY',
    yyyymmdd: 'YYYYMMDD',
  })[f];
  if (m) return `TO_DATE(${expr}, '${m}')`;
  return `CAST(${expr} AS DATE)`;
}

// Read the date format hint stored on a (table, column) override entry.
// `columnTypes` may carry plain strings ('date') or objects ({type, format})
// and missing entries default to 'auto'.
function getDateFormat(table, column, columnTypes) {
  if (!columnTypes) return 'auto';
  const entry = columnTypes[`${table}.${column}`];
  if (!entry || typeof entry === 'string') return 'auto';
  return entry.format || 'auto';
}

// Read just the type override (e.g. 'integer', 'decimal', 'date') for a
// (table, column). Handles both the simple string form and the object
// form. Returns null when no override is set.
function getOverrideType(table, column, columnTypes) {
  if (!columnTypes) return null;
  const entry = columnTypes[`${table}.${column}`];
  if (!entry) return null;
  if (typeof entry === 'string') return entry;
  return entry.type || null;
}

// Build the SQL expression for a date-part dimension (year, month, week,
// day-of-week, month/day name) honouring the per-dialect EXTRACT/YEAR/etc.
// syntax AND the column's date-format override (so a text column with
// 'DD/MM/YYYY' values is parsed before the part is extracted).
//
// Returns null when the dim has no datePart. Used by both the SELECT
// projection and the WHERE / HAVING filter generation, so drill-down on
// a year column actually filters by the YEAR(...) expression rather than
// the raw timestamp string.
function buildDatePartExpr(dim, dbType, columnTypes) {
  if (!dim || !dim.datePart) return null;
  const col = quoteCol(dim.table, dim.column, dbType);
  // Re-use castToDate for the inner parsing so non-ISO text dates are
  // normalised before EXTRACT/strftime sees them.
  const dateExpr = castToDate(col, dbType, getDateFormat(dim.table, dim.column, columnTypes));
  if (dbType === 'duckdb') {
    switch (dim.datePart) {
      case 'num_year': return `EXTRACT(YEAR FROM ${dateExpr})`;
      case 'num_month': return `EXTRACT(MONTH FROM ${dateExpr})`;
      case 'name_month': return `STRFTIME(${dateExpr}, '%B')`;
      case 'num_week': return `EXTRACT(WEEK FROM ${dateExpr})`;
      case 'num_day_of_week': return `EXTRACT(DOW FROM ${dateExpr})`;
      case 'name_day': return `STRFTIME(${dateExpr}, '%A')`;
      default: return col;
    }
  }
  if (dbType === 'mysql') {
    switch (dim.datePart) {
      case 'num_year': return `YEAR(${dateExpr})`;
      case 'num_month': return `MONTH(${dateExpr})`;
      case 'name_month': return `MONTHNAME(${dateExpr})`;
      case 'num_week': return `WEEK(${dateExpr})`;
      case 'num_day_of_week': return `DAYOFWEEK(${dateExpr})`;
      case 'name_day': return `DAYNAME(${dateExpr})`;
      default: return col;
    }
  }
  if (dbType === 'azure_sql' || dbType === 'mssql') {
    switch (dim.datePart) {
      case 'num_year': return `YEAR(${dateExpr})`;
      case 'num_month': return `MONTH(${dateExpr})`;
      case 'name_month': return `DATENAME(MONTH, ${dateExpr})`;
      case 'num_week': return `DATEPART(WEEK, ${dateExpr})`;
      case 'num_day_of_week': return `DATEPART(WEEKDAY, ${dateExpr})`;
      case 'name_day': return `DATENAME(WEEKDAY, ${dateExpr})`;
      default: return col;
    }
  }
  // PostgreSQL / Azure PostgreSQL / BigQuery
  switch (dim.datePart) {
    case 'num_year': return `EXTRACT(YEAR FROM ${dateExpr})`;
    case 'num_month': return `EXTRACT(MONTH FROM ${dateExpr})`;
    case 'name_month': return `TO_CHAR(${dateExpr}, 'Month')`;
    case 'num_week': return `EXTRACT(WEEK FROM ${dateExpr})`;
    case 'num_day_of_week': return `EXTRACT(DOW FROM ${dateExpr})`;
    case 'name_day': return `TO_CHAR(${dateExpr}, 'Day')`;
    default: return col;
  }
}

// Pick the SQL JOIN keyword for a relation based on its cardinality. The
// UI now expresses joins as cardinality (1 / * on each end) rather than a
// raw LEFT/INNER/RIGHT pill — the SQL dialect is derived here:
//   *:1 / 1:* → LEFT JOIN  (keep all rows on the "many" side, decorate with dim)
//   1:1       → INNER JOIN (no fan-out, both sides match by definition)
//   *:*       → INNER JOIN (semantically a bridge — emit something usable but
//                           the canvas should warn the user)
// Falls back to the legacy `type` field on joins that pre-date cardinality.
function deriveJoinKeyword(j) {
  const c = j && j.cardinality;
  if (c && c.from && c.to) {
    if (c.from === '1' && c.to === '1') return 'INNER';
    if (c.from === '*' && c.to === '*') return 'INNER';
    return 'LEFT';
  }
  return (j?.type || 'LEFT').toUpperCase();
}

// Convert a (possibly text) column expression into a numeric SQL value
// using the dialect's CAST keyword. `type` is 'integer' / 'decimal' /
// 'number' (the legacy alias, treated as decimal). For decimals we wrap
// REPLACE(expr, ',', '.') first so French comma decimals like "12,34"
// parse cleanly — REPLACE on a native numeric column implicitly stringifies,
// works on every supported dialect.
function castToNumber(expr, dbType, type) {
  const wantsInt = type === 'integer';
  // For decimals, tolerate comma decimals; for integers, trust clean digits
  // (REPLACE on an int that happens to contain "12,000" thousands would lose
  // the decimal, which is the safer outcome).
  const cleaned = wantsInt ? expr : `REPLACE(${expr}, ',', '.')`;
  if (dbType === 'mysql') {
    return wantsInt ? `CAST(${cleaned} AS SIGNED)` : `CAST(${cleaned} AS DECIMAL(38,10))`;
  }
  if (dbType === 'azure_sql' || dbType === 'mssql') {
    return wantsInt ? `CAST(${cleaned} AS INT)` : `CAST(${cleaned} AS DECIMAL(38,10))`;
  }
  if (dbType === 'bigquery') {
    return wantsInt ? `CAST(${cleaned} AS INT64)` : `CAST(${cleaned} AS NUMERIC)`;
  }
  // PostgreSQL / Azure PostgreSQL / DuckDB
  return wantsInt ? `CAST(${cleaned} AS INTEGER)` : `CAST(${cleaned} AS NUMERIC)`;
}

// Validate a single value as a date using the requested format hint. The
// format codes mirror the dropdown options offered to the user when
// overriding a column to type='date':
//   - 'auto'         tries ISO, then EU (DD/MM/YYYY), then US (MM/DD/YYYY)
//   - 'iso'          strict YYYY-MM-DD (or longer ISO 8601)
//   - 'dd/mm/yyyy'   day first, slash separator (also accepts 2-digit year)
//   - 'mm/dd/yyyy'   month first, slash separator
//   - 'dd-mm-yyyy'   dash separator
//   - 'dd.mm.yyyy'   dot separator
//   - 'yyyymmdd'     compact ISO (no separators)
// All checks reject pure-numeric values up-front to avoid scoring random
// IDs or counts as "valid dates".
function isValidDate(v, fmt) {
  if (v == null) return false;
  if (v instanceof Date) return !isNaN(v.getTime());
  const s = String(v).trim();
  if (!s) return false;
  // yyyymmdd is the only format that legitimately consists of pure digits;
  // every other path rejects them up-front.
  const purelyNumeric = /^-?\d+(\.\d+)?$/.test(s);
  if (purelyNumeric && fmt !== 'yyyymmdd') return false;

  const tryEu = (sep) => {
    const m = s.match(new RegExp(`^(\\d{1,2})${sep}(\\d{1,2})${sep}(\\d{2,4})$`));
    if (!m) return false;
    const dd = +m[1], mm = +m[2];
    const yyyy = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    if (dd < 1 || dd > 31 || mm < 1 || mm > 12) return false;
    const iso = `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
    return !isNaN(Date.parse(iso));
  };
  const tryUs = (sep) => {
    const m = s.match(new RegExp(`^(\\d{1,2})${sep}(\\d{1,2})${sep}(\\d{2,4})$`));
    if (!m) return false;
    const mm = +m[1], dd = +m[2];
    const yyyy = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return false;
    const iso = `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
    return !isNaN(Date.parse(iso));
  };
  const tryIso = () => /^\d{4}-\d{2}-\d{2}/.test(s) && !isNaN(Date.parse(s));
  const tryYyyymmdd = () => {
    const m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (!m) return false;
    const yyyy = +m[1], mm = +m[2], dd = +m[3];
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return false;
    return !isNaN(Date.parse(`${m[1]}-${m[2]}-${m[3]}`));
  };

  switch (fmt) {
    case 'iso':         return tryIso();
    case 'dd/mm/yyyy':  return tryEu('\\/');
    case 'mm/dd/yyyy':  return tryUs('\\/');
    case 'dd-mm-yyyy':  return tryEu('-');
    case 'dd.mm.yyyy':  return tryEu('\\.');
    case 'yyyymmdd':    return tryYyyymmdd();
    case 'auto':
    default: {
      if (tryIso()) return true;
      if (tryEu('[\\/.\\-]')) return true;
      if (tryUs('[\\/.\\-]')) return true;
      if (/[A-Za-z]/.test(s)) return !isNaN(Date.parse(s));
      return false;
    }
  }
}

// Compute the set of tables reachable from a starting table via the join graph.
// Used to verify the RLS table can constrain every queried table — otherwise an
// unconnected table would slip through via cross join.
function tablesReachableFrom(startTable, joins) {
  const reachable = new Set([startTable]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const j of joins || []) {
      if (reachable.has(j.from_table) && !reachable.has(j.to_table)) { reachable.add(j.to_table); changed = true; }
      if (reachable.has(j.to_table) && !reachable.has(j.from_table)) { reachable.add(j.from_table); changed = true; }
    }
  }
  return reachable;
}

// Convert a glob-style pattern (with * as wildcard) to a case-insensitive RegExp.
// Examples:
//   "alice@openreport.io"   → matches that exact email
//   "*@openreport.io"       → any email in the openreport.io domain
//   "alice*"                → emails starting with "alice"
//   "*admin*"               → emails containing "admin"
//   "*"                     → matches any authenticated user
function patternToRegex(pattern) {
  const escaped = String(pattern).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i');
}

function emailMatchesPattern(email, pattern) {
  if (!pattern) return false;
  try { return patternToRegex(pattern).test(email || ''); } catch { return false; }
}

// Given an rls config { enabled, table, primaryKey, rules: { rowKey: [patterns...] } }
// return the list of allowed row-key values for a given user email, or null if no rule matched.
function getAllowedRlsKeys(rls, email) {
  if (!rls || !rls.enabled || !rls.rules) return null;
  const allowed = [];
  for (const [rowKey, patterns] of Object.entries(rls.rules)) {
    if (!Array.isArray(patterns)) continue;
    if (patterns.some((p) => emailMatchesPattern(email, p))) {
      allowed.push(rowKey);
    }
  }
  return allowed;
}

// List models for current user
router.get('/', requireAuth, (req, res) => {
  const models = db.prepare(`
    SELECT m.id, m.name, m.description, m.datasource_id, d.name as datasource_name, m.created_at, m.updated_at
    FROM models m
    JOIN datasources d ON d.id = m.datasource_id
    WHERE m.user_id = ?
    ORDER BY m.updated_at DESC
  `).all(req.user.id);
  res.json({ models });
});

// Get single model with full details (owner, global admin, or anyone with access to a report using it)
router.get('/:id', requireAuth, (req, res) => {
  const model = db.prepare('SELECT * FROM models WHERE id = ?').get(req.params.id);
  if (!model || !canAccessModel(model, req.user)) return res.status(404).json({ error: 'Model not found' });

  // Strip the RLS rules map (other users' email patterns) from the response for anyone
  // who isn't the owner or a global admin. The viewer's own access is enforced server-side
  // by /query — they don't need to see who else has access.
  const isOwner = req.user.id === model.user_id;
  const isAdmin = req.user.role === 'admin';
  const fullRls = JSON.parse(model.rls || '{}');
  const safeRls = (isOwner || isAdmin) ? fullRls : {};

  res.json({
    model: {
      ...model,
      selected_tables: JSON.parse(model.selected_tables),
      table_positions: JSON.parse(model.table_positions),
      dimensions: JSON.parse(model.dimensions),
      measures: JSON.parse(model.measures),
      joins: JSON.parse(model.joins),
      rls: safeRls,
      column_types: JSON.parse(model.column_types || '{}'),
      dateColumn: model.date_column || null,
    },
  });
});

// Create model
router.post('/', requireAuth, (req, res) => {
  const { name, datasourceId, description } = req.body;
  if (!name || !datasourceId) return res.status(400).json({ error: 'Name and datasourceId are required' });

  const ds = db.prepare('SELECT id FROM datasources WHERE id = ? AND user_id = ?').get(datasourceId, req.user.id);
  if (!ds) return res.status(404).json({ error: 'Datasource not found' });

  const id = uuidv4();
  db.prepare('INSERT INTO models (id, user_id, datasource_id, name, description) VALUES (?, ?, ?, ?, ?)').run(
    id, req.user.id, datasourceId, name, description || ''
  );

  res.status(201).json({ model: { id, name, datasource_id: datasourceId, description: description || '' } });
});

// Update model (dimensions, measures, joins, and optionally datasource)
router.put('/:id', requireAuth, (req, res) => {
  const model = db.prepare('SELECT * FROM models WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!model) return res.status(404).json({ error: 'Model not found' });

  const { name, description, selected_tables, table_positions, dimensions, measures, joins, rls, column_types, dateColumn, datasourceId } = req.body;

  // If caller is moving the model to a different datasource, verify ownership
  if (datasourceId && datasourceId !== model.datasource_id) {
    const ds = db.prepare('SELECT id FROM datasources WHERE id = ? AND user_id = ?').get(datasourceId, req.user.id);
    if (!ds) return res.status(404).json({ error: 'Target datasource not found' });
  }

  db.prepare(`
    UPDATE models SET
      name = COALESCE(?, name),
      description = COALESCE(?, description),
      datasource_id = COALESCE(?, datasource_id),
      selected_tables = COALESCE(?, selected_tables),
      table_positions = COALESCE(?, table_positions),
      dimensions = COALESCE(?, dimensions),
      measures = COALESCE(?, measures),
      joins = COALESCE(?, joins),
      rls = COALESCE(?, rls),
      column_types = COALESCE(?, column_types),
      date_column = CASE WHEN ? = 1 THEN ? ELSE date_column END,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    name || null,
    description !== undefined ? description : null,
    datasourceId || null,
    selected_tables ? JSON.stringify(selected_tables) : null,
    table_positions ? JSON.stringify(table_positions) : null,
    dimensions ? JSON.stringify(dimensions) : null,
    measures ? JSON.stringify(measures) : null,
    joins ? JSON.stringify(joins) : null,
    rls !== undefined ? JSON.stringify(rls || {}) : null,
    column_types !== undefined ? JSON.stringify(column_types || {}) : null,
    dateColumn !== undefined ? 1 : 0,
    dateColumn !== undefined ? (dateColumn || '') : '',
    req.params.id
  );

  // The model's logical shape may have changed (renamed dim, new measure,
  // RLS rules, format overrides). Drop every cached row tied to this model
  // so the next visual refresh hits the DB and rebuilds. Cheap because the
  // index is keyed by modelId.
  queryCache.invalidateModel(req.params.id);
  preAggCache.invalidateModel(req.params.id);

  const updated = db.prepare('SELECT * FROM models WHERE id = ?').get(req.params.id);
  res.json({
    model: {
      ...updated,
      selected_tables: JSON.parse(updated.selected_tables),
      table_positions: JSON.parse(updated.table_positions),
      dimensions: JSON.parse(updated.dimensions),
      measures: JSON.parse(updated.measures),
      joins: JSON.parse(updated.joins),
      rls: JSON.parse(updated.rls || '{}'),
      column_types: JSON.parse(updated.column_types || '{}'),
      dateColumn: updated.date_column || null,
    },
  });
});

// Validate model references against the current datasource schema.
// Returns a list of broken references (missing tables, missing columns).
router.get('/:id/validate', requireAuth, async (req, res) => {
  const model = db.prepare('SELECT * FROM models WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!model) return res.status(404).json({ error: 'Model not found' });

  const source = db.prepare('SELECT * FROM datasources WHERE id = ? AND user_id = ?').get(model.datasource_id, req.user.id);
  if (!source) return res.status(404).json({ error: 'Datasource not found' });

  const selectedTables = JSON.parse(model.selected_tables || '[]');
  const dimensions = JSON.parse(model.dimensions || '[]');
  const measures = JSON.parse(model.measures || '[]');
  const joins = JSON.parse(model.joins || '[]');

  let conn;
  const issues = [];
  try {
    conn = createConnection(source);
    const availableTables = new Set(await conn.getTables());
    const columnsCache = new Map();
    const getCols = async (tableName) => {
      if (columnsCache.has(tableName)) return columnsCache.get(tableName);
      if (!availableTables.has(tableName)) { columnsCache.set(tableName, null); return null; }
      try {
        const cols = await conn.getColumns(tableName);
        // Drivers expose columns with different shapes: { column_name }, { name }, or plain strings
        const set = new Set((cols || []).map((c) => {
          if (typeof c === 'string') return c;
          return c?.column_name ?? c?.name ?? c?.Name ?? c?.COLUMN_NAME ?? '';
        }).filter(Boolean));
        columnsCache.set(tableName, set);
        return set;
      } catch (e) {
        columnsCache.set(tableName, null);
        return null;
      }
    };

    // Check selected tables
    for (const t of selectedTables) {
      if (!availableTables.has(t)) {
        issues.push({ kind: 'table', name: t, table: t, issue: 'missing_table' });
      }
    }

    // Check dimensions
    for (const d of dimensions) {
      // Computed dimensions with sqlExpression don't need table/column checks
      if (d.sqlExpression) continue;
      // Date-part synthetic dimensions (name starts with "_date.") depend on the parent date column
      if (d.datePartOf) continue;
      if (!d.table) { issues.push({ kind: 'dimension', name: d.name, issue: 'no_table', label: d.label }); continue; }
      const cols = await getCols(d.table);
      if (cols === null) {
        issues.push({ kind: 'dimension', name: d.name, table: d.table, column: d.column, issue: 'missing_table', label: d.label });
        continue;
      }
      if (d.column && !cols.has(d.column)) {
        issues.push({ kind: 'dimension', name: d.name, table: d.table, column: d.column, issue: 'missing_column', label: d.label });
      }
    }

    // Check measures
    for (const m of measures) {
      if (m.sqlExpression) continue;
      // Custom measures from the report editor (aggregation: 'custom') are free-form SQL
      // expressions over the model, not direct table.column references — skip column checks.
      if (m.aggregation === 'custom') continue;
      if (!m.table) { issues.push({ kind: 'measure', name: m.name, issue: 'no_table', label: m.label }); continue; }
      const cols = await getCols(m.table);
      if (cols === null) {
        issues.push({ kind: 'measure', name: m.name, table: m.table, column: m.column, issue: 'missing_table', label: m.label });
        continue;
      }
      if (m.column && !cols.has(m.column)) {
        issues.push({ kind: 'measure', name: m.name, table: m.table, column: m.column, issue: 'missing_column', label: m.label });
      }
    }

    // Check joins
    for (const j of joins) {
      const check = async (side, pos) => {
        if (!side || !side.table) return;
        const cols = await getCols(side.table);
        if (cols === null) {
          issues.push({ kind: 'join', name: `${j.left?.table || '?'} ↔ ${j.right?.table || '?'}`, table: side.table, column: side.column, issue: 'missing_table', side: pos });
          return;
        }
        if (side.column && !cols.has(side.column)) {
          issues.push({ kind: 'join', name: `${j.left?.table || '?'} ↔ ${j.right?.table || '?'}`, table: side.table, column: side.column, issue: 'missing_column', side: pos });
        }
      };
      await check(j.left, 'left');
      await check(j.right, 'right');
    }

    // Check date column
    if (model.date_column) {
      const dateDim = dimensions.find((d) => d.name === model.date_column);
      if (dateDim && dateDim.table) {
        const cols = await getCols(dateDim.table);
        if (cols === null) {
          issues.push({ kind: 'dateColumn', name: model.date_column, table: dateDim.table, column: dateDim.column, issue: 'missing_table' });
        } else if (dateDim.column && !cols.has(dateDim.column)) {
          issues.push({ kind: 'dateColumn', name: model.date_column, table: dateDim.table, column: dateDim.column, issue: 'missing_column' });
        }
      }
    }

    res.json({ brokenReferences: issues, checkedAt: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message, brokenReferences: [] });
  } finally {
    conn?.close?.();
  }
});

// Delete model
router.delete('/:id', requireAuth, (req, res) => {
  // Check if any reports use this model
  const reportCount = db.prepare('SELECT COUNT(*) as count FROM reports WHERE model_id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (reportCount && reportCount.count > 0) {
    return res.status(409).json({ error: `This model is used by ${reportCount.count} report(s). Delete them first.` });
  }

  const result = db.prepare('DELETE FROM models WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Model not found' });
  res.json({ message: 'Model deleted' });
});

// Fetch rows from the table designated as the RLS table, so the UI can display them
// for per-row user/pattern mapping. Owner-only.
// Optional `search` param performs a server-side LIKE filter on the primary key column,
// allowing the UI to look up rows beyond the 1000-row display cap.
router.get('/:id/rls/rows', requireAuth, async (req, res) => {
  const model = db.prepare('SELECT * FROM models WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!model) return res.status(404).json({ error: 'Model not found' });

  const { table, primaryKey, columns, search } = req.query;
  if (!table || !primaryKey) return res.status(400).json({ error: 'table and primaryKey are required' });

  const datasource = db.prepare('SELECT * FROM datasources WHERE id = ?').get(model.datasource_id);
  if (!datasource) return res.status(404).json({ error: 'Datasource not found' });

  // Build a SELECT for the requested columns (default: just the primary key).
  // Column names are validated against the actual table schema to prevent injection.
  let conn;
  try {
    conn = createConnection(datasource);
    const cols = await conn.getColumns(table);
    const colSet = new Set((cols || []).map((c) => {
      if (typeof c === 'string') return c;
      return c?.column_name ?? c?.name ?? c?.Name ?? c?.COLUMN_NAME ?? '';
    }).filter(Boolean));

    if (!colSet.has(primaryKey)) return res.status(400).json({ error: `Primary key column "${primaryKey}" not found in table` });

    const dbType = datasource.db_type;
    const requestedCols = (typeof columns === 'string' ? columns.split(',') : []).map((s) => s.trim()).filter(Boolean);
    const safeCols = [primaryKey, ...requestedCols.filter((c) => c !== primaryKey && colSet.has(c))];
    const selectList = safeCols.map((c) => quoteIdent(c, dbType)).join(', ');

    let sql = `SELECT ${selectList} FROM ${quoteTable(table, dbType)}`;
    const trimmedSearch = (search || '').toString().trim();
    if (trimmedSearch) {
      const escaped = escapeLiteral(trimmedSearch, dbType);
      // CAST to VARCHAR so the LIKE works regardless of the column's native type (number, date, etc.)
      sql += ` WHERE LOWER(${castToString(quoteCol(table, primaryKey, dbType), dbType)}) LIKE LOWER('%${escaped}%')`;
    }
    // SQL Server / Azure SQL doesn't support LIMIT — use OFFSET/FETCH instead.
    const isMssql = dbType === 'azure_sql' || dbType === 'mssql';
    sql += ` ORDER BY ${quoteIdent(primaryKey, dbType)}`;
    sql += isMssql ? ` OFFSET 0 ROWS FETCH NEXT 1000 ROWS ONLY` : ` LIMIT 1000`;

    const rawRows = await conn.query(sql);
    // Mirror the /query post-process — empty `{}` from pg for zero
    // intervals must also flatten to 0 seconds instead of rendering as
    // `[object Object]`.
    const INTERVAL_KEYS_EXPLORE = ['years', 'months', 'days', 'hours', 'minutes', 'seconds', 'milliseconds', 'micros', 'fractionalSeconds'];
    const rows = rawRows.map((r) => {
      const obj = {};
      for (const [k, v] of Object.entries(r)) {
        if (v instanceof Date) { obj[k] = v.toISOString().split('T')[0]; continue; }
        if (v == null || typeof v !== 'object' || Array.isArray(v)) { obj[k] = v; continue; }
        const keys = Object.keys(v);
        const isInterval = keys.length === 0 || keys.some((kk) => INTERVAL_KEYS_EXPLORE.includes(kk));
        if (isInterval) {
          obj[k] = (Number(v.years) || 0) * 31557600
            + (Number(v.months) || 0) * 2629800
            + (Number(v.days) || 0) * 86400
            + (Number(v.hours) || 0) * 3600
            + (Number(v.minutes) || 0) * 60
            + (Number(v.seconds) || 0)
            + (Number(v.milliseconds) || 0) / 1000
            + (Number(v.micros) || 0) / 1_000_000
            + (Number(v.fractionalSeconds) || 0);
        } else {
          obj[k] = v;
        }
      }
      return obj;
    });
    res.json({ rows, columns: Array.from(colSet), truncated: rows.length >= 1000 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    conn?.close();
  }
});

// Validate that a column can be safely interpreted as a target type.
// Pulls up to 100k non-null values for the column then runs JS-side coercion
// checks to compute a hit rate. Used by the schema editor when the user
// overrides the inferred type for a column (varchar holding dates, integer
// IDs treated as categorical strings, etc.).
//
// Body: { table, column, type } where type ∈ {'date','number','boolean','string'}
// Returns: { ok, sampleSize, validCount, validRatio, invalidExamples: [...] }
router.post('/:id/validate-column-type', requireAuth, async (req, res) => {
  const model = db.prepare('SELECT * FROM models WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!model) return res.status(404).json({ error: 'Model not found' });

  const { table, column, type, dateFormat } = req.body || {};
  if (!table || !column || !type) return res.status(400).json({ error: 'table, column and type are required' });
  // 'number' is kept as a legacy alias for 'decimal' so existing models keep
  // validating; new models should pick integer or decimal explicitly.
  if (!['date', 'number', 'integer', 'decimal', 'boolean', 'string'].includes(type)) {
    return res.status(400).json({ error: `Unsupported type "${type}"` });
  }
  // Date format codes the client may pass alongside type='date'. 'auto'
  // (or unspecified) tries ISO, EU and US in turn — the loose default.
  const ALLOWED_DATE_FORMATS = ['auto', 'iso', 'dd/mm/yyyy', 'mm/dd/yyyy', 'dd-mm-yyyy', 'dd.mm.yyyy', 'yyyymmdd'];
  const fmt = ALLOWED_DATE_FORMATS.includes(dateFormat) ? dateFormat : 'auto';

  const datasource = db.prepare('SELECT * FROM datasources WHERE id = ?').get(model.datasource_id);
  if (!datasource) return res.status(404).json({ error: 'Datasource not found' });

  // Validate that the requested column actually exists on the table — also
  // protects against SQL injection via the column name.
  let conn;
  try {
    conn = createConnection(datasource);
    const cols = await conn.getColumns(table);
    const colSet = new Set((cols || []).map((c) => {
      if (typeof c === 'string') return c;
      return c?.column_name ?? c?.name ?? c?.Name ?? c?.COLUMN_NAME ?? '';
    }).filter(Boolean));
    if (!colSet.has(column)) return res.status(400).json({ error: `Column "${column}" not found in table` });

    const SAMPLE = 100000;
    const dbType = datasource.db_type;
    const colExpr = quoteCol(table, column, dbType);
    const isMssql = dbType === 'azure_sql' || dbType === 'mssql';
    // SQL Server uses TOP <n>; everyone else uses LIMIT <n>. WHERE filters
    // out NULLs so they don't pollute the validity ratio.
    const sql = isMssql
      ? `SELECT TOP ${SAMPLE} ${colExpr} AS v FROM ${quoteTable(table, dbType)} WHERE ${colExpr} IS NOT NULL`
      : `SELECT ${colExpr} AS v FROM ${quoteTable(table, dbType)} WHERE ${colExpr} IS NOT NULL LIMIT ${SAMPLE}`;

    const rows = await conn.query(sql);
    const sampleSize = rows.length;
    if (sampleSize === 0) {
      return res.json({ ok: true, sampleSize: 0, validCount: 0, validRatio: 1, invalidExamples: [], note: 'No non-null values to sample' });
    }

    // Type-specific JS coercion checks. Each returns a boolean.
    // Coerces any user-supplied numeric (with French/EN decimal separator)
    // into a JS number. Used by the decimal & legacy 'number' checks.
    const parseFlexibleNumber = (s) => {
      if (s == null) return NaN;
      const str = String(s).trim();
      if (!str) return NaN;
      // Try as-is first (handles dot decimals + plain integers)
      const direct = Number(str);
      if (Number.isFinite(direct)) return direct;
      // Fallback: French-style comma decimal — replace ALL commas with dots
      // (we tolerate a single decimal mark; multi-comma values are unusual
      // here, e.g. thousands grouping is rare in raw column data).
      const withDot = Number(str.replace(/,/g, '.'));
      return withDot;
    };

    const checks = {
      string: () => true, // anything that ended up in JS can be a string
      // Legacy alias kept for backward-compat with models stored before the
      // integer/decimal split. Equivalent to 'decimal'.
      number: (v) => Number.isFinite(parseFlexibleNumber(v)) || typeof v === 'bigint',
      decimal: (v) => Number.isFinite(parseFlexibleNumber(v)) || typeof v === 'bigint',
      // Strict integer: digits with optional sign, no decimal mark.
      integer: (v) => {
        if (typeof v === 'bigint') return true;
        if (typeof v === 'number') return Number.isInteger(v);
        const s = String(v ?? '').trim();
        return /^-?\d+$/.test(s);
      },
      boolean: (v) => {
        if (typeof v === 'boolean') return true;
        if (typeof v === 'number') return v === 0 || v === 1;
        const s = String(v).trim().toLowerCase();
        return ['true', 'false', '0', '1', 'yes', 'no', 't', 'f', 'y', 'n'].includes(s);
      },
      date: (v) => isValidDate(v, fmt),
    };
    const check = checks[type];

    let validCount = 0;
    const invalidExamples = [];
    const seenInvalid = new Set();
    for (const row of rows) {
      const v = row.v ?? row.V ?? null;
      if (check(v)) {
        validCount += 1;
      } else if (invalidExamples.length < 5) {
        const key = String(v).slice(0, 50);
        if (!seenInvalid.has(key)) {
          seenInvalid.add(key);
          invalidExamples.push(v == null ? null : String(v).slice(0, 80));
        }
      }
    }

    res.json({
      ok: true,
      sampleSize,
      validCount,
      validRatio: validCount / sampleSize,
      invalidExamples,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    conn?.close();
  }
});

// Detect the cardinality of a join column by sampling. Returns "1" if all
// sampled values are unique (likely a PK / unique side), "*" if duplicates
// were found. Used by the SchemaCanvas when the user creates a new join,
// to suggest the cardinality of each end. The sample is intentionally
// small (1000 rows) — fast and good enough for a suggestion. Final word
// belongs to the user; they can override the marker manually.
//
// Body: { table, column }
// Returns: { cardinality: '1'|'*', sampleSize, distinct }
router.post('/:id/detect-cardinality', requireAuth, async (req, res) => {
  const model = db.prepare('SELECT * FROM models WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!model) return res.status(404).json({ error: 'Model not found' });
  const { table, column } = req.body || {};
  if (!table || !column) return res.status(400).json({ error: 'table and column are required' });

  const datasource = db.prepare('SELECT * FROM datasources WHERE id = ?').get(model.datasource_id);
  if (!datasource) return res.status(404).json({ error: 'Datasource not found' });

  let conn;
  try {
    conn = createConnection(datasource);
    // Defensive: column must exist on the table (also blocks SQL injection
    // through the column name since we splice it into the query string).
    const cols = await conn.getColumns(table);
    const colSet = new Set((cols || []).map((c) => {
      if (typeof c === 'string') return c;
      return c?.column_name ?? c?.name ?? c?.Name ?? c?.COLUMN_NAME ?? '';
    }).filter(Boolean));
    if (!colSet.has(column)) return res.status(400).json({ error: `Column "${column}" not found in table` });

    const SAMPLE = 1000;
    const dbType = datasource.db_type;
    const colExpr = quoteCol(table, column, dbType);
    const isMssql = dbType === 'azure_sql' || dbType === 'mssql';
    const sql = isMssql
      ? `SELECT TOP ${SAMPLE} ${colExpr} AS v FROM ${quoteTable(table, dbType)} WHERE ${colExpr} IS NOT NULL`
      : `SELECT ${colExpr} AS v FROM ${quoteTable(table, dbType)} WHERE ${colExpr} IS NOT NULL LIMIT ${SAMPLE}`;

    const rows = await conn.query(sql);
    const sampleSize = rows.length;
    if (sampleSize === 0) {
      return res.json({ cardinality: '1', sampleSize: 0, distinct: 0, note: 'No non-null values to sample' });
    }
    const seen = new Set();
    for (const r of rows) {
      const v = r.v ?? r.V;
      seen.add(String(v));
    }
    const cardinality = seen.size === sampleSize ? '1' : '*';
    res.json({ cardinality, sampleSize, distinct: seen.size });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    conn?.close();
  }
});

// Cancel an in-flight query by its client-generated queryId. The client
// passes the same queryId both in /query (to register) and here (to cancel).
// We only allow cancellation by the same authenticated user who started the
// query — a public report viewer can cancel their own queries but not those
// of other sessions sharing the server.
router.post('/cancel-query', (req, res) => {
  const { queryId } = req.body || {};
  if (!queryId) return res.status(400).json({ error: 'Missing queryId' });
  const entry = inFlightQueries.get(String(queryId));
  if (!entry) return res.json({ canceled: false, reason: 'not-found' });
  // Same-user check. null userId means the original query was public, so
  // anyone can cancel it; authenticated queries require a matching user.
  const requesterId = req.isAuthenticated() ? req.user.id : null;
  if (entry.userId != null && entry.userId !== requesterId) {
    return res.status(403).json({ error: 'Not allowed to cancel this query' });
  }
  try { entry.cancel(); }
  catch (e) { console.warn('[cancel-query] cancel threw', e.message); }
  // Remove eagerly so a duplicate cancel returns 'not-found' instead of
  // double-canceling (the /query finally also deletes, redundant but safe).
  inFlightQueries.delete(String(queryId));
  res.json({ canceled: true });
});

// Query model: build SQL from selected dimensions + measures.
// Accessible if the user has access to any report linked to this model
// (owner, global admin, public report, or workspace member).
router.post('/:id/query', async (req, res) => {
  const model = db.prepare('SELECT * FROM models WHERE id = ?').get(req.params.id);
  if (!model || !canAccessModel(model, req.user)) return res.status(404).json({ error: 'Model not found' });

  const datasource = db.prepare('SELECT * FROM datasources WHERE id = ?').get(model.datasource_id);
  if (!datasource) return res.status(404).json({ error: 'Datasource not found' });
  const dbType = datasource.db_type;

  let {
    dimensionNames, measureNames, limit, offset, filters, widgetFilters,
    distinct, measureAggOverrides, sqlOnly,
    // Optional: client-generated UUID. When set, the server registers the
    // running query in inFlightQueries so a sibling POST /cancel-query
    // request can abort it via the dialect's native cancel mechanism.
    queryId,
    // When `true`, skip the cache lookup and force a fresh DB hit. The
    // client sets this on user-initiated refresh; the freshly-fetched
    // rows still get written back into the cache so subsequent requests
    // for the same shape become hot.
    bypassCache,
    // When `true`, skip the trailing `queryCache.set` after a fresh SQL
    // execution. The warmer sets this for plan items whose results will
    // also be stored in `preAggCache` — avoiding storing the same data
    // twice (raw row-of-objects in queryCache + columnar in preAgg).
    // Caller-trusted: it's only honoured for SUCCESSFUL fresh runs;
    // doesn't change cache LOOKUP behaviour.
    skipCacheSet,
    // Report-scoped extensions: dims/measures defined ONLY in the calling
    // report (so other reports on the same model don't see them), plus
    // label/type overrides for model-level dims/measures. The model itself
    // stays untouched. The frontend sends these from report.settings.
    extraDimensions, extraMeasures, dimensionOverrides, measureOverrides,
    // Optional: report context. Used here to gate extras (a viewer can't
    // smuggle a custom-SQL measure into a /query they don't own) and by
    // cloud to resolve workspace-scoped timeouts.
    reportId,
  } = req.body;

  // Gate `extraMeasures` / `extraDimensions` / overrides: these can carry
  // arbitrary SQL (via `aggregation: 'custom'` + `expression`) or arbitrary
  // table/column references. Only the model owner and admins may pass
  // *unpersisted* extras in the request body — that's how the UI preview
  // works for unsaved changes. Everyone else gets either the report's
  // already-saved extras (when reportId points to a report they can read)
  // or nothing at all.
  const userIsModelOwner = req.isAuthenticated() && req.user.id === model.user_id;
  const userIsAdmin = req.isAuthenticated() && req.user.role === 'admin';
  if (!userIsModelOwner && !userIsAdmin) {
    if (reportId) {
      const report = db.prepare('SELECT settings FROM reports WHERE id = ?').get(String(reportId));
      const persisted = report ? JSON.parse(report.settings || '{}') : {};
      extraMeasures = Array.isArray(persisted.extraMeasures) ? persisted.extraMeasures : [];
      extraDimensions = Array.isArray(persisted.extraDimensions) ? persisted.extraDimensions : [];
      measureOverrides = (persisted.measureOverrides && typeof persisted.measureOverrides === 'object')
        ? persisted.measureOverrides : {};
      dimensionOverrides = (persisted.dimensionOverrides && typeof persisted.dimensionOverrides === 'object')
        ? persisted.dimensionOverrides : {};
    } else {
      extraMeasures = [];
      extraDimensions = [];
      measureOverrides = {};
      dimensionOverrides = {};
    }
  }
  // dimensionNames: ["orders.customer_name", "orders.status"]
  // measureNames: ["orders.total_amount_sum", "orders.count"]

  // Merge model-level definitions with the report's extras / overrides.
  // Extras: appended to the list. Overrides: shallow-merged into the
  // matching entry (so the user can rename a model dim per-report or
  // re-type it).
  const allDimensions = JSON.parse(model.dimensions);
  const allMeasures = JSON.parse(model.measures);
  if (dimensionOverrides && typeof dimensionOverrides === 'object') {
    for (const [name, ov] of Object.entries(dimensionOverrides)) {
      const idx = allDimensions.findIndex((d) => d.name === name);
      if (idx >= 0) allDimensions[idx] = { ...allDimensions[idx], ...ov };
    }
  }
  if (Array.isArray(extraDimensions)) {
    for (const d of extraDimensions) {
      if (d && d.name && !allDimensions.find((x) => x.name === d.name)) {
        allDimensions.push(d);
      }
    }
  }
  if (measureOverrides && typeof measureOverrides === 'object') {
    for (const [name, ov] of Object.entries(measureOverrides)) {
      const idx = allMeasures.findIndex((m) => m.name === name);
      if (idx >= 0) allMeasures[idx] = { ...allMeasures[idx], ...ov };
    }
  }
  if (Array.isArray(extraMeasures)) {
    for (const m of extraMeasures) {
      if (m && m.name && !allMeasures.find((x) => x.name === m.name)) {
        allMeasures.push(m);
      }
    }
  }
  const allJoins = JSON.parse(model.joins);
  const rls = JSON.parse(model.rls || '{}');
  // Per-column overrides (type + optional format). Used by castToDate to
  // pick the right SQL parser when a date column is stored as text in a
  // non-ISO format.
  const columnTypes = JSON.parse(model.column_types || '{}');

  // Inline `${measure_name}` placeholders inside a custom SQL expression by
  // expanding them to the referenced measure's SQL. Lets users compose
  // custom measures from other measures (Power BI's `[Measure]` ref).
  // Resolution rules:
  //   - Regular measure (SUM/AVG/COUNT/MIN/MAX) → `<AGG>("table"."col")`
  //   - Custom measure → `(<recursively-inlined expression>)`
  //   - Filtered measure (intersection) → `<AGG>(CASE WHEN <rules> THEN col END)`
  //   - Filtered measure (override) → emits a placeholder which is resolved to
  //     a scalar subquery after fromClause/whereParts are finalised.
  // Cycle detection: track the resolution path; throw on revisit so a
  // mutually-recursive pair surfaces a clean error rather than blowing the
  // stack.
  // overrideRefInfos collects override-mode references so the post-FROM step
  // can substitute the placeholders with subqueries.
  const overrideRefInfos = [];
  function inlineMeasureRefs(expression, pathStack = []) {
    if (!expression) return expression;
    return String(expression).replace(/\$\{\s*([^}]+?)\s*\}/g, (match, name) => {
      const trimmed = name.trim();
      if (pathStack.includes(trimmed)) {
        throw new Error(`Cyclic measure reference: ${[...pathStack, trimmed].join(' → ')}`);
      }
      // Prefer name match (canonical, stable identifier) over label match —
      // labels are user-editable and can collide between measures.
      const target = allMeasures.find((mm) => mm.name === trimmed)
        || allMeasures.find((mm) => mm.label === trimmed);
      if (!target) return match; // leave unresolved so the SQL error is informative
      const hasRules = Array.isArray(target.filterRules) && target.filterRules.length > 0;
      // Filtered measure (intersection): wrap aggregate(s) with CASE WHEN.
      // This branch handles BOTH bare aggregations (sum/avg/count/…) AND
      // custom-expression filtered measures — the latter get every
      // aggregate inside their expression wrapped via transformAggregates.
      // Must run BEFORE the "custom expression" fall-through, otherwise a
      // custom measure with filterRules would be inlined without its
      // CASE WHEN context.
      if (hasRules && !target.overrideFilters) {
        const clauses = target.filterRules.map(buildRuleClause).filter(Boolean);
        if (clauses.length > 0) {
          const whenSql = clauses.join(' AND ');
          if (target.aggregation === 'custom' && target.expression) {
            // Recursively inline any nested refs in the bare expression,
            // then wrap each aggregate with CASE WHEN.
            const inlinedBare = inlineMeasureRefs(target.expression, [...pathStack, trimmed]);
            const wrapped = transformAggregates(
              inlinedBare,
              ['SUM', 'AVG', 'MIN', 'MAX', 'COUNT'],
              (fn, arg) => `${fn}(CASE WHEN ${whenSql} THEN ${arg} END)`,
            );
            return `(${wrapped})`;
          }
          if (target.aggregation === 'count' || (target.column === '*' && !target.table)) {
            return `COUNT(CASE WHEN ${whenSql} THEN 1 END)`;
          }
          if (target.table && target.column) {
            tablesUsed.add(target.table);
            return `${normalizeAggregation(target.aggregation).toUpperCase()}(CASE WHEN ${whenSql} THEN ${quoteCol(target.table, target.column, dbType)} END)`;
          }
        }
        // No clauses survived (rules pointed at unknown fields) → fall through.
      }
      if (hasRules && target.overrideFilters) {
        // Override mode: emit a placeholder; resolved to a scalar subquery
        // after fromClause is built. Register tables now so the JOIN graph
        // picks them up.
        for (const r of target.filterRules) {
          if (!r || r.isMeasure || !r.field) continue;
          const dimDef = allDimensions.find((d) => d.name === r.field);
          if (dimDef) tablesUsed.add(dimDef.table);
        }
        if (target.table) tablesUsed.add(target.table);
        const refIdx = overrideRefInfos.length;
        overrideRefInfos.push({ target });
        return `__OVERRIDE_REF_${refIdx}__`;
      }
      // Custom expression (no filterRules): recursively inline.
      if (target.aggregation === 'custom' && target.expression) {
        return `(${inlineMeasureRefs(target.expression, [...pathStack, trimmed])})`;
      }
      // Regular measure paths.
      if (target.aggregation === 'count' || (target.column === '*' && !target.table)) {
        return 'COUNT(*)';
      }
      if (target.table && target.column) {
        tablesUsed.add(target.table);
        return `${normalizeAggregation(target.aggregation).toUpperCase()}(${quoteCol(target.table, target.column, dbType)})`;
      }
      return match;
    });
  }

  // Walk a SQL expression and replace each top-level aggregate (SUM/AVG/
  // MIN/MAX/COUNT) by `transform(fn, arg)`. Paren-aware: tracks depth so a
  // CASE WHEN containing `IN (...)` inside the aggregate doesn't trick the
  // matcher into terminating early. Skips string literals so an expression
  // like `'SUM(x)'` stays untouched. The same primitive backs both the
  // NUMERIC cast (for integer-division avoidance) and the CASE WHEN wrap
  // (for filtered-measure intersection mode).
  function transformAggregates(expression, fns, transform) {
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
      // Aggregates are word-boundaried; skip if previous char is alpha/_
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

  // Wrap each top-level aggregate so its result is in a decimal/numeric
  // type — prevents the integer-division-truncates-to-0 trap when the
  // user writes a / inside a custom expression. Dialect-aware so it works
  // on every supported backend:
  //   - PG / Azure PG / DuckDB / MSSQL / Azure SQL: CAST(... AS NUMERIC)
  //     (PG flavours accept DECIMAL too but NUMERIC is more idiomatic)
  //   - MySQL: CAST(... AS DECIMAL(38,10)) — MySQL refuses CAST AS NUMERIC
  //     without precision in older versions
  //   - BigQuery: CAST(... AS NUMERIC) — BQ already returns FLOAT64 from
  //     `/` so this is mostly defensive, but harmless
  // SUM/AVG/MIN/MAX get the argument cast (preserves decimal precision);
  // COUNT gets cast on its return value (it ignores its argument's type).
  function dialectNumericCast(inner) {
    if (dbType === 'mysql') return `CAST(${inner} AS DECIMAL(38,10))`;
    return `CAST(${inner} AS NUMERIC)`;
  }
  function applyNumericCast(expression) {
    return transformAggregates(
      expression,
      ['SUM', 'AVG', 'MIN', 'MAX', 'COUNT'],
      (fn, arg) => fn.toUpperCase() === 'COUNT'
        ? dialectNumericCast(`${fn}(${arg})`)
        : `${fn}(${dialectNumericCast(arg)})`,
    );
  }

  // RLS: model owner and global admins bypass. Everyone else (including unauthenticated
  // viewers of public reports) is filtered by the rule set against their email.
  const isOwner = req.isAuthenticated() && req.user.id === model.user_id;
  const isAdmin = req.isAuthenticated() && req.user.role === 'admin';
  const rlsApplies = rls && rls.enabled && rls.table && rls.primaryKey && !isOwner && !isAdmin;
  let allowedRlsKeys = null;
  if (rlsApplies) {
    const email = req.isAuthenticated() ? req.user.email : '';
    allowedRlsKeys = getAllowedRlsKeys(rls, email);
  }

  // Detect missing references and report them explicitly instead of silently dropping
  const missingDims = (dimensionNames || []).filter((name) => !allDimensions.find((d) => d.name === name));
  const missingMeas = (measureNames || []).filter((name) => !allMeasures.find((m) => m.name === name));
  if (missingDims.length > 0 || missingMeas.length > 0) {
    const parts = [];
    if (missingDims.length) parts.push(`dimension(s) ${missingDims.map((n) => `"${n}"`).join(', ')}`);
    if (missingMeas.length) parts.push(`measure(s) ${missingMeas.map((n) => `"${n}"`).join(', ')}`);
    return res.status(400).json({ error: `Missing in model: ${parts.join(' and ')}. Update the widget binding or restore the field in the model.` });
  }

  // Preserve the order from the request (axis first, then legend)
  const selectedDimensions = dimensionNames
    ? dimensionNames.map((name) => allDimensions.find((d) => d.name === name)).filter(Boolean)
    : [];
  const selectedMeasures = measureNames
    ? measureNames.map((name) => {
        const m = allMeasures.find((mm) => mm.name === name);
        if (!m) return null;
        // Apply per-widget aggregation override if provided
        if (measureAggOverrides && measureAggOverrides[name] && m.aggregation !== 'custom') {
          return { ...m, aggregation: measureAggOverrides[name] };
        }
        return m;
      }).filter(Boolean)
    : [];

  if (selectedDimensions.length === 0 && selectedMeasures.length === 0) {
    return res.status(400).json({ error: 'Select at least one dimension or measure' });
  }

  // Build SQL
  const selectParts = [];
  const groupByParts = [];
  const tablesUsed = new Set();

  // Pre-register filter tables so they get JOINed.
  // whereParts is an array of `{ field, sql }` objects so that override-mode
  // filtered measures (CALCULATE-style) can selectively drop the clauses on
  // their override fields when building their correlated subquery.
  // `field` is the dimension name (or null for non-dim clauses like RLS).
  const whereParts = [];
  if (filters && typeof filters === 'object') {
    for (const [dimName, values] of Object.entries(filters)) {
      if (!Array.isArray(values) || values.length === 0) continue;
      const dimDef = allDimensions.find((d) => d.name === dimName);
      if (dimDef) {
        tablesUsed.add(dimDef.table);
        const col = quoteCol(dimDef.table, dimDef.column, dbType);
        if (dimDef.datePart) {
          // Drill-down on a date-part dim — filter against the same
          // EXTRACT/YEAR(...) expression used in SELECT. Type-aware IN
          // emits a numeric `IN (2024)` for num_year etc. instead of
          // wrapping a CAST around the EXTRACT.
          const expr = buildDatePartExpr(dimDef, dbType, columnTypes);
          const clause = buildInList(expr, effectiveDimType(dimDef), values, dbType);
          if (clause) whereParts.push({ field: dimName, sql: clause });
        } else if (dimDef.type === 'date') {
          const fmt = getDateFormat(dimDef.table, dimDef.column, columnTypes);
          const escaped = values.map((v) => quoteLiteral(v, dbType)).join(', ');
          whereParts.push({ field: dimName, sql: `${castToDate(col, dbType, fmt)} IN (${escaped})` });
        } else {
          // Type-aware IN — string columns compared without a CAST so the
          // engine can hit the index, numeric columns compared as numbers.
          const clause = buildInList(col, effectiveDimType(dimDef), values, dbType);
          if (clause) whereParts.push({ field: dimName, sql: clause });
        }
      }
    }
  }

  // Per-widget filters with rich operators. Built here for dimension filters
  // (added to WHERE) and later for measure filters (added to HAVING after the
  // measure aggregation expressions are constructed). Custom-expression
  // measures are not yet supported in HAVING.
  const havingParts = [];
  const escVal = (v) => quoteLiteral(v, dbType);
  const isEmpty = (v) => v == null || v === '';
  function buildScalarClause(colExpr, op, value, values, isDateCol, dateFmt, dimType) {
    const cast = isDateCol ? castToDate(colExpr, dbType, dateFmt || 'auto') : colExpr;
    const list = Array.isArray(values) ? values : (Array.isArray(value) ? value : null);
    const numericFor = (v) => isDateCol ? escVal(v) : Number(v);
    switch (op) {
      case 'in':
        return list?.length ? buildInList(colExpr, dimType || 'string', list, dbType) : null;
      case 'not_in':
        return list?.length ? buildInList(colExpr, dimType || 'string', list, dbType, true) : null;
      case 'eq':  return isEmpty(value) ? null : `${cast} = ${escVal(value)}`;
      case 'neq': return isEmpty(value) ? null : `${cast} <> ${escVal(value)}`;
      case 'gt':  return isEmpty(value) ? null : `${cast} > ${numericFor(value)}`;
      case 'gte': return isEmpty(value) ? null : `${cast} >= ${numericFor(value)}`;
      case 'lt':  return isEmpty(value) ? null : `${cast} < ${numericFor(value)}`;
      case 'lte': return isEmpty(value) ? null : `${cast} <= ${numericFor(value)}`;
      case 'between': {
        const [a, b] = list || [];
        if (isEmpty(a) || isEmpty(b)) return null;
        return isDateCol
          ? `${cast} BETWEEN ${escVal(a)} AND ${escVal(b)}`
          : `${cast} BETWEEN ${Number(a)} AND ${Number(b)}`;
      }
      case 'contains':     return isEmpty(value) ? null : `${castToString(colExpr, dbType)} LIKE ${escVal('%' + value + '%')}`;
      case 'not_contains': return isEmpty(value) ? null : `${castToString(colExpr, dbType)} NOT LIKE ${escVal('%' + value + '%')}`;
      case 'starts_with':  return isEmpty(value) ? null : `${castToString(colExpr, dbType)} LIKE ${escVal(value + '%')}`;
      case 'ends_with':    return isEmpty(value) ? null : `${castToString(colExpr, dbType)} LIKE ${escVal('%' + value)}`;
      case 'is_empty':     return `(${colExpr} IS NULL OR ${castToString(colExpr, dbType)} = '')`;
      case 'is_not_empty': return `(${colExpr} IS NOT NULL AND ${castToString(colExpr, dbType)} <> '')`;
      default: return null;
    }
  }
  // Apply dimension filters now (WHERE). Measure filters are deferred until
  // the SELECT is built, then pushed onto havingParts below.
  const measureFiltersDeferred = [];
  if (Array.isArray(widgetFilters)) {
    for (const f of widgetFilters) {
      if (!f || typeof f !== 'object' || !f.field || !f.op) continue;
      if (f.isMeasure) { measureFiltersDeferred.push(f); continue; }
      const dimDef = allDimensions.find((d) => d.name === f.field);
      if (!dimDef) continue;
      tablesUsed.add(dimDef.table);
      // For date-part dims, the comparison must be against the same
      // EXTRACT/YEAR(...) expression used in SELECT — otherwise filtering
      // by year on a "_date.num_year" dim would never match the raw
      // timestamp column.
      const col = dimDef.datePart
        ? buildDatePartExpr(dimDef, dbType, columnTypes)
        : quoteCol(dimDef.table, dimDef.column, dbType);
      const clause = buildScalarClause(
        col, f.op, f.value, f.values,
        // datePart dims aren't date-typed — they're year/month numbers etc.
        !dimDef.datePart && dimDef.type === 'date',
        getDateFormat(dimDef.table, dimDef.column, columnTypes),
        effectiveDimType(dimDef),
      );
      if (clause) whereParts.push({ field: f.field, sql: clause });
    }
  }

  selectedDimensions.forEach((d) => {
    if (d.datePart) {
      // Date part derived column — delegate to the dialect-aware helper so
      // the SELECT and the WHERE/HAVING paths stay consistent (they all need
      // the same EXTRACT/YEAR(...) expression for drill-down to work).
      const expr = buildDatePartExpr(d, dbType, columnTypes);
      selectParts.push(`${expr} AS ${quoteIdent(d.label || d.name, dbType)}`);
      groupByParts.push(expr);
      tablesUsed.add(d.table);
    } else {
      selectParts.push(`${quoteCol(d.table, d.column, dbType)} AS ${quoteIdent(d.label || d.name, dbType)}`);
      groupByParts.push(quoteCol(d.table, d.column, dbType));
      tablesUsed.add(d.table);
    }
  });

  // Helper used by filtered measures to convert a single FilterRule into a
  // SQL fragment. Mirrors the WHERE-loop above but returns the clause
  // instead of pushing it. Skips measure-on-measure filters (no HAVING
  // sense inside a CASE WHEN — would need a subquery), and stamps the
  // referenced field's table on `tablesUsed` so the JOIN graph stays correct.
  const buildRuleClause = (rule) => {
    if (!rule || rule.isMeasure || !rule.field || !rule.op) return null;
    const dimDef = allDimensions.find((d) => d.name === rule.field);
    if (!dimDef) return null;
    tablesUsed.add(dimDef.table);
    const col = dimDef.datePart
      ? buildDatePartExpr(dimDef, dbType, columnTypes)
      : quoteCol(dimDef.table, dimDef.column, dbType);
    return buildScalarClause(
      col, rule.op, rule.value, rule.values,
      !dimDef.datePart && dimDef.type === 'date',
      getDateFormat(dimDef.table, dimDef.column, columnTypes),
      effectiveDimType(dimDef),
    );
  };

  // Override-mode filtered measures emit a placeholder during the SELECT
  // construction loop and are filled in later (after the FROM clause is
  // assembled) with a scalar subquery. The subquery is uncorrelated: it
  // duplicates the main FROM/JOIN graph and applies its own WHERE clause
  // that drops the visual's filters on the override fields and substitutes
  // the measure's own filterRules. This works perfectly for scorecards (no
  // GROUP BY); for grouped charts the same scalar value is repeated across
  // every group — Power BI's CALCULATE-on-grouped semantics would require
  // a correlated subquery, deferred to a follow-up.
  const overrideMeasureInfos = [];

  selectedMeasures.forEach((m) => {
    if (m.table) tablesUsed.add(m.table);
    // Override-mode filtered measure: register tables referenced by its
    // filterRules so the JOIN graph picks them up, then push a placeholder
    // into selectParts. We patch it up after fromClause is built.
    if (Array.isArray(m.filterRules) && m.filterRules.length > 0 && m.overrideFilters) {
      for (const r of m.filterRules) {
        if (!r || r.isMeasure || !r.field) continue;
        const dimDef = allDimensions.find((d) => d.name === r.field);
        if (dimDef) tablesUsed.add(dimDef.table);
      }
      // Custom expression: inline `${measure}` refs and register tables
      // referenced inside the resolved SQL so the outer JOIN graph picks
      // them up (the subquery duplicates the outer FROM clause, so its
      // tables must already be in tablesUsed).
      let inlinedExpression = null;
      if (m.aggregation === 'custom' && m.expression) {
        try {
          inlinedExpression = inlineMeasureRefs(m.expression);
        } catch (e) {
          return res.status(400).json({ error: e.message });
        }
        const allFieldsForLookup = [...allDimensions, ...allMeasures.filter((x) => x.table)];
        for (const field of allFieldsForLookup) {
          if (inlinedExpression.includes(field.column) || inlinedExpression.includes(field.table)) {
            tablesUsed.add(field.table);
          }
        }
      }
      overrideMeasureInfos.push({
        index: selectParts.length,
        m,
        label: m.label || m.name,
        inlinedExpression,
      });
      selectParts.push(null); // placeholder, filled in after fromClause is built
      return;
    }
    // Filtered measure (intersection mode): aggregate over rows that
    // satisfy `filterRules`, otherwise NULL. The visual's WHERE clauses
    // still apply, so this is a strict subset of the visual's data —
    // perfect for "active sales only", "this category only" etc.
    if (Array.isArray(m.filterRules) && m.filterRules.length > 0 && !m.overrideFilters) {
      const clauses = m.filterRules.map(buildRuleClause).filter(Boolean);
      if (clauses.length > 0) {
        const whenSql = clauses.join(' AND ');
        if (m.aggregation === 'custom' && m.expression) {
          // Inline `${measure}` references before the CASE WHEN wrap so any
          // aggregates from referenced measures get the filter context too.
          let inlined;
          try {
            inlined = inlineMeasureRefs(m.expression);
          } catch (e) {
            return res.status(400).json({ error: e.message });
          }
          // Wrap each top-level aggregate's argument in `CASE WHEN <rules>
          // THEN <arg> END`. Paren-aware so an inlined CASE WHEN containing
          // `IN (...)` doesn't break the matcher. Composes with the NUMERIC
          // cast for SUM/AVG so divisions preserve decimals.
          const rewritten = transformAggregates(
            inlined,
            ['SUM', 'AVG', 'MIN', 'MAX', 'COUNT'],
            (fn, arg) => {
              const cast = (fn.toUpperCase() === 'SUM' || fn.toUpperCase() === 'AVG')
                ? dialectNumericCast(arg)
                : arg;
              return `${fn}(CASE WHEN ${whenSql} THEN ${cast} END)`;
            },
          );
          selectParts.push(`(${rewritten}) AS ${quoteIdent(m.label || m.name, dbType)}`);
          // Register tables referenced by the inlined expression
          const allFieldsForLookup = [...allDimensions, ...allMeasures.filter((x) => x.table)];
          for (const field of allFieldsForLookup) {
            if (inlined.includes(field.column) || inlined.includes(field.table)) {
              tablesUsed.add(field.table);
            }
          }
        } else if (m.aggregation === 'count' || (m.column === '*' && !m.table)) {
          selectParts.push(`COUNT(CASE WHEN ${whenSql} THEN 1 END) AS ${quoteIdent(m.label || m.name, dbType)}`);
        } else if (m.table && m.column) {
          const rawCol = quoteCol(m.table, m.column, dbType);
          const ovType = getOverrideType(m.table, m.column, columnTypes);
          const colExpr = (ovType === 'integer' || ovType === 'decimal' || ovType === 'number')
            ? castToNumber(rawCol, dbType, ovType)
            : rawCol;
          const aggExpr = `${normalizeAggregation(m.aggregation).toUpperCase()}(CASE WHEN ${whenSql} THEN ${colExpr} END)`;
          // Same INTERVAL handling as regular measures.
          const isInterval = String(m.dataType || '').toLowerCase() === 'interval';
          const supportsExtractEpoch = dbType === 'postgres' || dbType === 'azure_postgres' || dbType === 'duckdb';
          const finalExpr = (isInterval && supportsExtractEpoch)
            ? `EXTRACT(EPOCH FROM ${aggExpr})`
            : aggExpr;
          selectParts.push(`${finalExpr} AS ${quoteIdent(m.label || m.name, dbType)}`);
        }
        return; // handled
      }
      // No clauses survived (e.g. all rules pointed at non-existent fields)
      // → fall through to the regular aggregation path.
    }
    if (m.aggregation === 'custom' && m.expression) {
      // Inline `${measure}` references first so the NUMERIC cast also wraps
      // any aggregates that came from referenced measures.
      let inlined;
      try {
        inlined = inlineMeasureRefs(m.expression);
      } catch (e) {
        return res.status(400).json({ error: e.message });
      }
      // Custom SQL expression - force NUMERIC inside aggregates to avoid integer division truncation
      // SUM(col) becomes SUM((col)::NUMERIC) so division preserves decimals.
      // Paren-aware so a CASE WHEN ... IN (..) inside an aggregate doesn't
      // break the matcher.
      const numericExpr = applyNumericCast(inlined);
      selectParts.push(`(${numericExpr}) AS ${quoteIdent(m.label || m.name, dbType)}`);
      // Extract table references from the INLINED expression for joins
      const allFieldsForLookup = [...allDimensions, ...allMeasures.filter((x) => x.table)];
      for (const field of allFieldsForLookup) {
        if (inlined.includes(field.column) || inlined.includes(field.table)) {
          tablesUsed.add(field.table);
        }
      }
    } else if (m.aggregation === 'count') {
      selectParts.push(`COUNT(*) AS ${quoteIdent(m.label || m.name, dbType)}`);
    } else {
      // Wrap the column in CAST when the user has overridden it to a numeric
      // type — otherwise SUM/AVG on a text column (e.g. nvarchar storing
      // numbers) blows up with "operand data type ... is invalid for sum".
      const rawCol = quoteCol(m.table, m.column, dbType);
      const ovType = getOverrideType(m.table, m.column, columnTypes);
      const colExpr = (ovType === 'integer' || ovType === 'decimal' || ovType === 'number')
        ? castToNumber(rawCol, dbType, ovType)
        : rawCol;
      const aggExpr = `${normalizeAggregation(m.aggregation).toUpperCase()}(${colExpr})`;
      // `interval` columns: SUM/AVG/MIN/MAX return an interval value, which
      // the underlying driver delivers as a JS object — widgets then render
      // `[object Object]`. PostgreSQL and DuckDB both support
      // `EXTRACT(EPOCH FROM …)` to flatten to seconds at SQL time. BigQuery
      // also has an INTERVAL type but no equivalent EPOCH extract — its
      // intervals get flattened by the row post-processor instead. MySQL
      // and MSSQL have no native interval column type so nothing to wrap.
      const isInterval = String(m.dataType || '').toLowerCase() === 'interval';
      const supportsExtractEpoch = dbType === 'postgres' || dbType === 'azure_postgres' || dbType === 'duckdb';
      const finalExpr = (isInterval && supportsExtractEpoch)
        ? `EXTRACT(EPOCH FROM ${aggExpr})`
        : aggExpr;
      selectParts.push(`${finalExpr} AS "${m.label || m.name}"`);
    }
  });

  // Apply per-widget MEASURE filters as HAVING clauses, now that aggregation
  // expressions are known. Skips custom expressions (not yet supported in HAVING).
  let topNOverride = null; // { aggExpr, n, direction: 'DESC' | 'ASC' }
  for (const f of measureFiltersDeferred) {
    const measDef = allMeasures.find((mm) => mm.name === f.field);
    if (!measDef) continue;
    if (measDef.aggregation === 'custom') continue; // unsupported for now
    // Same numeric-cast logic as the SELECT path so HAVING references the
    // exact same expression.
    const rawColH = (measDef.table && measDef.column)
      ? quoteCol(measDef.table, measDef.column, dbType)
      : null;
    const ovTypeH = getOverrideType(measDef.table, measDef.column, columnTypes);
    const colExprH = rawColH && (ovTypeH === 'integer' || ovTypeH === 'decimal' || ovTypeH === 'number')
      ? castToNumber(rawColH, dbType, ovTypeH)
      : rawColH;
    const baseAggExpr = measDef.aggregation === 'count'
      ? 'COUNT(*)'
      : (colExprH
          ? `${normalizeAggregation(measDef.aggregation).toUpperCase()}(${colExprH})`
          : null);
    if (!baseAggExpr) continue;
    // Mirror the SELECT path: `interval` aggregates need EXTRACT(EPOCH …)
    // so HAVING comparisons are against a number rather than an interval.
    // PG + DuckDB share the syntax; BigQuery falls back to the row post-
    // processor (and HAVING on intervals there is rare anyway).
    const isIntervalH = String(measDef.dataType || '').toLowerCase() === 'interval';
    const supportsExtractEpochH = dbType === 'postgres' || dbType === 'azure_postgres' || dbType === 'duckdb';
    const aggExpr = (isIntervalH && supportsExtractEpochH && measDef.aggregation !== 'count')
      ? `EXTRACT(EPOCH FROM ${baseAggExpr})`
      : baseAggExpr;
    if (measDef.table) tablesUsed.add(measDef.table);
    // Top N / Bottom N — these aren't WHERE/HAVING clauses; they override
    // ORDER BY and LIMIT after aggregation. First top/bottom filter wins.
    if ((f.op === 'top_n' || f.op === 'bottom_n')) {
      if (topNOverride) continue;
      const n = parseInt(f.value, 10);
      if (Number.isFinite(n) && n > 0) {
        topNOverride = { aggExpr, n, direction: f.op === 'top_n' ? 'DESC' : 'ASC' };
      }
      continue;
    }
    const clause = buildScalarClause(aggExpr, f.op, f.value, f.values, false);
    if (clause) havingParts.push(clause);
  }

  // RLS WHERE injection: must be added after all dim/measure tables are registered
  // (so the JOIN graph picks up the RLS table) but before building the FROM clause.
  if (rlsApplies) {
    // Safety: every table queried must be reachable from the RLS table via joins.
    // Otherwise the SQL would fall back to a cross-join and the unreachable table's
    // rows would all leak through, multiplied by the count of allowed RLS rows.
    const reachable = tablesReachableFrom(rls.table, allJoins);
    const unreachable = Array.from(tablesUsed).filter((t) => !reachable.has(t));
    if (unreachable.length > 0) {
      // Deny everything rather than risk leaking rows from an unconstrained table.
      tablesUsed.add(rls.table);
      whereParts.push({ field: null, sql: '1 = 0' });
    } else {
      tablesUsed.add(rls.table);
      if (!allowedRlsKeys || allowedRlsKeys.length === 0) {
        // No matching rule for this user → deny everything.
        whereParts.push({ field: null, sql: '1 = 0' });
      } else {
        const escaped = allowedRlsKeys.map((v) => quoteLiteral(v, dbType)).join(', ');
        whereParts.push({ field: null, sql: `${castToString(quoteCol(rls.table, rls.primaryKey, dbType), dbType)} IN (${escaped})` });
      }
    }
  }

  // Build FROM + JOINs. Greedy traversal of the join graph: start with the
  // most "fact-like" table (the one appearing with cardinality "*" on the
  // most joins), then keep pulling in any remaining table that has a
  // direct join with one already added. Starting from a dim would emit
  // `FROM dim LEFT JOIN fact` — semantically OK, but `FROM fact LEFT JOIN dim`
  // is the canonical star-schema shape and what most analytics readers
  // expect.
  let tableList = Array.from(tablesUsed);
  if (tableList.length > 1) {
    const factScore = {};
    for (const t of tableList) factScore[t] = 0;
    for (const j of allJoins) {
      const c = j.cardinality;
      if (!c) continue;
      if (c.from === '*' && tableList.includes(j.from_table)) factScore[j.from_table] += 1;
      if (c.to === '*' && tableList.includes(j.to_table)) factScore[j.to_table] += 1;
    }
    // Stable sort: highest fact score first, original index as tie-breaker
    // so two equal-score tables keep their original relative order.
    tableList.sort((a, b) => (factScore[b] - factScore[a]) || (Array.from(tablesUsed).indexOf(a) - Array.from(tablesUsed).indexOf(b)));
  }
  // Snowflake bridging: when a referenced table has no direct join to the
  // root (e.g. filter on `d_entite` while the query SELECTs from
  // `f_appel_entrant_fin` and the only connection is via `d_destinataire`),
  // we need to pull the intermediate table(s) into the FROM clause. Without
  // this the greedy join loop below falls back to a comma-separated
  // cross-join — Cartesian product, wrong results.
  if (tableList.length > 1) {
    const rootTable = tableList[0];
    // Undirected adjacency over the full join graph.
    const adj = new Map();
    for (const j of allJoins || []) {
      if (!j || !j.from_table || !j.to_table) continue;
      if (!adj.has(j.from_table)) adj.set(j.from_table, new Set());
      if (!adj.has(j.to_table)) adj.set(j.to_table, new Set());
      adj.get(j.from_table).add(j.to_table);
      adj.get(j.to_table).add(j.from_table);
    }
    // BFS from root to record the parent of every reachable table — gives
    // us shortest path back to root by walking up the parent chain.
    const parent = new Map();
    parent.set(rootTable, null);
    const queue = [rootTable];
    while (queue.length > 0) {
      const cur = queue.shift();
      for (const next of adj.get(cur) || []) {
        if (parent.has(next)) continue;
        parent.set(next, cur);
        queue.push(next);
      }
    }
    // For every referenced table, walk the parent chain back to root and
    // add the intermediate tables. Skip tables that aren't reachable at
    // all (broken model — the greedy loop will fall back to cross-join,
    // matching the old behaviour for that pathological case).
    const expanded = new Set(tableList);
    for (const t of tableList) {
      if (t === rootTable || !parent.has(t)) continue;
      let cur = parent.get(t);
      while (cur !== null && cur !== rootTable) {
        if (!expanded.has(cur)) expanded.add(cur);
        cur = parent.get(cur);
      }
    }
    if (expanded.size > tableList.length) {
      // Re-sort with bridges included. The root stays first; bridge tables
      // get fact-score 0 and slot in after the genuinely referenced tables.
      tableList = Array.from(expanded);
      tableList.sort((a, b) => {
        if (a === rootTable) return -1;
        if (b === rootTable) return 1;
        return 0;
      });
    }
  }
  let fromClause = quoteTable(tableList[0], dbType);
  if (tableList.length > 1) {
    const added = new Set([tableList[0]]);
    const remaining = tableList.slice(1);
    while (remaining.length > 0) {
      let pickedIdx = -1;
      let pickedJoin = null;
      for (let i = 0; i < remaining.length; i++) {
        const t = remaining[i];
        const join = allJoins.find(
          (j) => (j.from_table === t && added.has(j.to_table)) ||
                 (j.to_table === t && added.has(j.from_table))
        );
        if (join) { pickedIdx = i; pickedJoin = join; break; }
      }
      if (pickedIdx === -1) {
        // No more reachable tables — fall back to a cross-join (comma) for
        // each leftover. Better than dropping them; they'll likely be
        // filtered down by WHERE in practice. A warning would help here
        // but we don't have a structured logger surfaced to the response.
        for (const t of remaining) fromClause += `, ${quoteTable(t, dbType)}`;
        break;
      }
      const t = remaining.splice(pickedIdx, 1)[0];
      const joinType = deriveJoinKeyword(pickedJoin);
      fromClause += ` ${joinType} JOIN ${quoteTable(t, dbType)} ON ${quoteCol(pickedJoin.from_table, pickedJoin.from_column, dbType)} = ${quoteCol(pickedJoin.to_table, pickedJoin.to_column, dbType)}`;
      added.add(t);
    }
  }

  // Fill in override-mode filtered measure placeholders. Each becomes a
  // scalar subquery that re-runs the same FROM/JOIN graph, drops the
  // visual's WHERE clauses on the override fields, and applies the
  // measure's own filterRules. This runs AFTER fromClause/whereParts are
  // finalised so the subquery has the same join graph as the outer query.
  for (const info of overrideMeasureInfos) {
    const { m, index, label, inlinedExpression } = info;
    const overrideFields = new Set(
      (m.filterRules || []).map((r) => r && r.field).filter(Boolean)
    );
    // Keep all WHERE clauses NOT tied to an override field. Untagged
    // clauses (RLS) are always kept so security is preserved.
    const keptWhere = whereParts
      .filter((w) => !w.field || !overrideFields.has(w.field))
      .map((w) => w.sql);
    const ruleClauses = (m.filterRules || []).map(buildRuleClause).filter(Boolean);
    const innerWhere = [...keptWhere, ...ruleClauses];
    // Build the inner aggregation expression — same shape as the regular
    // measure path so INTERVAL / numeric overrides / custom expressions
    // behave identically. Custom expressions are used verbatim (with the
    // same NUMERIC-cast trick as the regular custom path) since the
    // subquery's own WHERE applies the filter context.
    let innerAgg;
    if (m.aggregation === 'custom' && m.expression) {
      // Tables already registered in the selectedMeasures loop above.
      // `inlinedExpression` was computed there too — `${measure}` refs
      // already expanded.
      innerAgg = applyNumericCast(inlinedExpression || m.expression);
    } else if (m.aggregation === 'count' || (m.column === '*' && !m.table)) {
      innerAgg = 'COUNT(*)';
    } else if (m.table && m.column) {
      const rawCol = quoteCol(m.table, m.column, dbType);
      const ovType = getOverrideType(m.table, m.column, columnTypes);
      const colExpr = (ovType === 'integer' || ovType === 'decimal' || ovType === 'number')
        ? castToNumber(rawCol, dbType, ovType)
        : rawCol;
      innerAgg = `${normalizeAggregation(m.aggregation).toUpperCase()}(${colExpr})`;
      const isInterval = String(m.dataType || '').toLowerCase() === 'interval';
      const supportsExtractEpoch = dbType === 'postgres' || dbType === 'azure_postgres' || dbType === 'duckdb';
      if (isInterval && supportsExtractEpoch) {
        innerAgg = `EXTRACT(EPOCH FROM ${innerAgg})`;
      }
    } else {
      innerAgg = 'NULL';
    }
    let subSql = `SELECT ${innerAgg} FROM ${fromClause}`;
    if (innerWhere.length > 0) {
      subSql += ` WHERE ${innerWhere.join(' AND ')}`;
    }
    selectParts[index] = `(${subSql}) AS ${quoteIdent(label, dbType)}`;
  }

  // Resolve `__OVERRIDE_REF_<i>__` placeholders left by the inliner when a
  // custom expression referenced an override-mode filtered measure. Each
  // becomes an inline scalar subquery — same shape as the standalone
  // override-mode placeholder. Runs AFTER the overrideMeasureInfos patch-up
  // because those output strings can themselves contain these markers (when
  // an override-mode top-level measure has a custom expression that refs
  // another override-mode filtered measure).
  if (overrideRefInfos.length > 0) {
    for (let i = 0; i < overrideRefInfos.length; i++) {
      const { target } = overrideRefInfos[i];
      const overrideFields = new Set(
        (target.filterRules || []).map((r) => r && r.field).filter(Boolean)
      );
      const keptWhere = whereParts
        .filter((w) => !w.field || !overrideFields.has(w.field))
        .map((w) => w.sql);
      const ruleClauses = (target.filterRules || []).map(buildRuleClause).filter(Boolean);
      const innerWhere = [...keptWhere, ...ruleClauses];
      let innerAgg;
      if (target.aggregation === 'custom' && target.expression) {
        // Custom-expression target: inline any nested ${...} refs and use
        // verbatim. The subquery's own WHERE applies the filter context.
        innerAgg = applyNumericCast(inlineMeasureRefs(target.expression));
      } else if (target.aggregation === 'count' || (target.column === '*' && !target.table)) {
        innerAgg = 'COUNT(*)';
      } else if (target.table && target.column) {
        const rawCol = quoteCol(target.table, target.column, dbType);
        const ovType = getOverrideType(target.table, target.column, columnTypes);
        const colExpr = (ovType === 'integer' || ovType === 'decimal' || ovType === 'number')
          ? castToNumber(rawCol, dbType, ovType)
          : rawCol;
        innerAgg = `${normalizeAggregation(target.aggregation).toUpperCase()}(${colExpr})`;
      } else {
        innerAgg = 'NULL';
      }
      let subSql = `SELECT ${innerAgg} FROM ${fromClause}`;
      if (innerWhere.length > 0) subSql += ` WHERE ${innerWhere.join(' AND ')}`;
      const placeholder = `__OVERRIDE_REF_${i}__`;
      const replacement = `(${subSql})`;
      for (let j = 0; j < selectParts.length; j++) {
        if (typeof selectParts[j] === 'string' && selectParts[j].includes(placeholder)) {
          selectParts[j] = selectParts[j].split(placeholder).join(replacement);
        }
      }
    }
  }

  const useDistinct = distinct || (selectedDimensions.length > 0 && selectedMeasures.length === 0);
  let sql = `SELECT ${useDistinct ? 'DISTINCT ' : ''}${selectParts.join(', ')} FROM ${fromClause}`;

  if (whereParts.length > 0) {
    sql += ` WHERE ${whereParts.map((w) => w.sql).join(' AND ')}`;
  }

  if (groupByParts.length > 0 && selectedMeasures.length > 0) {
    sql += ` GROUP BY ${groupByParts.join(', ')}`;
  }

  if (havingParts.length > 0 && selectedMeasures.length > 0) {
    sql += ` HAVING ${havingParts.join(' AND ')}`;
  }

  const MAX_ROWS = 1000000;
  // Top/Bottom N filter (set above) replaces both the default ORDER BY (which
  // is by the first dimension for stability) and the configured LIMIT.
  if (topNOverride) {
    // NULL-handling on ORDER BY is dialect-specific. Postgres / DuckDB /
    // BigQuery accept "NULLS LAST" inline. MySQL emulates with "<col> IS NULL".
    // SQL Server / Azure SQL has neither; in practice aggregates over a
    // non-empty group rarely produce NULL, so we just omit the nulls hint.
    const supportsNullsLast = dbType === 'postgres' || dbType === 'duckdb' || dbType === 'bigquery';
    if (dbType === 'mysql') {
      sql += ` ORDER BY ${topNOverride.aggExpr} IS NULL, ${topNOverride.aggExpr} ${topNOverride.direction}`;
    } else if (supportsNullsLast) {
      sql += ` ORDER BY ${topNOverride.aggExpr} ${topNOverride.direction} NULLS LAST`;
    } else {
      sql += ` ORDER BY ${topNOverride.aggExpr} ${topNOverride.direction}`;
    }
    // SQL Server / Azure SQL: OFFSET/FETCH instead of LIMIT.
    if (dbType === 'azure_sql' || dbType === 'mssql') {
      sql += ` OFFSET 0 ROWS FETCH NEXT ${topNOverride.n} ROWS ONLY`;
    } else {
      sql += ` LIMIT ${topNOverride.n}`;
    }
  } else {
    // Stable ordering: ORDER BY the first dimension to keep consistent colors across refetches
    if (groupByParts.length > 0) {
      sql += ` ORDER BY ${groupByParts[0]}`;
    } else if (selectParts.length > 0) {
      sql += ` ORDER BY 1`;
    }
    const requestedLimit = Math.min(limit || 1000, MAX_ROWS);
    if (dbType === 'azure_sql' || dbType === 'mssql') {
      sql += ` OFFSET ${offset || 0} ROWS FETCH NEXT ${requestedLimit} ROWS ONLY`;
    } else {
      sql += ` LIMIT ${requestedLimit}`;
      if (offset) {
        sql += ` OFFSET ${offset}`;
      }
    }
  }

  // sqlOnly mode — return the assembled SQL without executing. Useful for
  // inspecting a slow / hanging query from the editor without waiting for
  // the server to actually run it.
  if (sqlOnly) {
    return res.json({ sql, rows: [], rowCount: 0, sqlOnly: true });
  }

  // Cache key includes the user-RLS context so a viewer with restricted
  // row access never reads a cached payload built for an unrestricted
  // owner. RLS bypass (owner / admin) gets a stable marker so admins
  // share a cache pool too.
  const rlsContextForCache = {
    bypass: isOwner ? 'owner' : (isAdmin ? 'admin' : null),
    allowed: allowedRlsKeys,
  };
  const cacheOpts = {
    datasourceId: datasource.id,
    modelId: model.id,
    sql,
    rlsContext: rlsContextForCache,
  };
  if (!bypassCache) {
    // Try the pre-aggregated cache FIRST — it covers every filter combo
    // for the same visual shape, so it's a far broader win than the
    // SQL-keyed cache below (which needs an exact SQL match). Only the
    // visual's intrinsic identity (dims/measures/widgetFilters/extras)
    // goes into the key — runtime slicer filters become an `inMemoryAgg`
    // pass over the cached rows.
    // Eligibility: every requested measure must either be additive
    // (sum/count/min/max) OR decomposable into additive components (ratio
    // of two additive measures, AVG via SUM+COUNT). The warmer applies the
    // same predicate, so a hit here implies the dataset has the metadata
    // the aggregate function needs to recompose at the new grain.
    const allMeasureSpecs = (selectedMeasures || []).map((m) => decomposeMeasure(m, allMeasures));
    const allAdditive = allMeasureSpecs.length > 0 && allMeasureSpecs.every((s) => s !== null);
    // A widget-level measure filter compiles to HAVING at the visual's
    // baseDims granularity. The pre-agg dataset is grouped at a finer
    // grain (baseDims + slicerDims), so re-applying that HAVING after
    // the in-memory re-group would still let through rows whose finer-
    // grain SUM is below the threshold — and dropping them at warm
    // time discards regions whose total IS above it. Either way the
    // result is wrong. Skip pre-agg whenever a REAL measure filter is set.
    //
    // EXCEPT top_n / bottom_n — these are synthetic measure filters added
    // by the client for Top N–enabled visuals (bar/pie/treemap). They map
    // to ORDER BY + LIMIT, which is fully reversible in-memory: we look up
    // the preAgg WITHOUT them (so the shape matches what the warmer stored
    // — the warmer doesn't replicate runtime topN state), then sort + slice
    // the aggregated rows here. Drill levels on a topN visual become cache
    // hits this way.
    const isSyntheticTopN = (f) => f && (f.op === 'top_n' || f.op === 'bottom_n');
    const hasRealMeasureFilter = Array.isArray(widgetFilters)
      && widgetFilters.some((f) => f && f.isMeasure && !isSyntheticTopN(f));
    if (allAdditive && !hasRealMeasureFilter) {
      const widgetFiltersForShape = Array.isArray(widgetFilters)
        ? widgetFilters.filter((f) => !isSyntheticTopN(f))
        : widgetFilters;
      const preAggOpts = {
        datasourceId: datasource.id,
        modelId: model.id,
        shape: preAggCache.stableShape({
          dims: dimensionNames,
          measures: measureNames,
          widgetFilters: widgetFiltersForShape,
          reportExtras: { extraDimensions, extraMeasures, dimensionOverrides, measureOverrides },
        }),
        rlsContext: rlsContextForCache,
      };
      const preAggResult = preAggCache.tryServeWithReason(preAggOpts, {
        dims: dimensionNames || [],
        measures: measureNames || [],
        filters: filters || {},
      });
      const preAggHit = preAggResult.hit
        ? { rows: preAggResult.rows, builtAt: preAggResult.builtAt }
        : null;
      // Stash the miss reason on `req` so the queryCache / DB branches
      // below can attach it to `_cache.preAggReason` — surfaces WHY the
      // pre-agg didn't serve in the network panel without needing logs.
      // `req` is the only object whose scope reliably reaches both the
      // queryCache branch (still inside `if (!bypassCache)`) and the DB
      // fallback branch (outside it).
      if (!preAggResult.hit) {
        req._preAggMissReason = preAggResult.reason;
        req._preAggMissDetails = preAggResult.details;
      }
      if (preAggHit) {
        let rows = preAggHit.rows;
        // Apply top_n / bottom_n after the in-memory aggregation. Resolves
        // the measure name to its row alias (SQL aliases by `label || name`).
        const topNFilter = Array.isArray(widgetFilters) ? widgetFilters.find(isSyntheticTopN) : null;
        const topNValue = topNFilter ? Math.max(1, Math.floor(topNFilter.value || 0)) : 0;
        if (topNFilter && topNFilter.field && topNValue > 0 && rows.length > topNValue) {
          const measDef = (selectedMeasures || []).find((mm) => mm && mm.name === topNFilter.field);
          const measKey = measDef ? (measDef.label || measDef.name) : topNFilter.field;
          const direction = topNFilter.op === 'top_n' ? 'desc' : 'asc';
          rows = [...rows].sort((a, b) => {
            const va = Number(a[measKey]);
            const vb = Number(b[measKey]);
            const naA = Number.isFinite(va) ? va : 0;
            const naB = Number.isFinite(vb) ? vb : 0;
            return direction === 'desc' ? naB - naA : naA - naB;
          }).slice(0, topNValue);
        }
        return res.json({
          rows,
          rowCount: rows.length,
          maxReached: rows.length >= MAX_ROWS,
          sql,
          _cache: { hit: true, preAgg: true, builtAt: preAggHit.builtAt },
          _rls: {
            configured: !!(rls && rls.enabled),
            applies: !!rlsApplies,
            bypass: rlsContextForCache.bypass,
            table: rls?.table || null,
            primaryKey: rls?.primaryKey || null,
            ruleCount: rls?.rules ? Object.keys(rls.rules).length : 0,
            userEmail: req.isAuthenticated() ? req.user.email : null,
            allowedKeys: allowedRlsKeys,
          },
        });
      }
    }

    // Fall back to the regular SQL-keyed cache.
    const cached = queryCache.get(cacheOpts);
    if (cached) {
      return res.json({
        rows: cached.rows,
        rowCount: cached.rows.length,
        maxReached: cached.rows.length >= MAX_ROWS,
        sql,
        _cache: {
          hit: true,
          builtAt: cached.builtAt,
          // Surface the preAgg miss reason here too — explains why we
          // landed on the SQL-keyed cache instead of the broader preAgg
          // path (which would survive filter changes).
          preAggReason: req._preAggMissReason || undefined,
          preAggDetails: req._preAggMissDetails || undefined,
        },
        _rls: {
          configured: !!(rls && rls.enabled),
          applies: !!rlsApplies,
          bypass: rlsContextForCache.bypass,
          table: rls?.table || null,
          primaryKey: rls?.primaryKey || null,
          ruleCount: rls?.rules ? Object.keys(rls.rules).length : 0,
          userEmail: req.isAuthenticated() ? req.user.email : null,
          allowedKeys: allowedRlsKeys,
        },
      });
    }
  }

  let conn;
  let registeredQueryId = null;
  try {
    conn = createConnection(datasource);
    // When the client supplies a queryId AND the connector exposes a
    // cancellable variant, register the cancel callback so a sibling
    // /cancel-query call can abort the in-flight DB query. Otherwise fall
    // back to the legacy non-cancellable path.
    const timeoutMs = resolveQueryTimeoutMs(req);
    let rawRows;
    const startedAt = Date.now();
    if (typeof conn.queryCancellable === 'function') {
      // Always go through queryCancellable now — it's the only path that
      // enforces the timeout. If the client provided a queryId we also
      // register the cancel callback so /cancel-query can abort it.
      const { promise, cancel } = conn.queryCancellable(sql, { timeoutMs });
      if (queryId) {
        registeredQueryId = String(queryId);
        const userId = req.isAuthenticated() ? req.user.id : null;
        inFlightQueries.set(registeredQueryId, { cancel, userId });
      }
      try {
        rawRows = await promise;
      } finally {
        if (registeredQueryId) {
          inFlightQueries.delete(registeredQueryId);
          registeredQueryId = null;
        }
      }
    } else {
      rawRows = await conn.query(sql);
    }
    // Normalize Date objects to ISO date strings for all DB types, and
    // flatten PostgreSQL `interval` values (delivered by node-postgres as
    // a `{ years, months, days, hours, minutes, seconds, milliseconds }`
    // object) to total seconds — otherwise they'd JSON-serialize as an
    // object and widgets would render `[object Object]`. Acts as a
    // backstop for measures that pre-date the per-measure `dataType`
    // tagging in the model editor.
    // Keys that drivers ever put on an interval object. Used to detect
    // interval-shaped values to flatten — see comment block below.
    const INTERVAL_KEYS = ['years', 'months', 'days', 'hours', 'minutes', 'seconds', 'milliseconds', 'micros', 'fractionalSeconds'];
    const rows = rawRows.map((r) => {
      const obj = {};
      for (const [k, v] of Object.entries(r)) {
        if (v instanceof Date) { obj[k] = v.toISOString().split('T')[0]; continue; }
        if (v == null || typeof v !== 'object' || Array.isArray(v)) { obj[k] = v; continue; }
        // Interval flatten — driver-specific shapes:
        //   - pg                    : { years, months, days, hours, minutes, seconds, milliseconds }
        //   - duckdb-async          : { months, days, micros }
        //   - @google-cloud/bigquery: { years, months, days, hours, minutes, seconds, fractionalSeconds }
        // For non-zero intervals at least one of those keys is present, so the
        // shape check below catches them. The trickier case is INTERVAL '0' /
        // INTERVAL 'P0D' / etc. — pg can deliver those as an empty `{}` with
        // none of the expected keys, which used to fall through to the
        // catch-all and render as `[object Object]`. We treat any empty
        // plain object the same way (= zero seconds) so zero durations show
        // up as `0s` instead of the broken object string.
        const keys = Object.keys(v);
        const isInterval = keys.length === 0 || keys.some((kk) => INTERVAL_KEYS.includes(kk));
        if (isInterval) {
          // Years / months are approximate (no fixed length) but consistent
          // with EXTRACT(EPOCH …)'s output for PG/DuckDB.
          obj[k] = (Number(v.years) || 0) * 31557600
            + (Number(v.months) || 0) * 2629800
            + (Number(v.days) || 0) * 86400
            + (Number(v.hours) || 0) * 3600
            + (Number(v.minutes) || 0) * 60
            + (Number(v.seconds) || 0)
            + (Number(v.milliseconds) || 0) / 1000
            + (Number(v.micros) || 0) / 1_000_000
            + (Number(v.fractionalSeconds) || 0);
        } else {
          obj[k] = v;
        }
      }
      return obj;
    });
    // Store in cache so the next identical request hits warm. We skip
    // empty / very-large payloads in stats but still cache them — an
    // empty result is still a meaningful answer to the user.
    // `skipCacheSet` is the warmer's hint that the same dataset is also
    // landing in preAggCache (columnar, ~7× smaller). Honour it to avoid
    // the duplication.
    if (!skipCacheSet) {
      queryCache.set(cacheOpts, {
        rows,
        builtAt: new Date().toISOString(),
        queryDurationMs: Date.now() - startedAt,
      });
    }
    res.json({
      rows, rowCount: rows.length, maxReached: rows.length >= MAX_ROWS, sql,
      _cache: {
        hit: false,
        // Same preAgg reason as the queryCache branch — DB hits are the
        // most useful case to diagnose because it means BOTH caches missed.
        preAggReason: req._preAggMissReason || undefined,
        preAggDetails: req._preAggMissDetails || undefined,
      },
      _rls: {
        configured: !!(rls && rls.enabled),
        applies: !!rlsApplies,
        bypass: isOwner ? 'owner' : isAdmin ? 'admin' : null,
        table: rls?.table || null,
        primaryKey: rls?.primaryKey || null,
        ruleCount: rls?.rules ? Object.keys(rls.rules).length : 0,
        userEmail: req.isAuthenticated() ? req.user.email : null,
        allowedKeys: allowedRlsKeys,
      },
    });
  } catch (err) {
    if (err && err.code === 'TIMEOUT') {
      return res.status(504).json({
        error: err.message,
        code: 'TIMEOUT',
        timeoutMs: err.timeoutMs,
        sql,
      });
    }
    res.status(500).json({ error: err.message, sql });
  } finally {
    conn?.close();
  }
});

module.exports = router;
module.exports.cloudHooks = cloudHooks;
