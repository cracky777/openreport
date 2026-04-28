/**
 * Extension point for the upload pipeline.
 *
 * The OSS edition ships with no checks registered, so uploads proceed
 * unchanged. The cloud edition (loaded via server/cloud/) registers a
 * per-plan quota check here so users can't exceed their subscription's
 * `maxUploadSizeMB` allowance.
 *
 * A check function receives the Express request and the multer file
 * descriptor. It returns:
 *   - `null` (or any falsy value) to allow the upload
 *   - a string explaining why the upload was rejected (used as the 413 body)
 *   - a Promise resolving to either of the above (async checks are supported)
 *
 * Checks run in registration order. The first one to return a string wins.
 */

const checks = [];

/**
 * Register a function that will be called for every authenticated upload.
 * @param {(req: import('express').Request, file: Express.Multer.File) => string|null|Promise<string|null>} fn
 */
function registerCheck(fn) {
  if (typeof fn !== 'function') throw new Error('upload check must be a function');
  checks.push(fn);
}

/**
 * Run every registered check and return the first non-empty veto reason,
 * or null if all checks pass.
 */
async function runChecks(req, file) {
  for (const fn of checks) {
    const reason = await fn(req, file);
    if (reason) return reason;
  }
  return null;
}

module.exports = { registerCheck, runChecks };
