# `server/cloud/` — cloud-edition server code

This directory exists in the OSS repository as a **placeholder**. The OSS
build ships only the `index.js` no-op stub.

The cloud repository overrides this directory with the real implementation:
billing routes, multi-tenant middleware, license enforcement, audit logs, etc.

**Do not add OSS features here.** Anything in `server/cloud/` (other than this
README and the `index.js` stub) belongs exclusively to the private cloud
repository — see [`CLOUD-DEV.md`](../../CLOUD-DEV.md) at the project root.

The OSS server only loads this module when `OPENREPORT_CLOUD=1` is set in
the environment, so the stub is never executed in normal OSS deployments.
