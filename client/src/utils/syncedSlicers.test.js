import { describe, it, expect } from 'vitest';
import { syncGroups, sharedSelections, withSelection, withPageSelections, syncedFilters, alignedWidgets, withFilterSync, syncDecisionLine } from './syncedSlicers';

const slicer = (dim, extra = {}) => ({ type: 'filter', dataBinding: { selectedDimensions: [dim] }, config: { ...extra } });
const bar = { type: 'bar', dataBinding: { selectedDimensions: ['region'], selectedMeasures: ['sales'] }, config: {} };

// Overview syncs its region slicer with Detail; Trends has its own region slicer, not synced.
const pages = () => [
  { id: 'p-overview', name: 'Overview', widgets: { s1: slicer('region', { syncPages: ['p-detail'], selectedValues: ['North'] }), b1: bar } },
  { id: 'p-detail', name: 'Detail', widgets: { b2: bar } },
  { id: 'p-trends', name: 'Trends', widgets: { s3: slicer('region', { selectedValues: ['South'] }), b3: bar } },
];

describe('syncedSlicers', () => {
  it('applies a selection to the page it is synced with', () => {
    const groups = syncGroups(pages());
    const shared = sharedSelections(groups, pages());
    expect(syncedFilters({}, groups, 'p-detail', shared)).toEqual({ region: ['North'] });
  });

  it('leaves a page that is not in the sync list untouched', () => {
    const groups = syncGroups(pages());
    const shared = withSelection(sharedSelections(groups, pages()), groups, 'p-overview', 'region', ['East']);
    const own = { region: ['South'] };
    expect(groups['p-trends']).toBeUndefined();
    expect(syncedFilters(own, groups, 'p-trends', shared)).toBe(own);
  });

  it('goes both ways: the synced page changes the selection of the page that listed it', () => {
    const list = pages();
    list[1].widgets.s2 = slicer('region');
    const groups = syncGroups(list);
    expect(groups['p-detail'].region).toBe(groups['p-overview'].region);
    const shared = withSelection(sharedSelections(groups, list), groups, 'p-detail', 'region', ['West']);
    expect(syncedFilters({ region: ['North'] }, groups, 'p-overview', shared)).toEqual({ region: ['West'] });
    expect(alignedWidgets(list[0].widgets, groups, 'p-overview', shared).s1.config.selectedValues).toEqual(['West']);
  });

  it('ignores a page that was removed', () => {
    const list = pages();
    list[0].widgets.s1.config.syncPages = ['p-deleted'];
    expect(syncGroups(list)).toEqual({});
    list[0].widgets.s1.config.syncPages = ['p-deleted', 'p-detail'];
    expect(Object.keys(syncGroups(list)).sort()).toEqual(['p-detail', 'p-overview']);
  });

  it('propagates a cleared selection, over an older one', () => {
    const groups = syncGroups(pages());
    const shared = withSelection(sharedSelections(groups, pages()), groups, 'p-overview', 'region', []);
    expect(syncedFilters({ region: ['North'], year: [2024] }, groups, 'p-detail', shared)).toEqual({ year: [2024] });
    const aligned = alignedWidgets(pages()[0].widgets, groups, 'p-overview', shared);
    expect(aligned.s1.config.selectedValues).toBeUndefined();
  });

  it('returns the same object when the page already reads the shared selection', () => {
    const groups = syncGroups(pages());
    const shared = sharedSelections(groups, pages());
    const filters = { region: ['North'] };
    expect(syncedFilters(filters, groups, 'p-detail', shared)).toBe(filters);
    const widgets = pages()[0].widgets;
    expect(alignedWidgets(widgets, groups, 'p-overview', shared)).toBe(widgets);
  });

  it('chains links and lets the page being edited decide, cleared or not', () => {
    const list = pages();
    list[1].widgets.s2 = slicer('region', { syncPages: ['p-trends'] });
    const groups = syncGroups(list);
    expect(groups['p-trends'].region).toBe(groups['p-overview'].region);
    expect(sharedSelections(groups, list)[groups['p-trends'].region]).toEqual(['North']);
    expect(sharedSelections(groups, list, 'p-detail')[groups['p-trends'].region]).toEqual([]);
  });

  it('takes a whole page of selections (a bookmark) into the shared ones', () => {
    const groups = syncGroups(pages());
    const shared = withPageSelections({}, groups, 'p-detail', { region: ['East'], year: [2025] });
    expect(syncedFilters({}, groups, 'p-overview', shared)).toEqual({ region: ['East'] });
  });
});

describe('filters synced by the assistant', () => {
  it('writes the group on every filter of the field, both ways', () => {
    const list = pages();
    const out = withFilterSync(list, [{ dim: 'region', page: 'p-trends', pages: ['p-overview'] }]);
    expect(out[2].widgets.s3.config.syncPages).toEqual(['p-overview']);
    expect(out[0].widgets.s1.config.syncPages).toEqual(['p-detail', 'p-trends']);
    expect(out[1]).toBe(list[1]);
    expect(syncGroups(out)['p-trends'].region).toBe(syncGroups(out)['p-detail'].region);
  });
  it('unsyncs a page: its filter forgets the others, the others forget it', () => {
    const out = withFilterSync(pages(), [{ dim: 'region', page: 'p-detail', pages: [] }]);
    expect(out[0].widgets.s1.config.syncPages).toBeUndefined();
    expect(syncGroups(out)['p-overview']).toBeUndefined();
  });
  it('leaves pages it does not touch as they are, and ignores pages that are gone', () => {
    const list = pages();
    const out = withFilterSync(list, [{ dim: 'region', page: 'p-gone', pages: ['p-trends'] }, { dim: 'year', page: 'p-trends', pages: ['p-overview'] }]);
    expect(out.every((p, i) => p === list[i])).toBe(true);
  });
  it('says a decision in words', () => {
    expect(syncDecisionLine({ label: 'Year', synced: true, pageNames: ['Overview', 'Sales'] })).toBe('Year filter synced on Overview, Sales');
    expect(syncDecisionLine({ label: 'Region', synced: false, pageNames: ['Detail'] })).toBe('Region filter on Detail: its own selection');
  });
});
