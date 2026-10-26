// Filters and axes read the dimension tables: a year slicer on the orders'
// own date filtered the orders and left the targets untouched (Illicado demo).
const { validateWidgetsProposal } = require('../utils/ai/validateProposal');
const { toPromptSchema } = require('../utils/ai/effectiveModel');
const { dimensionSideOf } = require('../utils/ai/dimensionSide');

const effective = {
  dimensions: [
    { name: 'calendrier.date', table: 'calendrier', column: 'date', type: 'date' },
    { name: 'calendrier.date_year', table: 'calendrier', column: 'date', type: 'integer', datePart: 'num_year', datePartOf: 'calendrier.date' },
    { name: 'canal.canal_id', table: 'canal', column: 'canal_id', type: 'string' },
    { name: 'canal.canal', table: 'canal', column: 'canal', type: 'string' },
    { name: 'commandes.date_commande', table: 'commandes', column: 'date_commande', type: 'date' },
    { name: 'commandes.date_commande_year', table: 'commandes', column: 'date_commande', type: 'integer', datePart: 'num_year', datePartOf: 'commandes.date_commande' },
    { name: 'commandes.date_commande_month', table: 'commandes', column: 'date_commande', type: 'string', datePart: 'year_month', datePartOf: 'commandes.date_commande' },
    { name: 'commandes.canal_id', table: 'commandes', column: 'canal_id', type: 'string' },
    { name: 'commandes.occasion', table: 'commandes', column: 'occasion', type: 'string' },
  ],
  measures: [{ name: 'commandes.montant_sum', table: 'commandes', column: 'montant', aggregation: 'sum' }],
  joins: [
    { from_table: 'commandes', from_column: 'date_commande', to_table: 'calendrier', to_column: 'date', cardinality: { from: '*', to: '1' } },
    { from_table: 'commandes', from_column: 'canal_id', to_table: 'canal', to_column: 'canal_id', cardinality: { from: '*', to: '1' } },
  ],
};
const ctx = { effective, page: { width: 1140, height: 800 }, pageContext: { pageWidth: 1140, pageHeight: 800, themes: ['light'], theme: 'light', widgets: [] }, mode: 'visuals', library: [], cardinality: {} };
const propose = (w) => validateWidgetsProposal({ widgets: [{ answers: 'filter', ...w }] }, ctx).widgets[0];

describe('Filters and axes on the dimension side', () => {
  test('a fact key names the same field of its dimension table', () => {
    expect(dimensionSideOf('commandes.date_commande_year', effective)).toBe('calendrier.date_year');
    expect(dimensionSideOf('commandes.canal_id', effective)).toBe('canal.canal_id');
    expect(dimensionSideOf('commandes.date_commande', effective)).toBe('calendrier.date');
    // No such date part on the calendar, and a fact's own attribute: left alone.
    expect(dimensionSideOf('commandes.date_commande_month', effective)).toBeNull();
    expect(dimensionSideOf('commandes.occasion', effective)).toBeNull();
    expect(dimensionSideOf('canal.canal', effective)).toBeNull();
  });

  test('the schema tells the assistant where to go', () => {
    const dims = toPromptSchema(effective).dimensions;
    expect(dims.find((d) => d.name === 'commandes.date_commande_year').dimensionSide).toBe('calendrier.date_year');
    expect(dims.find((d) => d.name === 'commandes.occasion').dimensionSide).toBeUndefined();
  });

  test('a slicer and an axis on a fact key move to the dimension table', () => {
    const slicer = propose({ type: 'filter', title: 'Year', binding: { selectedDimensions: ['commandes.date_commande_year'] } });
    expect(slicer.dataBinding.selectedDimensions).toEqual(['calendrier.date_year']);
    const bars = propose({ type: 'bar', answers: 'compare', title: 'By channel', binding: { selectedDimensions: ['commandes.canal_id'], selectedMeasures: ['commandes.montant_sum'] } });
    expect(bars.dataBinding.selectedDimensions).toEqual(['canal.canal_id']);
  });

  test('a fact attribute no dimension holds stays on the fact', () => {
    const slicer = propose({ type: 'filter', title: 'Occasion', binding: { selectedDimensions: ['commandes.occasion'] } });
    expect(slicer.dataBinding.selectedDimensions).toEqual(['commandes.occasion']);
  });
});
