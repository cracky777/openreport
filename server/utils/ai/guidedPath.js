// The guided path of an OPEN request ("a dashboard", "where do I start"):
// domain → objective → the roles the objective needs → a proposal. The
// catalogue (domains/) says what each trade follows; the model's glossary
// says which field plays which role; what is missing is asked with
// `ask_user`, one closed question per turn, and what the user answers is
// taught to the model by the browser (PUT /models/:id/glossary) with the
// user's rights — never by the server of the assistant.
//
// The server never reads the request itself: the model declares whether it
// is open or precise, and the server holds what it asks and what it proposes
// to the catalogue (Set.has on ids, fields looked up in the effective model).

const { DOMAINS, domainOf, roleOf, roleFits } = require('./domains');
const { OBJECTIVES } = require('./domains/objectives');
const { cleanSynonyms } = require('../glossary');

const MAX_QUESTION = 240;
const MAX_OPTIONS = 6;
const MAX_OPTION = 80;
const MAX_LEARN_SYNONYMS = 5;

const objectivesOf = (domainId) => OBJECTIVES[domainId] || [];
const objectiveOf = (domainId, id) => objectivesOf(domainId).find((o) => o.id === id) || null;

/** role id → the first field of the model that carries it. */
function rolesOf(effective) {
  const out = {};
  for (const f of [...(effective.dimensions || []), ...(effective.measures || [])]) {
    if (typeof f.role === 'string' && !out[f.role]) out[f.role] = f.name;
  }
  return out;
}

const RULES = [
  'Open or precise? Read it first, and write it as `reading.scope` of your proposal: report (the user asks for a report, a dashboard or a reporting, whatever the topic — "a report on sales" IS a report, several pages), view (a question or an objective asked without the word report, one page) or precise — the app holds the proposal to that scope. A PRECISE request names what to show — a measure, a dimension, a period ("revenue by country in 2025", "top 5 products"): answer it directly, as the chart guide says, never with a question. An OPEN request asks for a report, a dashboard, an overview, where to start, or help on a topic without naming fields ("a dashboard on my shop", "help me follow my sales"): take the guided path, one step per turn, each step one `ask_user` call with closed choices. The user may answer "Decide for me": then decide and go on.',
  '1. Domain. The model declares no business domain: say in one sentence what the data looks like and call `ask_user` with the two or three catalogue domains it most resembles as options (learn.kind "domain", value = the domain id — the choice is saved on the model). Domains declared: skip this step. The user named their trade or function in the conversation ("I run five warehouses", "I am the CFO") and it matches a catalogue domain: that is the domain, no question — name it in `understood`.',
  '2. Objective. Call `ask_user` with the objectives of the domain as options (three to five, their labels, no learn). An objective whose needed roles are missing stays in the list, with what it lacks in its label ("Budget vs actual — needs a budget column"). Asked for a whole REPORT: the same question with `multiple: true` — which pages the report should have, every objective of the domain as an option, the ones with missing columns marked — and the pages are the objectives picked. The app refuses a report proposed before that question was asked, unless the user pressed "Build the full report" (then every objective the model can draw is a page, no question).',
  '3. Roles. For each role the objective needs: present under "Roles present" → use that field. Missing → look for a field whose name, type, synonyms or description fits; sure of it → use it and name it in `understood`; not sure → `ask_user` with learn.kind "role", the role id, the candidate fields as options (value = the field name, at most five) and, as synonyms, the user\'s own words for it. The app adds "I don\'t have it" for them: then leave out the visuals that need it and say so in one sentence. One role per question.',
  '4. Propose, with `understood` (domain, objective, which field plays which role). A TARGETED view — one objective, or a question on one topic — is the trame of that objective in one `propose_widgets` call. A WHOLE report — "a report on my shop", "a report on sales", "the full reporting", "a dashboard": any request that asks for a report or a dashboard, on a topic or not — is scope "report" and one `propose_report` call where it exists, never propose_widgets: one page per objective of the domain whose needed roles are present (the overview first, two to six pages, each page the trame of its objective), and one sentence naming the objectives left out and the column each lacks. Unsure whether they want a whole report or visuals on one page: `ask_user` with those two options, no learn — never guess. Never more than one question per turn, three on a path: after three, propose with what you have.',
  'A precise request on a model with a glossary is still answered directly: the roles pick the right field, and `understood.roles` names the ones you used.',
];

/**
 * What the prompt says about the catalogue for this model: the objectives of
 * its domains with which roles are present or missing, or, with no domain
 * yet, the domains it may be matched to.
 */
function guidedLines(effective) {
  const roles = rolesOf(effective);
  const domains = (effective.domains || []).map(domainOf).filter(Boolean);
  const lines = ['', 'Guided path for open requests:', ...RULES, ''];
  if (!domains.length) {
    lines.push(`No domain declared. Catalogue: ${DOMAINS.map((d) => `${d.id} (${d.label})`).join(', ')}.`);
    return lines;
  }
  const present = Object.entries(roles).filter(([id]) => roleOf(id));
  lines.push(present.length ? `Roles present: ${present.map(([id, f]) => `${id} = ${f}`).join(', ')}` : 'Roles present: none yet — every role of an objective will have to be found or asked.');
  for (const d of domains) {
    lines.push(`Objectives of ${d.label} (${d.id}):`);
    for (const o of objectivesOf(d.id)) {
      const needs = o.needs.map((r) => `${d.id}.${r}${roles[`${d.id}.${r}`] ? '' : ' (MISSING)'}`).join(', ');
      const forks = (o.forks || []).filter((f) => f.yes || f.no).map((f) => {
        const has = !!roles[`${d.id}.${f.role}`];
        const branch = has ? f.yes : f.no;
        return branch ? ` If ${d.id}.${f.role} ${has ? 'present' : 'absent'}: ${branch}.` : '';
      }).join('');
      lines.push(`- ${d.id}.${o.id} "${o.label}" — ${o.asks} Needs ${needs}. Trame: ${o.trame.join(' · ')}.${forks}`);
    }
  }
  return lines;
}

const fieldKindOf = (effective, name) => ((effective.dimensions || []).some((d) => d.name === name) ? 'dimension' : (effective.measures || []).some((m) => m.name === name) ? 'measure' : null);

/**
 * A closed question for the user. Options are labels the user clicks; with
 * `learn`, each value is what the browser then teaches the model: a domain
 * id, or a field of the model for a role.
 * @returns {{ payload: object|null, errors: string[] }}
 */
function validateQuestion(args, { effective }) {
  const a = args && typeof args === 'object' ? args : {};
  const errors = [];
  const question = typeof a.question === 'string' ? a.question.trim().slice(0, MAX_QUESTION) : '';
  const multiple = a.multiple === true;
  // The question whether filters repeated on several pages stay in sync: the
  // digest of the conversation marks it, so a proposal that syncs them is
  // known to rest on the user's answer (filterSync.js), never on their words.
  const about = a.about === 'filter_sync' ? 'filter_sync' : null;
  if (!question) errors.push('question: one sentence');
  const raw = Array.isArray(a.options) ? a.options.slice(0, MAX_OPTIONS) : [];
  const learnRaw = a.learn && typeof a.learn === 'object' ? a.learn : null;
  let learn = null;
  if (learnRaw && learnRaw.kind === 'domain') learn = { kind: 'domain' };
  else if (learnRaw && learnRaw.kind === 'role') {
    if (!roleOf(learnRaw.role)) errors.push(`learn.role: ${JSON.stringify(String(learnRaw.role).slice(0, 60))} is not a role of the catalogue`);
    else learn = { kind: 'role', role: learnRaw.role, synonyms: cleanSynonyms(learnRaw.synonyms).slice(0, MAX_LEARN_SYNONYMS) };
  } else if (learnRaw) errors.push('learn.kind: domain or role');
  const options = [];
  for (const o of raw) {
    const label = typeof (o && o.label) === 'string' ? o.label.trim().slice(0, MAX_OPTION) : '';
    const value = typeof (o && o.value) === 'string' ? o.value.slice(0, 200) : '';
    if (!label) { errors.push('options: each needs a label'); continue; }
    // An option without a value ("none of these") teaches nothing and is
    // kept as a plain answer; one with a value must point at something real.
    if (learn && value && learn.kind === 'domain' && !domainOf(value)) { errors.push(`options: ${JSON.stringify(label)}: value must be a domain id of the catalogue`); continue; }
    if (learn && value && learn.kind === 'role') {
      const kind = fieldKindOf(effective, value);
      if (!kind) { errors.push(`options: ${JSON.stringify(label)}: value must be a field name of the schema`); continue; }
      if (!roleFits(learn.role, kind)) { errors.push(`options: ${value} is a ${kind}, ${learn.role} is not a ${kind} role`); continue; }
    }
    if (options.some((x) => x.label === label || (value && x.value === value))) continue;
    options.push(learn && value ? { label, value } : { label });
  }
  if (options.length < 2) errors.push('options: two to six choices');
  if (learn && !options.some((o) => o.value)) errors.push(`options: a ${learn.kind} question needs at least one option with a value to learn from`);
  if (errors.length) return { payload: null, errors };
  if (multiple && learn && learn.kind === 'role') errors.push('multiple: a column question takes one answer');
  if (errors.length) return { payload: null, errors };
  return { payload: { kind: 'question', question, options, ...(multiple ? { multiple: true } : {}), ...(learn ? { learn } : {}), ...(about ? { about } : {}) }, errors: [] };
}

/**
 * What the model says it understood of an open request, checked against the
 * catalogue and the schema: the user reads it on the card and corrects it.
 * Junk is dropped and reported; it never blocks the proposal.
 * @returns {{ understood: object|null, warnings: string[] }}
 */
function validateUnderstood(args, { effective }) {
  const u = args && args.understood && typeof args.understood === 'object' ? args.understood : null;
  if (!u) return { understood: null, warnings: [] };
  const warnings = [];
  const domain = domainOf(u.domain);
  if (u.domain !== undefined && !domain) warnings.push(`understood.domain: ${JSON.stringify(String(u.domain).slice(0, 60))} is not a domain of the catalogue`);
  const objective = domain ? objectiveOf(domain.id, u.objective) : null;
  if (u.objective !== undefined && !objective) warnings.push(`understood.objective: ${JSON.stringify(String(u.objective).slice(0, 60))} is not an objective of ${domain ? domain.id : 'that domain'}`);
  const roles = [];
  for (const [roleId, field] of Object.entries(u.roles && typeof u.roles === 'object' ? u.roles : {}).slice(0, 20)) {
    const role = roleOf(roleId);
    const kind = fieldKindOf(effective, field);
    if (!role || !kind || !roleFits(roleId, kind)) { warnings.push(`understood.roles: ${roleId} → ${JSON.stringify(String(field).slice(0, 80))} is not a ${role ? role.kind : 'known'} role on a field of the schema`); continue; }
    roles.push({ role: roleId, label: role.label, field });
  }
  const understood = {
    ...(domain ? { domain: { id: domain.id, label: domain.label } } : {}),
    ...(objective ? { objective: { id: objective.id, label: objective.label } } : {}),
    roles,
  };
  return { understood: domain || objective || roles.length ? understood : null, warnings };
}

module.exports = { guidedLines, validateQuestion, validateUnderstood, rolesOf, objectivesOf, RULES };
