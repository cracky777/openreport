// From "which widgets share a row, and how much each matters" to pixels.
//
// The model is good at the first half — reading titles and bindings, deciding
// what leads and what goes together — and bad at the second: sums of widths,
// gutters and grid snapping, over a dozen rectangles, in its head. So it never
// does that part. It hands over rows and weights; everything that must be
// exact (margins, gutters, the 20 px grid, the readable floor of each type,
// staying inside the page) is computed here, the same way every time.

const GRID = 20;
const MARGIN = 20;
const GUTTER = 20;
const MAX_ROWS = 12;
const MAX_PER_ROW = 8;
const GENERIC_MIN = { w: 100, h: 60 };

// The smallest box, in page pixels, in which each type still reads: axes,
// ticks and a few labels for a chart, the value and its label for a
// scorecard. Roughly 55 % of the editor's default sizes. The prompt quotes
// this table, so what the model is told and what it is held to cannot drift.
const READABLE_MIN = {
  bar: { w: 280, h: 200 },
  line: { w: 280, h: 200 },
  combo: { w: 300, h: 200 },
  scatter: { w: 280, h: 220 },
  pie: { w: 220, h: 200 },
  treemap: { w: 240, h: 180 },
  table: { w: 280, h: 160 },
  pivotTable: { w: 360, h: 200 },
  scorecard: { w: 140, h: 80 },
  gauge: { w: 180, h: 140 },
  filter: { w: 140, h: 60 },
  customVisual: { w: 240, h: 180 },
};

// Past this height a row is wasted space rather than emphasis: a scorecard
// 400 px tall says nothing more than one 160 px tall. A row takes the cap of
// its most demanding widget.
const MAX_HEIGHT = { scorecard: 160, filter: 320, gauge: 320, text: 120 };
const DEFAULT_MAX_HEIGHT = 520;

function readableMin(type) {
  return READABLE_MIN[type] || GENERIC_MIN;
}

// A filter is seven different widgets under one type: a dropdown reads in a
// 60 px strip, an inline calendar needs a 280 px square. Sized from what each
// style actually draws (FilterWidget.jsx).
const FILTER_MIN = {
  dropdown: { w: 160, h: 60 },
  list: { w: 160, h: 200 },
  range: { w: 220, h: 100 },
  dateRelative: { w: 220, h: 100 },
  dateCalendar: { w: 260, h: 300 },
};
const TITLE_HEIGHT = 30;
const SIDE_LEGEND_WIDTH = 120;
const STACKED_LEGEND_HEIGHT = 30;
const COLUMN_WIDTH = 90;
const LEGEND_TYPES = new Set(['bar', 'line', 'pie', 'scatter', 'combo']);
const snapUp = (n) => Math.ceil(n / GRID) * GRID;

function filterMin(widget, dateDims) {
  const shape = widget.shape || {};
  const dim = widget.dataBinding && Array.isArray(widget.dataBinding.selectedDimensions) ? widget.dataBinding.selectedDimensions[0] : null;
  // Same default as the widget: a date dimension opens as a date range.
  const style = shape.slicerStyle || (dateDims.has(dim) ? 'dateRange' : 'list');
  if (style === 'dateRange' || style === 'dateBetween') return shape.dateLayout === 'horizontal' ? { w: 320, h: 80 } : { w: 180, h: 160 };
  if (style === 'buttons') return shape.orientation === 'horizontal' ? { w: 260, h: 60 } : { w: 140, h: 160 };
  return FILTER_MIN[style] || FILTER_MIN.list;
}

/**
 * The readable floor of ONE widget, from what it actually has to draw: the
 * type's floor, plus the room its title, its legend or its columns take from
 * the plot. A floor by type alone let a calendar filter be laid out in the
 * 60 px strip that suits a dropdown.
 *
 * @param {object} widget    a page-context widget: { type, title, config, shape, dataBinding }
 * @param {Set} dateDims     names of the model's date dimensions
 * @param {number} maxWidth  a floor never asks for more than the page offers
 */
function floorOf(widget, dateDims = new Set(), maxWidth = Infinity) {
  const base = widget.type === 'filter' ? filterMin(widget, dateDims) : readableMin(widget.type);
  let { w, h } = base;
  const config = widget.config || {};
  const binding = widget.dataBinding || {};
  if (widget.title) h += TITLE_HEIGHT;
  if (LEGEND_TYPES.has(widget.type) && config.showLegend) {
    if (config.legendPosition === 'left' || config.legendPosition === 'right') w += SIDE_LEGEND_WIDTH;
    else h += STACKED_LEGEND_HEIGHT;
  }
  if (widget.type === 'table' || widget.type === 'pivotTable') {
    const columns = [binding.selectedDimensions, binding.selectedMeasures].reduce((n, list) => n + (Array.isArray(list) ? list.length : 0), 0);
    w = Math.max(w, columns * COLUMN_WIDTH);
  }
  if (widget.type === 'scorecard' && binding.compareDateDim) h += 20;
  return { w: Math.min(snapUp(w), maxWidth), h: snapUp(h) };
}

const dateDimsOf = (effective) => new Set(((effective && effective.dimensions) || []).filter((d) => /date|time/i.test(String(d.type || ''))).map((d) => d.name));

/** Stamp every widget of the page with its floor, and whether it is under it today. */
function withFloors(pageContext, effective) {
  const dateDims = dateDimsOf(effective);
  const maxWidth = pageContext.pageWidth - 2 * MARGIN;
  return {
    ...pageContext,
    widgets: pageContext.widgets.map((widget) => {
      const minSize = floorOf(widget, dateDims, maxWidth);
      const at = widget.layout || {};
      const squashed = Number(at.w) < minSize.w || Number(at.h) < minSize.h;
      return squashed ? { ...widget, minSize, tooSmallNow: true } : { ...widget, minSize };
    }),
  };
}

const minOf = (widget) => widget.minSize || readableMin(widget.type);

const weightOf = (v) => (Number.isFinite(Number(v)) ? Math.min(Math.max(Number(v), 0.25), 10) : 1);
const snapDown = (n) => Math.floor(n / GRID) * GRID;

/**
 * Share `available` px between items by weight, on the grid, no item under
 * its floor. Returns null when even the floors do not fit.
 */
function share(available, items) {
  const floors = items.reduce((sum, it) => sum + it.min, 0);
  if (floors > available) return null;
  const totalWeight = items.reduce((sum, it) => sum + it.weight, 0);
  const sizes = items.map((it) => Math.min(Math.max(snapDown((available * it.weight) / totalWeight), it.min), it.max ?? Infinity));
  // Floors pushed some items past their share: take it back, one grid step at
  // a time, from whichever has the most room above its own floor.
  let excess = sizes.reduce((a, b) => a + b, 0) - available;
  while (excess > 0) {
    let pick = -1;
    for (let i = 0; i < sizes.length; i++) {
      if (sizes[i] - GRID >= items[i].min && (pick === -1 || sizes[i] - items[i].min > sizes[pick] - items[pick].min)) pick = i;
    }
    if (pick === -1) return null;
    sizes[pick] -= GRID;
    excess -= GRID;
  }
  return sizes;
}

const rowMinHeight = (row) => Math.max(...row.cells.map((c) => minOf(c.widget).h));
const rowMinWidth = (row) => row.cells.reduce((sum, c) => sum + c.min, 0) + GUTTER * (row.cells.length - 1);

// Models lay a page out like a document: a row for the title, a row for the
// filters, a row for each idea — six rows on a page that holds four. Refusing
// that twice left the author with no layout at all (seen with a real model on
// a real report). So when the rows are too tall together, neighbours are
// merged, in place: first the pair that leaves the most width to spare and is
// closest in height — a title with a filter strip, never a scorecard with a
// chart if anything else works — and only pairs that still fit side by side. The order the model chose, left
// to right and top to bottom, is kept.
function fitRows(rows, innerWidth, innerHeight) {
  const tooTall = () => rows.reduce((sum, row) => sum + rowMinHeight(row), 0) + GUTTER * (rows.length - 1) > innerHeight;
  while (rows.length > 1 && tooTall()) {
    let best = -1;
    let bestCost = Infinity;
    for (let i = 0; i < rows.length - 1; i++) {
      const [a, b] = [rows[i], rows[i + 1]];
      if (a.cells.length + b.cells.length > MAX_PER_ROW) continue;
      const width = rowMinWidth(a) + GUTTER + rowMinWidth(b);
      if (width > innerWidth) continue;
      // How full the merged row would be, plus how unlike the two are in
      // height: a title beside a filter strip costs almost nothing, four
      // charts squeezed to their floors or a scorecard beside a chart a lot.
      const cost = width / innerWidth + Math.abs(rowMinHeight(a) - rowMinHeight(b)) / 200;
      if (cost < bestCost) { best = i; bestCost = cost; }
    }
    if (best === -1) return;
    const [a, b] = [rows[best], rows[best + 1]];
    a.cells.push(...b.cells);
    a.weight = Math.max(a.weight, b.weight);
    rows.splice(best + 1, 1);
  }
}

/**
 * @param {object} raw     { rows: [{ height?, widgets: [{ widgetId, width? }] }] } as the model wrote it
 * @param {Map} byId       widgets of the submitted page, by id
 * @param {object} page    { width, height }
 * @returns {{ moves: object[], errors: string[] }}  moves = [{ op:'move', widgetId, x, y, w, h }]
 */
function arrange(raw, byId, page) {
  // A real model wrote the key as `rows":` — a stray quote inside a good
  // layout, which a strict read threw away whole. Any key that is "rows" once
  // stripped of punctuation is taken for it; the content is validated below.
  const key = raw && typeof raw === 'object' ? Object.keys(raw).find((k) => k.replace(/[^a-z]/gi, '').toLowerCase() === 'rows') : null;
  const rowsIn = key && Array.isArray(raw[key]) ? raw[key].slice(0, MAX_ROWS) : [];
  if (!rowsIn.length) return { moves: [], errors: ['arrangement: no row was given'] };

  const errors = [];
  const seen = new Set();
  const rows = [];
  rowsIn.forEach((row, r) => {
    const cells = [];
    const list = row && Array.isArray(row.widgets) ? row.widgets.slice(0, MAX_PER_ROW) : [];
    for (const written of list) {
      // The compact form the tool asks for: "w3", or "w3:2" for twice as wide.
      // The less a model has to write, the less it gets wrong.
      const cell = typeof written === 'string'
        ? { widgetId: written.split(':')[0].trim(), width: written.split(':')[1] }
        : written;
      const widget = cell && byId.get(cell.widgetId);
      if (!widget) { errors.push(`arrangement row ${r + 1}: unknown widget`); continue; }
      if (widget.merged) { errors.push(`arrangement row ${r + 1}: ${JSON.stringify(widget.title || widget.type)} is part of a merged block and cannot be placed alone; leave it out`); continue; }
      if (seen.has(widget.id)) { errors.push(`arrangement row ${r + 1}: a widget appears twice`); continue; }
      seen.add(widget.id);
      cells.push({ widget, weight: weightOf(cell.width), min: minOf(widget).w });
    }
    if (cells.length) rows.push({ index: r + 1, cells, weight: weightOf(row.height) });
  });
  if (!rows.length) return { moves: [], errors };

  const innerWidth = page.width - 2 * MARGIN;
  fitRows(rows, innerWidth, page.height - 2 * MARGIN);
  for (const row of rows) {
    row.widths = share(innerWidth - GUTTER * (row.cells.length - 1), row.cells);
    if (!row.widths) {
      errors.push(`arrangement row ${row.index}: ${row.cells.length} widgets do not fit side by side at a readable width on a ${page.width} px page; split this row in two`);
    }
  }
  const fitting = rows.filter((row) => row.widths);
  if (!fitting.length) return { moves: [], errors };

  const heights = share(
    page.height - 2 * MARGIN - GUTTER * (fitting.length - 1),
    fitting.map((row) => ({
      weight: row.weight,
      min: Math.max(...row.cells.map((c) => minOf(c.widget).h)),
      // Never under the floor: a calendar filter needs more than the cap that
      // suits the other filters.
      max: Math.max(...row.cells.map((c) => Math.max(MAX_HEIGHT[c.widget.type] || DEFAULT_MAX_HEIGHT, minOf(c.widget).h))),
    })),
  );
  if (!heights) {
    errors.push(`arrangement: ${fitting.length} rows do not fit at a readable height on a ${page.height} px page; use fewer rows by putting more widgets side by side (scorecards together, two or three charts per row). This is a layout problem, not a reason to tell the user to remove visuals`);
    return { moves: [], errors };
  }

  const moves = [];
  let y = MARGIN;
  fitting.forEach((row, r) => {
    let x = MARGIN;
    row.cells.forEach((cell, c) => {
      // The last widget of a row takes what grid snapping left over, so every
      // row ends flush with the right margin.
      const w = c === row.cells.length - 1 ? MARGIN + innerWidth - x : row.widths[c];
      moves.push({ op: 'move', widgetId: cell.widget.id, x, y, w, h: heights[r] });
      x += w + GUTTER;
    });
    y += heights[r] + GUTTER;
  });
  return { moves, errors };
}

// A comfortable size for a visual that stands alone, by type; the rest take
// the chart's. Never under the widget's own readable floor.
const ALONE = { scorecard: { w: 280, h: 160 }, gauge: { w: 300, h: 240 }, filter: { w: 240, h: 200 }, table: { w: 760, h: 360 }, pivotTable: { w: 760, h: 400 } };
const ALONE_CHART = { w: 560, h: 360 };
const SUMMARY = new Set(['scorecard', 'gauge', 'filter']);
const FULL_ROW = { line: 3, table: 2, pivotTable: 2 };
const MAX_SUMMARY_PER_ROW = 6;

/**
 * Sizes and places for visuals that are not on any page yet (the landing-page
 * assistant). The model proposes them in reading order and is not asked for a
 * layout — it has no page to look at — so the rows follow from the order and
 * the types, the way a person would lay a dashboard out: the figures together
 * in a band, a trend across the full width, the other charts two by two, a
 * table across. `arrange` then does the pixels, as for an existing page.
 *
 * @param {object[]} proposed  validated proposals: { type, config, dataBinding }
 * @returns {object[]}        the same, each with `layout: {x,y,w,h}` — or as they came if they cannot fit one page
 */
function layoutNew(proposed, page, effective) {
  const dateDims = dateDimsOf(effective);
  // A model can still write the `layout` it was not offered: never kept.
  const widgets = proposed.map(({ layout: _madeUp, ...w }) => w);
  const maxWidth = page.width - 2 * MARGIN;
  const items = widgets.map((w, i) => {
    const pseudo = { id: `n${i + 1}`, type: w.type, title: (w.config && w.config.title) || '', config: w.config || {}, dataBinding: w.dataBinding || {} };
    return { ...pseudo, minSize: floorOf(pseudo, dateDims, maxWidth) };
  });

  if (items.length === 1) {
    const want = ALONE[items[0].type] || ALONE_CHART;
    const size = { w: Math.min(Math.max(want.w, items[0].minSize.w), maxWidth), h: Math.max(want.h, items[0].minSize.h) };
    return [{ ...widgets[0], layout: { x: MARGIN, y: MARGIN, ...size } }];
  }

  const rows = [];
  let open = null; // the row still taking widgets of the same kind
  for (const item of items) {
    const kind = SUMMARY.has(item.type) ? 'summary' : (FULL_ROW[item.type] ? 'full' : 'chart');
    const room = open && open.kind === kind && open.widgets.length < (kind === 'summary' ? MAX_SUMMARY_PER_ROW : 2);
    if (kind === 'full' || !room) {
      open = { kind, height: kind === 'summary' ? 1 : (FULL_ROW[item.type] || 3), widgets: [] };
      rows.push(open);
    }
    open.widgets.push(item.id);
  }

  const { moves } = arrange({ rows }, new Map(items.map((it) => [it.id, it])), page);
  // All or nothing: a dashboard with half its visuals placed and the rest piled
  // in a corner is worse than letting whoever adds them stack them in order.
  if (moves.length !== items.length) return widgets;
  const at = new Map(moves.map((m) => [m.widgetId, { x: m.x, y: m.y, w: m.w, h: m.h }]));
  return widgets.map((w, i) => ({ ...w, layout: at.get(`n${i + 1}`) }));
}

/**
 * How full the page is, from the readable floor of what is on it: 1 means the
 * visuals would fill the page edge to edge at their smallest readable size.
 * Given to the model as a fact rather than left to its arithmetic — "too many
 * visuals" is the one piece of design advice it cannot act on itself, so it
 * has to be able to say it, and with a number.
 */
function pageLoad(pageContext) {
  const visuals = pageContext.widgets.filter((w) => READABLE_MIN[w.type]);
  const footprint = visuals.reduce((sum, w) => sum + (minOf(w).w + GUTTER) * (minOf(w).h + GUTTER), 0);
  const area = Math.max(1, (pageContext.pageWidth - MARGIN) * (pageContext.pageHeight - MARGIN));
  return { visuals: visuals.length, ratio: Math.round((footprint / area) * 100) / 100 };
}

module.exports = { arrange, layoutNew, pageLoad, floorOf, withFloors, minOf, readableMin, READABLE_MIN, GRID, MARGIN, GUTTER };
