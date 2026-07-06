module.exports = {
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/tests/setupEnv.js'],
  collectCoverage: true,
  // Scope coverage to the pure-logic units that are unit-tested. Route/HTTP
  // behaviour is covered by the integration harness (supertest) without a
  // coverage gate, so a big partially-exercised file can't crater the numbers.
  collectCoverageFrom: [
    'utils/measureType.js',
    'utils/reportFilterRules.js',
    'utils/sqlBuilder/**/*.js',
  ],
  coverageReporters: ['text-summary', 'lcov'],
  // Floor set just below current so it prevents regression without blocking.
  // Ratchet up as coverage grows.
  coverageThreshold: {
    global: { statements: 50, branches: 40, functions: 58, lines: 55 },
  },
};
