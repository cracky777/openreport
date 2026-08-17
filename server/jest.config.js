module.exports = {
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/tests/setupEnv.js'],
  globalTeardown: '<rootDir>/tests/globalTeardown.js',
  collectCoverage: true,
  // The routes and the cache engine ARE exercised by the supertest harness, but
  // they used to sit outside this list — so the reported figure described a
  // corner of the server and read as if it described the whole. Widened: the
  // number is lower and finally means something. The thresholds below follow.
  collectCoverageFrom: [
    'routes/**/*.js',
    'utils/measureType/**/*.js',
    'utils/reportFilterRules.js',
    'utils/sqlBuilder/**/*.js',
    'utils/rollup*.js',
    'utils/dbConnector.js',
    'utils/queryCache.js',
  ],
  coverageReporters: ['text-summary', 'lcov'],
  // Floor set just below current so it prevents regression without blocking.
  // Ratchet up as coverage grows.
  //
  // These dropped when the scope widened above — 68% statements became 37%.
  // Nothing got worse: the old figure measured a well-tested corner and was
  // read as if it measured the server. A low honest floor beats a high
  // flattering one, because only the honest one moves when someone adds a test.
  coverageThreshold: {
    global: { statements: 36, branches: 29, functions: 33, lines: 40 },
  },
};
