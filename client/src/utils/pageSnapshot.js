import html2canvas from 'html2canvas';

// The page as the reader sees it, as one small JPEG, for the assistant to
// judge its own change (the studio's review turn). Rendered from the live
// DOM: what the user has in front of them, charts included.
//
// `mask`: the instance shares no data values with the AI provider — the
// content of every widget is replaced by stripes, titles kept, so the
// picture shows the layout and the look and not one figure.

// Sharp enough to tell a 13 px title from a 16 px one, a weight from another:
// at 1000 px the designer judged type it could hardly read.
const MAX_WIDTH = 1500;
const QUALITY = 0.8;
const STRIPES = 'repeating-linear-gradient(135deg, rgba(128,128,128,0.18) 0 8px, rgba(128,128,128,0.06) 8px 16px)';
// A capture that has not come back by then never will: a hidden tab paints
// nothing, and the card stayed on "Applying…" for good (seen with Karim).
const CAPTURE_MS = 8000;
const PAINT_MS = 500;

const within = (promise, ms, fallback) => Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(fallback), ms))]);

// Two frames: the browser has painted the latest React commit by the second.
// A hidden tab runs no frame: the wait gives up instead.
export const afterPaint = () => within(new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))), PAINT_MS);

const START_MS = 300;
const LOAD_MS = 15000;
// A chart draws itself for about a second (ECharts' animation), and a restyle
// starts it again — later still when a new font has to load first. Caught
// half way, a line "stopped at the end of August" and bars "came out empty",
// and the review offered to undo a sound change (seen with Karim). So: wait
// until the charts' pixels stop changing, read twice in a row.
const STEP_MS = 250;
const DRAW_MS = 5000;
const MIN_DRAW_MS = 1100;

// A cheap fingerprint of every chart canvas on the page: a sample of its pixels.
function drawn(node) {
  let sum = 0;
  for (const canvas of node?.querySelectorAll('.widget-content canvas') || []) {
    try {
      const { width, height } = canvas;
      if (!width || !height) continue;
      const data = canvas.getContext('2d').getImageData(0, 0, width, height).data;
      for (let i = 3; i < data.length; i += 4 * 97) sum += data[i] + data[i - 1];
    } catch { /* a canvas that cannot be read counts as settled */ }
  }
  return sum;
}

/**
 * Resolves once the page's visuals have their data and have drawn it: no
 * widget left loading (WidgetItem marks its spinner), then the charts' pixels
 * steady. A fetch that never ends gives up after LOAD_MS, a chart that never
 * settles after DRAW_MS.
 */
export async function settled(node) {
  await afterPaint();
  await new Promise((resolve) => setTimeout(resolve, START_MS));
  const loading = () => !!node?.querySelector('[data-widget-loading]');
  const until = Date.now() + LOAD_MS;
  while (loading() && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 150));
  const start = Date.now();
  let last = drawn(node);
  let steady = 0;
  while (Date.now() - start < DRAW_MS) {
    await new Promise((resolve) => setTimeout(resolve, STEP_MS));
    const now = drawn(node);
    steady = now === last ? steady + 1 : 0;
    last = now;
    if (steady >= 2 && Date.now() - start >= MIN_DRAW_MS) return;
  }
}

function maskValues(clonedRoot) {
  for (const el of clonedRoot.querySelectorAll('.widget-content')) {
    el.replaceChildren();
    el.style.background = STRIPES;
    el.style.minHeight = '24px';
  }
}

// The page and its menu side by side, as the reader sees them: the menu
// captured on its own (the page scrolls, the area around it would cut it)
// and set where it shows — a bar above, a column left or right. The designer
// set the menu and said it could not see it (Maison Gaspard).
// Where the menu shows against the page, read on screen: above, right or left.
function sideOf(nav, node) {
  const a = nav.getBoundingClientRect();
  const b = node.getBoundingClientRect();
  // Across the page's width: a bar (the page may be scrolled under it, so not its top).
  if (a.left < b.right - 1 && a.right > b.left + 1) return 'top';
  return a.left >= b.right - 1 ? 'right' : 'left';
}

function besideMenu(page, menu, position) {
  if (!menu) return page;
  const top = position === 'top';
  const canvas = document.createElement('canvas');
  canvas.width = top ? Math.max(page.width, menu.width) : page.width + menu.width;
  canvas.height = top ? page.height + menu.height : Math.max(page.height, menu.height);
  const ctx = canvas.getContext('2d');
  if (top) { ctx.drawImage(menu, 0, 0); ctx.drawImage(page, 0, menu.height); }
  else if (position === 'right') { ctx.drawImage(page, 0, 0); ctx.drawImage(menu, page.width, 0); }
  else { ctx.drawImage(menu, 0, 0); ctx.drawImage(page, menu.width, 0); }
  return canvas;
}

/**
 * @param {HTMLElement} node   the page element
 * @param {{ mask?: boolean, nav?: HTMLElement, width?: number }} options  `nav`: the page menu, drawn beside the page where it shows;
 *   `width`: drawn at that width from the start (a thumbnail costs a fraction of a full capture — a sheet of
 *   five pages at full size froze the tab)
 * @returns {Promise<{ mediaType: string, data: string } | null>}  base64 JPEG, or null when the capture failed
 */
export async function snapshotPage(node, { mask = false, nav = null, width = MAX_WIDTH } = {}) {
  // Not on screen: no picture, so no review — the change itself goes on.
  if (!node || document.hidden) return null;
  try {
    const scale = Math.min(1, width / Math.max(1, node.scrollWidth + (nav ? nav.scrollWidth : 0)));
    const shot = (el, masked) => within(html2canvas(el, {
      scale, useCORS: true, backgroundColor: null, logging: false,
      onclone: (_doc, clonedRoot) => { if (masked) maskValues(clonedRoot); },
    }), CAPTURE_MS, null);
    const page = await shot(node, mask);
    if (!page) return null;
    // A menu that will not draw leaves the page alone: the review still happens.
    let menu = null;
    if (nav) { try { menu = await shot(nav, false); } catch { /* no menu in the picture */ } }
    const full = besideMenu(page, menu, menu ? sideOf(nav, node) : null);
    const ratio = Math.min(1, width / Math.max(1, full.width));
    let canvas = full;
    if (ratio < 1) {
      canvas = document.createElement('canvas');
      canvas.width = Math.round(full.width * ratio);
      canvas.height = Math.round(full.height * ratio);
      canvas.getContext('2d').drawImage(full, 0, 0, canvas.width, canvas.height);
    }
    const url = canvas.toDataURL('image/jpeg', QUALITY);
    const data = url.slice(url.indexOf(',') + 1);
    return data ? { mediaType: 'image/jpeg', data } : null;
  } catch {
    return null; // a tainted canvas or an unsupported style: the review simply does not happen
  }
}

const SHEET_WIDTH = 1500;
const SHEET_GAP = 16;
const loadImage = (shot) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = reject;
  img.src = `data:${shot.mediaType};base64,${shot.data}`;
});

/**
 * Every page of the report in small, side by side, for a review of a change
 * that reached several pages: the designer saw one page and could not tell
 * that the report, taken whole, read flat or repeated itself.
 * @param {{ mediaType: string, data: string }[]} shots  one capture per page, in order
 * @returns {Promise<{ mediaType: string, data: string } | null>}
 */
export async function contactSheet(shots) {
  try {
    const images = await Promise.all(shots.filter(Boolean).map(loadImage));
    if (images.length < 2) return null;
    const cols = images.length <= 4 ? 2 : 3;
    const cell = Math.floor((SHEET_WIDTH - SHEET_GAP * (cols + 1)) / cols);
    const heights = images.map((img) => Math.round(img.height * (cell / img.width)));
    const rows = Math.ceil(images.length / cols);
    const rowHeight = (r) => Math.max(...heights.slice(r * cols, r * cols + cols));
    const canvas = document.createElement('canvas');
    canvas.width = SHEET_WIDTH;
    canvas.height = SHEET_GAP + Array.from({ length: rows }, (_, r) => rowHeight(r) + SHEET_GAP).reduce((a, b) => a + b, 0);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#9ca3af';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    let y = SHEET_GAP;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const k = r * cols + c;
        if (k >= images.length) break;
        ctx.drawImage(images[k], SHEET_GAP + c * (cell + SHEET_GAP), y, cell, heights[k]);
      }
      y += rowHeight(r) + SHEET_GAP;
    }
    const url = canvas.toDataURL('image/jpeg', QUALITY);
    const data = url.slice(url.indexOf(',') + 1);
    return data ? { mediaType: 'image/jpeg', data } : null;
  } catch {
    return null; // no sheet: the review goes on with the page alone
  }
}
