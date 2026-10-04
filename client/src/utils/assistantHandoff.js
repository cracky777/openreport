// A request typed in one place is answered by the assistant of another page:
// the report and Ask assistants hand a data-model request to the model
// assistant, and the empty Reports stage hands "the report I want" to the
// report editor's — or, with no model yet, to the model assistant first while
// the report request waits for the model to be ready ('describe'). The request
// travels through localStorage rather than the URL (it is the user's own
// words), and the target may open in another tab. One slot per kind: the model
// and the waiting report request live side by side.
const KEY = 'openreport.assistantRequest';
// A page that opens right away reads it within the minute; the report request
// waits while the author builds the model.
const MAX_AGE_MS = 60_000;
export const DESCRIBE_MAX_AGE_MS = 60 * 60_000;

/** `kind` names the page that must answer ('model' | 'report' | 'describe'): ids of different kinds may collide. */
export function handOver(kind, id, request, maxAge = MAX_AGE_MS) {
  try {
    localStorage.setItem(`${KEY}.${kind}`, JSON.stringify({ id, request: request || '', at: Date.now(), maxAge }));
  } catch { /* storage blocked: the assistant opens with an empty box */ }
}

function read(kind, id, now) {
  const raw = localStorage.getItem(`${KEY}.${kind}`);
  if (!raw) return { raw: null, request: '' };
  const item = JSON.parse(raw);
  // A stale or foreign request must not surface in another page's assistant.
  const fresh = now - item.at < Math.min(item.maxAge || MAX_AGE_MS, DESCRIBE_MAX_AGE_MS);
  return { raw, request: item.id === id && fresh && typeof item.request === 'string' ? item.request : '' };
}

/** The request handed over to this `kind` and `id`, once; '' when there is none. */
export function takeHandOver(kind, id, now = Date.now()) {
  try {
    const { raw, request } = read(kind, id, now);
    if (raw) localStorage.removeItem(`${KEY}.${kind}`);
    return request;
  } catch {
    return ''; /* storage blocked or garbled: nothing to hand over */
  }
}

/** Same, left in place: whether a request waits here. */
export function peekHandOver(kind, id, now = Date.now()) {
  try { return read(kind, id, now).request; } catch { return ''; /* storage blocked or garbled */ }
}
