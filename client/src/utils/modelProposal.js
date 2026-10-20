/**
 * A proposal of the model assistant, applied to the model editor's state in
 * one go. Pure: the editor passes its state in and sets what comes back; the
 * author still saves the model as usual. Names follow what the editor's own
 * buttons create (addDimension / addMeasure / autoFlagColumns), so a column
 * flagged by the assistant is the same object as one flagged by hand.
 *
 * @param {object} state     { joins, dimensions, measures, tablePositions, domains }
 * @param {object} proposal  { joins, removeJoins, tableRoles, fields, measures, positions, domains, glossary }
 *                           (its `addTables` are the editor's to load: they need their columns)
 * @param {object} columns   { typeOf(table, column) → dimension type, dataTypeOf(table, column) → source type }
 */
// The parts a date breaks into (ids of the assistant's tool), as the editor
// itself makes them: the engine's expression and the type it returns.
export const DATE_PARTS = {
  year: { suffix: 'year', label: 'Year', expr: 'num_year', type: 'integer' },
  year_month: { suffix: 'year_month', label: 'Year-month', expr: 'year_month', type: 'string' },
  month_num: { suffix: 'month_num', label: 'Month number', expr: 'num_month', type: 'integer' },
  month_name: { suffix: 'month_name', label: 'Month name', expr: 'name_month', type: 'string' },
  week: { suffix: 'week', label: 'Week', expr: 'num_week', type: 'integer' },
  day_of_week: { suffix: 'day_of_week', label: 'Day of week', expr: 'num_day_of_week', type: 'integer' },
  day_name: { suffix: 'day_name', label: 'Day name', expr: 'name_day', type: 'string' },
};

const sameLink = (a, b) => (a.from_table === b.from_table && a.from_column === b.from_column && a.to_table === b.to_table && a.to_column === b.to_column)
  || (a.from_table === b.to_table && a.from_column === b.to_column && a.to_table === b.from_table && a.to_column === b.from_column);

export function applyModelProposal(state, proposal, { typeOf, dataTypeOf }) {
  let joins = (state.joins || []).filter((j) => !(proposal.removeJoins || []).some((r) => sameLink(j, r)));
  for (const j of proposal.joins || []) if (!joins.some((x) => sameLink(x, j))) joins = [...joins, j];

  let dimensions = [...(state.dimensions || [])];
  let measures = [...(state.measures || [])];
  const dimension = (table, column) => ({ name: `${table}.${column}`, table, column, type: typeOf(table, column), label: column });
  const measure = (table, column, aggregation, label) => ({
    name: `${table}.${column}_${aggregation}`, table, column, aggregation, label: label || column,
    dataType: String(dataTypeOf(table, column) || '').toLowerCase(),
  });

  for (const { table, column, as, dateParts } of proposal.fields || []) {
    const isDim = (d) => d.table === table && d.column === column && !d.expression && !d.datePart;
    const isMeas = (m) => m.table === table && m.column === column && m.aggregation !== 'custom';
    if (as === 'none') {
      dimensions = dimensions.filter((d) => !(d.table === table && d.column === column && !d.expression));
      measures = measures.filter((m) => !isMeas(m));
    } else if (as === 'dimension') {
      if (!dimensions.some(isDim)) dimensions.push(dimension(table, column));
      // The breakdowns of a date, beside it: named after the column so two
      // dates of one model never share a name (`_date.*` is the editor's
      // single date table).
      for (const p of (dateParts || []).map((id) => DATE_PARTS[id]).filter(Boolean)) {
        const name = `${table}.${column}_${p.suffix}`;
        if (!dimensions.some((d) => d.name === name)) {
          dimensions.push({ name, table, column, type: p.type, label: `${column} (${p.label})`, datePartOf: `${table}.${column}`, datePart: p.expr });
        }
      }
    } else if (as === 'measure' && !measures.some(isMeas)) {
      measures.push(measure(table, column, 'sum'));
    }
  }
  for (const { table, column, aggregation, label } of proposal.measures || []) {
    const made = measure(table, column, aggregation, label);
    if (!measures.some((m) => m.name === made.name)) measures.push(made);
  }

  // The glossary lands on the fields of that column — every aggregation of a
  // measure column shares its meaning. A role given replaces; a description
  // given replaces; synonyms are the users' words, never the assistant's.
  for (const { table, column, as, role, description } of proposal.glossary || []) {
    const meta = { ...(role ? { role } : {}), ...(description ? { description } : {}) };
    const on = (f) => (f.table === table && f.column === column ? { ...f, ...meta } : f);
    if (as === 'dimension') dimensions = dimensions.map((d) => (d.expression ? d : on(d)));
    else measures = measures.map((m) => (m.aggregation === 'custom' ? m : on(m)));
  }

  const tablePositions = { ...(state.tablePositions || {}) };
  // A position keeps the table's role, and a role keeps its position.
  for (const [t, p] of Object.entries(proposal.positions || {})) tablePositions[t] = { ...tablePositions[t], x: p.x, y: p.y };
  for (const [t, role] of Object.entries(proposal.tableRoles || {})) tablePositions[t] = { ...tablePositions[t], tableType: role };

  return { joins, dimensions, measures, tablePositions, domains: proposal.domains || state.domains || [] };
}

/**
 * The proposal without the lines the author unticked (`dropped`, a Set of the
 * keys the card gives them: table:<name>, join0, remove0, role:<table>, field0, measure0, positions, domains, glossary0).
 */
export function keepModelChoices(proposal, dropped) {
  if (!dropped.size) return proposal;
  const keep = (list, prefix) => (list || []).filter((_, i) => !dropped.has(`${prefix}${i}`));
  return {
    ...proposal,
    addTables: (proposal.addTables || []).filter((t) => !dropped.has(`table:${t}`)),
    joins: keep(proposal.joins, 'join'),
    removeJoins: keep(proposal.removeJoins, 'remove'),
    tableRoles: Object.fromEntries(Object.entries(proposal.tableRoles || {}).filter(([t]) => !dropped.has(`role:${t}`))),
    fields: keep(proposal.fields, 'field'),
    measures: keep(proposal.measures, 'measure'),
    positions: dropped.has('positions') ? null : proposal.positions,
    domains: dropped.has('domains') ? null : proposal.domains,
    glossary: keep(proposal.glossary, 'glossary'),
  };
}

/** The proposal in one line, for the conversation the next turn carries back. */
export function describeModelProposal(proposal, outcome) {
  const status = {
    applied: 'applied by the user', dismissed: 'dismissed by the user',
    partial: 'partly applied by the user — only what follows was kept, the rest turned down',
  }[outcome] || 'not applied yet';
  const parts = [
    ...(proposal.addTables || []).map((t) => `add table ${t}`),
    ...(proposal.joins || []).map((j) => `join ${j.from_table}.${j.from_column} → ${j.to_table}.${j.to_column}`),
    ...(proposal.removeJoins || []).map((j) => `remove join ${j.from_table}.${j.from_column} → ${j.to_table}.${j.to_column}`),
    ...Object.entries(proposal.tableRoles || {}).map(([t, r]) => `${t} is a ${r}`),
    ...(proposal.fields || []).map((f) => `${f.table}.${f.column} as ${f.as}${f.dateParts ? ` by ${f.dateParts.join(', ')}` : ''}`),
    ...(proposal.measures || []).map((m) => `measure ${m.aggregation}(${m.table}.${m.column})`),
    ...(proposal.positions ? ['tables arranged'] : []),
    ...(proposal.domains ? [`domains: ${proposal.domains.join(', ') || 'none'}`] : []),
    ...(proposal.glossary || []).map((g) => `${g.table}.${g.column}${g.role ? ` = ${g.role}` : ''}${g.description ? ' (described)' : ''}`),
  ];
  return `[Proposed — ${status}: ${parts.join('; ')}]`.slice(0, 1500);
}
