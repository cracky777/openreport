// The semantic layer the assistant works with: the model's fields merged with
// the report's own overrides and extras — the same merge /query performs, so a
// name the assistant is shown is a name /query will resolve.
//
// Built from what is PERSISTED. The rollups were built from the saved report
// too, so an extra measure that only exists in the editor's unsaved state has
// no cached data to offer anyway.

const { reportExtras } = require('../rollupPlanning');
const { domainOf, roleFits } = require('./domains');
const { cleanSynonyms, MAX_DESCRIPTION } = require('../glossary');
const { readsDistinctRows } = require('../sqlBuilder/dimMeasure');

function mergeFields(base, overrides, extras) {
  const out = base.map((f) => (overrides[f.name] ? { ...f, ...overrides[f.name] } : f));
  for (const f of extras) {
    if (f && f.name && !out.find((x) => x.name === f.name)) out.push(f);
  }
  return out;
}

function buildEffectiveModel(model, reportSettings) {
  const extras = reportExtras(reportSettings);
  return {
    dimensions: mergeFields(model.dimensions || [], extras.dimensionOverrides, extras.extraDimensions),
    measures: mergeFields(model.measures || [], extras.measureOverrides, extras.extraMeasures),
    // The glossary (utils/glossary.js): what the model is about, in business terms.
    domains: (model.domains || []).filter((id) => domainOf(id)),
    description: typeof model.description === 'string' ? model.description.trim().slice(0, MAX_DESCRIPTION * 2) : '',
    // Never sent: only read to tell which measures count each item once.
    joins: Array.isArray(model.joins) ? model.joins : [],
  };
}

// The glossary of one field, checked again on the way out: a role the
// catalogue no longer has, or that sits on the wrong kind of field, is not
// shown — the provider must only ever see ids the server will accept back.
function glossaryOf(field, kind) {
  const out = {};
  if (typeof field.role === 'string' && roleFits(field.role, kind)) out.role = field.role;
  const synonyms = cleanSynonyms(field.synonyms);
  if (synonyms.length) out.synonyms = synonyms;
  if (typeof field.description === 'string' && field.description.trim()) out.description = field.description.trim().slice(0, MAX_DESCRIPTION);
  return out;
}

// What leaves the instance. A whitelist of the fields a model needs to pick
// the right name: never `expression` (free SQL), never table/column names,
// joins or RLS — the physical schema is none of the provider's business.
// Role, synonyms and description are the glossary: business words, written
// for the provider to read.
// Which tables the joins tie together: a number per table, the same for
// tables one can reach from the other. Null when they all hang together.
function joinGroups(effective) {
  const tables = new Set([...effective.dimensions, ...effective.measures].map((f) => f.table).filter(Boolean));
  if (tables.size < 2) return null;
  const parent = new Map([...tables].map((t) => [t, t]));
  const root = (t) => { while (parent.get(t) !== t) t = parent.get(t); return t; };
  for (const j of effective.joins || []) {
    if (parent.has(j.from_table) && parent.has(j.to_table)) parent.set(root(j.from_table), root(j.to_table));
  }
  const roots = [...new Set([...tables].map(root))];
  if (roots.length < 2) return null;
  return new Map([...tables].map((t) => [t, roots.indexOf(root(t)) + 1]));
}

// What a measure the assistant made (_calc.*) is made of, in field names: it
// told an insurer its "number of contracts" counted policies when it counted
// the distinct premiums. Only the closed forms it writes (utils/ai/
// reportMeasures.js) — an author's own SQL expression never leaves.
const CLOSED_EXPRESSION = /^[\s\d.()*/+-]*$/;
function madeOf(m, effective) {
  if (!String(m.name || '').startsWith('_calc.')) return null;
  if (m.aggregation === 'custom') {
    const expr = String(m.expression || '');
    return CLOSED_EXPRESSION.test(expr.replace(/\$\{[^}]+\}/g, '').replace(/NULLIF\(|, 0\)/g, '')) ? expr : null;
  }
  const field = [...effective.dimensions, ...effective.measures].find((x) => x.name !== m.name && x.table === m.table && x.column === m.column);
  const of = field ? field.name : m.column;
  const parts = [m.since ? `${m.aggregation} of the days from ${m.since} to ${m.column}` : `${m.aggregation} of ${of}${m.times ? ` × ${m.times}, row by row` : ''}`];
  if (m.lastValue) parts.push(`on the last date of ${m.lastValue.dim}`);
  if (m.perPeriod) parts.push(`added for each ${m.perPeriod.dim}`);
  if (m.runningTotal) parts.push('running total');
  if ((m.filterRules || []).length) parts.push(`where ${m.filterRules.map((r) => `${r.field} ${r.op} ${(r.values && r.values.length ? r.values : [r.value]).join(', ')}`).join(' and ')}`);
  return parts.join(' ');
}

function toPromptSchema(effective) {
  // Tables no join links (contracts and claims dropped together, their key
  // named "police"): each field says its group, never a table or a join, so a
  // visual never mixes two — the AI offered a loss ratio by product anyway.
  const groups = joinGroups(effective);
  const grouped = (f) => (groups && groups.has(f.table) ? { group: groups.get(f.table) } : {});
  return {
    dimensions: effective.dimensions.map((d) => ({ name: d.name, label: d.label || d.name, type: d.type || 'string', ...glossaryOf(d, 'dimension'), ...grouped(d) })),
    measures: effective.measures.map((m) => {
      const out = { name: m.name, label: m.label || m.name, aggregation: m.aggregation || null, ...glossaryOf(m, 'measure'), ...grouped(m) };
      // A column of a table listing things (clients, products): /query reads it
      // once per item in each group, so its SUM by month adds the monthly
      // targets of the clients present that month. Without being told, the AI
      // took the average and multiplied it by a count of clients (Léa).
      if (readsDistinctRows(m, m.table, effective.joins)) out.oncePerItem = true;
      const made = madeOf(m, effective);
      if (made) out.madeOf = made;
      if (m.format && typeof m.format === 'object') {
        const { decimals, prefix, suffix } = m.format;
        out.format = { decimals, prefix, suffix };
      }
      return out;
    }),
  };
}

/** The model-level glossary lines of the prompt, or none when nothing is declared. */
function businessLines(effective) {
  const domains = (effective.domains || []).map(domainOf).filter(Boolean);
  if (!domains.length && !effective.description) return [];
  const lines = ['', 'Business context:'];
  if (domains.length) lines.push(`- This model is about: ${domains.map((d) => d.label).join(', ')}. Read the question with that trade's expectations in mind.`);
  if (effective.description) lines.push(`- The author describes it as: ${JSON.stringify(effective.description)}`);
  return lines;
}

module.exports = { buildEffectiveModel, toPromptSchema, businessLines };
