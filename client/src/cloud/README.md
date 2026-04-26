# `client/src/cloud/` — cloud-edition client code

This directory exists in the OSS repository as a **placeholder**. The OSS
build ships only the `index.jsx` no-op stub (default export is `null`).

The cloud repository overrides this directory with the real implementation:
billing pages, account management, plan selector, SSO flows, etc.

**Do not add OSS features here.** Anything in `client/src/cloud/` (other
than this README and the `index.jsx` stub) belongs exclusively to the
private cloud repository — see
[`CLOUD-DEV.md`](../../../CLOUD-DEV.md) at the project root.

The OSS bundle only mounts the cloud routes when
`VITE_OPENREPORT_CLOUD=1` is set at build time. The stub remains
present so that `import('./cloud')` resolves cleanly in both editions.
