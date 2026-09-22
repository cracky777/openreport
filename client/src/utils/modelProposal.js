/**
 * A proposal of the model assistant, applied to the model editor's state in
 * one go. Pure: the editor passes its state in and sets what comes back; the
 * author still saves the model as usual. Names follow what the editor's own
 * buttons create (addDimension / addMeasure / autoFlagColumns), so a column
 * flagged by the assistant is the same object as one flagged by hand.
 *
 * @param {object} state     { joins, dimensions, measures, tablePositions }
 * @param {object} proposal  { joins, removeJoins, tableRoles, fields, measures, positions }
 * @param {object} columns   { typeOf(table, column) → dimension type, dataTypeOf(table, column) → source type }
 */
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

  for (const { table, column, as } of proposal.fields || []) {
    const isDim = (d) => d.table === table && d.column === column && !d.expression;
    const isMeas = (m) => m.table === table && m.column === column && m.aggregation !== 'custom';
    if (as === 'none') {
      dimensions = dimensions.filter((d) => !isDim(d));
      measures = measures.filter((m) => !isMeas(m));
    } else if (as === 'dimension' && !dimensions.some(isDim)) {
      dimensions.push(dimension(table, column));
    } else if (as === 'measure' && !measures.some(isMeas)) {
      measures.push(measure(table, column, 'sum'));
    }
  }
  for (const { table, column, aggregation, label } of proposal.measures || []) {
    const made = measure(table, column, aggregation, label);
    if (!measures.some((m) => m.name === made.name)) measures.push(made);
  }

  const tablePositions = { ...(state.tablePositions || {}) };
  // A position keeps the table's role, and a role keeps its position.
  for (const [t, p] of Object.entries(proposal.positions || {})) tablePositions[t] = { ...tablePositions[t], x: p.x, y: p.y };
  for (const [t, role] of Object.entries(proposal.tableRoles || {})) tablePositions[t] = { ...tablePositions[t], tableType: role };

  return { joins, dimensions, measures, tablePositions };
}

/** The proposal in one line, for the conversation the next turn carries back. */
export function describeModelProposal(proposal, outcome) {
  const status = outcome === 'applied' ? 'applied by the user' : outcome === 'dismissed' ? 'dismissed by the user' : 'not applied yet';
  const parts = [
    ...(proposal.joins || []).map((j) => `join ${j.from_table}.${j.from_column} → ${j.to_table}.${j.to_column}`),
    ...(proposal.removeJoins || []).map((j) => `remove join ${j.from_table}.${j.from_column} → ${j.to_table}.${j.to_column}`),
    ...Object.entries(proposal.tableRoles || {}).map(([t, r]) => `${t} is a ${r}`),
    ...(proposal.fields || []).map((f) => `${f.table}.${f.column} as ${f.as}`),
    ...(proposal.measures || []).map((m) => `measure ${m.aggregation}(${m.table}.${m.column})`),
    ...(proposal.positions ? ['tables arranged'] : []),
  ];
  return `[Proposed — ${status}: ${parts.join('; ')}]`.slice(0, 1500);
}
