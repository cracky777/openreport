# Security Policy

Open Report holds the credentials of the databases it reads, and enforces
row-level security on the rows it returns. A flaw in either is a flaw that
exposes someone else's data, so vulnerability reports are taken seriously and
answered.

## Reporting a vulnerability

**Please do not open a public issue.** An issue is visible to everyone,
including to whoever would exploit it, from the moment you press submit.

Use one of these instead:

- [Report a vulnerability privately on GitHub](https://github.com/cracky777/openreport/security/advisories/new)
  — preferred, because the discussion stays attached to the repository and can
  become an advisory when it is fixed.
- Or email **support@openreport.io** with `SECURITY` in the subject.

Please include what you would want to receive yourself: what the flaw is, how to
reach it, what it lets an attacker do, and the version or commit you tested.

## What happens next

- You will get an acknowledgement within **72 hours**.
- We will confirm or dispute the report, and tell you which it is.
- If it is confirmed, you will hear about the fix before it is published.
- If you want credit in the advisory, say so; if you would rather not be named,
  say that instead.

This is a small project without a security team, so please read those timings as
an honest intention rather than a contractual SLA.

## Supported versions

Open Report is pre-1.0 and moves quickly. Fixes land on `master`, and that is
the only branch that receives them. If you self-host, updating means pulling
`master` and rebuilding.

## Scope

In scope: authentication and session handling, the multi-tenant boundary
(workspaces, report and model access checks), row-level security, SQL
injection through model definitions or query payloads, the storage of datasource
credentials, and the custom-visual and file-import paths.

Out of scope: anything that requires an account you already control to attack
only your own data, missing hardening headers with no demonstrated impact,
denial of service by volume, and findings from automated scanners without a
working proof of concept.

## Running it safely

Two settings decide more than any patch:

- `SESSION_SECRET`, `INTERNAL_TOKEN_SECRET` and `DATASOURCE_ENC_KEY` must each be
  set to a real random value (`openssl rand -hex 32`), and must differ from one
  another. The application refuses to run on weak or default values, and exits
  rather than continuing. Do not work around that check.
- Put it behind HTTPS. Session cookies are marked `Secure` in production, and a
  browser will not send a `Secure` cookie over plain HTTP.
