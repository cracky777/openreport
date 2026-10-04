// Anywhere in the app can hand the Assistant panel a question: a "How?" asks
// its Help tab, "What do you need?" on the empty Reports stage asks Your data
// (or Help, before there is a data model). The panel lives in the AppShell,
// far from the page that asks: a window event reaches it without threading a
// callback through.
const EVENT = 'openreport:ask-assistant';

/**
 * @param {string} question
 * @param {{tab?: 'help'|'data', modelId?: string}} [options]  the tab, and for Your data the model to ask about
 */
export function askAssistant(question, { tab = 'help', modelId } = {}) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { question, tab, modelId } }));
}

/** @returns {function} unsubscribe */
export function onAskAssistant(listener) {
  const handle = (e) => listener(e.detail);
  window.addEventListener(EVENT, handle);
  return () => window.removeEventListener(EVENT, handle);
}
