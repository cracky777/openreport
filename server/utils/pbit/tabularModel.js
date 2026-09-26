// DataModelSchema (TMSL) → a flat, source-aware description of the model.
// Power BI's automatic date tables (one hidden LocalDateTable per date
// column) are dropped here: OpenReport derives date parts from the column
// itself, so they carry no information worth importing.
const { parseMExpression } = require('./mExpression');

const isAutoDateTable = (name) => /^(LocalDateTable|DateTableTemplate)_/.test(String(name || ''));

const joinExpr = (e) => (Array.isArray(e) ? e.join('\n') : (e == null ? '' : String(e)));

function classifyTable(t, parsed, partition) {
  if (isAutoDateTable(t.name)) return 'dateAuto';
  if (!partition) return 'unknown';
  if (partition.source?.type === 'calculated') return 'calculated';
  if (parsed.nativeQuery != null) return 'native';
  if (parsed.combine) return 'combine';
  if (parsed.reference) return 'derived';
  if (parsed.source?.kind === 'inline') return 'inline';
  if (parsed.source?.kind === 'file') return 'file';
  if (parsed.source && parsed.table) return 'source';
  return 'unknown';
}

function readTabularModel(schema) {
  const m = schema.model || {};
  const tables = [];
  for (const t of m.tables || []) {
    const partition = (t.partitions || [])[0] || null;
    const mText = partition && partition.source?.type === 'm' ? joinExpr(partition.source.expression) : '';
    const parsed = mText ? parseMExpression(mText) : parseMExpression('');
    const kind = classifyTable(t, parsed, partition);
    tables.push({
      name: t.name,
      isHidden: !!t.isHidden,
      kind,
      m: parsed,
      mText,
      calcExpression: partition && partition.source?.type === 'calculated' ? joinExpr(partition.source.expression) : null,
      partitionMode: partition ? (partition.mode || 'import') : null,
      columns: (t.columns || []).map((c) => ({
        name: c.name,
        sourceColumn: c.sourceColumn || c.name,
        dataType: c.dataType || 'string',
        isHidden: !!c.isHidden,
        formatString: c.formatString || null,
        kind: c.type === 'calculated' ? 'calculated' : (c.type === 'calculatedTableColumn' ? 'calculatedTable' : 'data'),
        expression: c.type === 'calculated' ? joinExpr(c.expression) : null,
        sortByColumn: c.sortByColumn || null,
      })),
      measures: (t.measures || []).map((ms) => ({
        name: ms.name,
        table: t.name,
        expression: joinExpr(ms.expression),
        formatString: ms.formatString || null,
        isHidden: !!ms.isHidden,
        displayFolder: ms.displayFolder || null,
        description: ms.description || null,
      })),
      hierarchies: (t.hierarchies || []).map((h) => ({
        name: h.name,
        levels: (h.levels || []).map((l) => ({ name: l.name, column: l.column })),
      })),
    });
  }
  const byName = new Map(tables.map((t) => [t.name, t]));
  const relationships = (m.relationships || [])
    .filter((r) => !isAutoDateTable(r.fromTable) && !isAutoDateTable(r.toTable))
    .map((r) => ({
      fromTable: r.fromTable, fromColumn: r.fromColumn,
      toTable: r.toTable, toColumn: r.toColumn,
      fromCardinality: r.fromCardinality || 'many',
      toCardinality: r.toCardinality || 'one',
      isActive: r.isActive !== false,
      crossFilteringBehavior: r.crossFilteringBehavior || 'oneDirection',
    }));
  const sharedQueries = {};
  for (const e of m.expressions || []) {
    if (e.kind && e.kind !== 'm') continue;
    sharedQueries[e.name] = parseMExpression(joinExpr(e.expression));
  }
  return {
    culture: m.culture || null,
    compatibilityLevel: schema.compatibilityLevel || null,
    tables,
    tablesByName: byName,
    relationships,
    sharedQueries,
    roles: (m.roles || []).map((r) => ({ name: r.name, tablePermissions: r.tablePermissions || [] })),
  };
}

module.exports = { readTabularModel, isAutoDateTable };
