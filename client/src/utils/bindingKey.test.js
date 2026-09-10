import { describe, test, expect } from 'vitest';
import { computeBindingSignatures } from './bindingKey';

const widget = (extra) => ({ type: 'bar', dataBinding: { selectedMeasures: ['m'] }, config: {}, ...extra });

describe('computeBindingSignatures', () => {
  test('one entry per widget, and it moves with the binding', () => {
    const a = computeBindingSignatures({ w1: widget(), w2: widget() });
    const b = computeBindingSignatures({
      w1: widget({ dataBinding: { selectedMeasures: ['m', 'm2'] } }),
      w2: widget(),
    });
    expect(a.w1).not.toBe(b.w1);
    // The neighbour must not move: refetching it because w1 changed is exactly
    // what repainted the visual next door on a filter edit.
    expect(a.w2).toBe(b.w2);
  });

  test('a widget filter moves its own entry', () => {
    const a = computeBindingSignatures({ w1: widget() });
    const b = computeBindingSignatures({
      w1: widget({ dataBinding: { selectedMeasures: ['m'], widgetFilters: [{ op: 'top_n', value: '5' }] } }),
    });
    expect(a.w1).not.toBe(b.w1);
  });

  test('presentation is not a binding', () => {
    // A colour or a font changes nothing about the query; waking the fetch
    // loop on it would abort whatever was in flight.
    const a = computeBindingSignatures({ w1: widget() });
    const b = computeBindingSignatures({ w1: widget({ config: { backgroundColor: '#fff', borderRadius: 4 } }) });
    expect(a.w1).toBe(b.w1);
  });

  test('the row cap and the Top N toggle DO move it — they are the query', () => {
    const a = computeBindingSignatures({ w1: widget() });
    expect(computeBindingSignatures({ w1: widget({ config: { dataLimit: 42 } }) }).w1).not.toBe(a.w1);
    expect(computeBindingSignatures({ w1: widget({ config: { topNEnabled: true } }) }).w1).not.toBe(a.w1);
  });
});
