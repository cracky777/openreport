// What Let's Talk learns from the user about the model's fields: when they
// confirm, correct or explain what a field means ("yes, the guarantee is the
// type of claim"), the assistant offers to remember it — the field, the words
// the user called it by, one line of what it holds. A card they apply writes
// it to the model's glossary (PUT /models/:id/glossary, utils/glossary.js),
// read with the schema by every assistant after. Asked by Jonathan.
//
// The server never reads the conversation: the assistant declares what was
// said, the field is looked up in the schema (Set.has), the words are bounded.

const { cleanSynonyms } = require('../glossary');

const MAX_ITEMS = 6;
const MAX_WORDS = 5;
const MAX_DESCRIPTION = 200;

/**
 * @param {object[]} raw   [{ field, synonyms, description }]
 * @param {object} effective  the model as the conversation sees it
 * @returns {{ items: object[], errors: string[] }}
 */
function validateRemember(raw, effective) {
  const list = Array.isArray(raw) ? raw.slice(0, MAX_ITEMS) : [];
  // The model's own fields: a measure the answer defines is not in it yet.
  const fields = new Map([...effective.dimensions, ...effective.measures].map((f) => [f.name, f]));
  const items = [];
  const errors = [];
  for (const r of list) {
    const a = r && typeof r === 'object' ? r : {};
    const f = fields.get(a.field);
    if (!f) { errors.push(`remember: ${JSON.stringify(String(a.field || '').slice(0, 80))} is not a field of the model`); continue; }
    const synonyms = cleanSynonyms(a.synonyms).slice(0, MAX_WORDS);
    const description = typeof a.description === 'string' ? a.description.trim().slice(0, MAX_DESCRIPTION) : '';
    if (!synonyms.length && !description) { errors.push(`remember: ${a.field} needs the user's words (synonyms) or a description`); continue; }
    items.push({ field: f.name, label: f.label || f.name, ...(synonyms.length ? { synonyms } : {}), ...(description ? { description } : {}) });
  }
  return { items, errors };
}

module.exports = { validateRemember, MAX_ITEMS };
