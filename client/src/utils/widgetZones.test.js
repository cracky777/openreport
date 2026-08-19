import { describe, it, expect } from 'vitest';
import { usesLegend, usesPivotColumns, collectMeasures, transformBinding } from './widgetZones';

describe('zone flags', () => {
  it('legend belongs to bar/line/combo/scatter only', () => {
    expect(['bar', 'line', 'combo', 'scatter'].every(usesLegend)).toBe(true);
    expect(['pie', 'treemap', 'table', 'pivot', 'card', 'gauge', 'filter'].some(usesLegend)).toBe(false);
  });

  it('pivot columns belong to pivot only', () => {
    expect(usesPivotColumns('pivot')).toBe(true);
    expect(usesPivotColumns('bar')).toBe(false);
  });
});

describe('collectMeasures', () => {
  it('unions scatter roles with selectedMeasures, preserving order', () => {
    const binding = { selectedMeasures: ['a', 'b', 'c', 'd'], scatterMeasures: { x: 'a', y: 'e' } };
    expect(collectMeasures('scatter', binding)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('unions combo splits with selectedMeasures', () => {
    const binding = { selectedMeasures: ['a'], comboBarMeasures: ['a', 'b'], comboLineMeasures: ['c'] };
    expect(collectMeasures('combo', binding)).toEqual(['a', 'b', 'c']);
  });
});

describe('transformBinding', () => {
  it('keeps dims, measures and legend (with order) across a bar → line switch', () => {
    const binding = { selectedDimensions: ['d2', 'd1'], selectedMeasures: ['m2', 'm1'], groupBy: ['g1'] };
    const next = transformBinding('bar', 'line', binding);
    expect(next.selectedDimensions).toEqual(['d2', 'd1']);
    expect(next.selectedMeasures).toEqual(['m2', 'm1']);
    expect(next.groupBy).toEqual(['g1']);
  });

  it('seeds the combo split from the canonical measures on first entry', () => {
    const next = transformBinding('bar', 'combo', { selectedMeasures: ['m1', 'm2'] });
    expect(next.comboBarMeasures).toEqual(['m1', 'm2']);
    expect(next.comboLineMeasures).toEqual([]);
  });

  it('keeps a still-valid combo split on re-entry (round-trip memory)', () => {
    const combo = { selectedMeasures: ['m1', 'm2'], comboBarMeasures: ['m1'], comboLineMeasures: ['m2'] };
    const bar = transformBinding('combo', 'bar', combo);
    expect(bar.selectedMeasures).toEqual(['m1', 'm2']);
    const back = transformBinding('bar', 'combo', bar);
    expect(back.comboBarMeasures).toEqual(['m1']);
    expect(back.comboLineMeasures).toEqual(['m2']);
  });

  it('reseeds the combo split when the measures changed in between', () => {
    const bar = { selectedMeasures: ['m1', 'm3'], comboBarMeasures: ['m1'], comboLineMeasures: ['m2'] };
    const combo = transformBinding('bar', 'combo', bar);
    expect(combo.comboBarMeasures).toEqual(['m1', 'm3']);
    expect(combo.comboLineMeasures).toEqual([]);
  });

  it('assigns scatter roles x/y/size from the first measures', () => {
    const next = transformBinding('bar', 'scatter', { selectedMeasures: ['m1', 'm2', 'm3', 'm4'] });
    expect(next.scatterMeasures).toEqual({ x: 'm1', y: 'm2', size: 'm3' });
  });

  it('brings every measure back from a scatter, not just the three roles', () => {
    const scatter = { selectedMeasures: ['m1', 'm2', 'm3', 'm4'], scatterMeasures: { x: 'm1', y: 'm2', size: 'm3' } };
    const bar = transformBinding('scatter', 'bar', scatter);
    expect(bar.selectedMeasures).toEqual(['m1', 'm2', 'm3', 'm4']);
  });

  it('leaves unused zone keys in place for round trips (pie keeps a dormant legend)', () => {
    const pie = transformBinding('bar', 'pie', { selectedDimensions: ['d1'], selectedMeasures: ['m1'], groupBy: ['g1'] });
    expect(pie.groupBy).toEqual(['g1']);
    const bar = transformBinding('pie', 'bar', pie);
    expect(bar.groupBy).toEqual(['g1']);
  });
});
