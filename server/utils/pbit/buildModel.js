// Tabular model → OpenReport model fields (selected_tables, dimensions,
// measures, joins…). Also exposes the field resolvers the report builder
// needs: Power BI visuals reference `Entity[Property]` in Power BI names,
// which map back to database tables/columns through the partition's M
// (navigation target + column renames) and the column's sourceColumn.
const { translateDax, translateDaxAst, translateRowDax, findEvolution, selectedValueAlias, parseDax, detectTimeIntelligence, aggSql, TIME_FUNCTIONS } = require('./dax');

const DEFAULT_SCHEMA = { postgres: 'public', azure_postgres: 'public', redshift: 'public', mssql: 'dbo', azure_sql: 'dbo' };

const AZURE_SQL_HOST = /\.(database\.windows\.net|fabric\.microsoft\.com|pbidedicated\.windows\.net|datawarehouse\.[\w.]+)$/i;

function dbTypeFor(source) {
  switch (source.kind) {
    case 'postgres': return /\.postgres\.database\.azure\.com$/i.test(source.host || '') ? 'azure_postgres' : 'postgres';
    case 'sqlserver': return AZURE_SQL_HOST.test(source.host || '') ? 'azure_sql' : 'mssql';
    case 'mysql': return 'mysql';
    case 'oracle': return 'oracle';
    case 'bigquery': return 'bigquery';
    case 'snowflake': return 'snowflake';
    case 'databricks': return 'databricks';
    case 'redshift': return 'redshift';
    default: return null;
  }
}

const TYPE_MAP = { int64: 'integer', double: 'decimal', decimal: 'decimal', dateTime: 'date', string: 'string', boolean: 'string', binary: 'string', variant: 'string' };

const slug = (label) => String(label || '').replace(/\s+/g, '_').toLowerCase();

const PBI_AGG = { 0: 'sum', 1: 'avg', 2: 'count_distinct', 3: 'min', 4: 'max', 5: 'count' };

// "0.00 %", "#,0", "0", "0.0%" → { decimals, thousandSep, suffix, percent }
function formatFromString(fs) {
  if (!fs || typeof fs !== 'string') return null;
  const first = fs.split(';')[0];
  const percent = first.includes('%');
  const dec = first.match(/\.(0+)/);
  const decimals = dec ? dec[1].length : 0;
  const thousandSep = /#,|0,/.test(first) ? ' ' : '';
  const format = { decimals, thousandSep, prefix: '', suffix: percent ? ' %' : '' };
  return { format, percent };
}

function sqlRefFor(orTable, column) {
  const parts = orTable.split('.');
  return parts.length > 1
    ? `"${parts[0]}"."${parts[1]}"."${column}"`
    : `"${orTable}"."${column}"`;
}

function buildModel(tabular, opts = {}) {
  const warnings = [];
  const warn = (code, message, extra = {}) => warnings.push({ level: 'warn', scope: 'model', code, message, ...extra });
  const info = (code, message, extra = {}) => warnings.push({ level: 'info', scope: 'model', code, message, ...extra });

  // ---- 1. sources: group the source tables by connector + database
  const sources = new Map();
  for (const t of tabular.tables) {
    if (t.kind !== 'source' || !t.m.source) continue;
    const s = t.m.source;
    const key = `${s.kind}|${(s.database || s.host || '').toLowerCase()}`;
    if (!sources.has(key)) sources.set(key, { ...s, hosts: new Set(), tables: [] });
    const g = sources.get(key);
    if (s.host) g.hosts.add(s.host);
    if (!g.database && s.database) g.database = s.database;
    g.tables.push(t.name);
  }
  const ranked = [...sources.values()].sort((a, b) => b.tables.length - a.tables.length);
  const primary = ranked[0] || null;
  let datasource = null;
  if (primary) {
    const dbType = dbTypeFor(primary);
    const hosts = [...primary.hosts];
    datasource = {
      dbType, host: hosts[0] || '', port: primary.port || null, dbName: primary.database || '',
      hosts, tableCount: primary.tables.length, kind: primary.kind,
    };
    if (hosts.length > 1) info('multiple_hosts', `Tables point at ${hosts.length} different hosts for database "${primary.database}"; the first one is proposed.`, { hosts });
    if (dbType === 'azure_sql' && /fabric\.microsoft\.com|pbidedicated\.windows\.net|datawarehouse\./i.test(hosts.join(' '))) {
      warn('fabric_auth', 'This is a Microsoft Fabric warehouse: it only accepts Entra ID authentication, which OpenReport\'s SQL Server connector does not support yet. The model imports, but the connection will fail until that is added.');
    }
    if (!dbType) warn('unsupported_connector', `Connector "${primary.kind}" has no OpenReport equivalent.`);
  }
  for (const other of ranked.slice(1)) {
    warn('secondary_source', `${other.tables.length} table(s) read another source (${other.kind} ${other.host || ''} ${other.database || ''}) and were skipped — an OpenReport model reads one datasource.`, { tables: other.tables });
  }
  const primaryKey = primary ? `${primary.kind}|${(primary.database || primary.host || '').toLowerCase()}` : null;
  const defaultSchema = datasource ? DEFAULT_SCHEMA[datasource.dbType] || null : null;

  // ---- 2. tables
  const tableMap = new Map();  // pbi table name → { orTable, columns: Map(pbiCol → {dbColumn, dataType, type}) }
  const selectedTables = [];
  const dimensions = [];
  const dimByName = new Map();
  const pushDim = (d) => { if (!dimByName.has(d.name)) { dimByName.set(d.name, d); dimensions.push(d); } };
  const claimedBy = new Map();     // database table → the first Power BI table over it
  const roleJoins = new Map();     // role table → [{ fact, factName, factColumn, dimColumn }], one per fact it reaches

  for (const t of tabular.tables) {
    if (t.kind === 'dateAuto') continue;
    if (t.kind === 'inline' || (t.kind === 'calculated' && t.columns.every((c) => c.isHidden) && t.measures.length)) continue; // measure holder
    if (t.kind === 'source') {
      const key = `${t.m.source.kind}|${(t.m.source.database || t.m.source.host || '').toLowerCase()}`;
      if (key !== primaryKey) continue;
      const orTable = (t.m.schema && t.m.schema !== defaultSchema) ? `${t.m.schema}.${t.m.table}` : t.m.table;
      if (!orTable) continue;
      const columns = new Map();
      // Table.SelectColumns right after navigation lists database columns —
      // the only ground truth we have when later steps derive new ones.
      const kept = t.m.keptColumns ? new Set(t.m.keptColumns) : null;
      const knownDb = (name) => !kept || kept.has(name);
      for (const c of t.columns) {
        if (c.kind !== 'data') continue;
        const renamedFrom = t.m.renames[c.sourceColumn];
        const dbColumn = renamedFrom && knownDb(renamedFrom) ? renamedFrom : c.sourceColumn;
        if (!knownDb(dbColumn)) {
          warn('derived_column', `Column ${t.name}[${c.name}] is produced by a Power Query step, not read from the database; skipped.`, { table: t.name, column: c.name });
          continue;
        }
        const type = TYPE_MAP[c.dataType] || 'string';
        columns.set(c.name, { dbColumn, dataType: c.dataType, type });
        pushDim({ name: `${orTable}.${dbColumn}`, table: orTable, column: dbColumn, type, label: c.name });
      }
      // A second Power BI table over a database table already in the model
      // is a role (d_entite_cible over d_entite): it reaches the fact through
      // its own relationship, which OpenReport cannot add as a second join.
      // Its columns become lookups on the fact instead (see resolveColumn).
      const roleOf = claimedBy.get(orTable) || null;
      if (!roleOf) claimedBy.set(orTable, t.name);
      tableMap.set(t.name, { orTable, columns, pbi: t, roleOf });
      if (!selectedTables.includes(orTable)) selectedTables.push(orTable);
      if (t.m.complexSteps.length) {
        warn('transformed_table', `"${t.name}" is transformed in Power Query (${t.m.complexSteps.map((s) => s.fn).join(', ')}); imported as the raw table ${orTable}. Columns produced by those steps will not exist.`, { table: t.name, steps: t.m.complexSteps.map((s) => s.fn) });
      }
      if (t.partitionMode === 'directQuery') info('direct_query', `"${t.name}" was in DirectQuery mode — irrelevant here, OpenReport always queries live or from its own cache.`, { table: t.name });
      // A calculated column is row-level DAX over its own table: the same
      // thing as an OpenReport calculated dimension when the DAX translates.
      // Registered in the table's columns too, so a measure or a visual that
      // reads it finds an expression where a column would be.
      const own = (entity, prop) => {
        if (entity !== t.name) return null;
        const c = columns.get(prop);
        if (!c) return null;
        return { sqlRef: c.expression ? `(${c.expression})` : sqlRefFor(orTable, c.dbColumn) };
      };
      for (const c of t.columns.filter((x) => x.kind === 'calculated')) {
        // A SELECTEDVALUE column stands for the column it reads: what is
        // bound to it (a slicer, mostly) binds to that column.
        const alias = selectedValueAlias(c.expression);
        if (alias && alias.table === t.name && columns.get(alias.column) && !columns.get(alias.column).expression) {
          columns.set(c.name, columns.get(alias.column));
          info('calculated_column', `Calculated column ${t.name}[${c.name}] shows the selection on ${t.name}[${alias.column}]; it is read as that column.`, { table: t.name, column: c.name });
          continue;
        }
        const r = translateRowDax(c.expression, { table: t.name, resolveColumn: own });
        if (!r.ok) {
          warn('calculated_column', `Calculated column ${t.name}[${c.name}] is DAX the importer could not translate (${r.reason}). Recreate it as a calculated dimension.`, { table: t.name, column: c.name, dax: c.expression });
          continue;
        }
        const type = TYPE_MAP[c.dataType] || 'string';
        const dimName = `_calcdim.${slug(t.name)}_${slug(c.name)}`;
        columns.set(c.name, { dbColumn: '', dataType: c.dataType, type, expression: r.sql, dimName });
        pushDim({ name: dimName, table: orTable, column: '', type, label: c.name, expression: r.sql, description: `Power BI: ${String(c.expression).trim().replace(/\s+/g, ' ').slice(0, 500)}` });
        info('calculated_column', `Calculated column ${t.name}[${c.name}] imported as a calculated dimension.`, { table: t.name, column: c.name });
      }
      continue;
    }
    if (t.kind === 'derived') {
      warn('derived_table', `"${t.name}" is a Power Query reference to "${t.m.reference}"${Object.keys(t.m.renames).length ? ' with renamed columns' : ''}${t.m.complexSteps.length ? ' plus ' + t.m.complexSteps.map((s) => s.fn).join(', ') : ''}. OpenReport cannot alias a table twice — create a view for it, then add it to the model.`, { table: t.name, reference: t.m.reference });
      continue;
    }
    if (t.kind === 'combine') {
      const members = (t.m.combine || []).map((q) => {
        const sq = tabular.sharedQueries[q] || (tabular.tablesByName.get(q) || {}).m;
        return sq && sq.table ? `${sq.schema ? sq.schema + '.' : ''}${sq.table}` : q;
      });
      warn('union_table', `"${t.name}" is a Power Query union of ${members.length} queries (${members.join(', ')}). Create a view with that UNION ALL in the database, then add it to the model.`, { table: t.name, members });
      continue;
    }
    if (t.kind === 'native') {
      warn('native_query', `"${t.name}" runs a hand-written SQL query in Power Query; OpenReport has no custom-SQL tables. Create a view with this SQL.`, { table: t.name, sql: t.m.nativeQuery });
      continue;
    }
    if (t.kind === 'file') {
      warn('file_source', `"${t.name}" is loaded from a file (${t.m.filePath || t.m.source.fileType}). Upload that file as a DuckDB datasource in OpenReport and build a separate model on it.`, { table: t.name });
      continue;
    }
    if (t.kind === 'calculated') {
      warn('calculated_table', `"${t.name}" is a DAX calculated table and was skipped.`, { table: t.name, dax: t.calcExpression });
      continue;
    }
    warn('unknown_table', `"${t.name}" has a Power Query expression the importer could not read; skipped.`, { table: t.name });
  }

  // ---- 3. relationships → joins (OpenReport convention: from = "1" side, to = "*" side)
  const joins = [];
  const seenPairs = new Set();
  for (const r of tabular.relationships) {
    const many = tableMap.get(r.fromTable);
    const one = tableMap.get(r.toTable);
    if (!many || !one) continue;
    if (!r.isActive) { info('inactive_relationship', `Inactive relationship ${r.fromTable}[${r.fromColumn}] → ${r.toTable}[${r.toColumn}] skipped.`); continue; }
    const fromCol = one.columns.get(r.toColumn);
    const toCol = many.columns.get(r.fromColumn);
    if (!fromCol || !toCol) { warn('join_column_missing', `Relationship ${r.fromTable}[${r.fromColumn}] → ${r.toTable}[${r.toColumn}] uses a column that is not a database column; skipped.`); continue; }
    if (one.roleOf) {
      // The role's relationship is remembered, not joined: its columns are
      // read through it as lookups on the fact.
      if (!roleJoins.has(r.toTable)) roleJoins.set(r.toTable, []);
      roleJoins.get(r.toTable).push({ fact: many.orTable, factName: r.fromTable, factColumn: toCol.dbColumn, dimColumn: fromCol.dbColumn });
      info('role_table', `"${r.toTable}" is ${one.orTable} again, joined on ${r.fromTable}[${r.fromColumn}]; its columns are imported as lookups on ${many.orTable}.`, { table: r.toTable });
      continue;
    }
    const pair = [one.orTable, many.orTable].sort().join('|');
    const m2m = r.fromCardinality === 'many' && r.toCardinality === 'many';
    if (seenPairs.has(pair)) {
      warn('duplicate_join', `A second relationship between ${one.orTable} and ${many.orTable} (${r.toColumn} = ${r.fromColumn}) was skipped — OpenReport keeps one join per table pair.`);
      continue;
    }
    seenPairs.add(pair);
    joins.push({
      from_table: one.orTable, from_column: fromCol.dbColumn,
      to_table: many.orTable, to_column: toCol.dbColumn,
      type: 'LEFT',
      cardinality: { from: m2m ? '*' : '1', to: '*' },
    });
    if (m2m) warn('many_to_many', `Relationship ${r.fromTable}[${r.fromColumn}] → ${r.toTable}[${r.toColumn}] is many-to-many; values may fan out.`);
  }

  // ---- 4. the report's date column: the date dimension most fact tables join to
  const dateVotes = new Map();
  for (const j of joins) {
    const d = dimByName.get(`${j.from_table}.${j.from_column}`);
    if (d && d.type === 'date') dateVotes.set(d.name, (dateVotes.get(d.name) || 0) + 1);
  }
  const dateColumn = [...dateVotes.entries()].sort((a, b) => b[1] - a[1]).map((x) => x[0])[0] || null;

  // ---- 5. resolvers shared with the report builder
  // `facts`: the Power BI tables the asking visual aggregates — a role joined
  // to several facts is read through the one the visual is about.
  const resolveColumn = (entity, property, facts) => {
    const t = tableMap.get(entity);
    if (!t) return null;
    const c = t.columns.get(property);
    if (!c) return null;
    if (t.roleOf && roleJoins.has(entity) && !c.expression) {
      // The role's column, as a lookup from the fact row through the
      // relationship the role was joined on.
      const options = roleJoins.get(entity);
      // Only through the visual's own fact: a lookup on another fact would
      // pull that table into the query and multiply its rows. With no such
      // relationship, the base table's column (joined as the model joins it)
      // is the closest reading.
      const rj = options.find((o) => facts && facts.has(o.factName));
      if (!rj) return { table: t.orTable, column: c.dbColumn, sqlRef: sqlRefFor(t.orTable, c.dbColumn), dimName: `${t.orTable}.${c.dbColumn}`, dataType: c.dataType, type: c.type };
      const dimName = `_calcdim.${slug(entity)}_${slug(rj.factName)}_${slug(property)}`;
      // Only the fact column is quoted: the query builder reads quoted
      // "table"."column" pairs as tables to join, and the lookup table must
      // stay inside its subquery.
      const expr = `(SELECT r.${c.dbColumn} FROM ${t.orTable} r WHERE r.${rj.dimColumn} = ${sqlRefFor(rj.fact, rj.factColumn)})`;
      pushDim({ name: dimName, table: rj.fact, column: '', type: c.type, label: `${property} (${entity})`, expression: expr, description: `Power BI table ${entity}, a role of ${t.orTable} joined on ${rj.factColumn}` });
      return { table: rj.fact, column: '', sqlRef: expr, dimName, dataType: c.dataType, type: c.type };
    }
    if (c.expression) return { table: t.orTable, column: '', sqlRef: `(${c.expression})`, dimName: c.dimName, dataType: c.dataType, type: c.type };
    return { table: t.orTable, column: c.dbColumn, sqlRef: sqlRefFor(t.orTable, c.dbColumn), dimName: `${t.orTable}.${c.dbColumn}`, dataType: c.dataType, type: c.type };
  };
  const resolveTable = (entity) => { const t = tableMap.get(entity); return t ? { table: t.orTable } : null; };

  // ---- 6. measures
  const measures = [];
  const measureByName = new Map();
  const pushMeasure = (m) => { measureByName.set(m.name, m); measures.push(m); return m; };
  const uniqueName = (base) => { let n = base; let i = 2; while (measureByName.has(n)) n = `${base}_${i++}`; return n; };
  const daxByName = new Map();     // pbi measure name → translated OpenReport name
  const specKey = (res) => JSON.stringify([res.aggregation, res.table, res.column || res.sqlRef, res.filters, res.periodShift || null]);
  const aggIndex = new Map();      // specKey → measure name (for helper reuse)

  const aggToMeasure = (res, name, label, fmt) => {
    const percent = fmt && fmt.percent;
    // An aggregate of a calculated column has no column to name: it is SQL.
    if (percent || res.column === '') {
      return {
        name, label, table: '', column: '', aggregation: 'custom',
        expression: percent ? `(${aggSql(res)}) * 100` : aggSql(res),
        ...(res.filters.length ? { filterRules: res.filters, overrideFilters: false } : {}),
        ...(res.periodShift ? { periodShift: res.periodShift } : {}),
        ...(fmt ? { format: fmt.format } : {}),
      };
    }
    return {
      name, label, table: res.table, column: res.column, aggregation: res.aggregation,
      ...(res.dataType ? { dataType: String(res.dataType).toLowerCase() } : {}),
      ...(res.filters.length ? { filterRules: res.filters, overrideFilters: false } : {}),
      ...(res.periodShift ? { periodShift: res.periodShift } : {}),
      ...(fmt ? { format: fmt.format } : {}),
    };
  };

  let currentParent = null;
  let helperCount = 0;
  const ctx = {
    resolveColumn, resolveTable,
    resolveMeasure: (name) => (daxByName.has(name) ? { name: daxByName.get(name) } : null),
    helper: (res) => {
      const key = res.kind === 'agg' ? specKey(res) : null;
      if (key && aggIndex.has(key)) return aggIndex.get(key);
      helperCount += 1;
      const name = uniqueName(`_calc.${slug(currentParent)}_part${helperCount}`);
      const m = res.kind === 'agg'
        ? aggToMeasure(res, name, `${currentParent} (part ${helperCount})`, null)
        : { name, label: `${currentParent} (part ${helperCount})`, table: '', column: '', aggregation: 'custom', expression: res.sql, filterRules: res.filters, overrideFilters: false, ...(res.periodShift ? { periodShift: res.periodShift } : {}) };
      pushMeasure(m);
      if (key) aggIndex.set(key, name);
      return name;
    },
  };

  const pbiMeasures = tabular.tables.flatMap((t) => t.measures);
  let pending = pbiMeasures.slice();
  const failed = new Map();
  for (let round = 0; pending.length && round < 20; round++) {
    const next = [];
    for (const m of pending) {
      currentParent = m.name;
      helperCount = 0;
      const r = translateDax(m.expression, ctx);
      if (!r.ok) { failed.set(m.name, r); next.push(m); continue; }
      failed.delete(m.name);
      const name = uniqueName(`_calc.${slug(m.name)}`);
      const fmt = formatFromString(m.formatString);
      let spec;
      if (r.result.kind === 'agg') {
        spec = aggToMeasure(r.result, name, m.name, fmt);
        aggIndex.set(specKey(r.result), name);
      } else if (r.result.kind === 'expr') {
        spec = {
          name, label: m.name, table: '', column: '', aggregation: 'custom',
          expression: fmt && fmt.percent ? `(${r.result.sql}) * 100` : r.result.sql,
          ...(r.result.filters.length ? { filterRules: r.result.filters, overrideFilters: false } : {}),
          ...(r.result.periodShift ? { periodShift: r.result.periodShift } : {}),
          ...(fmt ? { format: fmt.format } : {}),
        };
      } else {
        spec = { name, label: m.name, table: '', column: '', aggregation: 'custom', expression: String(r.result.value == null ? 'NULL' : r.result.value) };
      }
      spec.description = `Power BI: ${m.expression.trim().replace(/\s+/g, ' ').slice(0, 500)}`;
      pushMeasure(spec);
      daxByName.set(m.name, name);
      for (const note of [...new Set(r.notes)]) info('measure_note', `${m.name}: ${note}`, { scope: 'measure', measure: m.name });
    }
    if (next.length === pending.length) break;
    pending = next;
  }
  // A draft shaped "(X − Y) ÷ X" where Y is X over the previous period is
  // the native N-1 comparison of X: the card that shows it binds X and
  // draws the % line. Remembered here, wired by the report builder.
  const evolutionByName = new Map();
  const previousPeriodOf = (node) => {
    // Y as a measure whose DAX is CALCULATE(<X>, <one-period-back>(date[col])).
    if (!node || node.t !== 'measure') return null;
    const pm = pbiMeasures.find((x) => x.name === node.name);
    let ast;
    try { ast = pm ? parseDax(pm.expression) : null; } catch { /* not a shape we read */ return null; }
    if (!ast || ast.t !== 'call' || ast.fn !== 'CALCULATE' || ast.args.length !== 2) return null;
    const shift = ast.args[1];
    if (!shift || shift.t !== 'call' || TIME_FUNCTIONS[shift.fn] !== 'n1') return null;
    const dateArg = shift.args[0];
    const dateCol = dateArg && dateArg.t === 'col' ? resolveColumn(dateArg.table, dateArg.column) : null;
    return { base: ast.args[0], dateDim: dateCol ? dateCol.dimName : null };
  };
  const baseMeasureFor = (node, draft) => {
    if (node.t === 'measure') return daxByName.get(node.name) || null;
    const r = translateDaxAst(node, ctx);
    if (!r.ok || r.result.kind !== 'agg') return null;
    const key = specKey(r.result);
    if (aggIndex.has(key)) return aggIndex.get(key);
    const name = uniqueName(`_calc.${slug(draft.name)}_base`);
    pushMeasure(aggToMeasure(r.result, name, `${draft.name} (base)`, null));
    aggIndex.set(key, name);
    return name;
  };
  for (const m of pending) {
    let evo;
    try { evo = findEvolution(parseDax(m.expression)); } catch { /* unparseable: stays a draft */ continue; }
    if (!evo) continue;
    const prev = previousPeriodOf(evo.previous);
    if (!prev || !prev.dateDim || JSON.stringify(prev.base) !== JSON.stringify(evo.current)) continue;
    currentParent = m.name;
    const base = baseMeasureFor(evo.current, m);
    if (!base) continue;
    evolutionByName.set(m.name, { base, dateDim: prev.dateDim, divideBy: evo.divideBy });
  }

  // Drafts: keep the measure so widgets stay bound, but with no SQL behind it.
  // Listed on the plan so the wizard shows them up front, like custom visuals.
  const drafts = [];
  for (const m of pending) {
    const r = failed.get(m.name) || { reason: 'not translated', tag: 'unsupported' };
    const name = uniqueName(`_calc.${slug(m.name)}`);
    const timeTags = detectTimeIntelligence(m.expression);
    const hint = evolutionByName.has(m.name)
      ? ' Cards showing it are imported as the N-1 % evolution of its base measure.'
      : timeTags.length
        ? ` Rebuild it in OpenReport with the native ${timeTags.map((t) => ({ n1: 'N-1 comparison', mtd: 'month-to-date', ytd: 'year-to-date', qtd: 'quarter-to-date' }[t] || t)).join(' / ')} option on the base measure.`
        : (r.tag === 'text' ? ' It builds display text; OpenReport formats values on the visual instead.' : '');
    pushMeasure({
      name, label: m.name, table: '', column: '', aggregation: 'custom', expression: 'NULL',
      description: `DRAFT — not translated (${r.reason}). Power BI: ${m.expression.trim().replace(/\s+/g, ' ').slice(0, 500)}`,
    });
    daxByName.set(m.name, name);
    drafts.push({ name: m.name, measureName: name, reason: r.reason, tag: r.tag || 'unsupported', hint: hint.trim(), dax: m.expression.trim() });
    warnings.push({ level: 'warn', scope: 'measure', code: `dax_${r.tag || 'unsupported'}`, measure: m.name, message: `Measure "${m.name}" was kept as an empty draft: ${r.reason}.${hint}`, dax: m.expression });
  }

  // Aggregations placed directly on columns by visuals ("Sum of amount"). The
  // column is also a dimension under its own name, and a result row is keyed
  // by label, so the measure is labelled after its aggregation, as Power BI
  // itself displays it.
  const AGG_WORD = { sum: 'sum', avg: 'average', min: 'min', max: 'max', count: 'count', count_distinct: 'distinct' };
  const ensureAggMeasure = (entity, property, fnCode) => {
    const col = resolveColumn(entity, property);
    if (!col) return null;
    const agg = PBI_AGG[fnCode] || 'sum';
    const name = col.column === '' ? `_calc.${slug(property)}_${agg}` : `${col.table}.${col.column}_${agg}`;
    if (measureByName.has(name)) return name;
    const label = `${property} (${AGG_WORD[agg]})`;
    if (col.column === '') {
      pushMeasure({ name, label, table: '', column: '', aggregation: 'custom', expression: aggSql({ aggregation: agg, column: '', sqlRef: col.sqlRef }), dataType: String(col.dataType).toLowerCase() });
      return name;
    }
    pushMeasure({ name, label, table: col.table, column: col.column, aggregation: agg, dataType: String(col.dataType).toLowerCase() });
    return name;
  };

  // Date hierarchy levels → date-part dimensions on the report's date column.
  const DATE_LEVELS = {
    year: { suffix: 'year', label: 'Year', expr: 'num_year', type: 'integer' },
    quarter: null,
    month: { suffix: 'month_name', label: 'Month Name', expr: 'name_month', type: 'string' },
    day: null,
  };
  const LEVEL_NAMES = { year: 'year', année: 'year', annee: 'year', quarter: 'quarter', trimestre: 'quarter', month: 'month', mois: 'month', day: 'day', jour: 'day' };
  const ensureDateLevel = (entity, property, level) => {
    const col = resolveColumn(entity, property);
    if (!col) return null;
    const key = LEVEL_NAMES[String(level || '').toLowerCase()];
    if (!key || !DATE_LEVELS[key]) return { dimName: col.dimName, fallback: true };
    if (col.dimName !== dateColumn) return { dimName: col.dimName, fallback: true };
    const part = DATE_LEVELS[key];
    const name = `_date.${part.suffix}`;
    pushDim({ name, table: col.table, column: col.column, type: part.type, label: part.label, datePartOf: dateColumn, datePart: part.expr });
    return { dimName: name, fallback: false };
  };

  const fields = () => ({
    name: opts.name || 'Imported model',
    description: opts.description || '',
    selected_tables: selectedTables,
    table_positions: {},
    dimensions,
    measures,
    joins,
    rls: {},
    column_types: {},
    date_column: dateColumn,
    incremental_months: null,
  });

  return {
    datasource, warnings, fields,
    resolveColumn, resolveTable, ensureAggMeasure, ensureDateLevel,
    resolveMeasure: (pbiName) => daxByName.get(pbiName) || null,
    resolveEvolution: (pbiName) => evolutionByName.get(pbiName) || null,
    drafts,
    stats: () => ({
      tables: selectedTables.length,
      dimensions: dimensions.length,
      joins: joins.length,
      measures: measures.length,
      measuresTranslated: pbiMeasures.length - pending.length,
      measuresDraft: pending.length,
      pbiTables: tabular.tables.filter((t) => t.kind !== 'dateAuto').length,
      pbiMeasures: pbiMeasures.length,
    }),
  };
}

module.exports = { buildModel, dbTypeFor, formatFromString };
