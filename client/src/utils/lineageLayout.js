// Where a field comes from, laid out to be read top to bottom: the sources at
// the top, the field at the bottom, one row per step — so the path fits a chat
// panel with its card beside it (a horizontal path of five steps ran off the
// panel, the field out of sight). A table that feeds the path at two depths
// takes the deeper one (its longest way to the field), so every edge points
// down. In a row, nodes follow the order of what they feed, so edges cross as
// little as they can. The gap between rows holds the label of the job.

export const BOX = { w: 200, h: 52, colGap: 16, rowGap: 48, pad: 12 };

/**
 * @param {{ nodes: { id: string, kind: string }[], edges: { from: string, to: string }[] }} graph
 * @returns {{ nodes: object[], edges: object[], width: number, height: number }}
 */
export function lineageLayout(graph, box = BOX) {
  const nodes = (graph && graph.nodes) || [];
  const ids = new Set(nodes.map((n) => n.id));
  const edges = ((graph && graph.edges) || []).filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to);
  const field = nodes.find((n) => n.kind === 'field') || nodes[0];
  if (!field) return { nodes: [], edges: [], width: 0, height: 0 };

  // Longest distance to the field; bounded by the node count, so a cycle in
  // the catalog cannot loop forever.
  const depth = new Map([[field.id, 0]]);
  for (let i = 0; i < nodes.length; i++) {
    let moved = false;
    for (const e of edges) {
      if (!depth.has(e.to)) continue;
      const d = depth.get(e.to) + 1;
      if (d < nodes.length && d > (depth.get(e.from) ?? -1)) { depth.set(e.from, d); moved = true; }
    }
    if (!moved) break;
  }
  nodes.forEach((n) => { if (!depth.has(n.id)) depth.set(n.id, 1); });
  const maxDepth = Math.max(...depth.values());

  const rows = Array.from({ length: maxDepth + 1 }, () => []);
  nodes.forEach((n) => rows[maxDepth - depth.get(n.id)].push(n));
  const rank = new Map(rows[maxDepth].map((n, i) => [n.id, i]));
  for (let r = maxDepth - 1; r >= 0; r--) {
    const weight = (n) => {
      const fed = edges.filter((e) => e.from === n.id && rank.has(e.to)).map((e) => rank.get(e.to));
      return fed.length ? fed.reduce((a, b) => a + b, 0) / fed.length : Infinity;
    };
    rows[r] = rows[r].map((n, i) => ({ n, i, w: weight(n) })).sort((a, b) => a.w - b.w || a.i - b.i).map((x) => x.n);
    rows[r].forEach((n, i) => rank.set(n.id, i));
  }

  const widest = Math.max(...rows.map((row) => row.length));
  const rowWidth = (k) => k * box.w + (k - 1) * box.colGap;
  const placed = new Map();
  rows.forEach((row, r) => {
    const left = box.pad + (rowWidth(widest) - rowWidth(row.length)) / 2;
    row.forEach((n, i) => placed.set(n.id, { ...n, x: left + i * (box.w + box.colGap), y: box.pad + r * (box.h + box.rowGap), w: box.w, h: box.h }));
  });

  const laidEdges = edges.map((e) => {
    const a = placed.get(e.from);
    const b = placed.get(e.to);
    const x1 = a.x + a.w / 2;
    const y1 = a.y + a.h;
    const x2 = b.x + b.w / 2;
    const y2 = b.y;
    const bend = Math.max(box.rowGap / 2, (y2 - y1) / 2);
    return { ...e, path: `M${x1},${y1} C${x1},${y1 + bend} ${x2},${y2 - bend} ${x2},${y2}`, mid: { x: (x1 + x2) / 2, y: (y1 + y2) / 2 } };
  });

  return {
    nodes: [...placed.values()],
    edges: laidEdges,
    width: box.pad * 2 + rowWidth(widest),
    height: box.pad * 2 + (maxDepth + 1) * box.h + maxDepth * box.rowGap,
  };
}
