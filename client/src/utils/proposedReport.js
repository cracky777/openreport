import { v4 as uuidv4 } from 'uuid';
import { withMeasureFormats } from './aiProposal';
import { withFilterSync } from './syncedSlicers';

// A whole report proposed by the assistant (kind 'report': pages of widgets
// the server validated and laid out), as the bundle /reports/import takes —
// the same document a .pbit import or the Finance package hands over, so the
// report is created by the user's own rights on the usual route.
export const PAGE = { width: 1140, height: 800 };

export function bundleFromProposal(proposal, makeId = uuidv4, pageIdOf = (i) => `page-${i + 1}`) {
  const made = (proposal.pages || []).map((p, i) => {
    const layout = [];
    const widgets = {};
    (p.widgets || []).forEach((w, j) => {
      const id = makeId();
      const box = w.layout || { x: 20, y: 20 + j * 320, w: PAGE.width - 40, h: 300 };
      layout.push({ i: id, x: box.x, y: box.y, w: box.w, h: box.h, z: j + 1 });
      widgets[id] = { type: w.type, data: w.data ? { ...w.data } : {}, dataBinding: { ...(w.dataBinding || {}) }, config: { ...(w.config || {}) } };
    });
    return { id: pageIdOf(i), name: p.name || `Page ${i + 1}`, layout, widgets };
  });
  // Filters synced across the report's pages as the card said (server
  // utils/ai/filterSync.js): pages named by their rank in the proposal.
  const pages = withFilterSync(made, (proposal.filterSync || []).filter((d) => d.synced).map((d) => ({
    dim: d.dim,
    page: made[d.page]?.id,
    pages: (d.pages || []).map((i) => made[i]?.id).filter(Boolean),
  })));
  return {
    format: 'open-report.report.v1',
    report: {
      title: proposal.title || 'Report',
      layout: pages[0]?.layout || [],
      widgets: pages[0]?.widgets || {},
      pages,
      // As tall as its tallest page asks (server pageHeightOf): rows at a readable height, not squeezed into one screen.
      // The measures the pages need ride with the report (the studio puts them on the model instead, when it may).
      settings: {
        pageWidth: PAGE.width, pageHeight: Math.max(PAGE.height, Number(proposal.pageHeight) || 0),
        ...withMeasureFormats({}, proposal),
        ...(Array.isArray(proposal.measures) && proposal.measures.length ? { extraMeasures: proposal.measures } : {}),
      },
    },
  };
}

/** The proposal's pages in the report document's own shape, ids fresh. */
export function pagesFromProposal(proposal, makeId = uuidv4) {
  const ids = (proposal.pages || []).map(() => `page-${makeId()}`);
  return bundleFromProposal(proposal, makeId, (i) => ids[i]).report.pages;
}
