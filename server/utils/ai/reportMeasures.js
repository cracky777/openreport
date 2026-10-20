// Measures the assistant may define from the conversation, in a CLOSED form
// (never SQL of its own): a measure filtered on some values, the arithmetic
// of two measures (a variance, a ratio), a running total, another aggregation
// of a column the schema already sums (its average, a count of rows), a stock
// read on its last date (lastValue.js: summed over the days it meant nothing), a target given per
// period added month by month (dimMeasure.js `perPeriod`: Crédit Ardent's 875 %). Each becomes a
// measure in the model's own shape — the same the model editor writes — and
// the browser saves it on the model (or, without that right, on the report).
// Asked by Claire, DAF: "réel vs budget" without the variance was no answer.

const { shapeWidget } = require('./widgetShaping');
const { readsDistinctRows } = require('../sqlBuilder/dimMeasure');

const KINDS = ['filtered', 'arithmetic', 'cumulative', 'aggregate', 'last', 'per_period', 'product', 'days_between'];
// What a column already summed or counted may become. Seen with Karim,
// logistics: "the model has no number of shipments, so the durations are
// totals, not averages" — the schema had the sum of the duration.
const AGGREGATIONS = ['sum', 'avg', 'count', 'count_distinct', 'min', 'max'];
const OPS = { add: '+', subtract: '-', multiply: '*', divide: '/', percent: '%' };
const MAX_MEASURES = 12;
const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// "_calc.ecart_reel_budget", free among the names in use.
function nameFor(label, taken) {
  const slug = label.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'measure';
  let name = `_calc.${slug}`;
  for (let i = 2; taken.has(name); i += 1) name = `_calc.${slug}_${i}`;
  return name;
}

const PERCENT_FORMAT = { decimals: 1, thousandSep: ' ', suffix: ' %' };

/**
 * @param {object[]} raw   the tool's `measures`
 * @param {object} ctx     the proposal context: effective model, cardinality…
 * @returns {{ measures: object[], errors: string[] }} the measures compiled, in order (a later one may use an earlier one)
 */
function validateMeasures(raw, ctx) {
  const list = Array.isArray(raw) ? raw.slice(0, MAX_MEASURES) : [];
  const errors = [];
  const measures = [];
  // A measure defined again in this call stands for the one of the schema.
  const known = () => [...measures, ...ctx.effective.measures.filter((m) => !measures.some((x) => x.name === m.name))];
  const byName = (name) => known().find((m) => m.name === name);
  const taken = new Set(ctx.effective.measures.map((m) => m.name));

  list.forEach((m, i) => {
    const label = `Measure ${i + 1}`;
    const a = m && typeof m === 'object' ? m : {};
    const title = text(a.label, 80);
    if (!title) { errors.push(`${label}: label is required`); return; }
    if (!KINDS.includes(a.kind)) { errors.push(`${label}: kind must be one of ${KINDS.join(', ')}`); return; }
    // The label of a measure it made before: that measure, defined again —
    // "Nombre de contrats" fixed came back as nombre_de_contrats_2 and the
    // ratio kept reading the wrong one (Mutuelle Horizon).
    const base = nameFor(title, new Set());
    const redefines = ctx.effective.measures.some((x) => x.name === base) && !measures.some((x) => x.name === base);
    const name = redefines ? base : nameFor(title, taken);
    if (redefines && [a.from, a.left, a.right].includes(name)) { errors.push(`${label}: ${name} cannot be made of itself — define it from other measures`); return; }
    let made = null;
    if (a.kind === 'days_between') {
      // The days from one date of a row to another (declared → closed), then
      // its average, total, shortest or longest: a handling delay. A row
      // missing one of the dates is left out (a claim still open).
      const dateOf = (n) => (ctx.effective.dimensions || []).find((d) => d.name === n && d.table && d.column && !d.datePart && !d.expression && /date|time/i.test(String(d.type || '')));
      const start = dateOf(a.from);
      const end = dateOf(a.to);
      if (!start || !end || start.table !== end.table || start.column === end.column) { errors.push(`${label}: days_between takes two different date dimensions (a day, not a month) of the SAME table as from and to`); return; }
      const aggregation = a.aggregation || 'avg';
      if (!['avg', 'sum', 'min', 'max'].includes(aggregation)) { errors.push(`${label}: days_between aggregation must be avg, sum, min or max`); return; }
      made = { name, label: title, table: end.table, column: end.column, since: start.column, aggregation, dataType: 'number', format: { decimals: aggregation === 'avg' ? 1 : 0, thousandSep: ' ', prefix: '', suffix: '' } };
    } else if (a.kind === 'product') {
      // Row by row, two columns of one table multiplied, then summed: a line's
      // quantity × its unit price. The sum of one times the sum of the other is not that.
      const left = byName(a.left);
      const right = byName(a.right);
      const plain = (x) => x && x.table && x.column && x.column !== '*' && x.aggregation === 'sum' && !x.expression && !x.times
        && !(x.filterRules || []).length && !x.lastValue && !x.runningTotal && !x.perPeriod && !x.periodShift;
      if (!plain(left) || !plain(right) || left.table !== right.table) { errors.push(`${label}: product takes two sum measures of plain columns of the SAME table as left and right`); return; }
      made = { name, label: title, table: left.table, column: left.column, times: right.column, aggregation: 'sum', dataType: left.dataType };
    } else if (a.kind === 'arithmetic') {
      const op = OPS[a.op];
      const left = byName(a.left);
      const right = byName(a.right);
      if (!op) { errors.push(`${label}: op must be one of ${Object.keys(OPS).join(', ')}`); return; }
      if (!left || !right) { errors.push(`${label}: left and right must be measure names of the schema${!left ? ` (${JSON.stringify(String(a.left || '').slice(0, 60))} is not)` : ''}${!right ? ` (${JSON.stringify(String(a.right || '').slice(0, 60))} is not)` : ''}`); return; }
      const l = `(\${${left.name}})`;
      const r = `(\${${right.name}})`;
      const expression = a.op === 'divide' ? `${l} / NULLIF(${r}, 0)` : a.op === 'percent' ? `100.0 * ${l} / NULLIF(${r}, 0)` : `${l} ${op} ${r}`;
      made = { name, label: title, table: '', column: '', aggregation: 'custom', expression, format: a.op === 'percent' ? PERCENT_FORMAT : (left.format || right.format || undefined) };
    } else if (a.kind === 'aggregate' && a.aggregation === 'count_distinct' && !byName(a.from)) {
      // A count of the distinct values of a dimension: the days of a period,
      // the customers served. A stock's cover in days divides by the first
      // (the cover was stock over a year's sales, seen with Karim). A plain
      // column only, looked up, never an expression.
      const dim = (ctx.effective.dimensions || []).find((d) => d.name === a.from && d.table && d.column && !d.datePart && !d.expression);
      if (!dim) { errors.push(`${label}: from must be a measure, or for count_distinct a dimension, of the schema (${JSON.stringify(String(a.from || '').slice(0, 60))} is not)`); return; }
      made = { name, label: title, table: dim.table, column: dim.column, aggregation: 'count_distinct', format: { decimals: 0, thousandSep: ' ', prefix: '', suffix: '' } };
    } else {
      const base = byName(a.from);
      if (!base) { errors.push(`${label}: from must be a measure name of the schema (${JSON.stringify(String(a.from || '').slice(0, 60))} is not)`); return; }
      // A row product or a delay in days is read whole: filtered, cumulated or
      // read another way, it would fall back to its bare column.
      if (base.times || base.since) { errors.push(`${label}: ${base.name} is a product or a delay: use it as it is, or in an arithmetic measure`); return; }
      if (a.kind === 'aggregate') {
        if (base.aggregation === 'custom' || !base.table || !base.column) { errors.push(`${label}: aggregate needs a measure that sums or counts one column (${base.name} is computed)`); return; }
        if (!AGGREGATIONS.includes(a.aggregation)) { errors.push(`${label}: aggregation must be one of ${AGGREGATIONS.join(', ')}`); return; }
        // The distinct values of an amount mean nothing: "number of contracts"
        // counted the distinct premiums, a frequency read 0.1 (Mutuelle Horizon).
        if (a.aggregation === 'count_distinct') { errors.push(`${label}: count_distinct counts the values of a DIMENSION — an id of the things counted (a contract number, a customer) — given as from; never the distinct amounts of a measure (${base.name})`); return; }
        made = { name, label: title, table: base.table, column: base.column, aggregation: a.aggregation, dataType: base.dataType, ...(base.filterRules ? { filterRules: base.filterRules, overrideFilters: base.overrideFilters } : {}) };
      } else if (a.kind === 'last') {
        // A stock, a balance, a headcount: its value on the last date of the rows shown.
        if (base.aggregation === 'custom' || !base.table || !base.column) { errors.push(`${label}: last needs a measure that sums one column (${base.name} is computed)`); return; }
        const date = (ctx.effective.dimensions || []).find((d) => d.name === a.date && !d.datePart && !d.expression && /date|time/i.test(String(d.type || '')));
        if (!date) { errors.push(`${label}: date must be the name of a date dimension of the schema (a day, not a month or a year)`); return; }
        made = { name, label: title, table: base.table, column: base.column, aggregation: base.aggregation, dataType: base.dataType, format: base.format, lastValue: { dim: date.name }, ...(base.filterRules ? { filterRules: base.filterRules, overrideFilters: !!base.overrideFilters } : {}) };
      } else if (a.kind === 'per_period') {
        // A monthly target of a dimension table: over several months, each month's targets added.
        if (!readsDistinctRows(base, base.table, ctx.effective.joins || [])) { errors.push(`${label}: per_period needs a measure of a table read once per item (marked oncePerItem in the schema): ${base.name} is not`); return; }
        const period = (ctx.effective.dimensions || []).find((d) => d.name === a.period && (d.datePart || /date|time/i.test(String(d.type || ''))));
        if (!period) { errors.push(`${label}: period must be the name of a date dimension of the facts, at the period the value is given for (the month: a year_month part)`); return; }
        made = { name, label: title, table: base.table, column: base.column, aggregation: base.aggregation, dataType: base.dataType, format: base.format, perPeriod: { dim: period.name } };
      } else if (a.kind === 'cumulative') {
        if (base.aggregation === 'custom' || !base.table || !base.column) { errors.push(`${label}: a running total needs a measure that sums one column (${base.name} is computed)`); return; }
        made = { name, label: title, table: base.table, column: base.column, aggregation: base.aggregation, dataType: base.dataType, format: base.format, runningTotal: true, ...(base.filterRules ? { filterRules: base.filterRules, overrideFilters: !!base.overrideFilters } : {}) };
      } else {
        // The rules go through the widget shaping checks: fields of the schema, closed operators, typed values.
        const shaped = shapeWidget({ filters: a.filters }, {}, { ...ctx, rank: null, alone: false });
        if (shaped.error) { errors.push(`${label}: ${shaped.error}`); return; }
        const rules = shaped.binding.widgetFilters || [];
        if (!rules.length) { errors.push(`${label}: a filtered measure needs filters`); return; }
        if (base.aggregation === 'custom' && !base.expression) { errors.push(`${label}: ${base.name} cannot be filtered`); return; }
        const own = Array.isArray(base.filterRules) && !base.overrideFilters ? base.filterRules : [];
        made = base.aggregation === 'custom'
          ? { name, label: title, table: '', column: '', aggregation: 'custom', expression: base.expression, format: base.format, filterRules: [...own, ...rules], overrideFilters: false }
          : { name, label: title, table: base.table, column: base.column, aggregation: base.aggregation, dataType: base.dataType, format: base.format, filterRules: [...own, ...rules], overrideFilters: false };
      }
    }
    if (made.format === undefined) delete made.format;
    if (redefines) made.redefines = true;
    made.description = text(a.description, 200) || undefined;
    if (!made.description) delete made.description;
    taken.add(name);
    measures.push(made);
  });
  return { measures, errors };
}

// What the card says of each, in words.
function describeMeasure(m, effective) {
  const label = (name) => ([...(effective.measures || []), ...(effective.dimensions || [])].find((x) => x.name === name) || {}).label || name;
  if (m.lastValue) return `${m.label}: ${label(`${m.table}.${m.column}`) || m.column} on the last date of ${label(m.lastValue.dim)}`;
  if (m.since) return `${m.label}: ${m.aggregation} of the days from ${m.since} to ${m.column}`;
  if (m.times) return `${m.label}: sum of ${m.column} × ${m.times}, row by row`;
  if (m.perPeriod) return `${m.label}: ${label(`${m.table}.${m.column}`) || m.column} added for each ${label(m.perPeriod.dim)}`;
  if (m.runningTotal) return `${m.label}: running total of ${label(`${m.table}.${m.column}`) || m.column}`;
  if (m.aggregation === 'custom') return `${m.label}: ${m.expression.replace(/\$\{([^}]+)\}/g, (_, n) => label(n.trim()))}`;
  const rules = (m.filterRules || []).map((r) => `${label(r.field)} ${r.op} ${(r.values && r.values.length ? r.values : [r.value]).filter((v) => v !== '' && v != null).join(', ')}`).join(' and ');
  return `${m.label}: ${m.aggregation} of ${m.column}${rules ? ` where ${rules}` : ''}`;
}

module.exports = { validateMeasures, describeMeasure, KINDS, MAX_MEASURES };
