import { describe, it, expect } from 'vitest';
import { lineageLayout, BOX } from './lineageLayout';

const node = (id, kind = 'entity') => ({ id, kind });
const at = (layout, id) => layout.nodes.find((n) => n.id === id);

describe('lineageLayout', () => {
  // The Nyukom path: API export → rawdata → staging → warehouse → the field.
  it('reads top to bottom, sources first, the field last', () => {
    const graph = {
      nodes: [node('field:x', 'field'), node('dwh'), node('staging'), node('raw'), node('api')],
      edges: [{ from: 'dwh', to: 'field:x' }, { from: 'staging', to: 'dwh' }, { from: 'raw', to: 'staging' }, { from: 'api', to: 'raw' }],
    };
    const out = lineageLayout(graph);
    const ys = ['api', 'raw', 'staging', 'dwh', 'field:x'].map((id) => at(out, id).y);
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
    expect(new Set(ys).size).toBe(5);
    // One box wide: it fits a chat panel.
    expect(out.width).toBe(BOX.pad * 2 + BOX.w);
    expect(out.height).toBe(BOX.pad * 2 + 5 * BOX.h + 4 * BOX.rowGap);
    // Each edge leaves the bottom of its source and ends on the top of its target.
    const e = out.edges.find((x) => x.from === 'dwh');
    const dwh = at(out, 'dwh');
    const f = at(out, 'field:x');
    expect(e.path.startsWith(`M${dwh.x + BOX.w / 2},${dwh.y + BOX.h} `)).toBe(true);
    expect(e.path.endsWith(` ${f.x + BOX.w / 2},${f.y}`)).toBe(true);
  });

  it('a table feeding the path at two depths sits at the deeper one, so no edge points up', () => {
    const graph = {
      nodes: [node('f', 'field'), node('fact'), node('stg'), node('dim')],
      edges: [{ from: 'fact', to: 'f' }, { from: 'stg', to: 'fact' }, { from: 'dim', to: 'fact' }, { from: 'dim', to: 'stg' }],
    };
    const out = lineageLayout(graph);
    for (const e of out.edges) expect(at(out, e.from).y).toBeLessThan(at(out, e.to).y);
  });

  it('a row follows the order of what it feeds, and a cycle in the catalog ends', () => {
    const graph = {
      nodes: [node('f', 'field'), node('a'), node('b'), node('srcB'), node('srcA')],
      edges: [{ from: 'a', to: 'f' }, { from: 'b', to: 'f' }, { from: 'srcA', to: 'a' }, { from: 'srcB', to: 'b' }, { from: 'a', to: 'srcA' }],
    };
    expect(lineageLayout(graph).nodes).toHaveLength(5);
    const simple = lineageLayout({ nodes: graph.nodes, edges: graph.edges.slice(0, 4) });
    expect(at(simple, 'srcA').x).toBeLessThan(at(simple, 'srcB').x);
  });

  it('nothing to draw without nodes', () => {
    expect(lineageLayout({ nodes: [], edges: [] })).toEqual({ nodes: [], edges: [], width: 0, height: 0 });
  });
});
