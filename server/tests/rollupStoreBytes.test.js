const os = require('os');
const fs = require('fs');
const path = require('path');

// Point the rollup store at an isolated temp dir BEFORE requiring the module —
// DATA_DIR is resolved once at module load.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'or-rollup-size-'));
process.env.ROLLUP_DUCKDB_DIR = TMP;

const rollupDuckDB = require('../utils/rollupDuckDB');

// Regression guard for the blue-green size doubling: during a rebuild the old
// gen file lingers on disk next to the new one until the prune runs, so a size
// probe that lands in that window must NOT count the orphaned old gen.
describe('modelStoreBytes — blue-green gen filtering', () => {
  const modelId = 'model-size-test';
  const orgId = null;

  beforeAll(() => {
    // new (referenced) gen, old (orphaned) gen, and the legacy base file.
    fs.writeFileSync(rollupDuckDB.dbPathFor(modelId, orgId, 'aaa'), Buffer.alloc(1000));
    fs.writeFileSync(rollupDuckDB.dbPathFor(modelId, orgId, 'bbb'), Buffer.alloc(2000));
    fs.writeFileSync(rollupDuckDB.dbPathFor(modelId, orgId, null), Buffer.alloc(500));
  });

  afterAll(() => { fs.rmSync(TMP, { recursive: true, force: true }); });

  test('no filter → counts every gen file on disk (legacy behaviour)', () => {
    expect(rollupDuckDB.modelStoreBytes(modelId, orgId)).toBe(1000 + 2000 + 500);
  });

  test('referenced gens → excludes the orphaned old gen (no ≈2× doubling)', () => {
    expect(rollupDuckDB.modelStoreBytes(modelId, orgId, new Set(['aaa']))).toBe(1000 + 500);
  });

  test('empty referenced set → only the base file', () => {
    expect(rollupDuckDB.modelStoreBytes(modelId, orgId, new Set())).toBe(500);
  });
});
