import { describe, it, expect } from 'vitest';
import { bundleFromProposal } from './proposedReport';

describe('bundleFromProposal', () => {
  it('turns the pages into the import document, the first page mirrored at the root', () => {
    let n = 0;
    const id = () => `w${++n}`;
    const proposal = {
      kind: 'report', title: 'Shop report',
      pages: [
        { name: 'Overview', widgets: [{ type: 'scorecard', config: { title: 'Revenue' }, dataBinding: { selectedMeasures: ['m'] }, layout: { x: 20, y: 20, w: 260, h: 110 }, rationale: 'r' }] },
        { name: 'Products', widgets: [{ type: 'bar', config: { title: 'Top' }, dataBinding: { selectedDimensions: ['d'], selectedMeasures: ['m'] } }] },
      ],
    };
    const b = bundleFromProposal(proposal, id);
    expect(b.format).toBe('open-report.report.v1');
    expect(b.report.title).toBe('Shop report');
    expect(b.report.pages.map((p) => p.name)).toEqual(['Overview', 'Products']);
    expect(b.report.pages[0].layout).toEqual([{ i: 'w1', x: 20, y: 20, w: 260, h: 110, z: 1 }]);
    expect(b.report.pages[0].widgets.w1).toEqual({ type: 'scorecard', data: {}, dataBinding: { selectedMeasures: ['m'] }, config: { title: 'Revenue' } });
    expect(b.report.layout).toBe(b.report.pages[0].layout);
    // A widget the server could not place still gets a box.
    expect(b.report.pages[1].layout[0]).toMatchObject({ i: 'w2', x: 20, y: 20, w: 1100, h: 300 });
    expect(b.report.settings).toEqual({ pageWidth: 1140, pageHeight: 800 });
    expect(bundleFromProposal({ ...proposal, pageHeight: 1060 }, id).report.settings.pageHeight).toBe(1060);
  });
});
