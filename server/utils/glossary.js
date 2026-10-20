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
function applyGlossaryPatch(model, patch) {
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
    const syn = cleanSynonyms([...(field.synonyms || []), ...(meta.synonyms || [])]);
    if (syn.length) next.synonyms = syn;
    const description = meta.description !== undefined ? meta.description : field.description;
    if (typeof description === 'string' && description.trim()) next.description = description.trim().slice(0, MAX_DESCRIPTION);
    changed += 1;
    return next;
  };
  const dimensions = (model.dimensions || []).map((f) => patchOne(f, 'dimension'));
  const measures = (model.measures || []).map((f) => patchOne(f, 'measure'));
  const known = new Set([...dimensions, ...measures].map((f) => f.name));
  for (const [name] of entries) if (!known.has(name)) errors.push(`${String(name).slice(0, 80)}: not a field of the model`);
  return { dimensions, measures, domains, changed, errors };
}

module.exports = { sanitizeFieldMeta, sanitizeFields, cleanSynonyms, applyGlossaryPatch, MAX_SYNONYMS, MAX_DESCRIPTION };
