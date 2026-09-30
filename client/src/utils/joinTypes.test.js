import { describe, test, expect } from 'vitest';
import { createRequire } from 'module';
import { typeFamily, joinTypeMismatch } from './joinTypes';

// The canvas warns with this copy, the model validation with the server's:
// the two must read every type the same way.
const server = createRequire(import.meta.url)('../../../server/utils/joinTypes.js');

const TYPES = [
  'BIGINT', 'INTEGER', 'hugeint', 'INT64', 'FLOAT64', 'decimal(18,3)', 'NUMBER(10,2)', 'double precision',
  'VARCHAR', 'varchar(255)', 'character varying', 'STRING', 'nvarchar(max)', 'text',
  'DATE', 'TIMESTAMP', 'timestamp with time zone', 'datetime2', 'INTERVAL', 'UUID', 'BOOLEAN', '',
];

describe('joinTypes mirror', () => {
  test.each(TYPES)('%s reads as on the server', (t) => {
    expect(typeFamily(t)).toBe(server.typeFamily(t));
  });

  test('text against a number is a mismatch, two numbers are not', () => {
    expect(joinTypeMismatch('VARCHAR', 'BIGINT')).toEqual({ from: 'text', to: 'number' });
    expect(joinTypeMismatch('INTEGER', 'BIGINT')).toBeNull();
  });
});
