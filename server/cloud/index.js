/**
 * Server-side entry point for the cloud edition.
 *
 * In the OSS repository this file is a no-op stub: it exports a `register`
 * function that does nothing. The cloud repository overrides this file with
 * the real implementation (billing routes, multi-tenant middleware, etc.)
 * and the OSS build never reaches it because the call site in
 * `server/index.js` is gated by `process.env.OPENREPORT_CLOUD === '1'`.
 *
 * Cloud edition: replace this file with the actual implementation.
 *   register(app) is called once at startup with the Express app instance.
 */

function register(_app) {
  // No-op in the OSS edition. The cloud edition mounts its routes here.
}

module.exports = { register };
