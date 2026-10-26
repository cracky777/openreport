import { describe, test, expect } from 'vitest';
import { copyEntry, pasteEntry, fieldsOf } from './widgetClipboard';

const source = {
  id: 'm1',
  dimensions: [{ name: 'sales.country', table: 'sales' }, { name: '_date.month_name', table: 'sales', datePart: 'name_month' }],
  measures: [{ name: 'sales.amt_sum', table: 'sales', label: 'Sales' }, { name: '_calc.margin_rate', aggregation: 'custom' }],
};
const settings = {
  extraMeasures: [{ name: '_calc.margin_rate', aggregation: 'custom', expression: '1' }, { name: '_calc.unused', aggregation: 'custom' }],
  extraDimensions: [{ name: '_date.month_name', table: 'sales', datePart: 'name_month' }],
  measureOverrides: { '_calc.margin_rate': { format: { suffix: ' %' } }, 'sales.other': { label: 'x' } },
};
const bar = {
  type: 'bar',
  config: { crossFilterExclusions: ['w9'], title: 'Margin' },
  dataBinding: { selectedDimensions: ['_date.month_name'], selectedMeasures: ['_calc.margin_rate', 'sales.amt_sum@@agg:avg'] },
  data: { labels: ['Jan'], datasets: [] },
};
const copied = () => copyEntry({ widget: bar, layoutItem: { i: 'w1', x: 40, y: 60, w: 400, h: 300 }, settings, model: source, reportId: 'r1', pageId: 'p1' });

describe('copy', () => {
  test('the fields a visual reads, variants by their base', () => {
    expect(fieldsOf(bar, source).sort()).toEqual(['_calc.margin_rate', '_date.month_name', 'sales.amt_sum']);
  });

  test('carries the report fields and formats it reads, never its rows', () => {
    const entry = copied();
    expect(entry.extraMeasures.map((m) => m.name)).toEqual(['_calc.margin_rate']);
    expect(entry.extraDimensions.map((d) => d.name)).toEqual(['_date.month_name']);
    expect(Object.keys(entry.measureOverrides)).toEqual(['_calc.margin_rate']);
    expect(entry.widget.data).toEqual({});
  });

  test('a text keeps its words', () => {
    const text = { type: 'text', data: { text: 'Hi', runs: [{ text: 'Hi', bold: true }], values: { a: 1 } } };
    const entry = copyEntry({ widget: text, layoutItem: { i: 't', x: 0, y: 0, w: 100, h: 40 }, settings: {}, model: source, reportId: 'r1', pageId: 'p1' });
    expect(entry.widget.data).toEqual({ text: 'Hi', runs: [{ text: 'Hi', bold: true }] });
  });
});

describe('paste', () => {
  test('same page: one step down and right, nothing added to the report', () => {
    const out = pasteEntry(copied(), { newId: 'n', reportId: 'r1', pageId: 'p1', settings, model: source });
    expect(out.layoutItem).toMatchObject({ i: 'n', x: 60, y: 80 });
    expect(out.settingsPatch).toBeNull();
    expect(out.widget.config.crossFilterExclusions).toEqual(['w9']);
  });

  test('another report: same place, its report fields added, interactions dropped', () => {
    const target = { id: 'm1', dimensions: [{ name: 'sales.country', table: 'sales' }], measures: [{ name: 'sales.amt_sum', table: 'sales' }] };
    const out = pasteEntry(copied(), { newId: 'n', reportId: 'r2', pageId: 'p1', settings: {}, model: target });
    expect(out.layoutItem).toMatchObject({ x: 40, y: 60 });
    expect(out.widget.config.crossFilterExclusions).toBeUndefined();
    const s = out.settingsPatch({ measureOverrides: { '_calc.margin_rate': { format: { suffix: '' } } } });
    expect(s.extraMeasures.map((m) => m.name)).toEqual(['_calc.margin_rate']);
    expect(s.extraDimensions.map((d) => d.name)).toEqual(['_date.month_name']);
    // This report's own format wins.
    expect(s.measureOverrides['_calc.margin_rate'].format.suffix).toBe('');
    expect(out.missing).toEqual([]);
  });

  test('a field the other model lacks is named, the visual pasted anyway', () => {
    const target = { id: 'm2', dimensions: [{ name: 'gift.card', table: 'gift' }], measures: [] };
    const out = pasteEntry(copied(), { newId: 'n', reportId: 'r2', pageId: 'p1', settings: {}, model: target });
    // By its label; the month reads a table this model lacks, so it is not brought either.
    expect(out.missing.sort()).toEqual(['Sales', '_date.month_name']);
    expect(out.settingsPatch({}).extraDimensions).toEqual([]);
  });

  test('a report field of the same name already there is kept', () => {
    const own = { extraMeasures: [{ name: '_calc.margin_rate', expression: 'mine' }] };
    const target = { dimensions: [], measures: [{ name: '_calc.margin_rate' }, { name: 'sales.amt_sum' }] };
    const out = pasteEntry(copied(), { newId: 'n', reportId: 'r2', pageId: 'p1', settings: own, model: target });
    expect(out.settingsPatch(own).extraMeasures).toEqual([{ name: '_calc.margin_rate', expression: 'mine' }]);
  });

  test('a place outside a smaller page is pulled back onto it', () => {
    const entry = { ...copied(), layout: { i: 'w1', x: 1500, y: 0, w: 400, h: 300 } };
    const out = pasteEntry(entry, { newId: 'n', reportId: 'r2', pageId: 'p1', settings: {}, model: source, pageWidth: 1140 });
    expect(out.layoutItem.x + 400).toBeLessThanOrEqual(1140);
  });
});
