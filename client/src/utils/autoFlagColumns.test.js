import { describe, test, expect } from 'vitest';
import { autoFlagColumns } from './autoFlagColumns';

const cols = (...defs) => defs.map(([column_name, data_type]) => ({ column_name, data_type }));

describe('autoFlagColumns', () => {
  test('every column comes back flagged — nothing is left for the user to tick', () => {
    const c = cols(['id', 'integer'], ['country', 'varchar'], ['amount', 'numeric'], ['created_at', 'timestamp']);
    const { dimensions, measures } = autoFlagColumns('sales', c);
    expect(dimensions.length + measures.length).toBe(c.length);
  });

  // The rule that matters: summing an id produces a number that means nothing.
  test('a key column stays a dimension even when it is numeric', () => {
    const { dimensions, measures } = autoFlagColumns('sales', cols(
      ['id', 'integer'], ['id_client', 'bigint'], ['pk_order', 'integer'], ['fk_product', 'integer'],
    ));
    expect(dimensions.map((d) => d.column)).toEqual(['id', 'id_client', 'pk_order', 'fk_product']);
    expect(measures).toEqual([]);
  });

  test('a numeric column is a measure and nothing else', () => {
    const { dimensions, measures } = autoFlagColumns('sales', cols(['amount', 'numeric']));
    expect(measures).toHaveLength(1);
    expect(measures[0]).toMatchObject({
      name: 'sales.amount_sum', table: 'sales', column: 'amount', aggregation: 'sum', label: 'amount',
    });
    // Flagging it both ways would double the field list for no gain.
    expect(dimensions).toEqual([]);
  });

  test('text and dates are dimensions', () => {
    const { dimensions, measures } = autoFlagColumns('sales', cols(['country', 'varchar'], ['created_at', 'timestamp']));
    expect(dimensions.map((d) => [d.column, d.type])).toEqual([['country', 'string'], ['created_at', 'date']]);
    expect(measures).toEqual([]);
  });

  test('a column named like a key but not at the start is read on its own merits', () => {
    // keyRank only treats a LEADING id/pk/fk as a key, so client_id is numeric
    // data like any other — the canvas shows it the same way.
    const { measures } = autoFlagColumns('sales', cols(['client_id', 'integer']));
    expect(measures.map((m) => m.column)).toEqual(['client_id']);
  });

  test('an interval keeps its source type so the SQL builder can wrap it', () => {
    const { measures } = autoFlagColumns('sales', cols(['duration', 'interval']));
    expect(measures[0].dataType).toBe('interval');
  });

  test('a per-column type override wins over the native type', () => {
    const { dimensions } = autoFlagColumns('sales', cols(['ref', 'varchar']), {
      effectiveType: () => 'date',
    });
    expect(dimensions[0].type).toBe('date');
  });

  test('plain column names are accepted, like addDimension does', () => {
    const { dimensions } = autoFlagColumns('sales', ['country']);
    expect(dimensions).toEqual([{ name: 'sales.country', table: 'sales', column: 'country', type: 'string', label: 'country' }]);
  });

  test('empty and malformed input yields empty lists rather than throwing', () => {
    expect(autoFlagColumns('sales', [])).toEqual({ dimensions: [], measures: [] });
    expect(autoFlagColumns('sales', null)).toEqual({ dimensions: [], measures: [] });
    expect(autoFlagColumns('sales', [{}, { column_name: '' }])).toEqual({ dimensions: [], measures: [] });
  });
});
