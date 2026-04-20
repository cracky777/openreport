const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { requireAuth } = require('../middleware/auth');
const db = require('../db');
const { createConnection } = require('../utils/dbConnector');

const router = express.Router();

// Quote a table name, handling schema.table format
// "datakhi_elections.d_population" → "datakhi_elections"."d_population"
// "users" → "users"
function quoteTable(name) {
  if (name.includes('.')) {
    return name.split('.').map((p) => `"${p}"`).join('.');
  }
  return `"${name}"`;
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

// Get single model with full details
router.get('/:id', requireAuth, (req, res) => {
  const model = db.prepare('SELECT * FROM models WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!model) return res.status(404).json({ error: 'Model not found' });

  res.json({
    model: {
      ...model,
      selected_tables: JSON.parse(model.selected_tables),
      table_positions: JSON.parse(model.table_positions),
      dimensions: JSON.parse(model.dimensions),
      measures: JSON.parse(model.measures),
      joins: JSON.parse(model.joins),
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

// Update model (dimensions, measures, joins)
router.put('/:id', requireAuth, (req, res) => {
  const model = db.prepare('SELECT * FROM models WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!model) return res.status(404).json({ error: 'Model not found' });

  const { name, description, selected_tables, table_positions, dimensions, measures, joins, dateColumn } = req.body;

  db.prepare(`
    UPDATE models SET
      name = COALESCE(?, name),
      description = COALESCE(?, description),
      selected_tables = COALESCE(?, selected_tables),
      table_positions = COALESCE(?, table_positions),
      dimensions = COALESCE(?, dimensions),
      measures = COALESCE(?, measures),
      joins = COALESCE(?, joins),
      date_column = CASE WHEN ? = 1 THEN ? ELSE date_column END,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    name || null,
    description !== undefined ? description : null,
    selected_tables ? JSON.stringify(selected_tables) : null,
    table_positions ? JSON.stringify(table_positions) : null,
    dimensions ? JSON.stringify(dimensions) : null,
    measures ? JSON.stringify(measures) : null,
    joins ? JSON.stringify(joins) : null,
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
      dateColumn: updated.date_column || null,
    },
  });
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

// Query model: build SQL from selected dimensions + measures
// Accessible if: user owns the model OR model is linked to a public report
router.post('/:id/query', async (req, res) => {
  let model;
  if (req.isAuthenticated()) {
    model = db.prepare('SELECT * FROM models WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  }
  if (!model) {
    // Check if model belongs to a public report
    const publicReport = db.prepare('SELECT id FROM reports WHERE model_id = ? AND is_public = 1').get(req.params.id);
    if (publicReport) {
      model = db.prepare('SELECT * FROM models WHERE id = ?').get(req.params.id);
    }
  }
  if (!model) return res.status(404).json({ error: 'Model not found' });

  const datasource = db.prepare('SELECT * FROM datasources WHERE id = ?').get(model.datasource_id);
  if (!datasource) return res.status(404).json({ error: 'Datasource not found' });

  const { dimensionNames, measureNames, limit, offset, filters, distinct, measureAggOverrides } = req.body;
  // dimensionNames: ["orders.customer_name", "orders.status"]
  // measureNames: ["orders.total_amount_sum", "orders.count"]

  const allDimensions = JSON.parse(model.dimensions);
  const allMeasures = JSON.parse(model.measures);
  const allJoins = JSON.parse(model.joins);

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
          whereParts.push(`CAST(${col} AS VARCHAR) IN (${escaped})`);
        }
      }
    }
  }

  const dbType = datasource.db_type;

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

  // Stable ordering: ORDER BY the first dimension to keep consistent colors across refetches
  if (groupByParts.length > 0) {
    sql += ` ORDER BY ${groupByParts[0]}`;
  } else if (selectParts.length > 0) {
    sql += ` ORDER BY 1`;
  }

  const MAX_ROWS = 1000000;
  const requestedLimit = Math.min(limit || 1000, MAX_ROWS);
  sql += ` LIMIT ${requestedLimit}`;
  if (offset) {
    sql += ` OFFSET ${offset}`;
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
    res.json({ rows, rowCount: rows.length, maxReached: rows.length >= MAX_ROWS, sql });
  } catch (err) {
    res.status(500).json({ error: err.message, sql });
  } finally {
    conn?.close();
  }
});

module.exports = router;
