const providers = require('./providers');

// An outside eye on a page the designer just changed. The designer judging
// its own work in the same conversation found it fine every time — seven
// reports in a row came out left-aligned at 14 px and each review said
// "nothing to correct" (Jonathan: « je ne comprends pas pourquoi elle ne
// trouve pas cela moche »). This is a separate call that did not make the
// page and owes it nothing: it sees the pictures only, no tools, no
// conversation, and its words go to the designer as an opinion to weigh.

const SYSTEM = 'You are an art director with a sharp eye, asked for a frank opinion on a dashboard page someone else designed. You did not make it and owe it nothing. You see pictures only; values may be hidden behind stripes — judge the design, not the figures.';

const QUESTION = (sheet) => `${sheet ? 'The first picture is the page as it is now; the last shows every page of the report in small. ' : ''}Would you sign this design? Say what makes it look generic, flat, unbalanced, cluttered or simply ugly — type (sizes, weights, alignment, families), hierarchy, color, spacing, frames, how the page sits in its brand${sheet ? ', and whether the pages hold together or repeat themselves' : ''} — and what a demanding designer would change. Be concrete (name the element), at most five points, most important first. If it is genuinely good, say so in one sentence and do not invent faults.`;

const MAX_CHARS = 1500;

/**
 * @param {object} config   the provider config of the turn
 * @param {{ mediaType: string, data: string }[]} images  the page now (and the sheet last, when `sheet`)
 * @returns {Promise<string>} the critique, or '' when the provider gave none
 */
async function outsideCritique({ config, images, sheet = false }, deps = {}) {
  const shown = sheet ? [images[images.length - 2], images[images.length - 1]] : [images[images.length - 1]];
  try {
    const turn = await providers.runTurn({
      config,
      system: SYSTEM,
      messages: [{ role: 'user', text: QUESTION(sheet), images: shown.filter(Boolean) }],
      tools: [],
      maxSteps: 1,
      execute: async () => ({ result: { error: 'No tools here' }, end: true }),
    }, { ...deps, chat: deps.chat || providers.chat });
    return String(turn.text || '').trim().slice(0, MAX_CHARS);
  } catch {
    return ''; // no opinion: the designer reviews on its own
  }
}

module.exports = { outsideCritique };
