import { describe, it, expect } from 'vitest';
import { keyRank, sortColumns } from './columnKeys';

const cols = (...names) => names.map((n) => ({ column_name: n }));
const names = (sorted) => sorted.map((c) => c.column_name);

describe('sortColumns', () => {
  it('puts id*, pk* and fk* columns before the rest', () => {
    const sorted = sortColumns(cols('amount', 'fk_client', 'label', 'id_appel', 'pk_commande'));
    expect(names(sorted)).toEqual(['id_appel', 'pk_commande', 'fk_client', 'amount', 'label']);
  });

  it('ranks primary identifiers (id*, pk*) above foreign keys (fk*)', () => {
    const sorted = sortColumns(cols('fk_client', 'id_client', 'pkclient'));
    expect(names(sorted)).toEqual(['id_client', 'pkclient', 'fk_client']);
  });

  it('sorts alphabetically within each tier and ignores case', () => {
    const sorted = sortColumns(cols('zone', 'FK_b', 'fk_a', 'ID_b', 'id_a', 'alpha'));
    expect(names(sorted)).toEqual(['id_a', 'ID_b', 'fk_a', 'FK_b', 'alpha', 'zone']);
  });

  it('matches loose prefixes without separator (idclient, fkclient)', () => {
    expect(keyRank('idclient')).toBe(0);
    expect(keyRank('fkclient')).toBe(1);
    expect(keyRank('client_id')).toBe(2);
  });
});
