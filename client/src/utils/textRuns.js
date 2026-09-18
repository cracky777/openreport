// Rich text for the Text visual: a list of runs, each a piece of text with
// its own formatting layered over the visual's font settings. Stored as
// `data.runs` next to the plain `data.text`, which stays what everything
// that only understands text (exports, imports, search) reads and writes.
//
// Runs are plain data, never markup: the renderer builds spans from them, so
// nothing a report carries can reach the page as HTML.
import { getFont, fontStack } from './googleFonts';

export const RUN_STYLE_KEYS = ['bold', 'italic', 'underline', 'color', 'fontSize', 'fontFamily'];
export const CLEAR_RUN_STYLE = Object.fromEntries(RUN_STYLE_KEYS.map((k) => [k, null]));

const COLOR_RE = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%]+\)|[a-z]{3,20})$/i;

// Only known keys with values that are safe to put in a style object; the
// font family must be one of the catalogue's so `fontStack` resolves it.
export function cleanRunStyle(style) {
  const out = {};
  if (!style || typeof style !== 'object') return out;
  if (style.bold === true) out.bold = true;
  if (style.italic === true) out.italic = true;
  if (style.underline === true) out.underline = true;
  if (typeof style.color === 'string' && COLOR_RE.test(style.color)) out.color = style.color;
  const size = Number(style.fontSize);
  if (Number.isInteger(size) && size >= 6 && size <= 200) out.fontSize = size;
  if (typeof style.fontFamily === 'string' && getFont(style.fontFamily)) out.fontFamily = style.fontFamily;
  return out;
}

function sameStyle(a, b) {
  return RUN_STYLE_KEYS.every((k) => a[k] === b[k]);
}

// Drops empty runs and unknown keys, merges neighbours that share a style.
export function normalizeRuns(runs) {
  const out = [];
  for (const r of Array.isArray(runs) ? runs : []) {
    if (!r || typeof r.text !== 'string' || r.text === '') continue;
    const run = { text: r.text, ...cleanRunStyle(r) };
    const prev = out[out.length - 1];
    if (prev && sameStyle(prev, run)) prev.text += run.text;
    else out.push(run);
  }
  return out;
}

export function runsToText(runs) {
  return (runs || []).map((r) => r.text).join('');
}

// The runs of a widget's data. Plain text wins over runs that no longer
// spell it: something that only knows `text` (an import, an older editor)
// may have changed it since the runs were written.
export function runsFromData(data) {
  const text = typeof data?.text === 'string' ? data.text : '';
  if (Array.isArray(data?.runs)) {
    const runs = normalizeRuns(data.runs);
    if (runsToText(runs) === text) return runs;
  }
  return text ? [{ text }] : [];
}

// Style object for one run. Sizes are strings so the same object suits a
// React `style` prop and a direct `Object.assign(el.style, …)`.
export function runStyle(run) {
  const s = {};
  if (run.bold) s.fontWeight = 700;
  if (run.italic) s.fontStyle = 'italic';
  if (run.underline) s.textDecoration = 'underline';
  if (run.color) s.color = run.color;
  if (run.fontSize) s.fontSize = `${run.fontSize}px`;
  if (run.fontFamily) s.fontFamily = fontStack(run.fontFamily);
  return s;
}

// Applies `patch` to the text between offsets start and end; a key set to
// null is removed so that stretch falls back to the visual's setting.
export function applyRunStyle(runs, start, end, patch) {
  const out = [];
  let pos = 0;
  for (const run of runs) {
    const runEnd = pos + run.text.length;
    const a = Math.max(start, pos);
    const b = Math.min(end, runEnd);
    if (a >= b) {
      out.push(run);
    } else {
      if (a > pos) out.push({ ...run, text: run.text.slice(0, a - pos) });
      const styled = { ...run, text: run.text.slice(a - pos, b - pos) };
      for (const [k, v] of Object.entries(patch)) {
        if (v == null) delete styled[k];
        else styled[k] = v;
      }
      out.push(styled);
      if (b < runEnd) out.push({ ...run, text: run.text.slice(b - pos) });
    }
    pos = runEnd;
  }
  return normalizeRuns(out);
}

// Runs touching [start, end); for a caret, the run the caret sits in (the
// one it would extend when typing).
function runsInRange(runs, start, end) {
  const hits = [];
  let pos = 0;
  for (const run of runs) {
    const runEnd = pos + run.text.length;
    const hit = end > start
      ? pos < end && runEnd > start
      : (pos < start && start <= runEnd) || (start === 0 && pos === 0);
    if (hit) hits.push(run);
    pos = runEnd;
  }
  return hits;
}

// The formatting every run in the range agrees on: what a toolbar shows as
// active for the current selection.
export function styleInRange(runs, start, end) {
  const hits = runsInRange(runs, start, end);
  if (hits.length === 0) return {};
  const out = {};
  for (const k of RUN_STYLE_KEYS) {
    const v = hits[0][k];
    if (v != null && hits.every((r) => r[k] === v)) out[k] = v;
  }
  return out;
}

export const RUN_ATTR = 'data-run';
const TEXT_NODE = 3;
const ELEMENT_NODE = 1;
const BLOCK_TAGS = new Set(['DIV', 'P']);

// Fills an element with one span per run, built with DOM calls only.
export function renderRuns(el, runs) {
  const doc = el.ownerDocument;
  while (el.firstChild) el.removeChild(el.firstChild);
  for (const run of runs) {
    const { text, ...style } = run;
    const span = doc.createElement('span');
    if (Object.keys(style).length > 0) span.setAttribute(RUN_ATTR, JSON.stringify(style));
    Object.assign(span.style, runStyle(run));
    span.textContent = text;
    el.appendChild(span);
  }
}

// Reads runs back from an edited element. Formatting comes only from the
// `data-run` attribute the renderer wrote, so typing inside a span keeps its
// style and anything the browser inserts on its own is plain. A <br> or a
// block the browser wrapped a new line in counts as a newline.
export function runsFromDom(root) {
  const runs = [];
  const walk = (node, style) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === TEXT_NODE) {
        runs.push({ text: child.nodeValue, ...style });
      } else if (child.nodeType === ELEMENT_NODE) {
        const tag = child.tagName.toUpperCase();
        if (tag === 'BR') { runs.push({ text: '\n', ...style }); continue; }
        let own = style;
        const attr = child.getAttribute(RUN_ATTR);
        if (attr) {
          try { own = { ...style, ...cleanRunStyle(JSON.parse(attr)) }; }
          catch { /* not written by us: inherit */ }
        }
        if (BLOCK_TAGS.has(tag) && runs.length > 0) runs.push({ text: '\n', ...style });
        walk(child, own);
      }
    }
  };
  walk(root, {});
  return normalizeRuns(runs);
}
