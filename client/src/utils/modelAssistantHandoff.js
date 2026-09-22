// The report and Ask assistants hand a data-model request over to the model
// assistant: the request travels through localStorage rather than the URL (it
// is the user's own words), and the model editor may open in another tab.
const KEY = 'openreport.modelAssistantRequest';
const MAX_AGE_MS = 60_000;

export function handOver(modelId, request) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ modelId, request: request || '', at: Date.now() }));
  } catch { /* storage blocked: the assistant opens with an empty box */ }
}

/** The request handed over for `modelId`, once; '' when there is none. */
export function takeHandOver(modelId, now = Date.now()) {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return '';
    localStorage.removeItem(KEY);
    const item = JSON.parse(raw);
    // A stale or foreign request must not surface in another model's editor.
    if (item.modelId !== modelId || !(now - item.at < MAX_AGE_MS)) return '';
    return typeof item.request === 'string' ? item.request : '';
  } catch {
    return ''; /* storage blocked or garbled: nothing to hand over */
  }
}
