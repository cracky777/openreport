const {
  tablesReachableFrom,
  emailMatchesPattern,
  getAllowedRlsKeys,
} = require('../utils/rls');

// Row-Level Security is the multi-tenant data boundary: a wrong decision here
// leaks one client's rows to another. These cover the pattern matching (incl.
// the regex-escaping that stops a pattern's "." from acting as a wildcard),
// the allowed-keys computation (the "no match → []" case that folds to
// WHERE 1=0), and the join-graph reachability guard.

describe('emailMatchesPattern', () => {
  test('exact email matches, case-insensitively', () => {
    expect(emailMatchesPattern('alice@openreport.io', 'alice@openreport.io')).toBe(true);
    expect(emailMatchesPattern('ALICE@Openreport.IO', 'alice@openreport.io')).toBe(true);
    expect(emailMatchesPattern('bob@openreport.io', 'alice@openreport.io')).toBe(false);
  });

  test('domain glob matches only that domain', () => {
    expect(emailMatchesPattern('alice@openreport.io', '*@openreport.io')).toBe(true);
    expect(emailMatchesPattern('bob@openreport.io', '*@openreport.io')).toBe(true);
    expect(emailMatchesPattern('alice@evil.io', '*@openreport.io')).toBe(false);
  });

  test('prefix glob anchors at the start', () => {
    expect(emailMatchesPattern('alice@x.io', 'alice*')).toBe(true);
    expect(emailMatchesPattern('alice.smith@x.io', 'alice*')).toBe(true);
    // "alicia" does not start with "alice" — anchored, must not over-match.
    expect(emailMatchesPattern('alicia@x.io', 'alice*')).toBe(false);
    expect(emailMatchesPattern('malice@x.io', 'alice*')).toBe(false);
  });

  test('contains glob', () => {
    expect(emailMatchesPattern('x-admin-y@z.io', '*admin*')).toBe(true);
    expect(emailMatchesPattern('user@z.io', '*admin*')).toBe(false);
  });

  test('bare * matches any non-empty email', () => {
    expect(emailMatchesPattern('anyone@anywhere.io', '*')).toBe(true);
  });

  // SECURITY: the "." in a literal pattern must be escaped, not treated as the
  // regex any-char — otherwise "a.b@x.io" would also match "aXb@xYio".
  test('regex metacharacters in a pattern are escaped, not interpreted', () => {
    expect(emailMatchesPattern('a.b@x.io', 'a.b@x.io')).toBe(true);
    expect(emailMatchesPattern('aXb@xYio', 'a.b@x.io')).toBe(false);
    // A pattern that is regex-special must match literally, never explode.
    expect(emailMatchesPattern('a+b@x.io', 'a+b@x.io')).toBe(true);
    expect(emailMatchesPattern('aaab@x.io', 'a+b@x.io')).toBe(false);
  });

  test('empty / missing pattern never matches', () => {
    expect(emailMatchesPattern('alice@x.io', '')).toBe(false);
    expect(emailMatchesPattern('alice@x.io', null)).toBe(false);
    expect(emailMatchesPattern('alice@x.io', undefined)).toBe(false);
  });
});

describe('getAllowedRlsKeys', () => {
  const rls = {
    enabled: true,
    table: 't',
    primaryKey: 'client_id',
    rules: {
      c1: ['alice@openreport.io', '*@c1.io'],
      c2: ['bob@openreport.io'],
      shared: ['*'],
    },
  };

  test('returns null when RLS is disabled or absent', () => {
    expect(getAllowedRlsKeys(null, 'a@x.io')).toBeNull();
    expect(getAllowedRlsKeys({ enabled: false, rules: rls.rules }, 'a@x.io')).toBeNull();
    expect(getAllowedRlsKeys({ enabled: true }, 'a@x.io')).toBeNull();
  });

  test('a user gets exactly the keys whose patterns match', () => {
    // alice matches c1 (literal) + shared (*); NOT c2.
    expect(getAllowedRlsKeys(rls, 'alice@openreport.io').sort()).toEqual(['c1', 'shared']);
    // a c1.io domain user matches c1 (domain glob) + shared.
    expect(getAllowedRlsKeys(rls, 'x@c1.io').sort()).toEqual(['c1', 'shared']);
    // bob matches c2 + shared.
    expect(getAllowedRlsKeys(rls, 'bob@openreport.io').sort()).toEqual(['c2', 'shared']);
  });

  // The CRITICAL boundary: a user matching no per-client rule gets [] (not
  // null) — the query layer folds [] into WHERE 1=0 (see the empty check),
  // returning zero rows instead of every row.
  test('a user matching no client rule still matches only "shared"', () => {
    expect(getAllowedRlsKeys(rls, 'stranger@evil.io')).toEqual(['shared']);
  });

  test('a user matching truly nothing gets an empty list, never null', () => {
    const strict = { enabled: true, table: 't', primaryKey: 'client_id', rules: { c1: ['alice@x.io'] } };
    const keys = getAllowedRlsKeys(strict, 'stranger@evil.io');
    expect(keys).toEqual([]);
    expect(keys).not.toBeNull();
  });

  test('non-array rule values are skipped, not crashed on', () => {
    const malformed = { enabled: true, table: 't', primaryKey: 'k', rules: { good: ['a@x.io'], bad: 'a@x.io' } };
    expect(getAllowedRlsKeys(malformed, 'a@x.io')).toEqual(['good']);
  });
});

describe('tablesReachableFrom', () => {
  const joins = [
    { from_table: 'facts', to_table: 'client' },
    { from_table: 'facts', to_table: 'product' },
    { from_table: 'product', to_table: 'category' },
  ];

  test('the start table alone with no joins', () => {
    expect([...tablesReachableFrom('facts', [])]).toEqual(['facts']);
  });

  test('reaches joined tables in both directions', () => {
    const r = tablesReachableFrom('client', joins);
    // client → facts → product → category are all reachable through the graph.
    expect(r.has('client')).toBe(true);
    expect(r.has('facts')).toBe(true);
    expect(r.has('product')).toBe(true);
    expect(r.has('category')).toBe(true);
  });

  test('an unconnected table is NOT reachable (would slip through a cross join)', () => {
    const r = tablesReachableFrom('facts', [{ from_table: 'other', to_table: 'lonely' }]);
    expect(r.has('lonely')).toBe(false);
    expect(r.has('other')).toBe(false);
  });
});
