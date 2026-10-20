import { describe, it, expect } from 'vitest';
import { applyReportChanges, describeProposal } from './aiProposal';

// A change of the report as a whole (kind 'reportChanges'), applied page by
// page as one new list of pages: visuals removed, replaced in their slot with
// their frame kept, moved where the server laid them, added where it placed
// them; pages added, renamed, removed — never the last one.
const TYPES = { bar: { defaultSize: { w: 20, h: 15 } }, line: { defaultSize: { w: 20, h: 15 } }, scorecard: { defaultSize: { w: 10, h: 6 } }, table: { defaultSize: { w: 30, h: 15 } } };
const model = { dimensions: [{ name: 'orders.country' }, { name: 'orders.day' }], measures: [{ name: 'orders.amount_sum' }] };
const bar = { type: 'bar', config: { title: 'Bar' }, dataBinding: { selectedDimensions: ['orders.country'], selectedMeasures: ['orders.amount_sum'] } };
const line = { type: 'line', config: { title: 'Line' }, dataBinding: { selectedDimensions: ['orders.day'], selectedMeasures: ['orders.amount_sum'] } };
const pagesOf = () => [
  {
    id: 'page-a', name: 'Overview',
    layout: [{ i: 'a1', x: 20, y: 20, w: 280, h: 120, z: 1 }, { i: 'a2', x: 20, y: 160, w: 1100, h: 300, z: 2 }],
    widgets: {
      a1: { type: 'scorecard', config: { title: 'Total', backgroundColor: '#112233', borderRadius: 12, color: '#ff0000' }, dataBinding: { selectedMeasures: ['orders.amount_sum'] } },
      a2: { type: 'bar', config: { title: 'By country' }, dataBinding: { selectedDimensions: ['orders.country'], selectedMeasures: ['orders.amount_sum'] } },
    },
  },
  { id: 'page-b', name: 'Detail', layout: [{ i: 'b1', x: 20, y: 20, w: 600, h: 300, z: 1 }], widgets: { b1: { type: 'table', config: { title: 'Rows' }, dataBinding: { selectedDimensions: ['orders.country'] } } } },
];
const ctx = { pages: pagesOf(), currentIdx: 0, pageWidth: 1140, pageHeight: 800, effectiveModel: model, widgetTypes: TYPES };
let n = 0;
const makeId = () => `id-${n += 1}`;

describe('applyReportChanges', () => {
  it('replaces in the slot with the frame kept, removes, moves and adds where the server placed', () => {
    const proposal = {
      kind: 'reportChanges', summary: 's', pageHeight: 800,
      pages: [{
        shown: true, pageId: 'page-a', isNew: false, name: 'Overview', rename: 'Home', remove: false,
        replace: [{ widgetId: 'a1', widget: { ...line, config: { title: 'Trend', color: '#00ff00' } } }],
        removeWidgets: ['a2'],
        moves: [{ op: 'move', widgetId: 'a1', x: 20, y: 20, w: 1100, h: 300 }],
        add: [{ ...bar, layout: { x: 20, y: 340, w: 540, h: 300 } }],
      }],
    };
    const r = applyReportChanges(proposal, ctx, makeId);
    expect(r.error).toBeUndefined();
    const [p] = r.pages;
    expect(p.name).toBe('Home');
    expect(Object.keys(p.widgets)).toHaveLength(2);
    // The old scorecard's slot and frame, the new line's look and data.
    expect(p.widgets.a1).toMatchObject({ type: 'line', config: { title: 'Trend', color: '#00ff00', backgroundColor: '#112233', borderRadius: 12 }, dataBinding: line.dataBinding });
    expect(p.layout.find((it) => it.i === 'a1')).toMatchObject({ x: 20, y: 20, w: 1100, h: 300 });
    expect(p.widgets.a2).toBeUndefined();
    const added = p.layout.find((it) => it.i !== 'a1');
    expect(added).toMatchObject({ x: 20, y: 340, w: 540, h: 300 });
    expect(p.widgets[added.i]).toMatchObject({ type: 'bar', data: {} });
    expect(r.pages[1]).toEqual(pagesOf()[1]);
    expect(r).toMatchObject({ applied: 5, skipped: 0 });
  });

  it('adds a page after the last, removes a page, never the last one, and counts what no longer fits', () => {
    const proposal = {
      kind: 'reportChanges', summary: 's',
      pages: [
        { shown: false, pageId: null, isNew: true, name: 'Trends', rename: null, remove: false, replace: [], removeWidgets: [], moves: [], add: [{ ...line, layout: { x: 20, y: 20, w: 1100, h: 300 } }] },
        { shown: false, pageId: 'page-b', isNew: false, name: 'Detail', rename: null, remove: true, replace: [], removeWidgets: [], moves: [], add: [] },
        { shown: false, pageId: 'page-gone', isNew: false, name: 'Gone', rename: null, remove: false, replace: [], removeWidgets: ['x'], moves: [], add: [] },
      ],
    };
    const r = applyReportChanges(proposal, ctx, makeId);
    expect(r.pages.map((p) => p.name)).toEqual(['Overview', 'Trends']);
    expect(r.pages[1].id).toMatch(/^page-id-/);
    expect(Object.values(r.pages[1].widgets)[0]).toMatchObject({ type: 'line' });
    expect(r).toMatchObject({ applied: 2, skipped: 1 });

    const everyPage = { kind: 'reportChanges', pages: [
      { shown: true, pageId: 'page-a', isNew: false, remove: true, replace: [], removeWidgets: [], moves: [], add: [] },
      { shown: false, pageId: 'page-b', isNew: false, remove: true, replace: [], removeWidgets: [], moves: [], add: [] },
    ] };
    const kept = applyReportChanges(everyPage, ctx, makeId);
    expect(kept.pages).toHaveLength(2);
    expect(kept).toMatchObject({ applied: 0, skipped: 2 });
  });

  it('a rename reaches the text widgets that carry the old title', () => {
    const pages = [{ id: 'page-a', name: 'Overview', layout: [{ i: 't1', x: 20, y: 20, w: 600, h: 48, z: 1 }], widgets: { t1: { type: 'text', data: { text: 'Old title' }, config: {} } } }];
    const proposal = { kind: 'reportChanges', title: 'Maison Verdier', pages: [] };
    const r = applyReportChanges(proposal, { ...ctx, pages, title: 'Old title' }, makeId);
    expect(r.pages[0].widgets.t1.data.text).toBe('Maison Verdier');
    expect(applyReportChanges(proposal, { ...ctx, pages, title: 'Another' }, makeId).pages[0].widgets.t1.data.text).toBe('Old title');
  });

  it('refuses a visual on a field the model no longer has', () => {
    const proposal = { kind: 'reportChanges', pages: [{ shown: true, pageId: 'page-a', isNew: false, replace: [], removeWidgets: [], moves: [], add: [{ ...bar, dataBinding: { selectedDimensions: ['orders.nope'] } }] }] };
    expect(applyReportChanges(proposal, ctx, makeId)).toEqual({ error: "Not in this report's model: orders.nope" });
  });

  it('is told back to the assistant in one line', () => {
    const proposal = { kind: 'reportChanges', summary: 'Reworked.', pages: [
      { isNew: false, name: 'Overview', rename: 'Home', remove: false, add: [bar], replace: [{ widgetId: 'a1', widget: line }], removeWidgets: ['a2'], moves: [{}], laidOut: true },
      { isNew: true, name: 'Trends', add: [], replace: [], removeWidgets: [], moves: [] },
      { isNew: false, name: 'Detail', remove: true },
    ] };
    expect(describeProposal(proposal, 'applied')).toBe('[Proposed changes to the report — applied by the user: Reworked. page "Overview": renamed "Home", added "Bar", replaced 1 by "Line", removed 1, laid out again; new page "Trends": ; page "Detail": removed]');
  });
});
