// Flaws of a page's layout the app can measure, named to the assistant so it
// fixes them instead of guessing them from a small picture: the review said a
// filter "no longer has a card" while it still stood, stretched, at a figure's
// height (Karim's report). Pure: boxes in, sentences out. The model is told,
// never forced — it is the designer (prompt DESIGNER_GUIDE).

const TALL_DROPDOWN = 120;
const GRID = 20;
const DRESSING = new Set(['text', 'shape', 'image']);
const NARROW = new Set(['filter', 'scorecard', 'gauge']);

const label = (w) => `${w.id} (${w.type}${w.title ? ` "${String(w.title).slice(0, 40)}"` : ''})`;
const isDropdown = (w) => w.type === 'filter' && (w.shape || {}).slicerStyle === 'dropdown';
const placed = (w) => w && w.layout && [w.layout.x, w.layout.y, w.layout.w, w.layout.h].every((v) => Number.isFinite(Number(v)));

// Rows: widgets whose boxes overlap vertically, read top to bottom.
function rowsOf(widgets) {
  const rows = [];
  for (const w of [...widgets].sort((a, b) => a.layout.y - b.layout.y || a.layout.x - b.layout.x)) {
    const row = rows.find((r) => r.some((o) => w.layout.y < o.layout.y + o.layout.h && o.layout.y < w.layout.y + w.layout.h));
    if (row) row.push(w); else rows.push([w]);
  }
  return rows.map((r) => r.sort((a, b) => a.layout.x - b.layout.x));
}

/**
 * @param {object} page  { pageWidth, widgets: [{ id, type, title, layout, shape }] }
 * @returns {string[]}   one sentence per flaw, with the widgets' ids
 */
function layoutIssues(page) {
  const widgets = ((page && page.widgets) || []).filter((w) => placed(w) && !DRESSING.has(w.type));
  const issues = [];
  for (const w of widgets) {
    if (isDropdown(w) && w.layout.h > TALL_DROPDOWN) {
      issues.push(`${label(w)} is a dropdown ${w.layout.h} px tall: about 70–90 px is enough — a slim strip, or stacked with other filters.`);
    }
  }
  const rows = rowsOf(widgets).filter((r) => r.length > 1);
  for (const row of rows) {
    // A dropdown kept slim beside taller cards, on their top line, is the
    // design asked above — not uneven heights. Flagged both ways, the review
    // chased its own fix card after card (seen on Karim's overview).
    const cards = row.filter((w) => !(isDropdown(w) && w.layout.h <= TALL_DROPDOWN));
    const heights = new Set(cards.map((w) => w.layout.h));
    const tops = new Set(row.map((w) => w.layout.y));
    if (tops.size > 1) issues.push(`${row.map(label).join(', ')} sit side by side with their tops out of line (${[...tops].join(' / ')} px).`);
    else if (heights.size > 1) issues.push(`${row.map(label).join(', ')} sit side by side with different heights (${row.map((w) => w.layout.h).join(' / ')} px): their bottoms do not line up.`);
  }
  // A row stopping short of the right edge the other rows reach.
  const right = (row) => Math.max(...row.map((w) => w.layout.x + w.layout.w));
  const allRows = rowsOf(widgets);
  const edge = Math.max(...allRows.map(right), 0);
  for (const row of allRows) {
    // A band of filters or figures keeps its width (arrange caps theirs):
    // told it "stopped short", the review stretched one dropdown, then one
    // scorecard, across the page (Léa's report).
    if (row.every((w) => NARROW.has(w.type))) continue;
    if (allRows.length > 1 && edge - right(row) >= 2 * GRID) issues.push(`The row of ${row.map(label).join(', ')} ends ${edge - right(row)} px before the right edge the other rows reach.`);
  }
  return issues;
}

module.exports = { layoutIssues };
