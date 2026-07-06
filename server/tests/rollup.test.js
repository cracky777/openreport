const { hllAllowedByEnv } = require('../utils/rollupDuckDB');

describe('LOT 5.1 — hllAllowedByEnv (single source of truth for HLL gating)', () => {
  const orig = process.env.ROLLUP_HLL_ENABLED;
  afterEach(() => {
    if (orig === undefined) delete process.env.ROLLUP_HLL_ENABLED;
    else process.env.ROLLUP_HLL_ENABLED = orig;
  });

  test('ROLLUP_HLL_ENABLED=1 forces HLL on', () => {
    process.env.ROLLUP_HLL_ENABLED = '1';
    expect(hllAllowedByEnv()).toBe(true);
  });

  test('ROLLUP_HLL_ENABLED=0 forces HLL off', () => {
    process.env.ROLLUP_HLL_ENABLED = '0';
    expect(hllAllowedByEnv()).toBe(false);
  });

  test('unset → ON by default, OFF on Windows', () => {
    delete process.env.ROLLUP_HLL_ENABLED;
    expect(hllAllowedByEnv()).toBe(process.platform !== 'win32');
  });
});
