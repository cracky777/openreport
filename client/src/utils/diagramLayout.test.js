import { describe, test, expect } from 'vitest';
import { arrangeDiagram, layoutPositions, tableHeight, TABLE_WIDTH } from './diagramLayout';

const j = (from, to) => ({ from_table: from, from_column: `${to}_id`, to_table: to, to_column: 'id' });
const cols = () => 6;
const overlap = (pos, names, count = cols) => names.some((a, i) => names.some((b, k) => {
  if (k <= i) return false;
  const A = pos[a];
  const B = pos[b];
  return A.x < B.x + TABLE_WIDTH && B.x < A.x + TABLE_WIDTH && A.y < B.y + tableHeight(count(b)) && B.y < A.y + tableHeight(count(a));
}));

describe('arrangeDiagram', () => {
  test('a star: the fact in the middle, its dimensions on both sides, nothing overlapping', () => {
    const tables = ['orders', 'customers', 'products', 'stores', 'calendar'];
    const joins = [j('orders', 'customers'), j('orders', 'products'), j('orders', 'stores'), j('orders', 'calendar')];
    const pos = arrangeDiagram(tables, joins, {}, cols);
    const others = tables.slice(1);
    expect(others.filter((t) => pos[t].x < pos.orders.x)).toHaveLength(2);
    expect(others.filter((t) => pos[t].x > pos.orders.x)).toHaveLength(2);
    expect(overlap(pos, tables)).toBe(false);
  });

  test('a constellation: a dimension two facts share sits between their heights', () => {
    const tables = ['sales', 'budget', 'calendar', 'products', 'stores'];
    const joins = [j('sales', 'calendar'), j('budget', 'calendar'), j('sales', 'products'), j('budget', 'stores')];
    const pos = arrangeDiagram(tables, joins, { sales: 'fact', budget: 'fact' }, cols);
    expect(pos.sales.x).toBe(pos.budget.x);
    expect(pos.budget.y).toBeGreaterThan(pos.sales.y);
    expect(pos.calendar.y).toBeGreaterThanOrEqual(pos.sales.y);
    expect(pos.calendar.x).not.toBe(pos.sales.x);
    expect(overlap(pos, tables)).toBe(false);
  });

  test('a snowflake goes one column further out; a table joined to nothing, below everything', () => {
    const tables = ['orders', 'products', 'categories', 'notes'];
    const joins = [j('orders', 'products'), j('products', 'categories')];
    const pos = arrangeDiagram(tables, joins, {}, cols);
    const side = Math.sign(pos.products.x - pos.orders.x);
    expect(Math.sign(pos.categories.x - pos.products.x)).toBe(side);
    const bottom = Math.max(...['orders', 'products', 'categories'].map((t) => pos[t].y + tableHeight(6)));
    expect(pos.notes.y).toBeGreaterThan(bottom);
  });

  test('taller tables push the next ones down', () => {
    const tables = ['f', 'a', 'b', 'c'];
    const joins = [j('f', 'a'), j('f', 'b'), j('f', 'c')];
    const pos = arrangeDiagram(tables, joins, {}, (t) => (t === 'a' ? 30 : 4));
    expect(overlap(pos, tables, (t) => (t === 'a' ? 30 : 4))).toBe(false);
  });
});

describe('layoutPositions', () => {
  test('a new diagram is laid out whole; an arranged one keeps its places, new tables beside what they join', () => {
    const joins = [j('orders', 'customers'), j('orders', 'products')];
    const fresh = layoutPositions({ orders: { tableType: 'fact' } }, ['orders', 'customers', 'products'], joins, cols);
    expect(fresh.orders.tableType).toBe('fact');
    expect(fresh.customers.x).not.toBe(fresh.orders.x);

    const arranged = { orders: { x: 600, y: 300 }, customers: { x: 100, y: 100 } };
    const next = layoutPositions(arranged, ['orders', 'customers', 'products'], joins, cols);
    expect(next.orders).toEqual(arranged.orders);
    expect(next.customers).toEqual(arranged.customers);
    expect(Math.abs(next.products.x - 600)).toBeGreaterThan(0);
    expect(overlap(next, ['orders', 'customers', 'products'])).toBe(false);

    const redone = layoutPositions(arranged, ['orders', 'customers', 'products'], joins, cols, { all: true });
    expect(redone.customers).not.toEqual(arranged.customers);
  });
});
