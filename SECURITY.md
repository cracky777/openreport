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

## The AI assistant

Who has it, in this order (`server/utils/ai/access.js`):

1. **Admin › AI switched off:** nobody. This is the instance's "no AI here".
2. **An account an admin refused** (Admin › AI › Who has the assistant): no
   assistant for that account, whatever provider it would bring itself.
3. **The instance has a provider:** everyone else who can edit a report.
4. **It has none:** each user may plug in **their own** provider, for their own
   requests. The key is stored encrypted on their account and is never readable
   back, not even by an admin.

Point 4 is on by default, and it is a decision you should make knowingly: a user
with their own provider chooses the third party that receives the field names of
the models they can read. They choose *where* it goes, never *what* goes — the
data-sharing level below stays the admin's, for personal providers too. To rule
it out, configure an instance provider (3), refuse accounts (2) or switch the
assistant off (1). On a multi-user instance also set
`OPENREPORT_BLOCK_INTERNAL_HOSTS=1`: like a datasource host, a provider URL is an
outbound target, and with personal providers it is no longer chosen by admins
only.

When it is on, know what leaves the server, because the provider is a third party:

- **Always:** the names, labels and types of the report's fields, which field
  combinations are cached, and the bindings of the widgets on the page being
  edited. Never SQL expressions, table or column names, joins or RLS rules.
- **Only with "Schema and cached data":** aggregated rows read from the report's
  rollup cache, capped at 200 rows per read. The default is schema only.

The assistant cannot reach a datasource. It reads through `/query` with
`cacheOnly`, which answers from the rollup store or returns a miss, and it does
so as the requesting user: access checks and row-level security apply
unchanged, and a user restricted by RLS gets no rows at all. It has no tool that
writes: it returns proposals, validated server-side against the model, and a
proposal changes a report only when its author applies it.

The same assistant answers in the **Ask your data** panel of the journey, about a
model rather than a report. It is open to users who may *build a report* on that
model, not to everyone who can read it through a shared report. The chart and
table shown in the panel are queried by the user's own browser session, under the usual
access rules and RLS; the assistant still only ever reads the cache. "Add to
report" is a user action: the server re-validates the visual against the target
report's model and places it itself. Ratings (👍/👎) keep the question and the
shape of the proposed visual, never the answer's text or any data row.

The assistant can also offer to do a few things for the user (today: scheduling
a report's cache refresh). It does so as a card: nothing happens until the user
clicks it, and the click goes through the ordinary API route with the user's own
rights. The assistant itself has no route or tool that changes anything.

In the data-model editor, the assistant (for the model's owner or an admin) is
shown the table and column names and types of the model being edited, never its
rows, and proposes joins, flags and measures. It writes no SQL: a measure is an
aggregation of one column. The author applies the proposal and saves the model.

What the assistant read from the cache during a conversation is kept by the
browser for that conversation only, and sent back to the same provider with the
next questions, so that a follow-up can refer to it. It is data the provider was
already sent when it was read; nothing of the conversation is stored on the
server.

When no built-in visual fits, the assistant can write a **custom visual**. That
is code, so it is held to more than an uploaded one:

- Only a workspace admin is offered one, and only they can add it to the
  workspace library — the same gate as uploading a `.zip`. The proposal shows a
  preview on invented rows and the full source, to be read before adding.
- AI-written visuals are marked as such on the server (`origin = 'ai'`, sent with
  the code in `X-OpenReport-Visual-Origin`), and the client runs them in the same
  sandboxed iframe as any visual **plus** a Content-Security-Policy that closes
  every outbound channel a policy can: no fetch, no remote image, font, frame or
  form. Uploaded visuals are unchanged and may still load a library from a CDN.
- A cheap lint refuses obvious network code before the proposal is shown and
  again when it is saved. It is a first filter, not a boundary.

Known limit: no policy a document carries can stop it from navigating itself
away (`location = …`), so a hostile visual could still leak what it was given in
a URL. The client detects that navigation, takes the visual down and says so —
after the fact. Closing it needs a `frame-src` policy on the application shell,
which is tracked as follow-up work. Until then, read generated code before
adding it, as you would a `.zip` from a stranger.

The provider API key is encrypted with `DATASOURCE_ENC_KEY` and is never
returned by any endpoint. Saving a key without that variable set is refused.
Both properties are in scope for reports.
