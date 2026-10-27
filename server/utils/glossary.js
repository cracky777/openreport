// The business glossary of a model: on each dimension and measure, its `role`
// in the catalogue (utils/ai/domains), the `synonyms` users call it by and a
// `description`; on the model, its `domains`. The assistant reads all of it
// with the schema; whoever may use the model may add to it (route
// PUT /models/:id/glossary), the model's editors edit it by hand in Step 2.
//
// Synonyms are words for the PROVIDER to read next to a field, never a list
// the server matches the request against: the request stays in any language.

const { cleanDomains, roleFits } = require('./ai/domains');

const MAX_SYNONYMS = 10;
const MAX_SYNONYM = 40;
const MAX_DESCRIPTION = 200;
const MAX_FIELDS_PER_PATCH = 100;

function cleanSynonyms(list) {
  const out = [];
  for (const s of Array.isArray(list) ? list : []) {
    const v = typeof s === 'string' ? s.trim().slice(0, MAX_SYNONYM) : '';
    if (v && !out.some((x) => x.toLowerCase() === v.toLowerCase())) out.push(v);
    if (out.length === MAX_SYNONYMS) break;
  }
  return out;
}

/**
 * The field with only the glossary attributes it may carry: an unknown role or
 * one of the wrong kind is dropped, synonyms and description are bounded.
 * @param {'dimension'|'measure'} kind
 */
function sanitizeFieldMeta(field, kind) {
  if (!field || typeof field !== 'object') return field;
  const { role, synonyms, description, ...rest } = field;
  if (typeof role === 'string' && roleFits(role, kind)) rest.role = role;
  const syn = cleanSynonyms(synonyms);
  if (syn.length) rest.synonyms = syn;
  if (typeof description === 'string' && description.trim()) rest.description = description.trim().slice(0, MAX_DESCRIPTION);
  return rest;
}

const sanitizeFields = (fields, kind) => (Array.isArray(fields) ? fields.map((f) => sanitizeFieldMeta(f, kind)) : fields);

/**
 * Merge a patch into the model's fields. `fields` maps a field name to
 * `{ role, synonyms, description }`, or to null to clear all three. A role or
 * description given replaces (null clears); synonyms given are ADDED to the
 * field's own — what one user taught, the next does not undo by accident.
 * @returns {{ dimensions: object[], measures: object[], domains: string[], changed: number, errors: string[] }}
 */
// When a field's description or synonyms last changed, whatever wrote them
// (the model editor, a glossary patch, a YAML import, a migrated report, the
// API): `glossaryUpdatedAt` on the field, ISO time, computed here from what
// the field was — never taken from the request. Absent on a field never
// documented. A catalog syncing both ways settles a conflict on it.
const glossaryOf = (f) => JSON.stringify({ d: (f && f.description) || '', s: (f && f.synonyms) || [] });
function stampGlossary(before, after, now = new Date().toISOString()) {
  if (!Array.isArray(after)) return after;
  const old = new Map((Array.isArray(before) ? before : []).filter((f) => f && f.name).map((f) => [f.name, f]));
  return after.map((f) => {
    if (!f || typeof f !== 'object') return f;
    const { glossaryUpdatedAt: _given, ...rest } = f;
    const was = old.get(rest.name);
    const documented = !!(rest.description || (Array.isArray(rest.synonyms) && rest.synonyms.length));
    const at = was
      ? (glossaryOf(was) === glossaryOf(rest) ? was.glossaryUpdatedAt || null : now)
      : (documented ? now : null);
    return at ? { ...rest, glossaryUpdatedAt: at } : rest;
  });
}

// What a patch will lose to the bounds, said back to its sender rather than
// cut silently (the catalog would believe its text landed whole).
function glossaryWarnings(name, meta) {
  const out = [];
  if (!meta || typeof meta !== 'object') return out;
  if (typeof meta.description === 'string' && meta.description.trim().length > MAX_DESCRIPTION) {
    out.push(`${name}: description cut to ${MAX_DESCRIPTION} characters`);
  }
  const syn = Array.isArray(meta.synonyms) ? meta.synonyms.filter((x) => typeof x === 'string' && x.trim()) : [];
  for (const x of syn) if (x.trim().length > MAX_SYNONYM) out.push(`${name}: synonym ${JSON.stringify(x.slice(0, 50))} cut to ${MAX_SYNONYM} characters`);
  if (Array.isArray(meta.synonyms) && meta.synonyms.some((x) => typeof x !== 'string')) out.push(`${name}: synonyms are text, the others were left out`);
  return out;
}

/**
 * `opts.synonymsMode` 'replace' sets a field's synonyms to those given (a
 * catalog syncing its terms back must be able to remove one); the default
 * 'add' keeps the browser's rule.
 */
function applyGlossaryPatch(model, patch, opts = {}) {
  const replaceSynonyms = opts.synonymsMode === 'replace';
  const p = patch && typeof patch === 'object' ? patch : {};
  const errors = [];
  const domains = p.domains !== undefined ? cleanDomains(p.domains) : (model.domains || []);
  if (p.domains !== undefined && Array.isArray(p.domains) && domains.length !== new Set(p.domains).size) errors.push('domains: some ids are not in the catalogue');
  let changed = p.domains !== undefined && JSON.stringify(domains) !== JSON.stringify(model.domains || []) ? 1 : 0;

  const entries = Object.entries(p.fields && typeof p.fields === 'object' ? p.fields : {}).slice(0, MAX_FIELDS_PER_PATCH);
  const patchOne = (field, kind) => {
    const hit = entries.find(([name]) => name === field.name);
    if (!hit) return field;
    const [, meta] = hit;
    const { role: _r, synonyms: _s, description: _d, ...bare } = field;
    if (meta === null) { changed += 1; return bare; }
    if (!meta || typeof meta !== 'object') { errors.push(`${field.name}: expected { role, synonyms, description } or null`); return field; }
    const next = { ...bare };
    const role = meta.role !== undefined ? meta.role : field.role;
    if (typeof role === 'string') {
      // A role that does not fit leaves the field as it was: nothing of a
      // mistaken patch lands.
      if (!roleFits(role, kind)) { errors.push(`${field.name}: role ${JSON.stringify(String(role).slice(0, 80))} is not a ${kind} role of the catalogue`); return field; }
      next.role = role;
    }
    const given = Array.isArray(meta.synonyms) ? meta.synonyms : [];
    const kept = replaceSynonyms && meta.synonyms !== undefined ? [] : (field.synonyms || []);
    const syn = cleanSynonyms([...kept, ...given]);
    if (syn.length) next.synonyms = syn;
    // More words than a field holds: said, like a description cut short.
    const words = new Set([...kept, ...given].filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim().slice(0, MAX_SYNONYM).toLowerCase()));
    if (words.size > MAX_SYNONYMS) errors.push(`${field.name}: only ${MAX_SYNONYMS} synonyms are kept`);
    const description = meta.description !== undefined ? meta.description : field.description;
    if (typeof description === 'string' && description.trim()) next.description = description.trim().slice(0, MAX_DESCRIPTION);
    changed += 1;
    return next;
  };
  const dimensions = stampGlossary(model.dimensions, (model.dimensions || []).map((f) => patchOne(f, 'dimension')));
  const measures = stampGlossary(model.measures, (model.measures || []).map((f) => patchOne(f, 'measure')));
  const known = new Set([...dimensions, ...measures].map((f) => f.name));
  for (const [name] of entries) if (!known.has(name)) errors.push(`${String(name).slice(0, 80)}: not a field of the model`);
  return { dimensions, measures, domains, changed, errors };
}

module.exports = { sanitizeFieldMeta, sanitizeFields, cleanSynonyms, applyGlossaryPatch, stampGlossary, glossaryWarnings, MAX_SYNONYMS, MAX_SYNONYM, MAX_DESCRIPTION };
