// LOT 6.2 — guard against divergence between the server and client copies of
// these pure helpers (each file carries a "keep in sync" note). We load BOTH —
// the server via require(), the client by eval'ing its ESM (they're
// self-contained pure functions, no imports) — and assert identical behaviour on
// a battery of inputs. If the two ever diverge, this test fails.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Minimal ESM→CJS shim: strip `export ` and re-export the `export function`
// names. Only valid for self-contained modules with no import statements.
function loadEsmPure(relFromRepoRoot) {
  const code = fs.readFileSync(path.join(__dirname, '..', '..', relFromRepoRoot), 'utf8');
  const names = [...code.matchAll(/export\s+function\s+([A-Za-z0-9_]+)/g)].map((m) => m[1]);
  const src = `${code.replace(/export\s+/g, '')}\nmodule.exports = { ${names.join(', ')} };`;
  const mod = { exports: {} };
  vm.runInNewContext(src, { module: mod, exports: mod.exports });
  return mod.exports;
}

const serverCP = require('../utils/comparePeriod');
const clientCP = loadEsmPure('client/src/utils/comparePeriod.js');
const serverRF = require('../utils/reportFilterRules');
const clientRF = loadEsmPure('client/src/utils/reportFilterRules.js');

const DIMS = [
  { name: 'yr', type: 'integer', label: 'Year' },
  { name: 'd', type: 'date' },
  { name: 'status', type: 'string' },
];
const FILTER_CASES = [
  { yr: ['2024', '2023'], status: ['open'] },
  { d: ['2024-05-01'] },
  { yr: [] },
  {},
];
const WF_CASES = [
  [{ field: 'yr', values: ['2024', '2020'] }],
  [{ field: 'd', value: '2024-05-01' }],
  [{ field: 'd', op: 'between', value: ['2026-01-01', '2026-08-29'] }], // range slicer / filter-bar shape
  [{ field: 'status', values: ['x'] }],
  [null],
  [],
];

describe('LOT 6.2 — server/client shared helpers stay aligned', () => {
  test('comparePeriod.shiftFiltersForN1', () => {
    for (const f of FILTER_CASES) {
      expect(serverCP.shiftFiltersForN1(f, DIMS)).toEqual(clientCP.shiftFiltersForN1(f, DIMS));
    }
  });

  test('comparePeriod.shiftWidgetFiltersForN1', () => {
    for (const wf of WF_CASES) {
      expect(serverCP.shiftWidgetFiltersForN1(wf, DIMS)).toEqual(clientCP.shiftWidgetFiltersForN1(wf, DIMS));
    }
  });

  test('comparePeriod.hasShiftableFilterForN1', () => {
    for (const f of FILTER_CASES) {
      for (const wf of WF_CASES) {
        expect(serverCP.hasShiftableFilterForN1(f, wf, DIMS)).toBe(clientCP.hasShiftableFilterForN1(f, wf, DIMS));
      }
    }
  });

  test('reportFilterRules.prepareGlobalRulesForWidget', () => {
    const rules = [
      { field: 'a', op: 'eq', value: 1 },
      { field: 'b', op: 'in', values: [1, 2], exclusions: ['w1'] },
      { field: 'c', op: 'eq', value: 3, exclusions: ['w2'] },
    ];
    for (const wid of ['w1', 'w2', 'w3']) {
      expect(serverRF.prepareGlobalRulesForWidget(rules, wid))
        .toEqual(clientRF.prepareGlobalRulesForWidget(rules, wid));
    }
  });
});

// A `between` rule carries its two bounds as an ARRAY in `value` (the shape
// range slicers and the report filter bar emit). The scalar path used to
// stringify the array, shift only the first year, and the malformed bound
// list dropped the BETWEEN clause downstream — so the N-1 slice was built
// and queried UNFILTERED (compared against all-time instead of Y-1).
describe('shiftWidgetFiltersForN1 — between rule with array value', () => {
  const DIMS_D = [{ name: 'd', type: 'date' }];
  const RULE = [{ field: 'd', op: 'between', value: ['2026-01-01', '2026-08-29'] }];

  test('server: both bounds shift a year back, array shape preserved', () => {
    const [out] = serverCP.shiftWidgetFiltersForN1(RULE, DIMS_D);
    expect(out.value).toEqual(['2025-01-01', '2025-08-29']);
  });

  test('client mirror: identical result', () => {
    const [out] = clientCP.shiftWidgetFiltersForN1(RULE, DIMS_D);
    expect(out.value).toEqual(['2025-01-01', '2025-08-29']);
  });
});
