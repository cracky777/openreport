# Open Report API (v1)

For driving Open Report from a script — typically an ETL job that refreshes a
model's cache once its pipeline has finished loading data.

Everything the browser does goes through `/api/*`, but only `/api/v1` accepts an
API token. That boundary is deliberate: a route added elsewhere in the app can
never become token-reachable by accident.

## Turning the API on

**The API ships disabled.** An Open Report instance holds credentials to every
database it connects to, so the surface that answers to a bearer string is
opt-in. An admin enables it in Admin › **API**, and picks who may hold a token:
admins only (the default), admins and editors, or everyone.

Admin › API also lists **every token on the instance** — who owns it, its
scopes, when it was last used — and lets an admin revoke any of them, which cuts
one integration without switching the API off or changing anyone's role.
Creating a token stays personal: there is no way to issue one in someone else's
name, which would forge an identity and break the audit trail.

Both settings are enforced on every call, not just at mint time. Switching the
API off refuses every token at once — there is nothing to revoke — and raising
the role floor, or demoting a user, kills the tokens they already hold.

## Getting a token

Once the API is on, Account menu › **API tokens** (or Admin › API for an admin)
› name it, pick its scopes, Create. The token is shown
once and never again — the server stores only a SHA-256 digest of it, so a lost
token is replaced, not recovered.

A token authenticates **as the user who created it** and gets no more access
than that user has. Row-level security, model ownership and workspace
membership apply exactly as they do in the browser.

| Scope | Grants |
|---|---|
| `read` | List models and reports |
| `refresh` | Rebuild a model's cache |

There is no `write` scope. Editing a model means feeding SQL to the compiler,
which is the most sensitive surface in the app; opening that to tokens is a
decision to take on its own rather than a default.

## Authentication

```
Authorization: Bearer orp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

A token that is unknown, revoked, expired, or whose owner has been deleted gets
`401`. A valid token missing the scope a route needs gets `403`.

Requests are rate-limited to 60 per minute per IP.

## Endpoints

### `GET /api/v1/whoami`

Who the token belongs to and what it may do. No scope required — useful to check
a token is live before wiring a job around it.

```json
{
  "user": { "id": "…", "email": "you@corp.io", "role": "editor" },
  "scopes": ["read", "refresh"]
}
```

### `GET /api/v1/models` — scope `read`

```json
{ "models": [{ "id": "…", "name": "Sales", "description": "", "updated_at": "2026-09-07 09:12:00" }] }
```

### `GET /api/v1/reports` — scope `read`

`cache_built_at` is when that report's data was last rebuilt.

```json
{ "reports": [{ "id": "…", "title": "Q3 review", "model_id": "…", "updated_at": "…", "cache_built_at": "…" }] }
```

### `POST /api/v1/models/:id/refresh` — scope `refresh`

Rebuilds every rollup the model needs, invalidates its query cache and stamps
`cache_built_at` on all of its reports. Synchronous: the response comes back
when the rebuild is done, so a job can block on it.

```bash
curl -X POST https://reports.example.com/api/v1/models/$MODEL_ID/refresh \
  -H "Authorization: Bearer $OPENREPORT_TOKEN"
```

```json
{ "model_id": "…", "refreshed_at": "2026-09-07T09:31:44.120Z", "result": { … } }
```

### `POST /api/v1/reports/:id/refresh` — scope `refresh`

The same rebuild, addressed by report instead of by model. The UI has two
buttons — "rebuild rollups" on a model and "warm now" on a report — but both
already run the same rebuild; the split is only about which id you happen to
hold. Use whichever your job knows about.

## Errors

| Status | Meaning |
|---|---|
| `400` | The report has no model attached |
| `401` | Missing, invalid, revoked or expired token |
| `403` | The token lacks the scope this route needs, or its owner's role is below the instance floor |
| `404` | No such model or report **for this token's owner** — an id you cannot see is indistinguishable from one that does not exist |
| `429` | Rate limit exceeded |
| `501` | The datasource's rollup storage doesn't support a rebuild |
| `503` | The API is switched off on this instance |

## Stability

`/api/v1` is a frozen contract: fields get added, never removed or renamed.
Anything breaking goes to `/api/v2`. The rest of `/api` follows the UI and can
change at any time — don't build against it.
