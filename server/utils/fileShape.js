// Reshaping an imported file into a fact table and the dimensions around it:
// months spread across columns become rows, title rows above the header go,
// amounts stored as text become numbers, what describes a key (an account's
// label next to its code) moves to a dimension table with one row per key, and
// the dates get a calendar table every fact can share. The recipe is a list of
// CLOSED operations — the assistant proposes it, the user reads it and
// validates — compiled here into DuckDB SQL with every identifier and literal
// quoted: nothing the model wrote is ever interpolated as SQL. The table as
// imported is kept in the file's `raw` schema (invisible to models, which list
// `main` only), so a recipe can be changed, removed, and replayed on refresh.

const q = (ident) => `"${String(ident).replace(/"/g, '""')}"`;
const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;

const OPS = ['header', 'drop', 'rename', 'unpivot', 'map', 'cast', 'filter', 'concat', 'dimension', 'calendar', 'copy'];
const TYPES = ['text', 'number', 'integer', 'date'];
const DECIMALS = ['point', 'comma'];
const DATE_FORMATS = ['%Y-%m-%d', '%d/%m/%Y', '%m/%d/%Y', '%d.%m.%Y', '%d-%m-%Y', '%Y/%m/%d', '%Y%m%d', '%d/%m/%y', '%Y-%m', '%m/%Y', '%m-%Y', '%Y%m', '%b %Y', '%B %Y', '%b-%y', '%b %y', '%Y-%m-%d %H:%M:%S'];
const FILTERS = ['not_empty', 'is_number', 'equals', 'not_equals', 'starts_with', 'not_starts_with'];
const MAX_STEPS = 40;
const MAX_LIST = 400;
const MAX_NAME = 128;
const MAX_VALUE = 200;
const MAX_HEADER_ROW = 50;
// A new table's name: an identifier models address as is; never `__`, which
// marks a linked source's tables (utils/modelSources.js).
const TABLE_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const str = (v, max = MAX_NAME) => (typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : null);
const list = (v) => (Array.isArray(v) ? v.map((x) => str(x)).filter(Boolean).slice(0, MAX_LIST) : []);
const tableName = (v) => (typeof v === 'string' && TABLE_NAME.test(v) && !v.includes('__') ? v : null);

/**
 * The recipe re-projected: only known operations with well-formed arguments.
 * `columns`: the table's columns, when known — references are checked against
 * them up to a `header` step, after which the names come from the data.
 * `taken`: table names of the source a new table may not take.
 * @returns {{ shape: object|null, errors: string[] }}
 */
function validateShape(raw, { columns = null, taken = [] } = {}) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const errors = [];
  const table = str(src.table);
  if (!table) return { shape: null, errors: ['table: the name of the table to reshape'] };
  let known = Array.isArray(columns) ? new Set(columns) : null;
  const col = (v, what) => {
    const c = str(v);
    if (!c) { errors.push(`${what}: a column name`); return null; }
    if (known && !known.has(c)) { errors.push(`${what}: ${JSON.stringify(c)} is not a column of ${table}`); return null; }
    return c;
  };
  const steps = [];
  const outputs = new Set();
  const used = new Set(taken.filter((t) => t !== table));
  const newTable = (v, what) => {
    const n = tableName(v);
    if (!n) { errors.push(`${what}: a table name (letters, digits, _; never __)`); return null; }
    if (used.has(n) || outputs.has(n)) { errors.push(`${what}: a table named ${n} already exists in the source`); return null; }
    outputs.add(n);
    return n;
  };
  const given = Array.isArray(src.steps) ? src.steps.slice(0, MAX_STEPS) : [];
  given.forEach((s, i) => {
    const op = s && typeof s === 'object' ? s.op : null;
    const at = `step ${i + 1}`;
    if (!OPS.includes(op)) { errors.push(`${at}: op must be one of ${OPS.join(', ')}`); return; }
    if (op === 'header') {
      const row = Number(s.row);
      if (i !== 0) { errors.push(`${at}: header must be the first step`); return; }
      if (!Number.isInteger(row) || row < 1 || row > MAX_HEADER_ROW) { errors.push(`${at}: header row between 1 and ${MAX_HEADER_ROW}`); return; }
      known = null; // the names are read from that row when applied
      steps.push({ op, row });
    } else if (op === 'drop') {
      const cols = list(s.columns).map((c) => col(c, at)).filter(Boolean);
      if (!cols.length) { errors.push(`${at}: drop needs columns`); return; }
      if (known) cols.forEach((c) => known.delete(c));
      steps.push({ op, columns: cols });
    } else if (op === 'rename') {
      const from = col(s.from, at);
      const to = str(s.to);
      if (!from || !to) { if (!to) errors.push(`${at}: rename needs from and to`); return; }
      if (known) { known.delete(from); known.add(to); }
      steps.push({ op, from, to });
    } else if (op === 'unpivot') {
      const name = str(s.name);
      const value = str(s.value);
      if (!name || !value) { errors.push(`${at}: unpivot needs name and value`); return; }
      const keep = list(s.keep).map((c) => col(c, at)).filter(Boolean);
      const cols = keep.length ? [] : list(s.columns).map((c) => col(c, at)).filter(Boolean);
      if (!keep.length && !cols.length) { errors.push(`${at}: unpivot needs the columns to turn into rows, or the columns to keep`); return; }
      if (known) { known = new Set(keep.length ? keep : [...known].filter((c) => !cols.includes(c))); known.add(name); known.add(value); }
      steps.push(keep.length ? { op, keep, name, value } : { op, columns: cols, name, value });
    } else if (op === 'map') {
      const c = col(s.column, at);
      const entries = Object.entries(s.values && typeof s.values === 'object' && !Array.isArray(s.values) ? s.values : {})
        .filter(([k, v]) => typeof k === 'string' && typeof v === 'string' && k.length <= MAX_VALUE && v.length <= MAX_VALUE)
        .slice(0, MAX_LIST);
      if (!c || !entries.length) { if (c) errors.push(`${at}: map needs values ({ from: to })`); return; }
      steps.push({ op, column: c, values: Object.fromEntries(entries) });
    } else if (op === 'cast') {
      const c = col(s.column, at);
      if (!c) return;
      if (!TYPES.includes(s.type)) { errors.push(`${at}: cast type among ${TYPES.join(', ')}`); return; }
      const step = { op, column: c, type: s.type };
      if (s.type === 'date' && s.format !== undefined) {
        if (!DATE_FORMATS.includes(s.format)) { errors.push(`${at}: date format among ${DATE_FORMATS.join(' ')}`); return; }
        step.format = s.format;
      }
      if ((s.type === 'number' || s.type === 'integer') && s.decimal !== undefined) {
        if (!DECIMALS.includes(s.decimal)) { errors.push(`${at}: decimal is point or comma`); return; }
        step.decimal = s.decimal;
      }
      steps.push(step);
    } else if (op === 'filter') {
      const c = col(s.column, at);
      if (!c) return;
      if (!FILTERS.includes(s.test)) { errors.push(`${at}: filter test among ${FILTERS.join(', ')}`); return; }
      const needsValue = !['not_empty', 'is_number'].includes(s.test);
      const value = needsValue ? str(s.value, MAX_VALUE) : null;
      if (needsValue && value === null) { errors.push(`${at}: ${s.test} needs a value`); return; }
      steps.push(needsValue ? { op, column: c, test: s.test, value } : { op, column: c, test: s.test });
    } else if (op === 'concat') {
      // Two columns that name the same kind of thing (departure and arrival
      // warehouse) joined into one key: a fact never joins a dimension twice,
      // the pair is read as one dimension instead (asked by Jonathan).
      const name = str(s.name, MAX_NAME);
      const cols = list(s.columns).map((c) => col(c, at)).filter(Boolean);
      // Spaces around the arrow are part of the key: not trimmed.
      const separator = s.separator === undefined ? ' → ' : (typeof s.separator === 'string' && s.separator.length > 0 && s.separator.length <= 8 ? s.separator : null);
      if (!name) { errors.push(`${at}: concat needs the name of the new column`); return; }
      if (known && known.has(name)) { errors.push(`${at}: ${JSON.stringify(name)} is already a column of ${table}`); return; }
      if (cols.length < 2) { errors.push(`${at}: concat needs at least two columns`); return; }
      if (separator === null) { errors.push(`${at}: separator is a short text`); return; }
      if (known) known.add(name);
      steps.push({ op, name, columns: cols, separator });
    } else if (op === 'dimension') {
      const name = newTable(s.name, at);
      const key = col(s.key, at);
      const cols = list(s.columns).map((c) => col(c, at)).filter(Boolean).filter((c) => c !== key);
      if (!name || !key) return;
      // No describing column: the table is the list of the key's values — what
      // two facts (tickets and targets, both by department) need to share.
      steps.push({ op, name, key, columns: cols });
    } else if (op === 'copy') {
      // A dimension a fact points to twice (departure and arrival warehouse)
      // is written twice, one table per role, each joined on its own column:
      // the model never joins one table twice (asked by Jonathan).
      const name = newTable(s.name, at);
      if (!name) return;
      steps.push({ op, name });
    } else if (op === 'calendar') {
      const name = newTable(s.name, at);
      const c = col(s.column, at);
      if (!name || !c) return;
      const step = { op, name, column: c };
      for (const k of ['from', 'to']) {
        if (s[k] === undefined) continue;
        if (typeof s[k] !== 'string' || !ISO_DATE.test(s[k])) { errors.push(`${at}: ${k} as YYYY-MM-DD`); return; }
        step[k] = s[k];
      }
      steps.push(step);
    }
  });
  let output = table;
  if (src.output !== undefined && src.output !== table) {
    output = newTable(src.output, 'output');
    if (!output) return { shape: null, errors };
  }
  return { shape: errors.length ? null : { table, steps, output }, errors };
}

/** The recipe in plain words, one line per step — what the card shows and the user validates. */
function describeShape(shape) {
  const few = (xs, n = 4) => (xs.length > n ? `${xs.slice(0, n).join(', ')} and ${xs.length - n} more` : xs.join(', '));
  const lines = shape.steps.map((s) => {
    switch (s.op) {
      case 'header': return `Row ${s.row} holds the column names; the rows above it are dropped`;
      case 'drop': return `Columns dropped: ${few(s.columns)}`;
      case 'rename': return `Column ${s.from} renamed ${s.to}`;
      case 'unpivot': return s.keep
        ? `Every column but ${few(s.keep)} becomes a row: its name in ${s.name}, its value in ${s.value}`
        : `${s.columns.length} columns (${few(s.columns, 3)}) become rows: the column name in ${s.name}, its value in ${s.value}`;
      case 'map': {
        const pairs = Object.entries(s.values);
        return `${s.column}: ${pairs.length} value${pairs.length > 1 ? 's' : ''} rewritten (${few(pairs.map(([k, v]) => `${k} → ${v}`), 3)})`;
      }
      case 'cast': return `${s.column} read as ${{ text: 'text', number: 'a number', integer: 'a whole number', date: 'a date' }[s.type]}${s.format ? ` (${s.format})` : ''}${s.decimal === 'comma' ? ' (decimal comma)' : ''}`;
      case 'filter': return `Rows kept where ${s.column} ${{
        not_empty: 'is not empty', is_number: 'is a number', equals: `is ${JSON.stringify(s.value)}`, not_equals: `is not ${JSON.stringify(s.value)}`,
        starts_with: `starts with ${JSON.stringify(s.value)}`, not_starts_with: `does not start with ${JSON.stringify(s.value)}`,
      }[s.test]}`;
      case 'concat': return `${s.name} = ${s.columns.join(` ${s.separator.trim() || s.separator} `)} (the columns joined into one key)`;
      case 'dimension': return s.columns.length
        ? `Table ${s.name} extracted: one row per ${s.key}, with ${few(s.columns)} (taken out of the fact)`
        : `Table ${s.name}: one row per ${s.key}, for every fact that has one to share`;
      case 'copy': return `Table ${s.name}: a second copy of the table as shaped, to join a fact on another of its columns`;
      case 'calendar': return `Table ${s.name}: one row per day${s.from && s.to ? ` from ${s.from} to ${s.to}` : ` over the years of ${s.column} and the year after`}, with year, quarter, month, week and month name`;
      default: return s.op;
    }
  });
  lines.push(`Fact table: ${shape.output}${shape.output !== shape.table ? ` (from ${shape.table})` : ''}`);
  return lines;
}

/** The tables the recipe writes, the fact first. */
const outputsOf = (shape) => [shape.output, ...shape.steps.filter((s) => ['dimension', 'calendar', 'copy'].includes(s.op)).map((s) => s.name)];

// Digits, separators and a sign — what a number looks like once currency
// signs, spaces and hard spaces are gone.
const digits = (c) => `regexp_replace(CAST(${q(c)} AS VARCHAR), '[^0-9,.-]', '', 'g')`;
const numberExpr = (c, decimal) => `TRY_CAST(${decimal === 'comma' ? `REPLACE(REPLACE(${digits(c)}, '.', ''), ',', '.')` : `REPLACE(${digits(c)}, ',', '')`} AS DOUBLE)`;
function castExpr(s) {
  const c = q(s.column);
  if (s.type === 'text') return `CAST(${c} AS VARCHAR)`;
  if (s.type === 'number') return numberExpr(s.column, s.decimal);
  if (s.type === 'integer') return `TRY_CAST(ROUND(${numberExpr(s.column, s.decimal)}) AS BIGINT)`;
  return s.format ? `TRY_CAST(TRY_STRPTIME(CAST(${c} AS VARCHAR), ${lit(s.format)}) AS DATE)` : `TRY_CAST(${c} AS DATE)`;
}
function filterExpr(s) {
  const text = `CAST(${q(s.column)} AS VARCHAR)`;
  switch (s.test) {
    case 'not_empty': return `NULLIF(TRIM(${text}), '') IS NOT NULL`;
    case 'is_number': return `${numberExpr(s.column)} IS NOT NULL`;
    case 'equals': return `${text} = ${lit(s.value)}`;
    case 'not_equals': return `${text} IS DISTINCT FROM ${lit(s.value)}`;
    case 'starts_with': return `COALESCE(starts_with(${text}, ${lit(s.value)}), FALSE)`;
    default: return `COALESCE(NOT starts_with(${text}, ${lit(s.value)}), TRUE)`;
  }
}

/**
 * The SELECT that builds the fact from `raw.<table>`, one CTE per step; the
 * dimension and calendar steps read the fact once built (applyShape).
 * `header`: { rawColumns, names } — the raw table's columns and the names row
 * `row` gives them, read before compiling.
 */
function compileFact(shape, { header = null } = {}) {
  const ctes = [];
  let from = `raw.${q(shape.table)}`;
  const next = (body) => { ctes.push(`s${ctes.length} AS (${body})`); from = `s${ctes.length - 1}`; };
  for (const s of shape.steps) {
    switch (s.op) {
      case 'header': {
        const named = header.rawColumns.map((c, k) => `${q(c)} AS ${q(header.names[k])}`);
        next(`SELECT ${named.join(', ')} FROM ${from} WHERE rowid >= ${s.row}`);
        break;
      }
      case 'drop': next(`SELECT * EXCLUDE (${s.columns.map(q).join(', ')}) FROM ${from}`); break;
      case 'rename': next(`SELECT * RENAME (${q(s.from)} AS ${q(s.to)}) FROM ${from}`); break;
      case 'unpivot': {
        const on = s.keep ? `COLUMNS(* EXCLUDE (${s.keep.map(q).join(', ')}))` : s.columns.map(q).join(', ');
        next(`SELECT * FROM (UNPIVOT ${from} ON ${on} INTO NAME ${q(s.name)} VALUE ${q(s.value)})`);
        break;
      }
      case 'map': {
        const text = `CAST(${q(s.column)} AS VARCHAR)`;
        const when = Object.entries(s.values).map(([k, v]) => `WHEN ${text} = ${lit(k)} THEN ${lit(v)}`).join(' ');
        next(`SELECT * REPLACE (CASE ${when} ELSE ${text} END AS ${q(s.column)}) FROM ${from}`);
        break;
      }
      case 'cast': next(`SELECT * REPLACE (${castExpr(s)} AS ${q(s.column)}) FROM ${from}`); break;
      case 'filter': next(`SELECT * FROM ${from} WHERE ${filterExpr(s)}`); break;
      case 'concat': next(`SELECT *, concat_ws(${lit(s.separator)}, ${s.columns.map((c) => `CAST(${q(c)} AS VARCHAR)`).join(', ')}) AS ${q(s.name)} FROM ${from}`); break;
      default: break; // dimension, calendar: after the fact
    }
  }
  return `${ctes.length ? `WITH ${ctes.join(', ')} ` : ''}SELECT * FROM ${from}`;
}

// The names row `row` gives the columns: its cells trimmed, an empty one
// numbered, a repeated one suffixed — the same names the sample showed.
function headerNames(cells) {
  const seen = new Map();
  return cells.map((v, k) => {
    const base = (v === null || v === undefined ? '' : String(v)).trim().replace(/\s+/g, ' ').slice(0, MAX_NAME) || `column_${k + 1}`;
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}_${n}`;
  });
}

// One row per day between two dates (SQL expressions), with the parts a
// report groups by. The same table beside the books (accounting/dimensions.js).
const calendarTableSql = (from, to) => `SELECT CAST(d AS DATE) AS "Date", CAST(year(d) AS INTEGER) AS "Year", 'Q' || quarter(d) AS "Quarter", CAST(month(d) AS INTEGER) AS "Month",
    monthname(d) AS "MonthName", strftime(d, '%Y-%m') AS "YearMonth", CAST(yearweek(d) // 100 AS VARCHAR) || '-W' || lpad(CAST(yearweek(d) % 100 AS VARCHAR), 2, '0') AS "YearWeek",
    CAST(day(d) AS INTEGER) AS "Day", dayname(d) AS "Weekday"
  FROM generate_series(CAST(${from} AS TIMESTAMP), CAST(${to} AS TIMESTAMP), INTERVAL 1 DAY) t(d)`;

const tableExists = async (db, schema, table) => (await db.all('SELECT 1 FROM duckdb_tables() WHERE database_name = current_database() AND schema_name = ? AND table_name = ?', schema, table)).length > 0;
const columnsOf = async (db, schema, table) => (await db.all('SELECT column_name FROM information_schema.columns WHERE table_catalog = current_database() AND table_schema = ? AND table_name = ? ORDER BY ordinal_position', schema, table)).map((r) => r.column_name);
const countOf = async (db, table) => Number((await db.all(`SELECT COUNT(*) AS n FROM main.${q(table)}`))[0].n);

/**
 * Apply a recipe to the open database: the table as imported is moved to the
 * `raw` schema (once), the previous outputs dropped, the fact and its tables
 * written to `main`. `shape: null` puts the raw table back and forgets it.
 * @param {string[]} previousOutputs  the tables the file wrote before (its entry's), dropped first
 * @returns {Promise<Array<{tableName: string, rowCount: number}>>} the file's tables now, the fact first
 */
async function applyShape(db, table, shape, previousOutputs = []) {
  await db.run('CREATE SCHEMA IF NOT EXISTS raw');
  if (!(await tableExists(db, 'raw', table))) {
    if (!(await tableExists(db, 'main', table))) throw new Error(`Table ${table} is not in the file`);
    await db.run(`CREATE TABLE raw.${q(table)} AS SELECT * FROM main.${q(table)}`);
  }
  for (const t of new Set([table, ...previousOutputs, ...(shape ? outputsOf(shape) : [])])) await db.run(`DROP TABLE IF EXISTS main.${q(t)}`);
  if (!shape) {
    await db.run(`CREATE TABLE main.${q(table)} AS SELECT * FROM raw.${q(table)}`);
    await db.run(`DROP TABLE raw.${q(table)}`);
    return [{ tableName: table, rowCount: await countOf(db, table) }];
  }
  let header = null;
  const first = shape.steps[0];
  if (first && first.op === 'header') {
    const rawColumns = await columnsOf(db, 'raw', table);
    const row = await db.all(`SELECT * FROM raw.${q(table)} WHERE rowid = ${first.row - 1}`);
    if (!row.length) throw new Error(`Row ${first.row} is past the end of ${table}`);
    header = { rawColumns, names: headerNames(rawColumns.map((c) => row[0][c])) };
  }
  await db.run('DROP TABLE IF EXISTS temp.shaping');
  await db.run(`CREATE TEMP TABLE shaping AS ${compileFact(shape, { header })}`);
  const tables = [];
  const taken = new Set();
  for (const s of shape.steps) {
    if (s.op === 'dimension') {
      await db.run(`CREATE TABLE main.${q(s.name)} AS SELECT DISTINCT ON (${q(s.key)}) ${[s.key, ...s.columns].map(q).join(', ')} FROM temp.shaping WHERE ${q(s.key)} IS NOT NULL ORDER BY ${q(s.key)}`);
      s.columns.forEach((c) => taken.add(c));
      tables.push({ tableName: s.name, rowCount: await countOf(db, s.name) });
    } else if (s.op === 'calendar') {
      // Whole years, to the end of the year after the last date: the targets
      // of a month the sales have not reached, or of the coming year, join it
      // (a December of targets fell into a blank column, seen in a review).
      const from = s.from ? `DATE ${lit(s.from)}` : `(SELECT CAST(date_trunc('year', MIN(${q(s.column)})) AS DATE) FROM temp.shaping)`;
      const to = s.to ? `DATE ${lit(s.to)}` : `(SELECT CAST(date_trunc('year', MAX(${q(s.column)})) + INTERVAL 2 YEAR - INTERVAL 1 DAY AS DATE) FROM temp.shaping)`;
      await db.run(`CREATE TABLE main.${q(s.name)} AS ${calendarTableSql(from, to)}`);
      tables.push({ tableName: s.name, rowCount: await countOf(db, s.name) });
    }
  }
  await db.run(`CREATE TABLE main.${q(shape.output)} AS SELECT *${taken.size ? ` EXCLUDE (${[...taken].map(q).join(', ')})` : ''} FROM temp.shaping`);
  await db.run('DROP TABLE temp.shaping');
  for (const s of shape.steps.filter((x) => x.op === 'copy')) {
    await db.run(`CREATE TABLE main.${q(s.name)} AS SELECT * FROM main.${q(shape.output)}`);
    tables.push({ tableName: s.name, rowCount: await countOf(db, s.name) });
  }
  return [{ tableName: shape.output, rowCount: await countOf(db, shape.output) }, ...tables];
}

module.exports = { validateShape, describeShape, outputsOf, compileFact, headerNames, applyShape, calendarTableSql, OPS, TYPES, DATE_FORMATS, FILTERS, DECIMALS };
