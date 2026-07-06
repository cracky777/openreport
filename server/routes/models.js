const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { requireAuth } = require('../middleware/auth');
const db = require('../db');
const { createConnection } = require('../utils/dbConnector');
const {
  resolveIntervalColumns,
  extractColumnRefsFromExpression,
  preWrapIntervalRefs,
} = require('../utils/columnTypeResolver');
const { canAccessReport, canAccessModel } = require('./reports');
const { getQueryTimeoutMs } = require('../utils/settingsHelper');
const queryCache = require('../utils/queryCache');
const rollupBuilder = require('../utils/rollupBuilder');
const { quoteIdent, quoteTable, quoteCol, escapeLiteral, quoteLiteral, normalizeAggregation } = require('../utils/sqlDialect');
const {
  castToString,
  castToNumber,
  castToDate,
  buildInList,
  effectiveDimType,
} = require('../utils/sqlBuilder/casts');
const {
  getDateFormat,
  getOverrideType,
  buildDatePartExpr,
  isValidDate,
} = require('../utils/sqlBuilder/datePart');
const { deriveJoinKeyword } = require('../utils/sqlBuilder/joins');
const { tablesReachableFrom, getAllowedRlsKeys } = require('../utils/rls');
const { parseModel } = require('../db/modelRow');

// Drivers expose columns with different shapes: { column_name }, { name },
// or plain strings. Normalise any getColumns() result into a Set of names.
function columnNameSet(cols) {
  return new Set((cols || []).map((c) => {
    if (typeof c === 'string') return c;
    return c?.column_name ?? c?.name ?? c?.Name ?? c?.COLUMN_NAME ?? '';
  }).filter(Boolean));
}

// Single source for a measure's aggregate SQL expression (the block that was
// copy-pasted 5× across the /query handler): numeric CAST on a column the user
// overrode to a numeric type, then SUM/AVG/MIN/MAX(col), then interval →
// EXTRACT(EPOCH …) flattening on the dialects that support it. COUNT stays at
// each call site (dialect-specific COUNT(col)/COUNT(*) shapes). `caseWhenSql`
// wraps the column in a CASE for conditional-filter measures. Returns the
// expression string (no alias). NB: the HAVING path keeps its own copy — its
// COUNT/effAgg handling diverges.
function buildMeasureAggExpr(m, { dbType, columnTypes, caseWhenSql = null }) {
  const rawCol = quoteCol(m.table, m.column, dbType);
  const ovType = getOverrideType(m.table, m.column, columnTypes);
  const colExpr = (ovType === 'integer' || ovType === 'decimal' || ovType === 'number')
    ? castToNumber(rawCol, dbType, ovType)
    : rawCol;
  const agg = normalizeAggregation(m.aggregation).toUpperCase();
  const aggExpr = caseWhenSql
    ? `${agg}(CASE WHEN ${caseWhenSql} THEN ${colExpr} END)`
    : `${agg}(${colExpr})`;
  const isInterval = String(m.dataType || '').toLowerCase() === 'interval' || ovType === 'interval';
  const supportsExtractEpoch = dbType === 'postgres' || dbType === 'azure_postgres' || dbType === 'duckdb';
  return (isInterval && supportsExtractEpoch) ? `EXTRACT(EPOCH FROM ${aggExpr})` : aggExpr;
}

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

// canAccessModel / canAccessReport live in ./reports (single source of truth
// for report + model authorization) and are imported at the top of this file.

// SQL helpers (castToString/castToDate/buildInList/buildDatePartExpr/…)
// + RLS helpers used to live inline here — extracted to utils/sqlBuilder/
// and utils/rls.js. See the `require` block at the top of this file.

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
  const row = db.prepare('SELECT * FROM models WHERE id = ?').get(req.params.id);
  if (!row || !canAccessModel(row, req.user)) return res.status(404).json({ error: 'Model not found' });
  const model = parseModel(row);

  // Strip the RLS rules map (other users' email patterns) from the response for anyone
  // who isn't the owner or a global admin. The viewer's own access is enforced server-side
  // by /query — they don't need to see who else has access.
  const isOwner = req.user.id === model.user_id;
  const isAdmin = req.user.role === 'admin';
  const safeRls = (isOwner || isAdmin) ? model.rls : {};

  res.json({
    model: {
      ...model,
      rls: safeRls,
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
  // Schema change invalidates every materialised rollup for this model.
  // Fire-and-forget: the manifest DELETE + DuckDB DROP run in the
  // background; if a query races the drop, the planner's duckdb-error
  // path just falls through to a live fact query for that one request.
  rollupBuilder.dropAllRollups({ modelId: req.params.id, orgId: req.organizationId || null })
    .catch((err) => console.warn('[rollup] invalidate on model update failed:', err.message));

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
  const row = db.prepare('SELECT * FROM models WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Model not found' });
  const model = parseModel(row);

  const source = db.prepare('SELECT * FROM datasources WHERE id = ? AND user_id = ?').get(model.datasource_id, req.user.id);
  if (!source) return res.status(404).json({ error: 'Datasource not found' });

  const { selected_tables: selectedTables, dimensions, measures, joins } = model;

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
        const set = columnNameSet(cols);
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
    const colSet = columnNameSet(cols);

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
    const colSet = columnNameSet(cols);
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
      const direct = Number(str);
      if (Number.isFinite(direct)) return direct;
      // Fallback: French-style comma decimal — replace ALL commas with dots
      // (we tolerate a single decimal mark; multi-comma values are unusual
      // here, e.g. thousands grouping is rare in raw column data).
      return Number(str.replace(/,/g, '.'));
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
    const colSet = columnNameSet(cols);
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
  // Temporary diagnostic — surfaces server-side timing breakdown so we
  // can localise where the 5s perceived latency on cross-filter clicks
  // is actually being spent. The id ties log lines from the same
  // request together; the marks are emitted as we hit each phase.
  // Remove once cross-filter perf is back under 500ms.
  const __qid = `q${Math.random().toString(36).slice(2, 8)}`;
  const __t0 = Date.now();
  const __mark = (label) => {
    if (process.env.QUERY_TIMING === '1') {
      console.log(`[${__qid}] +${Date.now() - __t0}ms ${label}`);
    }
  };

  const rawModel = db.prepare('SELECT * FROM models WHERE id = ?').get(req.params.id);
  if (!rawModel || !canAccessModel(rawModel, req.user)) return res.status(404).json({ error: 'Model not found' });
  const model = parseModel(rawModel);

  const datasource = db.prepare('SELECT * FROM datasources WHERE id = ?').get(model.datasource_id);
  if (!datasource) return res.status(404).json({ error: 'Datasource not found' });
  const dbType = datasource.db_type;
  // Body summary — tells us which client path fired this request (slicer
  // search / refreshSlicer / main fetch effect / sqlOnly preview).
  // Includes a fingerprint of the filters that helps spot duplicate paths.
  const __body = req.body || {};
  const __wfilterPreview = Array.isArray(__body.widgetFilters)
    ? __body.widgetFilters.slice(0, 3).map((f) => `${f?.field}/${f?.op}`).join(',')
    : '';
  __mark(`model+datasource loaded [dims=${(__body.dimensionNames || []).length} measures=${(__body.measureNames || []).length} wfilters=${(__body.widgetFilters || []).length}(${__wfilterPreview}) bypass=${!!__body.bypassCache} sqlOnly=${!!__body.sqlOnly} distinct=${!!__body.distinct} reportId=${__body.reportId || '∅'}]`);

  let {
    dimensionNames, measureNames, limit, offset, filters, widgetFilters,
    distinct, measureAggOverrides, sqlOnly,
    // X-grain HAVING — when the client visual has a legend (groupBy) and
    // applies a measure filter, the user expects "filter X values whose
    // TOTAL (across all legend slices) passes the test", not "filter
    // each (X × legend) cell independently". This array names the X-axis
    // dims; when set, measure filters (HAVING-style + top_n / bottom_n)
    // get routed through an IN-subquery aggregated at the X grain
    // instead of HAVING at the (X × legend) grain.
    havingGrainDims,
    // Optional: client-generated UUID. When set, the server registers the
    // running query in inFlightQueries so a sibling POST /cancel-query
    // request can abort it via the dialect's native cancel mechanism.
    queryId,
    // When `true`, skip the cache lookup and force a fresh DB hit. The
    // client sets this on user-initiated refresh; the freshly-fetched
    // rows still get written back into the cache so subsequent requests
    // for the same shape become hot.
    bypassCache,
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
    // Load a report's *persisted* extras only when the caller can actually
    // access that report — otherwise any model-reachable user could pull a
    // private report's saved extras just by guessing its id.
    let persisted = {};
    if (reportId) {
      const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(String(reportId));
      if (report && canAccessReport(report, req.user)) {
        persisted = JSON.parse(report.settings || '{}');
      }
    }
    extraMeasures = Array.isArray(persisted.extraMeasures) ? persisted.extraMeasures : [];
    extraDimensions = Array.isArray(persisted.extraDimensions) ? persisted.extraDimensions : [];
    measureOverrides = (persisted.measureOverrides && typeof persisted.measureOverrides === 'object')
      ? persisted.measureOverrides : {};
    dimensionOverrides = (persisted.dimensionOverrides && typeof persisted.dimensionOverrides === 'object')
      ? persisted.dimensionOverrides : {};
    // Free-SQL (`aggregation: 'custom'` / raw `expression`) must originate from
    // the model — which is owner-controlled — never from a report's saved
    // extras/overrides: a report-scoped custom expression is arbitrary SQL and,
    // for a non-owner (esp. anonymous viewers of a public report), a RLS-bypass
    // vector. Strip it here; model-defined custom measures still run for everyone.
    const isFreeSql = (x) => x && (x.aggregation === 'custom' || typeof x.expression === 'string');
    extraMeasures = extraMeasures.filter((m) => !isFreeSql(m));
    extraDimensions = extraDimensions.filter((d) => !isFreeSql(d));
    for (const k of Object.keys(measureOverrides)) if (isFreeSql(measureOverrides[k])) delete measureOverrides[k];
    for (const k of Object.keys(dimensionOverrides)) if (isFreeSql(dimensionOverrides[k])) delete dimensionOverrides[k];
  }
  // dimensionNames: ["orders.customer_name", "orders.status"]
  // measureNames: ["orders.total_amount_sum", "orders.count"]

  // Merge model-level definitions with the report's extras / overrides.
  // Extras: appended to the list. Overrides: shallow-merged into the
  // matching entry (so the user can rename a model dim per-report or
  // re-type it). Shallow-copy here because we push extras into these
  // arrays below — without the spread we'd mutate the parsed `model`
  // object that's cached on the route's local scope.
  const allDimensions = [...model.dimensions];
  const allMeasures = [...model.measures];
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
  const allJoins = model.joins;
  const rls = model.rls;
  // Per-column overrides (type + optional format). Used by castToDate to
  // pick the right SQL parser when a date column is stored as text in a
  // non-ISO format.
  const columnTypes = model.column_types;

  // INTERVAL safety net. A measure created before `addMeasure` stamped
  // `dataType` (or via a path where `col.data_type` wasn't available)
  // carries no `dataType`, and there's no `column_types` override either —
  // so the SQL builder can't tell its column is a Postgres/DuckDB
  // `interval` and emits `SUM("col")` / `HAVING SUM("col") <= 30`, which
  // the DB rejects ("operator does not exist: interval <= integer").
  // Resolve interval-ness from the source catalog (process-cached,
  // best-effort) and inject a synthetic `{type:'interval'}` override so
  // every existing isInterval / getOverrideType call site flattens it with
  // EXTRACT(EPOCH …) — no model re-save required. Only fills gaps; an
  // explicit user override always wins.
  try {
    // Probe EVERY measure column regardless of existing columnTypes entries.
    // The user-set override is a best-effort interpretation hint — but for
    // an INTERVAL column the source type wins absolutely: Postgres refuses
    // to CAST(interval AS NUMERIC), so a stale 'decimal' / 'number' override
    // (e.g. set manually before the probe knew the column was interval)
    // would crash every SUM/AVG on it. We force type='interval' for any
    // column the catalog confirms is interval, overriding the user's choice.
    const intervalProbe = (allMeasures || [])
      .filter((m) => m && m.table && m.column && m.column !== '*')
      .map((m) => ({ table: m.table, column: m.column }));
    // Also probe columns referenced INSIDE custom-expression measures —
    // otherwise an interval column that appears only in a custom expression
    // (no structured measure on it) wouldn't get its dataType resolved, and
    // the preWrapIntervalRefs pass below couldn't know to wrap it.
    const seenProbeKey = new Set(
      intervalProbe.map((c) => `${c.table}.${c.column}`),
    );
    for (const m of allMeasures || []) {
      if (m && m.aggregation === 'custom' && m.expression) {
        for (const ref of extractColumnRefsFromExpression(m.expression)) {
          const key = `${ref.table}.${ref.column}`;
          if (!seenProbeKey.has(key)) {
            seenProbeKey.add(key);
            intervalProbe.push(ref);
          }
        }
      }
    }
    if (intervalProbe.length) {
      const intervalSet = await resolveIntervalColumns(datasource, intervalProbe);
      for (const key of intervalSet) {
        // Force type='interval' but preserve any other fields the user set
        // on the entry (e.g. format hints).
        columnTypes[key] = { ...(columnTypes[key] || {}), type: 'interval' };
      }
    }
  } catch (e) {
    console.warn('[columnType] interval probe skipped -', e.message);
  }

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
  //   - PG / Azure PG / DuckDB: CAST(... AS NUMERIC) — arbitrary precision
  //   - MySQL / MSSQL / Azure SQL: CAST(... AS DECIMAL(38,10)). MySQL refuses
  //     CAST AS NUMERIC without precision; MSSQL/Azure DEFAULT NUMERIC to scale
  //     0, silently truncating the decimals — pin the scale on both.
  //   - BigQuery: CAST(... AS NUMERIC) — BQ already returns FLOAT64 from
  //     `/` so this is mostly defensive, but harmless
  // SUM/AVG/MIN/MAX get the argument cast (preserves decimal precision);
  // COUNT gets cast on its return value (it ignores its argument's type).
  function dialectNumericCast(inner) {
    if (dbType === 'mysql' || dbType === 'mssql' || dbType === 'azure_sql') {
      return `CAST(${inner} AS DECIMAL(38,10))`;
    }
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
  __mark('extras gating + rls resolved');

  // ── Aggregate-aware rollup planner ────────────────────────────────────
  // Before assembling (and running) the fact-table SQL, see if a
  // materialised rollup covers this request. The rollup table IS the
  // persistent cache — no separate in-RAM grain cache layer.
  //
  // Skip the planner for:
  //   - `sqlOnly`: the SQL-preview endpoint wants the fact SQL, not data.
  //   - `_rollupBuilder`: the builder's own /query calls MUST hit the
  //     source fact table — that's how the rollup gets populated. Serving
  //     them from a rollup would build a rollup from itself.
  const isRollupBuilderRequest = !!(req.body && req.body._rollupBuilder);
  // `bypassCache` = an explicit user refresh of a visual. Per product
  // decision it must be handled by the LIVE query and stored in
  // queryCache — NOT served from the rollup. So skip the rollup planner;
  // the normal path then runs live (queryCache.get is itself skipped
  // when bypassCache, forcing fresh) and writes the result to queryCache.
  // Slicer-distinct shape: distinct=true, exactly one dim, no measures.
  // We want these to try the rollup FIRST (matches the freshly-built
  // rollup state after a cache rebuild) and on MISS fall to LIVE
  // skipping queryCache (whose stale entries would otherwise survive
  // a rebuild within the same server process and feed the slicer with
  // pre-rebuild distinct values).
  const isSlicerDistinct = !!distinct
    && Array.isArray(measureNames) && measureNames.length === 0
    && Array.isArray(dimensionNames) && dimensionNames.length === 1;
  if (sqlOnly || isRollupBuilderRequest || bypassCache) {
    __mark(`SKIP rollup planner (sqlOnly=${!!sqlOnly}, builder=${isRollupBuilderRequest}, bypassCache=${!!bypassCache})`);
  } else if (isSlicerDistinct) {
    const rollupPlanner = require('../utils/rollupPlanner');
    const __tRollup = Date.now();
    let rollupResult;
    try {
      rollupResult = await rollupPlanner.tryServeSlicerDistinct({
        modelId: model.id,
        orgId: req.organizationId || null,
        reportId,
        dimensionName: dimensionNames[0],
        filters: filters || {},
        widgetFilters: Array.isArray(widgetFilters) ? widgetFilters : [],
        allDimensions,
        limit,
        rlsApplies: !!rlsApplies,
      });
    } catch (err) {
      rollupResult = { hit: false, reason: `planner-error:${err.message}` };
    }
    __mark(`rollupPlanner slicer ${rollupResult.hit ? 'HIT' : 'MISS:' + rollupResult.reason} (${Date.now() - __tRollup}ms, ${rollupResult.rows?.length ?? 0} rows)`);
    if (rollupResult.hit) {
      return res.json({
        rows: rollupResult.rows,
        rowCount: rollupResult.rows.length,
        maxReached: rollupResult.rows.length >= 1000000,
        sql: rollupResult.sql || null,
        _cache: {
          hit: true,
          fromRollup: rollupResult.tableName,
          rollupMatch: 'slicer',
          serverMs: Date.now() - __t0,
        },
      });
    }
    // MISS: fall through to live SQL below. Mark this request so the
    // queryCache check skips — otherwise a stale entry from before a
    // cache rebuild would be served, undoing the whole "rebuild +
    // refresh" semantics for slicer widgets.
    req._slicerDistinctBypassQueryCache = true;
  } else {
    const rollupPlanner = require('../utils/rollupPlanner');
    const __tRollup = Date.now();
    let rollupResult;
    try {
      rollupResult = await rollupPlanner.tryServeFromRollup({
        model,
        modelId: model.id,
        orgId: req.organizationId || null,
        reportId,
        dimensionNames: dimensionNames || [],
        measureNames: measureNames || [],
        measureAggOverrides: measureAggOverrides || {},
        filters: filters || {},
        widgetFilters: Array.isArray(widgetFilters) ? widgetFilters : [],
        havingGrainDims,
        allDimensions,
        allMeasures,
        limit,
        rlsApplies: !!rlsApplies,
      });
    } catch (err) {
      rollupResult = { hit: false, reason: `planner-error:${err.message}` };
    }
    __mark(`rollupPlanner ${rollupResult.hit ? 'HIT ' + rollupResult.match : 'MISS:' + rollupResult.reason} (${Date.now() - __tRollup}ms, ${rollupResult.rows?.length ?? 0} rows)`);
    if (rollupResult.hit) {
      return res.json({
        rows: rollupResult.rows,
        rowCount: rollupResult.rows.length,
        maxReached: rollupResult.rows.length >= 1000000,
        sql: rollupResult.sql || null,
        _cache: {
          hit: true,
          fromRollup: rollupResult.tableName,
          rollupMatch: rollupResult.match,
          serverMs: Date.now() - __t0,
        },
        _rls: {
          configured: !!(rls && rls.enabled),
          applies: !!rlsApplies,
          bypass: isOwner ? 'owner' : (isAdmin ? 'admin' : null),
          table: rls?.table || null,
          primaryKey: rls?.primaryKey || null,
          ruleCount: rls?.rules ? Object.keys(rls.rules).length : 0,
          userEmail: req.isAuthenticated() ? req.user.email : null,
          allowedKeys: allowedRlsKeys,
        },
      });
    }
    req._preAggMissReason = rollupResult.reason;
  }
  // ──────────────────────────────────────────────────────────────────────

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
    for (const [dimName, raw] of Object.entries(filters)) {
      // Range-shape: `{ op: 'between', value: [start, end] }` — emitted by
      // widgetQueryPayload when the slicer style is dateRange / dateBetween
      // or dateCalendar+between. Routes to a clean BETWEEN clause instead
      // of the discrete-list IN that would otherwise materialise.
      const isRange = raw && typeof raw === 'object' && !Array.isArray(raw)
        && raw.op === 'between' && Array.isArray(raw.value) && raw.value.length === 2;
      const values = isRange ? null : raw;
      if (!isRange && (!Array.isArray(values) || values.length === 0)) continue;
      const dimDef = allDimensions.find((d) => d.name === dimName);
      if (!dimDef) continue;
      tablesUsed.add(dimDef.table);
      const col = quoteCol(dimDef.table, dimDef.column, dbType);
      if (isRange) {
        const [startVal, endVal] = raw.value;
        if (dimDef.type === 'date') {
          const fmt = getDateFormat(dimDef.table, dimDef.column, columnTypes);
          whereParts.push({
            field: dimName,
            sql: `${castToDate(col, dbType, fmt)} BETWEEN ${quoteLiteral(startVal, dbType)} AND ${quoteLiteral(endVal, dbType)}`,
          });
        } else if (dimDef.datePart) {
          const expr = buildDatePartExpr(dimDef, dbType, columnTypes);
          whereParts.push({
            field: dimName,
            sql: `${expr} BETWEEN ${quoteLiteral(startVal, dbType)} AND ${quoteLiteral(endVal, dbType)}`,
          });
        } else {
          whereParts.push({
            field: dimName,
            sql: `${col} BETWEEN ${quoteLiteral(startVal, dbType)} AND ${quoteLiteral(endVal, dbType)}`,
          });
        }
        continue;
      }
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
    let expr;
    if (d.datePart) {
      // Date part derived column — delegate to the dialect-aware helper so
      // the SELECT and the WHERE/HAVING paths stay consistent (they all need
      // the same EXTRACT/YEAR(...) expression for drill-down to work).
      expr = buildDatePartExpr(d, dbType, columnTypes);
    } else {
      expr = quoteCol(d.table, d.column, dbType);
    }
    selectParts.push(`${expr} AS ${quoteIdent(d.label || d.name, dbType)}`);
    groupByParts.push(expr);
    tablesUsed.add(d.table);
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

  // DIM-ONLY measure detection. A measure whose only column reference is
  // on a DIM table (not a real fact in the join graph) is emitted as a
  // scalar subquery that runs against that dim alone, with only the
  // visual's WHERE clauses targeting that same dim. Cross-table filters
  // are dropped — otherwise the regular SELECT path would force a JOIN
  // through the bridge fact and `COUNT(dim.col)` would count fact rows
  // instead of dim rows (observed: `COUNT("d_date"."nom_mois")` jumped
  // from 1 to N appels per date when a destinataire filter forced the
  // f_appel_entrant_fin join). The subquery is uncorrelated (constant
  // per outer row) — for a scorecard this is exactly the value; for a
  // grouped chart the constant repeats across groups, which is the
  // honest "this measure isn't grouped by anything from another table"
  // semantic.
  //
  // Real-facts detection: a `*`-side join target that NEVER appears as a
  // `from_table` is a real fact. Anything else (incl. snowflake dim
  // children that ARE `*` but also parent a fact via their own join)
  // counts as a dim. Mirrors `factConformedDimTables` in rollupBuilder.
  const realFacts = (() => {
    const list = Array.isArray(allJoins) ? allJoins : [];
    const fromTables = new Set();
    const manyTables = new Set();
    for (const j of list) {
      if (!j || !j.from_table || !j.to_table) continue;
      fromTables.add(j.from_table);
      const c = j.cardinality || {};
      if (c.to === '*' || (!c.from && !c.to)) manyTables.add(j.to_table);
      if (c.from === '*') manyTables.add(j.from_table);
    }
    return new Set([...manyTables].filter((t) => !fromTables.has(t)));
  })();
  // Tables that actually participate in the join graph. The dim-only
  // treatment only makes sense for a table reached THROUGH a join — that's
  // the only place threading the graph would inflate the aggregate. A
  // table that joins to nothing (a single-table model, or a standalone
  // table) can't fan out, so its measures must aggregate normally via
  // GROUP BY. Without this guard a single-table model has an empty
  // `realFacts` set, so every measure was wrongly treated dim-only and
  // emitted as an uncorrelated `(SELECT SUM(col) FROM t)` — repeating the
  // grand total across every group instead of the per-group sum.
  const joinedTables = (() => {
    const s = new Set();
    for (const j of (Array.isArray(allJoins) ? allJoins : [])) {
      if (j && j.from_table) s.add(j.from_table);
      if (j && j.to_table) s.add(j.to_table);
    }
    return s;
  })();
  // Primary table for the measure — the dim table that owns its column.
  // For a custom expression we accept the dim-only treatment only if
  // every quoted column reference points at the SAME table; multi-table
  // refs need the join graph and stay on the regular path.
  const measurePrimaryTable = (m) => {
    if (m.table) return m.table;
    if (m.aggregation === 'custom' && m.expression) {
      // Defer to the regular path when the expression embeds `${ref}`
      // markers — the inliner may pull in another measure that lives on
      // a different table, which our extraction-based detection here
      // can't see. Single-table custom expressions with no refs are the
      // safe sweet spot.
      if (String(m.expression).includes('${')) return null;
      const refs = extractColumnRefsFromExpression(m.expression);
      const tables = new Set(refs.map((r) => r.table).filter(Boolean));
      if (tables.size === 1) return [...tables][0];
    }
    return null;
  };
  const dimOnlyMeasureInfos = [];

  // Field list used by every "which tables does this inlined expression touch?"
  // scan below. Depends only on the model shape, so build it once instead of
  // rebuilding the spread+filter inside each custom/filtered-measure branch.
  const allFieldsForLookup = [...allDimensions, ...allMeasures.filter((x) => x.table)];

  selectedMeasures.forEach((m) => {
    // Dim-only fast path. Skip the normal selectParts emission AND skip
    // the `tablesUsed.add` — the dim is queried by the scalar subquery
    // independently, so adding it here would needlessly force the join
    // graph to thread through it (and bring along the cross-table
    // filters whose inflation we're avoiding in the first place).
    // Bail out for measures that carry their own pipeline (filterRules,
    // override mode, custom-with-refs); those go through the dedicated
    // paths below.
    const primaryTable = measurePrimaryTable(m);
    // RLS gate: the dim-only subquery is independent of the outer WHERE
    // and would silently bypass an RLS clause (the clause references the
    // RLS table, which the subquery's FROM doesn't include). For
    // RLS-restricted users we fall through to the regular structured
    // path so the outer WHERE enforces it — the measure may be
    // fact-inflated but it's never leaky. Owners/admins (rlsApplies =
    // false) get the clean subquery path.
    const isDimOnlyCandidate = primaryTable
      && joinedTables.has(primaryTable)
      && !realFacts.has(primaryTable)
      && !(Array.isArray(m.filterRules) && m.filterRules.length > 0)
      && !rlsApplies;
    if (isDimOnlyCandidate) {
      dimOnlyMeasureInfos.push({
        index: selectParts.length,
        m,
        primaryTable,
        label: m.label || m.name,
      });
      selectParts.push(null);
      return;
    }
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
        // Detect tables BEFORE wrapping interval refs — the wrap inserts the
        // exact same column ref inside EXTRACT(EPOCH FROM …) so includes()
        // still matches, but routing pre-wrap is cleaner.
        for (const field of allFieldsForLookup) {
          if (inlinedExpression.includes(field.column) || inlinedExpression.includes(field.table)) {
            tablesUsed.add(field.table);
          }
        }
        inlinedExpression = preWrapIntervalRefs(inlinedExpression, columnTypes, dbType);
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
          // Pre-wrap interval-column refs so CAST AS NUMERIC inside the
          // aggregate doesn't blow up on an interval-typed column.
          inlined = preWrapIntervalRefs(inlined, columnTypes, dbType);
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
          for (const field of allFieldsForLookup) {
            if (inlined.includes(field.column) || inlined.includes(field.table)) {
              tablesUsed.add(field.table);
            }
          }
        } else if (m.aggregation === 'count' || (m.column === '*' && !m.table)) {
          selectParts.push(`COUNT(CASE WHEN ${whenSql} THEN 1 END) AS ${quoteIdent(m.label || m.name, dbType)}`);
        } else if (m.table && m.column) {
          selectParts.push(`${buildMeasureAggExpr(m, { dbType, columnTypes, caseWhenSql: whenSql })} AS ${quoteIdent(m.label || m.name, dbType)}`);
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
      // Pre-wrap interval-column refs (EXTRACT EPOCH) so the NUMERIC cast
      // below doesn't try CAST(interval AS NUMERIC) — illegal in PG.
      inlined = preWrapIntervalRefs(inlined, columnTypes, dbType);
      // Custom SQL expression - force NUMERIC inside aggregates to avoid integer division truncation
      // SUM(col) becomes SUM((col)::NUMERIC) so division preserves decimals.
      // Paren-aware so a CASE WHEN ... IN (..) inside an aggregate doesn't
      // break the matcher.
      const numericExpr = applyNumericCast(inlined);
      selectParts.push(`(${numericExpr}) AS ${quoteIdent(m.label || m.name, dbType)}`);
      // Extract table references from the INLINED expression for joins
      for (const field of allFieldsForLookup) {
        if (inlined.includes(field.column) || inlined.includes(field.table)) {
          tablesUsed.add(field.table);
        }
      }
    } else if (m.aggregation === 'count_col' && m.table && m.column) {
      // Internal kind used ONLY by the AVG decomposition's denominator
      // (measureType.collectComponentsForVisual): COUNT of NON-NULL
      // values of the column, so a rolled-up AVG = SUM(x)/COUNT(x)
      // matches SQL AVG (NULLs skipped). Distinct from user `count`
      // measures, which stay COUNT(*) (next branch).
      selectParts.push(`COUNT(${quoteCol(m.table, m.column, dbType)}) AS ${quoteIdent(m.label || m.name, dbType)}`);
    } else if (m.aggregation === 'hll' && m.table && m.column) {
      // Internal kind used ONLY by the rollup builder's DISTINCT-via-HLL
      // pipeline (measureType.collectComponentsForVisual emits one
      // synthetic per `COUNT(DISTINCT col)` measure). The source DB has
      // no `datasketch_hll` function — every dialect we support, BQ
      // excepted — so we can't compute a sketch here. Instead we emit
      // the column RAW (no aggregate) and add it to GROUP BY. The
      // source DB then delivers deduped (grain ∪ col) tuples; the
      // downstream DuckDB staging step computes
      // `datasketch_hll(lgK, col)` at the grain level. Sibling additive
      // atoms in the same query get aggregated at the finer (grain ∪
      // col) cardinality, then re-aggregated in DuckDB — mathematically
      // exact since SUM/MIN/MAX/COUNT are additive.
      const rawCol = quoteCol(m.table, m.column, dbType);
      selectParts.push(`${rawCol} AS ${quoteIdent(m.label || m.name, dbType)}`);
      groupByParts.push(rawCol);
    } else if (m.aggregation === 'count') {
      // COUNT(*) when no column is specified (or the legacy '*' sentinel),
      // COUNT(table.column) — non-null count — when a column was picked
      // in the measure wizard. The wizard now lets the user choose
      // either; for backwards-compat existing measures that came in
      // with `column='*'` or no table keep the COUNT(*) shape.
      if (m.table && m.column && m.column !== '*') {
        selectParts.push(`COUNT(${quoteCol(m.table, m.column, dbType)}) AS ${quoteIdent(m.label || m.name, dbType)}`);
      } else {
        selectParts.push(`COUNT(*) AS ${quoteIdent(m.label || m.name, dbType)}`);
      }
    } else {
      // Wrap the column in CAST when the user has overridden it to a numeric
      // type — otherwise SUM/AVG on a text column (e.g. nvarchar storing
      // numbers) blows up with "operand data type ... is invalid for sum".
      // interval columns render as an `[object Object]` blob; the shared helper
      // flattens SUM/AVG/MIN/MAX(interval) with EXTRACT(EPOCH …) on pg/azure_pg/
      // duckdb (mysql/mssql have no interval type; BQ flattens post-query).
      selectParts.push(`${buildMeasureAggExpr(m, { dbType, columnTypes })} AS ${quoteIdent(m.label || m.name, dbType)}`);
    }
  });

  // Apply per-widget MEASURE filters as HAVING clauses, now that aggregation
  // expressions are known. Custom-expression measures route through the same
  // SELECT-path pipeline (inlineMeasureRefs → preWrapIntervalRefs →
  // applyNumericCast) so HAVING / top_n / bottom_n operate on EXACTLY the
  // same SQL expression the visual renders.
  //
  // X-grain HAVING (line/column charts with a legend): when the client
  // sends `havingGrainDims` (the X-axis dims only, post-drill), measure
  // filters are routed into `xGrainHavingParts` / `xGrainTopN` instead.
  // The post-loop block downstream wraps these in an IN-subquery that
  // aggregates at the X grain — so "Top 10 countries by revenue" keeps
  // ALL years of each top country, instead of trimming to top 10
  // (country, year) cells. The drill case works naturally because
  // `havingGrainDims` reflects the currently-displayed level only.
  let topNOverride = null; // { aggExpr, n, direction: 'DESC' | 'ASC' }
  const xGrainHavingParts = [];
  let xGrainTopN = null; // { aggExpr, n, direction }
  const useXGrainHaving = Array.isArray(havingGrainDims)
    && havingGrainDims.length > 0
    && Array.isArray(dimensionNames)
    && havingGrainDims.length < dimensionNames.length;
  for (const f of measureFiltersDeferred) {
    const measDef = allMeasures.find((mm) => mm.name === f.field);
    if (!measDef) continue;
    let aggExpr; // set below — used as ORDER BY / HAVING expression
    if (measDef.aggregation === 'custom') {
      if (!measDef.expression) continue;
      let inlined;
      try {
        inlined = inlineMeasureRefs(measDef.expression);
      } catch {
        continue;
      }
      inlined = preWrapIntervalRefs(inlined, columnTypes, dbType);
      aggExpr = `(${applyNumericCast(inlined)})`;
      // Pull tables referenced by the inlined expression into the JOIN
      // graph — same logic the SELECT path uses at line 1477. Without
      // this, a HAVING that references a table not otherwise selected
      // would emit SQL with an unresolved alias.
      for (const field of allFieldsForLookup) {
        if (inlined.includes(field.column) || inlined.includes(field.table)) {
          tablesUsed.add(field.table);
        }
      }
    } else {
      // The HAVING must aggregate with the SAME function the visual uses.
      // The SELECT path applies the per-widget aggregation override
      // (measureAggOverrides) when building selectedMeasures, so a measure
      // shown as AVG on the widget must be filtered as AVG too — not the
      // measure's base aggregation (which would emit SUM here while the
      // SELECT emits AVG, comparing the filter against the wrong number).
      const effAggH = (measureAggOverrides && measureAggOverrides[f.field]
        && measDef.aggregation !== 'custom')
        ? measureAggOverrides[f.field]
        : measDef.aggregation;
      // Same numeric-cast logic as the SELECT path so HAVING references the
      // exact same expression.
      const rawColH = (measDef.table && measDef.column)
        ? quoteCol(measDef.table, measDef.column, dbType)
        : null;
      const ovTypeH = getOverrideType(measDef.table, measDef.column, columnTypes);
      const colExprH = rawColH && (ovTypeH === 'integer' || ovTypeH === 'decimal' || ovTypeH === 'number')
        ? castToNumber(rawColH, dbType, ovTypeH)
        : rawColH;
      // Mirror the SELECT path: COUNT becomes COUNT(table.column) when a
      // column is bound on the measure (non-'*' sentinel), otherwise the
      // classic COUNT(*). HAVING must use the same expression the visual
      // displays, so this matches the COUNT branch in the SELECT loop above.
      const baseAggExpr = effAggH === 'count'
        ? ((measDef.table && measDef.column && measDef.column !== '*')
            ? `COUNT(${quoteCol(measDef.table, measDef.column, dbType)})`
            : 'COUNT(*)')
        : (colExprH
            ? `${normalizeAggregation(effAggH).toUpperCase()}(${colExprH})`
            : null);
      if (!baseAggExpr) continue;
      // Mirror the SELECT path: `interval` aggregates need EXTRACT(EPOCH …)
      // so HAVING comparisons are against a number rather than an interval.
      // PG + DuckDB share the syntax; BigQuery falls back to the row post-
      // processor (and HAVING on intervals there is rare anyway).
      const isIntervalH = String(measDef.dataType || '').toLowerCase() === 'interval'
        || ovTypeH === 'interval';
      const supportsExtractEpochH = dbType === 'postgres' || dbType === 'azure_postgres' || dbType === 'duckdb';
      aggExpr = (isIntervalH && supportsExtractEpochH && effAggH !== 'count')
        ? `EXTRACT(EPOCH FROM ${baseAggExpr})`
        : baseAggExpr;
      if (measDef.table) tablesUsed.add(measDef.table);
    }

    // Top N / Bottom N — without legend, override ORDER BY + LIMIT
    // directly. With legend (useXGrainHaving), bucket into xGrainTopN so
    // the post-loop IN-subquery wraps it.
    if (f.op === 'top_n' || f.op === 'bottom_n') {
      const n = parseInt(f.value, 10);
      if (!Number.isFinite(n) || n <= 0) continue;
      if (useXGrainHaving) {
        if (!xGrainTopN) {
          xGrainTopN = { aggExpr, n, direction: f.op === 'top_n' ? 'DESC' : 'ASC' };
        }
      } else if (!topNOverride) {
        topNOverride = { aggExpr, n, direction: f.op === 'top_n' ? 'DESC' : 'ASC' };
      }
      continue;
    }

    // Comparator (>, <, =, between, is_null, …) — route to x-grain bucket
    // when legend is present, otherwise emit as a regular HAVING.
    const clause = buildScalarClause(aggExpr, f.op, f.value, f.values, false);
    if (!clause) continue;
    if (useXGrainHaving) xGrainHavingParts.push(clause);
    else havingParts.push(clause);
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

  // ── Multi-fact fan-out fix ────────────────────────────────────────────
  // When a visual combines measures from ≥2 different fact tables, joining
  // the raw facts to a shared dimension fans out rows (each f1 row × each
  // matching f2 row) and inflates the SUMs. The rollup cache already avoids
  // this — one pre-aggregated subquery per fact, then FULL JOIN USING the
  // grain (see rollupPlanner.js `subFor`). Mirror that on the live path:
  // aggregate each fact independently at the requested grain, then FULL JOIN
  // the per-fact results on the dimension aliases (CROSS JOIN for a grainless
  // scorecard). Strictly gated to the clean common case; anything exotic
  // (custom/HLL/override/filtered measures, x-grain HAVING, measure
  // HAVING/TopN, RLS, distinct, or a dim/filter not conformed to every fact)
  // falls back to the existing single-query path below, unchanged.
  let multiFactBody = null;
  {
    const SIMPLE_AGGS = new Set(['sum', 'avg', 'min', 'max', 'count']);
    const factsInvolved = [...new Set(
      selectedMeasures.filter((m) => m.table && realFacts.has(m.table)).map((m) => m.table),
    )];
    const allMeasuresSimpleFact = selectedMeasures.length > 0 && selectedMeasures.every((m) =>
      m.table && realFacts.has(m.table)
      && SIMPLE_AGGS.has(String(m.aggregation || '').toLowerCase())
      && !m.expression
      && !(Array.isArray(m.filterRules) && m.filterRules.length > 0)
      && !m.overrideFilters);
    const eligible = factsInvolved.length >= 2
      && allMeasuresSimpleFact
      && !rlsApplies
      && !distinct
      && !topNOverride
      && havingParts.length === 0
      && measureFiltersDeferred.length === 0
      && (!Array.isArray(havingGrainDims) || havingGrainDims.length === 0)
      && dimOnlyMeasureInfos.length === 0;
    if (eligible) {
      const dimInfoOf = (d) => ({
        expr: d.datePart ? buildDatePartExpr(d, dbType, columnTypes) : quoteCol(d.table, d.column, dbType),
        alias: quoteIdent(d.label || d.name, dbType),
      });
      const dimInfos = selectedDimensions.map(dimInfoOf);
      const dimSelects = dimInfos.map((x) => `${x.expr} AS ${x.alias}`);
      const dimExprs = dimInfos.map((x) => x.expr);
      const dimAliases = dimInfos.map((x) => x.alias);
      // Per-fact aggregate select — mirrors the normal-aggregation branch of
      // the SELECT loop above (CAST override + interval EXTRACT EPOCH).
      const measureSelectOf = (m) => {
        const alias = quoteIdent(m.label || m.name, dbType);
        const rawCol = quoteCol(m.table, m.column, dbType);
        const agg = String(m.aggregation || '').toLowerCase();
        if (agg === 'count') {
          const e = (m.table && m.column && m.column !== '*') ? `COUNT(${rawCol})` : 'COUNT(*)';
          return { sql: `${e} AS ${alias}`, alias };
        }
        const finalExpr = buildMeasureAggExpr(m, { dbType, columnTypes });
        return { sql: `${finalExpr} AS ${alias}`, alias };
      };
      // Every per-fact subquery must join the grain dims AND any dim
      // referenced by a WHERE filter (report / widget / cross-filter), so
      // the filters apply inside each fact's aggregation.
      const filterDimTables = whereParts
        .filter((w) => w.field)
        .map((w) => { const d = allDimensions.find((x) => x.name === w.field); return d ? d.table : null; })
        .filter(Boolean);
      const neededDimTables = [...new Set([...selectedDimensions.map((d) => d.table), ...filterDimTables])];
      // FROM <fact> JOIN <needed dims…>, rooted at the fact (mirrors the main
      // traversal). Returns null if a needed table can't be connected to this
      // fact → the fact isn't conformed to that dim → fall back entirely.
      const buildFactFrom = (fact) => {
        let from = quoteTable(fact, dbType);
        const added = new Set([fact]);
        const remaining = neededDimTables.filter((t) => t !== fact);
        while (remaining.length > 0) {
          let pickedIdx = -1; let pickedJoin = null;
          for (let i = 0; i < remaining.length; i++) {
            const t = remaining[i];
            const j = allJoins.find((jj) => (jj.from_table === t && added.has(jj.to_table))
              || (jj.to_table === t && added.has(jj.from_table)));
            if (j) { pickedIdx = i; pickedJoin = j; break; }
          }
          if (pickedIdx < 0) return null;
          const t = remaining.splice(pickedIdx, 1)[0];
          const jt = deriveJoinKeyword(pickedJoin);
          from += ` ${jt} JOIN ${quoteTable(t, dbType)} ON ${quoteCol(pickedJoin.from_table, pickedJoin.from_column, dbType)} = ${quoteCol(pickedJoin.to_table, pickedJoin.to_column, dbType)}`;
          added.add(t);
        }
        return from;
      };
      const whereSql = whereParts.length > 0 ? ` WHERE ${whereParts.map((w) => w.sql).join(' AND ')}` : '';
      const groupSql = dimExprs.length > 0 ? ` GROUP BY ${dimExprs.join(', ')}` : '';
      const subs = [];
      const measureAliases = [];
      let ok = true;
      for (const fact of factsInvolved) {
        const from = buildFactFrom(fact);
        if (!from) { ok = false; break; }
        const fMeasures = selectedMeasures.filter((m) => m.table === fact);
        const mSel = fMeasures.map(measureSelectOf);
        mSel.forEach((x) => measureAliases.push(x.alias));
        subs.push(`SELECT ${[...dimSelects, ...mSel.map((x) => x.sql)].join(', ')} FROM ${from}${whereSql}${groupSql}`);
      }
      if (ok && subs.length >= 2) {
        const wrapped = subs.map((s, i) => `(${s}) g${i}`);
        const joiner = dimAliases.length > 0
          ? (acc, cur) => `${acc} FULL JOIN ${cur} USING (${dimAliases.join(', ')})`
          : (acc, cur) => `${acc} CROSS JOIN ${cur}`;
        const joined = wrapped.reduce((acc, cur, i) => (i === 0 ? cur : joiner(acc, cur)));
        multiFactBody = {
          sql: `SELECT ${[...dimAliases, ...measureAliases].join(', ')} FROM ${joined}`,
          orderByAlias: dimAliases.length > 0 ? dimAliases[0] : null,
        };
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
    const origOrder = new Map(tableList.map((t, i) => [t, i]));
    tableList.sort((a, b) => (factScore[b] - factScore[a]) || (origOrder.get(a) - origOrder.get(b)));
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
        // None of the leftover tables can be reached through a real join.
        // A filter-only table here — e.g. a date dimension pulled in by a
        // global date filter on a fact-less slicer query (`SELECT DISTINCT
        // d_destinataire.lib` with no measure, so no fact to bridge
        // d_date) — must NOT be comma-cross-joined: that's a Cartesian
        // product AND its WHERE clause degrades to a meaningless no-op
        // (`d_date.year = 2026` against an unrelated cross product just
        // asks "does any 2026 row exist"). Drop such tables and strip the
        // WHERE clauses that reference them. Tables genuinely required by
        // the SELECT / GROUP BY (pathological broken model) keep the old
        // cross-join fallback so we never emit invalid SQL.
        const requiredTables = new Set();
        for (const d of selectedDimensions) if (d.table) requiredTables.add(d.table);
        for (const m of selectedMeasures) if (m && m.table) requiredTables.add(m.table);
        const droppedTables = new Set();
        for (const t of remaining) {
          if (requiredTables.has(t)) {
            fromClause += `, ${quoteTable(t, dbType)}`;
          } else {
            droppedTables.add(t);
          }
        }
        if (droppedTables.size > 0) {
          // Strip dim WHERE clauses on the dropped tables. Never drop
          // untagged clauses (field === null): those are RLS / security
          // and unreachable RLS is already handled by deny-all above.
          for (let i = whereParts.length - 1; i >= 0; i--) {
            const w = whereParts[i];
            if (!w.field) continue;
            const dd = allDimensions.find((d) => d.name === w.field);
            if (dd && droppedTables.has(dd.table)) whereParts.splice(i, 1);
          }
          if (process.env.QUERY_TIMING === '1') {
            console.log(`[${__qid}] dropped unjoinable filter table(s): ${Array.from(droppedTables).join(', ')} (no join path to the query — filter would be a Cartesian no-op)`);
          }
        }
        break;
      }
      const t = remaining.splice(pickedIdx, 1)[0];
      const joinType = deriveJoinKeyword(pickedJoin);
      fromClause += ` ${joinType} JOIN ${quoteTable(t, dbType)} ON ${quoteCol(pickedJoin.from_table, pickedJoin.from_column, dbType)} = ${quoteCol(pickedJoin.to_table, pickedJoin.to_column, dbType)}`;
      added.add(t);
    }
  }

  // Build the inner aggregation subquery for an override-mode filtered
  // measure. Used by both patch-up loops below (the top-level
  // `overrideMeasureInfos` loop and the `__OVERRIDE_REF_<i>__` placeholder
  // resolver). Both used to inline the same ~25 lines of identical logic,
  // with one subtle drift: the placeholder resolver was MISSING the
  // EXTRACT(EPOCH FROM …) wrap for interval-typed measures, so a duration
  // measure referenced via `${...}` inside a custom expression would emit
  // an INTERVAL value while the same measure at top-level emitted seconds.
  // Now that both call sites share one helper, the interval wrap applies
  // in both paths.
  //
  // Returns the raw `SELECT ... FROM ... [WHERE ...]` string; the caller
  // wraps it in `(...)` (+ either an `AS <label>` or a placeholder substring
  // splice). `inlinedExpr` lets the caller pre-feed the nested-`${}`-expanded
  // form (the overrideMeasureInfos path pre-computes this during the main
  // SELECT loop and stashes it on the info object; the override-ref path
  // calls inlineMeasureRefs on demand).
  const buildOverrideSubquery = (measure, inlinedExpr) => {
    const overrideFields = new Set(
      (measure.filterRules || []).map((r) => r && r.field).filter(Boolean)
    );
    // Keep all WHERE clauses NOT tied to an override field. Untagged
    // clauses (RLS) are always kept so security is preserved.
    const keptWhere = whereParts
      .filter((w) => !w.field || !overrideFields.has(w.field))
      .map((w) => w.sql);
    const ruleClauses = (measure.filterRules || []).map(buildRuleClause).filter(Boolean);
    const innerWhere = [...keptWhere, ...ruleClauses];
    let innerAgg;
    if (measure.aggregation === 'custom' && measure.expression) {
      // Pre-wrap interval refs even on the fallback path (when inlinedExpr
      // wasn't pre-computed) — applyNumericCast will fail on raw interval
      // columns otherwise.
      const exprForCast = inlinedExpr
        || preWrapIntervalRefs(measure.expression, columnTypes, dbType);
      innerAgg = applyNumericCast(exprForCast);
    } else if (measure.aggregation === 'count' || (measure.column === '*' && !measure.table)) {
      innerAgg = 'COUNT(*)';
    } else if (measure.table && measure.column) {
      innerAgg = buildMeasureAggExpr(measure, { dbType, columnTypes });
    } else {
      innerAgg = 'NULL';
    }
    let subSql = `SELECT ${innerAgg} FROM ${fromClause}`;
    if (innerWhere.length > 0) {
      subSql += ` WHERE ${innerWhere.join(' AND ')}`;
    }
    return subSql;
  };

  // Fill in dim-only measure placeholders. Each becomes a scalar subquery
  // that runs against the measure's primary dim table alone, with only
  // the visual's WHERE clauses whose field lives on that SAME table.
  // RLS / untagged clauses are dropped here too — the dim-only subquery
  // is a scope-restricted lookup; security still applies via the outer
  // query's WHERE for the rest of the SELECT. (If the dim itself is
  // RLS-controlled, the model should mark it RLS via a different
  // mechanism; we don't have one today and counts on a public dim are
  // fine.)
  for (const info of dimOnlyMeasureInfos) {
    const { m, index, primaryTable, label } = info;
    const sameTableWhere = whereParts
      .filter((w) => {
        if (!w.field) return false;
        const d = allDimensions.find((dd) => dd.name === w.field);
        return d && d.table === primaryTable;
      })
      .map((w) => w.sql);
    let innerAgg;
    if (m.aggregation === 'custom' && m.expression) {
      let inlined;
      try {
        inlined = inlineMeasureRefs(m.expression);
      } catch (e) {
        return res.status(400).json({ error: e.message });
      }
      inlined = preWrapIntervalRefs(inlined, columnTypes, dbType);
      innerAgg = applyNumericCast(inlined);
    } else if (m.aggregation === 'count' || (m.column === '*' && !m.table)) {
      innerAgg = 'COUNT(*)';
    } else if (m.table && m.column) {
      innerAgg = buildMeasureAggExpr(m, { dbType, columnTypes });
    } else {
      innerAgg = 'NULL';
    }
    let subSql = `SELECT ${innerAgg} FROM ${quoteTable(primaryTable, dbType)}`;
    if (sameTableWhere.length > 0) {
      subSql += ` WHERE ${sameTableWhere.join(' AND ')}`;
    }
    selectParts[index] = `(${subSql}) AS ${quoteIdent(label, dbType)}`;
  }

  // Fill in override-mode filtered measure placeholders. Each becomes a
  // scalar subquery that re-runs the same FROM/JOIN graph, drops the
  // visual's WHERE clauses on the override fields, and applies the
  // measure's own filterRules. This runs AFTER fromClause/whereParts are
  // finalised so the subquery has the same join graph as the outer query.
  for (const info of overrideMeasureInfos) {
    const { m, index, label, inlinedExpression } = info;
    const subSql = buildOverrideSubquery(m, inlinedExpression);
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
      const inlinedExpr = target.expression ? inlineMeasureRefs(target.expression) : null;
      const subSql = buildOverrideSubquery(target, inlinedExpr);
      const placeholder = `__OVERRIDE_REF_${i}__`;
      const replacement = `(${subSql})`;
      for (let j = 0; j < selectParts.length; j++) {
        if (typeof selectParts[j] === 'string' && selectParts[j].includes(placeholder)) {
          selectParts[j] = selectParts[j].split(placeholder).join(replacement);
        }
      }
    }
  }

  // X-grain HAVING — build the IN-subquery now that fromClause + whereParts
  // are finalised (RLS injected, JOIN graph closed). The subquery shape:
  //   SELECT <x dims> FROM <same FROM> WHERE <same WHERE>
  //   GROUP BY <x dims> HAVING <x-grain havings>
  //   [ORDER BY <x-grain topN expr> <dir> [NULLS LAST] LIMIT <n>]
  // and we push `<x dim cols> IN (<subSql>)` onto whereParts so the outer
  // query keeps the (X × legend) grain but only for X values that passed
  // the X-grain test. We capture whereParts BEFORE pushing the IN clause
  // so the subquery sees the unmodified WHERE — no self-referential loop.
  // Single-dim case uses `col IN (subSelect)`; multi-dim uses row-value
  // `(col1, col2) IN (subSelect)`, which works on PG / MySQL / DuckDB /
  // BigQuery; MSSQL doesn't support it and would fall through to a no-op
  // unless we ever expand to EXISTS. For now the typical case (one
  // active X axis, possibly drilled) hits the single-dim branch.
  if (useXGrainHaving && (xGrainHavingParts.length > 0 || xGrainTopN)) {
    const grainDimDefs = havingGrainDims
      .map((n) => allDimensions.find((d) => d.name === n))
      .filter((d) => d && d.table && d.column);
    if (grainDimDefs.length === havingGrainDims.length && grainDimDefs.length > 0) {
      for (const d of grainDimDefs) tablesUsed.add(d.table);
      const dimColExprs = grainDimDefs.map((d) => quoteCol(d.table, d.column, dbType));
      const capturedWhere = whereParts.length > 0
        ? ` WHERE ${whereParts.map((w) => w.sql).join(' AND ')}`
        : '';
      const subSelect = dimColExprs.join(', ');
      const subGroupBy = dimColExprs.join(', ');
      const subHaving = xGrainHavingParts.length > 0
        ? ` HAVING ${xGrainHavingParts.join(' AND ')}`
        : '';
      let subOrderLimit = '';
      if (xGrainTopN) {
        const supportsNullsLast = dbType === 'postgres' || dbType === 'duckdb' || dbType === 'bigquery';
        if (dbType === 'mysql') {
          subOrderLimit = ` ORDER BY ${xGrainTopN.aggExpr} IS NULL, ${xGrainTopN.aggExpr} ${xGrainTopN.direction}`;
        } else if (supportsNullsLast) {
          subOrderLimit = ` ORDER BY ${xGrainTopN.aggExpr} ${xGrainTopN.direction} NULLS LAST`;
        } else {
          subOrderLimit = ` ORDER BY ${xGrainTopN.aggExpr} ${xGrainTopN.direction}`;
        }
        if (dbType === 'mssql' || dbType === 'azure_sql') {
          subOrderLimit += ` OFFSET 0 ROWS FETCH NEXT ${xGrainTopN.n} ROWS ONLY`;
        } else {
          subOrderLimit += ` LIMIT ${xGrainTopN.n}`;
        }
      }
      const subSql = `SELECT ${subSelect} FROM ${fromClause}${capturedWhere} GROUP BY ${subGroupBy}${subHaving}${subOrderLimit}`;
      const inLhs = dimColExprs.length === 1 ? dimColExprs[0] : `(${dimColExprs.join(', ')})`;
      whereParts.push({ field: null, sql: `${inLhs} IN (${subSql})` });
    }
  }

  __mark('SQL parts assembled (selectParts, whereParts, joins, etc.)');
  const useDistinct = distinct || (selectedDimensions.length > 0 && selectedMeasures.length === 0);
  // Dim-only short-circuit. When EVERY selected measure was emitted as a
  // dim-only scalar subquery AND there are no grain dims to GROUP BY, the
  // outer FROM/JOIN/WHERE is just CPU waste: it forces a cartesian over
  // whatever bridge fact the join graph picked first to connect the
  // filter-only dim tables — and that "first fact" choice is arbitrary
  // (BFS adjacency order), so two equivalent visuals could route through
  // different facts. The subqueries are independent constants either way,
  // so drop the outer query entirely and emit a bare `SELECT (subq),...`
  // — no FROM, no WHERE, no GROUP BY. Returns one row, the scalars.
  const allMeasuresDimOnly = selectedMeasures.length > 0
    && dimOnlyMeasureInfos.length === selectedMeasures.length;
  const dimOnlyShortCircuit = allMeasuresDimOnly && selectedDimensions.length === 0;
  let sql;
  if (dimOnlyShortCircuit) {
    sql = `SELECT ${selectParts.join(', ')}`;
  } else if (multiFactBody) {
    // Per-fact aggregate-then-join body (no outer WHERE/GROUP BY/HAVING —
    // each per-fact subquery already carries them). ORDER BY / LIMIT below.
    sql = multiFactBody.sql;
  } else {
    sql = `SELECT ${useDistinct ? 'DISTINCT ' : ''}${selectParts.join(', ')} FROM ${fromClause}`;
    if (whereParts.length > 0) {
      sql += ` WHERE ${whereParts.map((w) => w.sql).join(' AND ')}`;
    }
    if (groupByParts.length > 0 && selectedMeasures.length > 0) {
      sql += ` GROUP BY ${groupByParts.join(', ')}`;
    }
    if (havingParts.length > 0 && selectedMeasures.length > 0) {
      sql += ` HAVING ${havingParts.join(' AND ')}`;
    }
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
    if (multiFactBody) {
      // Outer query exposes dim aliases (not the dim exprs), so order by alias.
      if (multiFactBody.orderByAlias) sql += ` ORDER BY ${multiFactBody.orderByAlias}`;
    } else if (groupByParts.length > 0) {
      sql += ` ORDER BY ${groupByParts[0]}`;
    } else if (selectParts.length > 0) {
      sql += ` ORDER BY 1`;
    }
    // offset/limit arrive straight from the request body, and this route is
    // reachable unauthenticated via public reports — coerce to bounded ints
    // before interpolation (a raw `offset` is otherwise an injection vector).
    const safeLimit = Math.min(Math.max(1, parseInt(limit, 10) || 1000), MAX_ROWS);
    const safeOffset = Math.max(0, parseInt(offset, 10) || 0);
    if (dbType === 'azure_sql' || dbType === 'mssql') {
      sql += ` OFFSET ${safeOffset} ROWS FETCH NEXT ${safeLimit} ROWS ONLY`;
    } else {
      sql += ` LIMIT ${safeLimit}`;
      if (safeOffset > 0) {
        sql += ` OFFSET ${safeOffset}`;
      }
    }
  }

  // sqlOnly mode — return the assembled SQL without executing. Useful for
  // inspecting a slow / hanging query from the editor without waiting for
  // the server to actually run it.
  if (sqlOnly) {
    return res.json({ sql, rows: [], rowCount: 0, sqlOnly: true });
  }

  // Opt-in: dump the exact SQL the rollup builder runs against the source
  // DB (off by default — set ROLLUP_SQL_LOG=1). Pairs with the
  // `queryMs=` timing line so a slow build can be traced to its query.
  if (isRollupBuilderRequest && process.env.ROLLUP_SQL_LOG === '1') {
    console.log(`[rollup] build-sql dims=[${(dimensionNames || []).join(',')}] :: ${sql}`);
  }

  // Opt-in: dump the exact SQL of LIVE (non-builder) queries — set
  // QUERY_SQL_LOG=1. Tagged with dims/measures/distinct so a slicer's
  // distinct-values query (meas=0 distinct=true) is greppable in the
  // Docker logs without hunting the browser Network tab.
  if (!isRollupBuilderRequest && process.env.QUERY_SQL_LOG === '1') {
    console.log(
      `[query-sql] report=${reportId || '∅'} ` +
      `dims=[${(dimensionNames || []).join(',')}] ` +
      `meas=${(measureNames || []).length} distinct=${!!distinct} ` +
      `wf=${Array.isArray(widgetFilters) ? widgetFilters.length : 0} :: ${sql}`
    );
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
  if (!bypassCache && !req._slicerDistinctBypassQueryCache) {
    // The rollup planner was already checked at the top of the handler —
    // a hit returned early before SQL build. Reaching here means rollup
    // miss; fall through to the SQL-keyed queryCache, then the DB.
    // `_slicerDistinctBypassQueryCache` set when a slicer-distinct
    // request rollup-MISSed: we want fresh live values, not a stale
    // queryCache entry from before the most recent cache rebuild.
    const cached = queryCache.get(cacheOpts);
    __mark(`queryCache.get ${cached ? 'HIT' : 'MISS'}`);
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
    __mark('DB phase start (createConnection + execute)');
    conn = createConnection(datasource);
    // When the client supplies a queryId AND the connector exposes a
    // cancellable variant, register the cancel callback so a sibling
    // /cancel-query call can abort the in-flight DB query. Otherwise fall
    // back to the legacy non-cancellable path.
    //
    // Rollup-builder requests run a full unfiltered aggregation over the
    // source fact table (one grain per call) to materialise a rollup —
    // that can be far slower than a runtime drill. The user-facing
    // default is fine for runtime queries but too tight for the build
    // pass; bump to 10 min for builder requests.
    const baseTimeoutMs = resolveQueryTimeoutMs(req);
    const timeoutMs = isRollupBuilderRequest ? Math.max(baseTimeoutMs, 10 * 60 * 1000) : baseTimeoutMs;
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
    // Rollup-builder requests pull a full unfiltered aggregation that
    // lands in the rollup table anyway; don't also bloat the in-RAM
    // queryCache with that one-off payload.
    if (!isRollupBuilderRequest) {
      queryCache.set(cacheOpts, {
        rows,
        builtAt: new Date().toISOString(),
        queryDurationMs: Date.now() - startedAt,
      });
    }
    __mark(`DB done (${rows.length} rows, queryMs=${Date.now() - startedAt})`);
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
