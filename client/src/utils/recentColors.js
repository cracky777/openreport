/**
 * The last colours the user picked, shared by every colour control in the app.
 *
 * A report is built one widget at a time, but its palette is a single decision:
 * the colour chosen for a line is the one wanted for the matching scorecard two
 * panels later. Re-finding it in an OS colour dialog is the tedious part, so the
 * recent ones stay one click away — the same idea as Power BI's "Recent colors".
 *
 * Stored per browser in localStorage. It is a convenience, never data: every
 * read and write is guarded, and an empty list simply renders nothing.
 */

const KEY = 'openreport.recentColors';
const MAX = 8;

const listeners = new Set();
let cache = null;

function normalize(color) {
  if (typeof color !== 'string') return null;
  const c = color.trim().toLowerCase();
  // Only plain #rrggbb is kept: it is what the pickers emit, and it is the one
  // form that compares reliably for de-duplication.
  return /^#[0-9a-f]{6}$/.test(c) ? c : null;
}

export function getRecentColors() {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || '[]');
    cache = Array.isArray(parsed) ? parsed.map(normalize).filter(Boolean).slice(0, MAX) : [];
  } catch {
    // Private window, disabled storage, corrupted value — no recents is fine.
    cache = [];
  }
  return cache;
}

export function pushRecentColor(color) {
  const c = normalize(color);
  if (!c) return;
  const next = [c, ...getRecentColors().filter((x) => x !== c)].slice(0, MAX);
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch { /* storage full or blocked — the in-memory list still serves this session */ }
  for (const fn of listeners) fn(next);
}

/** Subscribe to changes so every open picker shows the same list. */
export function subscribeRecentColors(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
