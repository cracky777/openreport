import { describe, test, expect } from 'vitest';
import { measureTag, boundLabel, tagFor, fillTags, tagsInText } from './textMeasures';

const MODEL = {
  measures: [{ name: 'sales.amt_sum', label: 'Sales' }, { name: 'sales.basket', label: 'Avg basket' }],
  dimensions: [{ name: 'sales.cat', label: 'Category' }, { name: 'sales.qty' }],
};

describe('measureTag', () => {
  test('folds a label to one lower-case word', () => {
    expect(measureTag('Sales')).toBe('sales');
    expect(measureTag('Avg basket')).toBe('avg_basket');
    expect(measureTag('Category (Max)')).toBe('category_max');
    expect(measureTag('  CA — TTC 2024 ')).toBe('ca_ttc_2024');
    expect(measureTag('Chiffre d’affaires')).toBe('chiffre_d_affaires');
  });
  test('keeps letters of any script', () => {
    expect(measureTag('Ventes été')).toBe('ventes_été');
  });
});

describe('boundLabel / tagFor', () => {
  test('a measure by its label, a variant by its column and aggregation', () => {
    expect(boundLabel('sales.amt_sum', MODEL)).toBe('Sales');
    expect(boundLabel('sales.amt_sum@@agg:avg', MODEL)).toBe('Sales (avg)');
    expect(boundLabel('sales.cat@@agg:max', MODEL)).toBe('Category (max)');
    expect(boundLabel('sales.qty@@agg:count_distinct', MODEL)).toBe('sales.qty (count_distinct)');
    expect(boundLabel('unknown', MODEL)).toBe('unknown');
  });
  test('the tag is the folded label', () => {
    expect(tagFor('sales.cat@@agg:max', MODEL)).toBe('category_max');
    expect(tagFor('sales.basket', MODEL)).toBe('avg_basket');
  });
});

describe('fillTags', () => {
  const values = { sales: '1,234', avg_basket: '12.5' };
  const render = (tag) => values[tag];
  test('replaces known tags, whatever their case, and leaves the rest', () => {
    expect(fillTags('Total #Sales on #avg_basket #unknown', render)).toBe('Total 1,234 on 12.5 #unknown');
    expect(fillTags('#SALES.', render)).toBe('1,234.');
    expect(fillTags('no tag', render)).toBe('no tag');
    expect(fillTags(undefined, render)).toBe('');
  });
  test('lists the tags a text names, folded and deduplicated', () => {
    expect(tagsInText('#Sales and #sales, #Avg_Basket')).toEqual(['sales', 'avg_basket']);
  });
});
