// Lookups over the catalogue. Every id a client or a provider names is checked
// here (Set.has) before it is stored or acted on.

const { DOMAINS } = require('./catalogue');

const MAX_DOMAINS = 4;
const ROLE_KINDS = ['date', 'dimension', 'key', 'measure'];
// Which fields may carry a role of each kind.
const FIELD_OF_KIND = { date: 'dimension', dimension: 'dimension', key: 'dimension', measure: 'measure' };

const byId = new Map(DOMAINS.map((d) => [d.id, d]));
const roles = new Map();
for (const d of DOMAINS) for (const r of d.roles) roles.set(`${d.id}.${r.id}`, { ...r, domain: d.id, fullId: `${d.id}.${r.id}` });

const domainOf = (id) => byId.get(id) || null;
const roleOf = (fullId) => roles.get(fullId) || null;

/** Distinct known domain ids, in the order given, at most MAX_DOMAINS. */
function cleanDomains(list) {
  const out = [];
  for (const id of Array.isArray(list) ? list : []) {
    if (typeof id === 'string' && byId.has(id) && !out.includes(id)) out.push(id);
    if (out.length === MAX_DOMAINS) break;
  }
  return out;
}

/** May a field of this nature ('dimension' | 'measure') carry this role? */
function roleFits(fullId, fieldKind) {
  const r = roleOf(fullId);
  return !!r && FIELD_OF_KIND[r.kind] === fieldKind;
}

/**
 * What the client gets of the catalogue: for the glossary, ids, labels and
 * kinds of the roles; for the Assistant panel's starting questions and
 * follow-ups, each objective with the roles it needs — no trames, which are
 * the provider's reading.
 */
function catalogueForClient() {
  const { OBJECTIVES } = require('./objectives');
  return DOMAINS.map((d) => ({
    id: d.id, kind: d.kind, label: d.label,
    roles: d.roles.map((r) => ({ id: `${d.id}.${r.id}`, label: r.label, kind: r.kind, required: r.required })),
    objectives: (OBJECTIVES[d.id] || []).map((o) => ({ id: o.id, label: o.label, asks: o.asks, needs: o.needs.map((r) => `${d.id}.${r}`) })),
  }));
}

/**
 * The catalogue as a prompt lists it: one compact line of roles per domain —
 * every domain when nothing is declared yet (the assistant then proposes the
 * domains along with the roles), else the declared ones, the others by name
 * only so a missing domain can still be proposed.
 */
function roleLines(domainIds) {
  const picked = domainIds.length ? domainIds.map(domainOf).filter(Boolean) : DOMAINS;
  const lines = picked.map((d) => `- ${d.id} (${d.label}): ${d.roles.map((r) => `${d.id}.${r.id}${r.kind === 'measure' ? '#' : r.kind === 'date' ? '@' : ''}`).join(' ')}`);
  const rest = DOMAINS.filter((d) => !picked.includes(d));
  if (rest.length) lines.push(`- other domains, roles listed once declared: ${rest.map((d) => `${d.id} (${d.label})`).join(', ')}`);
  return lines;
}

module.exports = { DOMAINS, MAX_DOMAINS, ROLE_KINDS, domainOf, roleOf, cleanDomains, roleFits, catalogueForClient, roleLines };
