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
