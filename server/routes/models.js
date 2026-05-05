const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { requireAuth } = require('../middleware/auth');
const db = require('../db');
const { createConnection } = require('../utils/dbConnector');
const { canAccessReport } = require('./reports');

const router = express.Router();

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

// Quote a table name, handling schema.table format
// "datakhi_elections.d_population" → "datakhi_elections"."d_population"
// "users" → "users"
function quoteTable(name) {
  if (name.includes('.')) {
    return name.split('.').map((p) => `"${p}"`).join('.');
  }
  return `"${name}"`;
}

// Cast an expression to a string type using the dialect's expected keyword.
// PostgreSQL / SQL Server / DuckDB accept VARCHAR; MySQL refuses VARCHAR
// and wants CHAR; BigQuery wants STRING. Used everywhere we coerce values
// to text for IN / LIKE / equality comparisons.
function castToString(expr, dbType) {
  if (dbType === 'mysql') return `CAST(${expr} AS CHAR)`;
  if (dbType === 'bigquery') return `CAST(${expr} AS STRING)`;
  return `CAST(${expr} AS VARCHAR)`;
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

  const { name, description, selected_tables, table_positions, dimensions, measures, joins, rls, dateColumn, datasourceId } = req.body;

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
    dateColumn !== undefined ? 1 : 0,
    dateColumn !== undefined ? (dateColumn || '') : '',
    req.params.id
  );

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

    const requestedCols = (typeof columns === 'string' ? columns.split(',') : []).map((s) => s.trim()).filter(Boolean);
    const safeCols = [primaryKey, ...requestedCols.filter((c) => c !== primaryKey && colSet.has(c))];
    const selectList = safeCols.map((c) => `"${c}"`).join(', ');

    let sql = `SELECT ${selectList} FROM ${quoteTable(table)}`;
    const trimmedSearch = (search || '').toString().trim();
    if (trimmedSearch) {
      const escaped = trimmedSearch.replace(/'/g, "''");
      // CAST to VARCHAR so the LIKE works regardless of the column's native type (number, date, etc.)
      sql += ` WHERE LOWER(${castToString(`${quoteTable(table)}."${primaryKey}"`, datasource.db_type)}) LIKE LOWER('%${escaped}%')`;
    }
    // SQL Server / Azure SQL doesn't support LIMIT — use OFFSET/FETCH instead.
    const isMssql = datasource.db_type === 'azure_sql' || datasource.db_type === 'mssql';
    sql += ` ORDER BY "${primaryKey}"`;
    sql += isMssql ? ` OFFSET 0 ROWS FETCH NEXT 1000 ROWS ONLY` : ` LIMIT 1000`;

    const rawRows = await conn.query(sql);
    const rows = rawRows.map((r) => {
      const obj = {};
      for (const [k, v] of Object.entries(r)) {
        if (v instanceof Date) obj[k] = v.toISOString().split('T')[0];
        else obj[k] = v;
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

// Query model: build SQL from selected dimensions + measures.
// Accessible if the user has access to any report linked to this model
// (owner, global admin, public report, or workspace member).
router.post('/:id/query', async (req, res) => {
  const model = db.prepare('SELECT * FROM models WHERE id = ?').get(req.params.id);
  if (!model || !canAccessModel(model, req.user)) return res.status(404).json({ error: 'Model not found' });

  const datasource = db.prepare('SELECT * FROM datasources WHERE id = ?').get(model.datasource_id);
  if (!datasource) return res.status(404).json({ error: 'Datasource not found' });
  const dbType = datasource.db_type;

  const { dimensionNames, measureNames, limit, offset, filters, widgetFilters, distinct, measureAggOverrides, sqlOnly } = req.body;
  // dimensionNames: ["orders.customer_name", "orders.status"]
  // measureNames: ["orders.total_amount_sum", "orders.count"]

  const allDimensions = JSON.parse(model.dimensions);
  const allMeasures = JSON.parse(model.measures);
  const allJoins = JSON.parse(model.joins);
  const rls = JSON.parse(model.rls || '{}');

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

  // Pre-register filter tables so they get JOINed
  const whereParts = [];
  if (filters && typeof filters === 'object') {
    for (const [dimName, values] of Object.entries(filters)) {
      if (!Array.isArray(values) || values.length === 0) continue;
      const dimDef = allDimensions.find((d) => d.name === dimName);
      if (dimDef) {
        tablesUsed.add(dimDef.table);
        const col = `${quoteTable(dimDef.table)}."${dimDef.column}"`;
        const escaped = values.map((v) => `'${String(v).replace(/'/g, "''")}'`).join(', ');
        if (dimDef.type === 'date') {
          // Date columns: cast to DATE so timestamps like "2024-04-30 10:30:00" match "2024-04-30"
          whereParts.push(`CAST(${col} AS DATE) IN (${escaped})`);
        } else {
          // Non-date columns: cast to VARCHAR for consistent comparison across all DB types
          whereParts.push(`${castToString(col, dbType)} IN (${escaped})`);
        }
      }
    }
  }

  // Per-widget filters with rich operators. Built here for dimension filters
  // (added to WHERE) and later for measure filters (added to HAVING after the
  // measure aggregation expressions are constructed). Custom-expression
  // measures are not yet supported in HAVING.
  const havingParts = [];
  const escVal = (v) => `'${String(v).replace(/'/g, "''")}'`;
  const isEmpty = (v) => v == null || v === '';
  function buildScalarClause(colExpr, op, value, values, isDateCol) {
    const cast = isDateCol ? `CAST(${colExpr} AS DATE)` : colExpr;
    const list = Array.isArray(values) ? values : (Array.isArray(value) ? value : null);
    const numericFor = (v) => isDateCol ? escVal(v) : Number(v);
    switch (op) {
      case 'in':
        if (!list?.length) return null;
        return `${castToString(colExpr, dbType)} IN (${list.map(escVal).join(', ')})`;
      case 'not_in':
        if (!list?.length) return null;
        return `${castToString(colExpr, dbType)} NOT IN (${list.map(escVal).join(', ')})`;
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
      const col = `${quoteTable(dimDef.table)}."${dimDef.column}"`;
      const clause = buildScalarClause(col, f.op, f.value, f.values, dimDef.type === 'date');
      if (clause) whereParts.push(clause);
    }
  }

  selectedDimensions.forEach((d) => {
    if (d.datePart) {
      // Date part derived column — generate SQL expression per DB type
      const col = `${quoteTable(d.table)}."${d.column}"`;
      let expr;
      if (dbType === 'duckdb') {
        switch (d.datePart) {
          case 'num_year': expr = `EXTRACT(YEAR FROM CAST(${col} AS DATE))`; break;
          case 'num_month': expr = `EXTRACT(MONTH FROM CAST(${col} AS DATE))`; break;
          case 'name_month': expr = `STRFTIME(CAST(${col} AS DATE), '%B')`; break;
          case 'num_week': expr = `EXTRACT(WEEK FROM CAST(${col} AS DATE))`; break;
          case 'num_day_of_week': expr = `EXTRACT(DOW FROM CAST(${col} AS DATE))`; break;
          case 'name_day': expr = `STRFTIME(CAST(${col} AS DATE), '%A')`; break;
          default: expr = col;
        }
      } else if (dbType === 'mysql') {
        switch (d.datePart) {
          case 'num_year': expr = `YEAR(${col})`; break;
          case 'num_month': expr = `MONTH(${col})`; break;
          case 'name_month': expr = `MONTHNAME(${col})`; break;
          case 'num_week': expr = `WEEK(${col})`; break;
          case 'num_day_of_week': expr = `DAYOFWEEK(${col})`; break;
          case 'name_day': expr = `DAYNAME(${col})`; break;
          default: expr = col;
        }
      } else if (dbType === 'azure_sql' || dbType === 'mssql') {
        switch (d.datePart) {
          case 'num_year': expr = `YEAR(${col})`; break;
          case 'num_month': expr = `MONTH(${col})`; break;
          case 'name_month': expr = `DATENAME(MONTH, ${col})`; break;
          case 'num_week': expr = `DATEPART(WEEK, ${col})`; break;
          case 'num_day_of_week': expr = `DATEPART(WEEKDAY, ${col})`; break;
          case 'name_day': expr = `DATENAME(WEEKDAY, ${col})`; break;
          default: expr = col;
        }
      } else {
        // PostgreSQL / Azure PostgreSQL / BigQuery
        switch (d.datePart) {
          case 'num_year': expr = `EXTRACT(YEAR FROM ${col}::DATE)`; break;
          case 'num_month': expr = `EXTRACT(MONTH FROM ${col}::DATE)`; break;
          case 'name_month': expr = `TO_CHAR(${col}::DATE, 'Month')`; break;
          case 'num_week': expr = `EXTRACT(WEEK FROM ${col}::DATE)`; break;
          case 'num_day_of_week': expr = `EXTRACT(DOW FROM ${col}::DATE)`; break;
          case 'name_day': expr = `TO_CHAR(${col}::DATE, 'Day')`; break;
          default: expr = col;
        }
      }
      selectParts.push(`${expr} AS "${d.label || d.name}"`);
      groupByParts.push(expr);
      tablesUsed.add(d.table);
    } else {
      selectParts.push(`${quoteTable(d.table)}."${d.column}" AS "${d.label || d.name}"`);
      groupByParts.push(`${quoteTable(d.table)}."${d.column}"`);
      tablesUsed.add(d.table);
    }
  });

  selectedMeasures.forEach((m) => {
    if (m.table) tablesUsed.add(m.table);
    if (m.aggregation === 'custom' && m.expression) {
      // Custom SQL expression - force NUMERIC inside aggregates to avoid integer division truncation
      // SUM(col) becomes SUM((col)::NUMERIC) so division preserves decimals
      const numericExpr = m.expression.replace(
        /\b(SUM|AVG|MIN|MAX)\(([^)]+)\)/gi,
        (match, fn, col) => `${fn}((${col})::NUMERIC)`
      );
      selectParts.push(`(${numericExpr}) AS "${m.label || m.name}"`);
      // Extract table references from expression for joins
      // Check all dimensions and measures for column/table references
      const allFieldsForLookup = [...allDimensions, ...allMeasures.filter((x) => x.table)];
      for (const field of allFieldsForLookup) {
        if (m.expression.includes(field.column) || m.expression.includes(field.table)) {
          tablesUsed.add(field.table);
        }
      }
    } else if (m.aggregation === 'count') {
      selectParts.push(`COUNT(*) AS "${m.label || m.name}"`);
    } else {
      selectParts.push(`${m.aggregation.toUpperCase()}(${quoteTable(m.table)}."${m.column}") AS "${m.label || m.name}"`);
    }
  });

  // Apply per-widget MEASURE filters as HAVING clauses, now that aggregation
  // expressions are known. Skips custom expressions (not yet supported in HAVING).
  let topNOverride = null; // { aggExpr, n, direction: 'DESC' | 'ASC' }
  for (const f of measureFiltersDeferred) {
    const measDef = allMeasures.find((mm) => mm.name === f.field);
    if (!measDef) continue;
    if (measDef.aggregation === 'custom') continue; // unsupported for now
    const aggExpr = measDef.aggregation === 'count'
      ? 'COUNT(*)'
      : (measDef.table && measDef.column
          ? `${(measDef.aggregation || 'sum').toUpperCase()}(${quoteTable(measDef.table)}."${measDef.column}")`
          : null);
    if (!aggExpr) continue;
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
      whereParts.push('1 = 0');
    } else {
      tablesUsed.add(rls.table);
      if (!allowedRlsKeys || allowedRlsKeys.length === 0) {
        // No matching rule for this user → deny everything.
        whereParts.push('1 = 0');
      } else {
        const escaped = allowedRlsKeys.map((v) => `'${String(v).replace(/'/g, "''")}'`).join(', ');
        whereParts.push(`${castToString(`${quoteTable(rls.table)}."${rls.primaryKey}"`, dbType)} IN (${escaped})`);
      }
    }
  }

  // Build FROM + JOINs
  const tableList = Array.from(tablesUsed);
  let fromClause = quoteTable(tableList[0]);

  if (tableList.length > 1) {
    for (let i = 1; i < tableList.length; i++) {
      const join = allJoins.find(
        (j) => (j.from_table === tableList[i] || j.to_table === tableList[i]) &&
               (j.from_table === tableList[0] || j.to_table === tableList[0] ||
                tableList.slice(0, i).some((t) => j.from_table === t || j.to_table === t))
      );
      if (join) {
        const joinType = (join.type || 'LEFT').toUpperCase();
        fromClause += ` ${joinType} JOIN ${quoteTable(tableList[i])} ON ${quoteTable(join.from_table)}."${join.from_column}" = ${quoteTable(join.to_table)}."${join.to_column}"`;
      } else {
        fromClause += `, ${quoteTable(tableList[i])}`;
      }
    }
  }

  const useDistinct = distinct || (selectedDimensions.length > 0 && selectedMeasures.length === 0);
  let sql = `SELECT ${useDistinct ? 'DISTINCT ' : ''}${selectParts.join(', ')} FROM ${fromClause}`;

  if (whereParts.length > 0) {
    sql += ` WHERE ${whereParts.join(' AND ')}`;
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
    // NULLs would otherwise dominate (Postgres) or sit at the bottom (MySQL)
    // of ORDER BY DESC. Force them to the bottom regardless of direction.
    const nullsClause = (dbType === 'mysql')
      ? '' // MySQL handled below
      : ' NULLS LAST';
    if (dbType === 'mysql') {
      // MySQL doesn't support NULLS LAST — emulate with `<col> IS NULL` first.
      sql += ` ORDER BY ${topNOverride.aggExpr} IS NULL, ${topNOverride.aggExpr} ${topNOverride.direction}`;
    } else {
      sql += ` ORDER BY ${topNOverride.aggExpr} ${topNOverride.direction}${nullsClause}`;
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

  let conn;
  try {
    conn = createConnection(datasource);
    const rawRows = await conn.query(sql);
    // Normalize Date objects to ISO date strings for all DB types
    const rows = rawRows.map((r) => {
      const obj = {};
      for (const [k, v] of Object.entries(r)) {
        if (v instanceof Date) obj[k] = v.toISOString().split('T')[0];
        else obj[k] = v;
      }
      return obj;
    });
    res.json({
      rows, rowCount: rows.length, maxReached: rows.length >= MAX_ROWS, sql,
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
    res.status(500).json({ error: err.message, sql });
  } finally {
    conn?.close();
  }
});

module.exports = router;
