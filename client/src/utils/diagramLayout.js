// Where the tables of a model sit on its diagram (SchemaCanvas). Tables were
// laid side by side three to a row whatever joined them, and a model built
// for the user read as a tangle (Jonathan). Laid out by its joins instead:
//
//   · the facts in the middle column, one under the other;
//   · each fact's dimensions beside it, left and right, the sides balanced;
//   · a dimension several facts share, on the lighter side, at the height of
//     those facts together;
//   · the tables a dimension leads to (a snowflake), one column further out on
//     its side;
//   · tables joined to nothing, in a row under everything.
//
// Heights are the canvas's own (a card shows 8 columns, then a toggle), so no
// two cards overlap. Pure: the positions come back, roles kept by the caller.

export const TABLE_WIDTH = 220;
const COLUMN_GAP = 110;
const ROW_GAP = 40;
// Below the canvas's floating toolbar (Detect relationships, Arrange tables…).
const ORIGIN = { x: 40, y: 80 };
const VISIBLE_ROWS = 8;
const STEP = TABLE_WIDTH + COLUMN_GAP;

/** The height SchemaCanvas gives a table of this many columns (collapsed past 8). */
export function tableHeight(columnCount) {
  const n = Math.max(0, Number(columnCount) || 0);
  return 44 + 20 + Math.min(n, VISIBLE_ROWS) * 24 + (n > VISIBLE_ROWS ? 24 : 0) + 4;
}

function neighboursOf(tables, joins) {
  const out = new Map(tables.map((t) => [t, new Set()]));
  for (const j of joins || []) {
    if (!out.has(j.from_table) || !out.has(j.to_table) || j.from_table === j.to_table) continue;
    out.get(j.from_table).add(j.to_table);
    out.get(j.to_table).add(j.from_table);
  }
  return out;
}

// The facts: those the model says are facts; else the tables that only ever
// sit on the many side of their joins; else the most joined one.
function factsOf(tables, joins, roles, near) {
  const declared = tables.filter((t) => roles[t] === 'fact');
  if (declared.length) return declared;
  const from = new Set((joins || []).map((j) => j.from_table));
  const to = new Set((joins || []).map((j) => j.to_table));
  const many = tables.filter((t) => from.has(t) && !to.has(t) && roles[t] !== 'dimension');
  if (many.length) return many;
  const joined = tables.filter((t) => near.get(t).size);
  if (!joined.length) return [];
  return [joined.slice().sort((a, b) => near.get(b).size - near.get(a).size)[0]];
}

/**
 * @param {string[]} tables
 * @param {object[]} joins     { from_table, to_table }
 * @param {object} roles       { table: 'fact' | 'dimension' }
 * @param {function} columnCount  (table) → its number of columns
 * @returns {object} { table: { x, y } }
 */
export function arrangeDiagram(tables, joins = [], roles = {}, columnCount = () => VISIBLE_ROWS) {
  const near = neighboursOf(tables, joins);
  const h = (t) => tableHeight(columnCount(t));
  const facts = factsOf(tables, joins, roles, near);
  const factSet = new Set(facts);
  const columns = new Map(); // column index → boxes { y, h }
  const positions = {};
  const xOf = (c) => ORIGIN.x + (c + 2) * STEP;
  // The first height at or under `wanted` where the column has room.
  const put = (t, c, wanted) => {
    const boxes = columns.get(c) || [];
    let y = Math.max(ORIGIN.y, Math.round(wanted));
    for (const b of [...boxes].sort((a, z) => a.y - z.y)) {
      if (y < b.y + b.h + ROW_GAP && y + h(t) + ROW_GAP > b.y) y = b.y + b.h + ROW_GAP;
    }
    boxes.push({ y, h: h(t) });
    columns.set(c, boxes);
    positions[t] = { x: xOf(c), y };
    return y;
  };
  const columnHeight = (c) => (columns.get(c) || []).reduce((s, b) => s + b.h + ROW_GAP, 0);
  const sideOf = {};

  // Facts, each with the dimensions it alone reaches, beside it.
  const shared = [];
  let nextFactY = ORIGIN.y;
  for (const f of facts) {
    const y = put(f, 0, nextFactY);
    const own = [...near.get(f)].filter((d) => !factSet.has(d) && !positions[d]);
    let bottom = y + h(f);
    for (const d of own) {
      const factsOfD = [...near.get(d)].filter((x) => factSet.has(x));
      if (factsOfD.length > 1) { if (!shared.includes(d)) shared.push(d); continue; }
      const side = columnHeight(-1) <= columnHeight(1) ? -1 : 1;
      sideOf[d] = side;
      const dy = put(d, side, y);
      bottom = Math.max(bottom, dy + h(d));
    }
    nextFactY = bottom + ROW_GAP * 2;
  }
  // Shared dimensions, at the middle of the facts they join.
  for (const d of shared) {
    const ys = [...near.get(d)].filter((x) => factSet.has(x)).map((x) => positions[x].y + h(x) / 2);
    const side = columnHeight(-1) <= columnHeight(1) ? -1 : 1;
    sideOf[d] = side;
    put(d, side, ys.reduce((a, b) => a + b, 0) / ys.length - h(d) / 2);
  }
  // Further out, ring by ring: what the placed tables lead to.
  let ring = Object.keys(sideOf);
  while (ring.length) {
    const next = [];
    for (const p of ring) {
      for (const t of near.get(p)) {
        if (positions[t] || factSet.has(t)) continue;
        const side = sideOf[p] || (columnHeight(-1) <= columnHeight(1) ? -1 : 1);
        const c = Math.max(-2, Math.min(2, (Object.prototype.hasOwnProperty.call(sideOf, p) ? Math.sign(sideOf[p]) * (Math.abs(sideOf[p]) + 1) : side)));
        sideOf[t] = c;
        put(t, c, positions[p].y);
        next.push(t);
      }
    }
    ring = next;
  }
  // A joined group with no fact (two lookups joined together): its first table in the middle.
  for (const t of tables) {
    if (positions[t] || !near.get(t).size) continue;
    put(t, 0, nextFactY);
    sideOf[t] = 0;
    for (const u of near.get(t)) {
      if (positions[u]) continue;
      const side = columnHeight(-1) <= columnHeight(1) ? -1 : 1;
      sideOf[u] = side;
      put(u, side, positions[t].y);
    }
    nextFactY = Math.max(...[...columns.values()].flat().map((b) => b.y + b.h)) + ROW_GAP * 2;
  }
  // Joined to nothing: a row under everything.
  const lone = tables.filter((t) => !positions[t]);
  const floor = Math.max(ORIGIN.y, ...[...columns.values()].flat().map((b) => b.y + b.h + ROW_GAP * 2));
  let rowTop = floor;
  let rowHeight = 0;
  lone.forEach((t, i) => {
    const col = i % 5;
    if (col === 0 && i) { rowTop += rowHeight + ROW_GAP; rowHeight = 0; }
    positions[t] = { x: ORIGIN.x + col * STEP, y: rowTop };
    rowHeight = Math.max(rowHeight, h(t));
  });

  // The leftmost column at the origin: no empty band when nothing went far left.
  const minX = Math.min(...Object.values(positions).map((p) => p.x));
  if (Number.isFinite(minX) && minX > ORIGIN.x) for (const p of Object.values(positions)) p.x -= minX - ORIGIN.x;
  return positions;
}

/**
 * Positions for a model's tables: all of them laid out by their joins when
 * the diagram is new (no table placed yet, or one), or when `all` is asked;
 * otherwise only the tables without a place, beside a table they join where
 * there is room — a diagram the author arranged keeps its arrangement.
 * Roles (`tableType`) are kept.
 */
export function layoutPositions(current, tables, joins, columnCount, { all = false } = {}) {
  const placed = tables.filter((t) => current?.[t] && typeof current[t].x === 'number');
  const roles = Object.fromEntries(tables.map((t) => [t, current?.[t]?.tableType]).filter(([, r]) => r));
  const keep = (t, p) => ({ ...(current?.[t] || {}), x: p.x, y: p.y });
  if (all || placed.length <= 1) {
    const laid = arrangeDiagram(tables, joins, roles, columnCount);
    return { ...(current || {}), ...Object.fromEntries(tables.map((t) => [t, keep(t, laid[t])])) };
  }
  const next = { ...current };
  const near = neighboursOf(tables, joins);
  const h = (t) => tableHeight(columnCount(t));
  const boxes = placed.map((t) => ({ x: next[t].x, y: next[t].y, w: TABLE_WIDTH, h: h(t) }));
  const clear = (b) => boxes.every((o) => b.x >= o.x + o.w + 40 || o.x >= b.x + b.w + 40 || b.y >= o.y + o.h + 40 || o.y >= b.y + b.h + 40);
  for (const t of tables.filter((x) => !placed.includes(x))) {
    const anchor = [...near.get(t)].find((u) => next[u] && typeof next[u].x === 'number');
    const startX = anchor ? next[anchor].x : ORIGIN.x;
    const startY = anchor ? next[anchor].y : Math.max(ORIGIN.y, ...boxes.map((b) => b.y + b.h + ROW_GAP));
    let spot = null;
    // Beside its anchor, right then left, moving down until there is room.
    for (let dy = 0; !spot && dy < 4000; dy += 20) {
      for (const dx of anchor ? [STEP, -STEP, 2 * STEP, -2 * STEP] : [0]) {
        const b = { x: Math.max(ORIGIN.x, startX + dx), y: startY + dy, w: TABLE_WIDTH, h: h(t) };
        if (clear(b)) { spot = b; break; }
      }
    }
    spot = spot || { x: ORIGIN.x, y: startY, w: TABLE_WIDTH, h: h(t) };
    boxes.push(spot);
    next[t] = keep(t, spot);
  }
  return next;
}
