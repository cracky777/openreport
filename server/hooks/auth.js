/**
 * Auth hook registry — generic extension point fired by /api/auth routes.
 *
 * The OSS edition wires the registry into the auth flow (post-register only
 * for now). The cloud edition registers a callback at boot that creates a
 * Personal organization for the new user, sends a welcome email, and consumes
 * any pending org invitations targeting that email.
 *
 * Hooks run sequentially after the user row is inserted and before the login
 * response is sent. They MUST not throw in the success path (catch + log) —
 * a failing cloud-side hook should not bubble up as a 500 to the user trying
 * to register.
 */

const _postRegister = [];

function registerPostRegister(fn) {
  if (typeof fn === 'function') _postRegister.push(fn);
}

async function runPostRegister(ctx) {
  for (const fn of _postRegister) {
    try {
      await fn(ctx);
    } catch (err) {
      console.error('[hooks/auth] post-register hook failed:', err);
    }
  }
}

module.exports = { registerPostRegister, runPostRegister };
