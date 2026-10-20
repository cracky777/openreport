import { describe, expect, test } from 'vitest';
import { naturalOrder } from './axisSort';

describe('naturalOrder', () => {
  test('labels in alphabetical order are read as people read them: M9 before M12', () => {
    const labels = ['J0', 'M1', 'M12', 'M3', 'M6', 'M9'];
    expect(naturalOrder(labels).map((i) => labels[i])).toEqual(['J0', 'M1', 'M3', 'M6', 'M9', 'M12']);
  });

  test('an order the query chose (a rank, a sort by value) is kept', () => {
    expect(naturalOrder(['M3', 'M12', 'M1'])).toBeNull();
  });

  test('labels already in natural order: nothing to do', () => {
    expect(naturalOrder(['Lille', 'Lyon', 'Nantes'])).toBeNull();
  });
});
