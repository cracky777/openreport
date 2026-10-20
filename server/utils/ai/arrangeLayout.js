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
  heatmap: { w: 320, h: 200 },
  map: { w: 280, h: 260 },
  waterfall: { w: 320, h: 200 },
  table: { w: 280, h: 160 },
  pivotTable: { w: 360, h: 200 },
  scorecard: { w: 140, h: 80 },
  gauge: { w: 180, h: 140 },
  filter: { w: 140, h: 60 },
  customVisual: { w: 240, h: 180 },
  // A text is a title or a sentence: squeezed to a generic floor it wrapped
  // one word per line (seen on a real page, the report title beside six figures).
  text: { w: 280, h: 60 },
};

// Past this height a row is wasted space rather than emphasis: a scorecard
// 400 px tall says nothing more than one 160 px tall. A row takes the cap of
// its most demanding widget.
const MAX_HEIGHT = { scorecard: 160, filter: 320, gauge: 320, text: 120 };
// A figure or a filter stretched across the page is a big empty card (seen
// with a lone scorecard): the summary types keep a readable width and the row
// ends where they end.
const MAX_WIDTH = { scorecard: 380, gauge: 440, filter: 340 };
// An image (a logo) keeps the width it was given: a page laid out again
// stretched Crédit Ardent's logo across the page, deformed.
const maxWidthOf = (w) => (w.type === 'image' ? w.ownWidth || (w.layout && w.layout.w) || 240 : MAX_WIDTH[w.type] || Infinity);
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
  const { w, h } = floorExact(widget, dateDims);
  return { w: Math.min(snapUp(w), maxWidth), h: snapUp(h) };
}

// The same floor before grid snapping: what two widgets sharing one box
// really need, when a grid step would be the difference.
function floorExact(widget, dateDims = new Set()) {
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
  return { w, h };
}

const dateDimsOf = (effective) => new Set(((effective && effective.dimensions) || []).filter((d) => /date|time/i.test(String(d.type || ''))).map((d) => d.name));

/**
 * Stamp every widget with its floor, and whether it is under it today — on
 * the other pages too, which a design card sizes and places as well.
 */
function withFloors(pageContext, effective) {
  const dateDims = dateDimsOf(effective);
  const maxWidth = pageContext.pageWidth - 2 * MARGIN;
  const floored = (widgets) => (widgets || []).map((widget) => {
    const minSize = floorOf(widget, dateDims, maxWidth);
    const at = widget.layout || {};
    const squashed = Number(at.w) < minSize.w || Number(at.h) < minSize.h;
    return squashed ? { ...widget, minSize, tooSmallNow: true } : { ...widget, minSize };
  });
  return {
    ...pageContext,
    widgets: floored(pageContext.widgets),
    ...(pageContext.otherPages ? { otherPages: pageContext.otherPages.map((p) => ({ ...p, widgets: floored(p.widgets) })) } : {}),
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
// Grid snapping leaves a row short of the right margin; a row of capped
// widgets takes it back a step at a time, each up to its own cap, so three
// scorecards still end flush while a lone one stays a card.
function growToCaps(row, innerWidth) {
  const used = () => row.widths.reduce((a, b) => a + b, 0) + GUTTER * (row.cells.length - 1);
  let guard = row.cells.length * 50;
  while (used() + GRID <= innerWidth && guard-- > 0) {
    // The narrowest first, so equals stay equal.
    let i = -1;
    row.widths.forEach((w, k) => { if (w + GRID <= row.cells[k].max && (i === -1 || w < row.widths[i])) i = k; });
    if (i === -1) return;
    row.widths[i] += GRID;
  }
}

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
      cells.push({ widget, weight: weightOf(cell.width), min: minOf(widget).w, max: Math.max(maxWidthOf(widget), minOf(widget).w) });
    }
    if (cells.length) rows.push({ index: r + 1, cells, weight: weightOf(row.height) });
  });
  if (!rows.length) return { moves: [], errors };

  const innerWidth = page.width - 2 * MARGIN;
  fitRows(rows, innerWidth, page.height - 2 * MARGIN);
  for (const row of rows) {
    row.widths = share(innerWidth - GUTTER * (row.cells.length - 1), row.cells);
    if (row.widths) growToCaps(row, innerWidth);
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
    // A row whose widgets are all capped stops short of the right margin.
    const capped = row.cells.every((cell) => Number.isFinite(cell.max));
    row.cells.forEach((cell, c) => {
      // The last widget of a row takes what grid snapping left over, so every
      // row ends flush with the right margin.
      const w = c === row.cells.length - 1 && !capped ? MARGIN + innerWidth - x : row.widths[c];
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
const MAX_SUMMARY_PER_ROW = 6;

/**
 * Sizes and places for visuals that are not on any page yet (the landing-page
 * assistant, the studio, a page of a proposed report). The model proposes them
 * in reading order and is not asked for a layout — it has no page to look at —
 * so the page is composed the way a person lays a dashboard out: a strip of
 * filters, a band of figures, then the charts two by two (a trend across the
 * full width), the tables across. Rows keep a comfortable height: squeezing
 * nine visuals into one screen made 240 px filters and 220 px tables (seen on
 * a real report). When they do not fit the page, the rows are compacted once;
 * past that the page is simply taller, and whoever applies the proposal reads
 * the height it needs (`pageHeightOf`).
 *
 * @param {object[]} proposed  validated proposals: { type, config, dataBinding }
 * @returns {object[]}        the same, each with `layout: {x,y,w,h}`
 */
const ROW = {
  comfortable: { title: 60, filters: 60, summary: 130, gauge: 240, chart: 300, line: 280, table: 320, pivotTable: 340 },
  compact: { title: 60, filters: 60, summary: 120, gauge: 220, chart: 240, line: 240, table: 240, pivotTable: 260 },
};
const CAP_WIDTH = { filter: 260, scorecard: 380 };
// A text is a title strip across the page (a page recomposed keeps its heading first).
// A text or a shape is a strip (a title band, a divider); an image a small box (a logo).
const kindOf = (type) => (type === 'filter' ? 'filters' : type === 'scorecard' || type === 'image' ? 'summary' : type === 'gauge' ? 'gauge' : type === 'text' || type === 'shape' ? 'title' : type === 'line' || type === 'table' || type === 'pivotTable' ? type : 'chart');

// The compositions a page of a proposed report may take, besides the
// standard strip of figures over charts two by two (asked by Jonathan: every
// report came out with the same skeleton). The model picks one per page.
const COMPOSITIONS = ['standard', 'hero', 'sidebar', 'grid', 'focus'];
const SIDEBAR_W = 280;
const isData = (it) => !['title', 'filters', 'summary'].includes(kindOf(it.type));

// Items side by side in a band from `x0`, `width` wide: equal shares on the
// grid, each at least its floor, the last one flush with the band's edge.
function placeBand(widgets, band, x0, width, y, h) {
  const n = band.length;
  const even = snapDown((width - GUTTER * (n - 1)) / n);
  let x = x0;
  band.forEach((it, c) => {
    const w = c === n - 1 ? Math.max(x0 + width - x, it.minSize.w) : Math.max(even, it.minSize.w);
    widgets[it.i] = { ...widgets[it.i], layout: { x, y, w, h: Math.max(h, it.minSize.h) } };
    x += w + GUTTER;
  });
  return y + Math.max(h, ...band.map((it) => it.minSize.h));
}

// A composition other than the standard one, or null when the page has
// nothing for it (a hero with no chart, a sidebar with nothing to hold).
function composeAs(composition, widgets, items, inner) {
  const filters = items.filter((it) => kindOf(it.type) === 'filters');
  const titles = items.filter((it) => kindOf(it.type) === 'title');
  const figures = items.filter((it) => kindOf(it.type) === 'summary' || it.type === 'gauge');
  const data = items.filter((it) => isData(it) && it.type !== 'gauge');
  const high = (it) => ROW.comfortable[kindOf(it.type)] || ROW.comfortable.chart;
  let y = MARGIN;
  const top = (list, h) => { for (let k = 0; k < list.length; k += MAX_SUMMARY_PER_ROW) y = placeBand(widgets, list.slice(k, k + MAX_SUMMARY_PER_ROW), MARGIN, inner, y, h) + GUTTER; };
  const rest = (list, perRow, h) => { for (let k = 0; k < list.length; k += perRow) y = placeBand(widgets, list.slice(k, k + perRow), MARGIN, inner, y, h || Math.max(...list.slice(k, k + perRow).map(high))) + GUTTER; };
  if (composition === 'hero') {
    // One chart leads, two thirds of the page; the figures stand in a column beside it.
    if (!data.length || !figures.length) return null;
    top(titles, ROW.comfortable.title);
    top(filters, ROW.comfortable.filters);
    const side = figures.slice(0, 4);
    const leadW = snapDown(inner * 0.66);
    const sideW = inner - leadW - GUTTER;
    const each = Math.max(110, snapDown((420 - GUTTER * (side.length - 1)) / side.length));
    const leadH = Math.max(420, side.length * each + GUTTER * (side.length - 1));
    widgets[data[0].i] = { ...widgets[data[0].i], layout: { x: MARGIN, y, w: leadW, h: leadH } };
    side.forEach((it, k) => { widgets[it.i] = { ...widgets[it.i], layout: { x: MARGIN + leadW + GUTTER, y: y + k * (each + GUTTER), w: sideW, h: each } }; });
    y += leadH + GUTTER;
    top(figures.slice(4), ROW.comfortable.summary);
    rest(data.slice(1), 2);
    return widgets;
  }
  if (composition === 'sidebar') {
    // Filters and figures in a column on the left, the charts down the right.
    if (!filters.length && !figures.length) return null;
    top(titles, ROW.comfortable.title);
    let ly = y;
    for (const it of [...filters, ...figures]) {
      const h = Math.max(kindOf(it.type) === 'filters' ? 60 : it.type === 'gauge' ? 200 : 120, it.minSize.h);
      widgets[it.i] = { ...widgets[it.i], layout: { x: MARGIN, y: ly, w: SIDEBAR_W, h } };
      ly += h + GUTTER;
    }
    const x0 = MARGIN + SIDEBAR_W + GUTTER;
    const width = inner - SIDEBAR_W - GUTTER;
    let ry = y;
    for (const it of data) ry = placeBand(widgets, [it], x0, width, ry, high(it)) + GUTTER;
    return widgets;
  }
  if (composition === 'grid') {
    // Everything in equal pairs, tables too: a page of comparable panels.
    top(titles, ROW.comfortable.title);
    top(filters, ROW.comfortable.filters);
    top(figures, ROW.comfortable.summary);
    rest(data, 2, 300);
    return widgets;
  }
  if (composition === 'focus') {
    // One chart across the page, tall; the others in a row of three under it.
    if (!data.length) return null;
    top(titles, ROW.comfortable.title);
    top(filters, ROW.comfortable.filters);
    top(figures, ROW.comfortable.summary);
    y = placeBand(widgets, [data[0]], MARGIN, inner, y, 420) + GUTTER;
    rest(data.slice(1), data.length - 1 >= 3 ? 3 : 2, 260);
    return widgets;
  }
  return null;
}

function layoutNew(proposed, page, effective, composition = 'standard') {
  const dateDims = dateDimsOf(effective);
  // A model can still write the `layout` it was not offered: never kept.
  const widgets = proposed.map(({ layout: _madeUp, ...w }) => w);
  const inner = page.width - 2 * MARGIN;
  const items = widgets.map((w, i) => ({
    i, type: w.type,
    // `shape` is what the page context carries of a filter's look; a new widget has it in its config.
    minSize: floorOf({ type: w.type, title: (w.config && w.config.title) || '', config: w.config || {}, shape: w.config || {}, dataBinding: w.dataBinding || {} }, dateDims, inner),
  }));

  if (items.length > 1 && composition !== 'standard') {
    const composed = composeAs(composition, widgets, items, inner);
    if (composed) return composed;
  }

  if (items.length === 1) {
    const want = ALONE[items[0].type] || ALONE_CHART;
    const size = { w: Math.min(Math.max(want.w, items[0].minSize.w), inner), h: Math.max(want.h, items[0].minSize.h) };
    return [{ ...widgets[0], layout: { x: MARGIN, y: MARGIN, ...size } }];
  }

  // Rows: filters, figures, then the rest in the order proposed — a chart
  // pairs with the next chart, everything else takes a row of its own.
  const byKind = (k) => items.filter((it) => kindOf(it.type) === k);
  const rows = [];
  const chunk = (list, n, kind) => { for (let k = 0; k < list.length; k += n) rows.push({ kind, items: list.slice(k, k + n) }); };
  chunk(byKind('title'), 1, 'title');
  chunk(byKind('filters'), MAX_SUMMARY_PER_ROW, 'filters');
  chunk(byKind('summary'), MAX_SUMMARY_PER_ROW, 'summary');
  let pair = null;
  for (const it of items.filter((x) => !['title', 'filters', 'summary'].includes(kindOf(x.type)))) {
    const kind = kindOf(it.type);
    if (kind === 'chart' || kind === 'gauge') {
      if (pair && pair.items.length < 2 && (pair.kind === 'chart') === (kind === 'chart')) { pair.items.push(it); pair = null; continue; }
      pair = { kind, items: [it] };
      rows.push(pair);
    } else {
      pair = null;
      rows.push({ kind, items: [it] });
    }
  }

  const heightsOf = (scale) => rows.map((row) => Math.max(ROW[scale][row.kind], ...row.items.map((it) => it.minSize.h)));
  const total = (hs) => hs.reduce((a, b) => a + b, 0) + GUTTER * (hs.length - 1) + 2 * MARGIN;
  let heights = heightsOf('comfortable');
  if (total(heights) > page.height) heights = heightsOf('compact');

  let y = MARGIN;
  rows.forEach((row, r) => {
    const n = row.items.length;
    const even = snapDown((inner - GUTTER * (n - 1)) / n);
    const widths = row.items.map((it) => Math.max(Math.min(even, CAP_WIDTH[it.type] || Infinity), it.minSize.w));
    // A row of capped widgets ends where they end; any other row ends flush right.
    const capped = row.items.every((it) => CAP_WIDTH[it.type]);
    if (!capped) widths[n - 1] = Math.max(inner - GUTTER * (n - 1) - widths.slice(0, -1).reduce((a, b) => a + b, 0), row.items[n - 1].minSize.w);
    let x = MARGIN;
    row.items.forEach((it, c) => {
      widgets[it.i] = { ...widgets[it.i], layout: { x, y, w: widths[c], h: heights[r] } };
      x += widths[c] + GUTTER;
    });
    y += heights[r] + GUTTER;
  });
  return widgets;
}

// A widget set into a page on its own takes a comfortable size for its kind,
// never more than the page and never under its floor.
const comfortable = (it, inner) => {
  const want = ALONE[it.type] || ALONE_CHART;
  return {
    w: Math.min(Math.max(Math.min(want.w, CAP_WIDTH[it.type] || Infinity), it.minSize.w), inner),
    h: Math.max(ROW.comfortable[kindOf(it.type)], it.minSize.h),
  };
};
const overlapsY = (a, b) => a.y < b.y + b.h && a.y + a.h > b.y;

/**
 * New widgets set INTO a page that keeps its layout: beside a widget (its
 * row makes room, sharing its width), under or above one (what is below
 * slides down), or at the end of the page. A filter asked "top right" had
 * the whole page laid out again around it (Jonathan): a page the reader
 * knows is worth more than a fresh composition, so nothing moves but what
 * has to.
 *
 * @param {object[]} kept   the page's widgets, sized: { id, type, title, config, shape, dataBinding, layout, minSize }
 * @param {object[]} added  validated proposals, sized: { type, minSize, place?: { near, side } } — `near` an id of
 *                          `kept` or "n<k>" for an earlier addition, `side` right | left | below | above
 * @param {object} page     { width, height }
 * @returns {{ moves: object[], added: object[] }}  moves for the kept widgets that made room, the added with their layout
 */
function insertWidgets(kept, added, page, effective) {
  const inner = page.width - 2 * MARGIN;
  const dateDims = dateDimsOf(effective);
  const needH = (w) => floorExact({ ...w, title: w.title || (w.config && w.config.title) || '', shape: w.shape || w.config || {} }, dateDims).h;
  // The page as it evolves, placed additions included (so a second one can sit beside the first).
  const current = new Map(kept.map((w) => [w.id, { id: w.id, type: w.type, minSize: minOf(w), needH: needH(w), layout: { ...w.layout } }]));
  const bottomOf = () => Math.max(MARGIN - GUTTER, ...[...current.values()].map((c) => c.layout.y + c.layout.h));
  const shiftFrom = (y, by) => { for (const c of current.values()) if (c.layout.y >= y - GRID / 2) c.layout.y += by; };
  const out = [];
  const atEnd = [];

  const beside = (it, target, side) => {
    const row = [...current.values()].filter((c) => overlapsY(c.layout, target.layout)).sort((a, b) => a.layout.x - b.layout.x);
    const left = Math.min(...row.map((c) => c.layout.x));
    const right = Math.max(...row.map((c) => c.layout.x + c.layout.w));
    const size = comfortable(it, inner);
    const h = Math.min(target.layout.h, Math.max(MAX_HEIGHT[it.type] || target.layout.h, it.minSize.h));
    const free = side === 'right' ? MARGIN + inner - right - GUTTER : left - MARGIN - GUTTER;
    // Room at the end of the row: nothing moves.
    if (free >= it.minSize.w) {
      const w = Math.min(size.w, snapDown(free));
      return { x: side === 'right' ? right + GUTTER : left - GUTTER - w, y: target.layout.y, w, h };
    }
    // Else the row shares its span again, each in proportion to what it had.
    const at = row.indexOf(target);
    const cells = row.map((c) => ({ c, weight: c.layout.w, min: c.minSize.w, max: Math.max(maxWidthOf(c), c.minSize.w) }));
    cells.splice(side === 'right' ? at + 1 : at, 0, { c: null, weight: size.w, min: it.minSize.w, max: Math.max(maxWidthOf(it), it.minSize.w) });
    const widths = share(right - left - GUTTER * (cells.length - 1), cells);
    if (!widths) return null;
    let x = left;
    let placed = null;
    cells.forEach((cell, k) => {
      if (cell.c) { cell.c.layout.x = x; cell.c.layout.w = widths[k]; } else placed = { x, y: target.layout.y, w: widths[k], h };
      x += widths[k] + GUTTER;
    });
    return placed;
  };
  const stacked = (it, target, side) => {
    const t = target.layout;
    // Aligned under (or over) its target, as wide as it.
    const w = Math.min(Math.max(t.w, it.minSize.w), inner);
    const h = Math.max(ROW.comfortable[kindOf(it.type)], needH(it));
    if (side === 'below') {
      // Room under the target before the next widget in its column: nothing moves.
      const overlapsX = (c) => c.layout.x < t.x + t.w && c.layout.x + c.layout.w > t.x;
      const next = Math.min(Infinity, ...[...current.values()].filter((c) => c !== target && overlapsX(c) && c.layout.y >= t.y + t.h).map((c) => c.layout.y));
      if (next - (t.y + t.h) - GUTTER >= h) return { x: t.x, y: t.y + t.h + GUTTER, w, h };
      // The target's own box, when it is taller than it needs: the new one
      // takes the bottom of it (a filter asked under a filter in a card that
      // was mostly empty: the page around them stays as it is).
      if (t.h - GUTTER - h >= target.needH) {
        t.h -= GUTTER + h;
        return { x: t.x, y: t.y + t.h + GUTTER, w, h };
      }
    }
    // Else a row of its own, everything from there sliding down.
    const row = [...current.values()].filter((c) => overlapsY(c.layout, t));
    const y = side === 'below' ? Math.max(...row.map((c) => c.layout.y + c.layout.h)) + GUTTER : Math.min(...row.map((c) => c.layout.y));
    shiftFrom(y, h + GUTTER);
    return { x: t.x, y, w, h };
  };

  added.forEach((it, k) => {
    const id = `n${k + 1}`;
    const place = it.place && typeof it.place === 'object' ? it.place : null;
    const target = place ? current.get(String(place.near)) : null;
    let layout = null;
    if (target && (place.side === 'right' || place.side === 'left')) layout = beside(it, target, place.side);
    if (target && !layout) layout = stacked(it, target, place.side === 'above' ? 'above' : 'below');
    if (layout) {
      current.set(id, { id, type: it.type, minSize: it.minSize, needH: needH(it), layout });
      out[k] = { ...it, layout };
    } else {
      atEnd.push(k);
    }
  });
  // The rest, composed together under everything, as on a new page.
  if (atEnd.length) {
    const offset = bottomOf() + GUTTER - MARGIN;
    layoutNew(atEnd.map((k) => added[k]), page).forEach((w, j) => {
      const layout = { ...w.layout, y: w.layout.y + offset };
      out[atEnd[j]] = { ...added[atEnd[j]], layout };
      current.set(`n${atEnd[j] + 1}`, { id: `n${atEnd[j] + 1}`, type: w.type, minSize: added[atEnd[j]].minSize, needH: needH(w), layout });
    });
  }
  const moves = kept
    .filter((w) => ['x', 'y', 'w', 'h'].some((k) => current.get(w.id).layout[k] !== w.layout[k]))
    .map((w) => ({ op: 'move', widgetId: w.id, ...current.get(w.id).layout }));
  return { moves, added: out };
}

/**
 * ONE widget of the page moved next to, under or over another, the page
 * otherwise as it is: the widget leaves its place (the row it empties closes),
 * and is set into the page like an addition (`insertWidgets`). The design
 * tool's answer to "put the filters one above the other": two widgets move,
 * not nine.
 *
 * @param {Map} byId       the page's widgets, sized, by id: { id, type, title, config, shape, dataBinding, layout, minSize }
 * @param {string} widgetId
 * @param {{ near: string, side: string }} place
 * @returns {{ moves: object[], error: string|null }}  moves = [{ op:'move', widgetId, x, y, w, h }]
 */
function placeWidget(byId, widgetId, place, page, effective) {
  const moving = byId.get(widgetId);
  const target = byId.get(place && place.near);
  if (!moving || !moving.layout) return { moves: [], error: 'unknown widget' };
  if (!target || target.id === moving.id) return { moves: [], error: `place: \`near\` must be another widget of this page` };
  const old = moving.layout;
  const kept = [...byId.values()].filter((w) => w.id !== widgetId && w.layout);
  // The row it leaves: closed when it held nothing else.
  const alone = !kept.some((w) => overlapsY(w.layout, old));
  const before = alone
    ? kept.map((w) => (w.layout.y >= old.y + old.h - GRID / 2 ? { ...w, layout: { ...w.layout, y: w.layout.y - old.h - GUTTER } } : w))
    : kept;
  const set = insertWidgets(before, [{ ...moving, place: { near: place.near, side: place.side } }], page, effective);
  const moves = [...set.moves];
  for (const w of before) {
    if (w.layout !== byId.get(w.id).layout && !moves.some((m) => m.widgetId === w.id)) moves.push({ op: 'move', widgetId: w.id, ...w.layout });
  }
  const { x, y, w, h } = set.added[0].layout;
  if (x !== old.x || y !== old.y || w !== old.w || h !== old.h) moves.push({ op: 'move', widgetId, x, y, w, h });
  return { moves, error: null };
}

/** The page height a laid-out set needs: the page's own, or more when the rows run past it. */
function pageHeightOf(widgets, page) {
  const bottom = widgets.reduce((max, w) => (w.layout ? Math.max(max, w.layout.y + w.layout.h) : max), 0);
  return Math.max(page.height, bottom + MARGIN);
}

/**
 * How full the page is, from the readable floor of what is on it: 1 means the
 * visuals would fill the page edge to edge at their smallest readable size.
 * Given to the model as a fact rather than left to its arithmetic — "too many
 * visuals" is the one piece of design advice it cannot act on itself, so it
 * has to be able to say it, and with a number.
 */
function pageLoad(pageContext) {
  // Data visuals only: a text has a floor for the layout, but it is no visual to count.
  const visuals = pageContext.widgets.filter((w) => READABLE_MIN[w.type] && w.type !== 'text');
  const footprint = visuals.reduce((sum, w) => sum + (minOf(w).w + GUTTER) * (minOf(w).h + GUTTER), 0);
  const area = Math.max(1, (pageContext.pageWidth - MARGIN) * (pageContext.pageHeight - MARGIN));
  return { visuals: visuals.length, ratio: Math.round((footprint / area) * 100) / 100 };
}

module.exports = {
  COMPOSITIONS, arrange, layoutNew, insertWidgets, placeWidget, pageHeightOf, pageLoad, floorOf, withFloors, minOf, readableMin, READABLE_MIN, GRID, MARGIN, GUTTER };
