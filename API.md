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
| `metadata` | Describe reports and their semantic models for a data catalog: read-only, no data (see [Metadata](#metadata)) |
| `glossary` | Write the descriptions and synonyms of a model's fields, nothing else (see [Glossary](#glossary)) |
| `query` | Run a semantic query on a model: measures by dimensions. **Returns data** (see [Query](#post-apiv1modelsidquery--scope-query)) |

There is no `write` scope. Editing a model means feeding SQL to the compiler,
which is the most sensitive surface in the app; opening that to tokens is a
decision to take on its own rather than a default. `glossary` writes words
only — descriptions and synonyms — never SQL, a role or a structure.

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

### `POST /api/v1/models/:id/query` — scope `query`

Ask the semantic model for measures by dimensions, by name. Open Report
compiles the SQL in the source's dialect and answers from the rollups or the
query cache when it can, exactly as it does for a report widget: same access
check, same row-level security. This is the endpoint an assistant or a script
uses to read figures without writing SQL. Field names are the ones
`GET /api/v1/metadata/models/:id` lists.

```json
{
  "measureNames": ["Revenue", "Orders"],
  "dimensionNames": ["Month"],
  "filters": {
    "Country": ["France", "Belgium"],
    "Order date": { "op": "between", "value": ["2026-01-01", "2026-10-31"] }
  },
  "limit": 100
}
```

- `measureNames`, `dimensionNames`: arrays of field names; at least one of the two.
- `filters` (optional): per dimension, a list of values (`IN`) or a range
  `{ "op": "between", "value": [from, to] }`.
- `limit` (optional, default and maximum 5000), `offset` (optional).

The answer is the widget payload: `rows` (one object per row, keyed by field
name), plus cache information. Any other field of the body is ignored.

## Metadata

For a data catalog — OpenMetadata, typically — that maps Open Report's reports
and semantic models next to the warehouse they read: which report shows which
measure, how each measure is computed, and from which physical columns.

Every route below needs the **`metadata`** scope and is **read-only**. Nothing
here returns a row of data or opens a connection to a source: only the
description of reports and models, as stored in Open Report and as its own SQL
compiler writes it.

### Who sees what

1. **The workspaces the token's owner is a member of.** Create an account
   dedicated to the catalog (e.g. `openmetadata@corp.io`), member of the
   workspaces to catalog and nothing else; its token acts as that account. Being
   a global admin does not widen this list: membership decides.
2. **`?workspace=`** narrows it further: workspace ids or names, repeated or
   comma-separated (`?workspace=Nyukom,Sales`). A workspace the account is not
   in stays out even when named.
3. Inside those, every object goes through the same checks as in the browser —
   the reports and models the account may read, the sources whose settings it
   may see.

**Make the catalog account an editor** of the workspaces whose reports define
SQL measures of their own (`settings.extraMeasures`): Open Report only ever
compiles a report's own SQL for someone who could write it on the model. As a
viewer, those measures come back with `compiled_sql_scope: "needs_model_editor"`
and no SQL. The token itself stays read-only whatever the role.

### Common shape

- Every response carries `metadata_format: 1`.
- Lists are sorted by `id` and paginated: `?limit=` (default 100, at most 500;
  20 and 50 for the lists that compile SQL) and `?after=<last id>`; the
  response's `next` is the cursor for the following page, `null` on the last one.
- Every object has `updated_at` and a `hash` (SHA-256 of its definition): fetch
  again only what changed.
- An id outside the caller's scope is a `404`, exactly like one that does not exist.

### `GET /api/v1/metadata/workspaces`

```json
{ "metadata_format": 1, "workspaces": [{ "id": "…", "name": "Nyukom", "description": "", "is_personal": false, "updated_at": "…", "hash": "…" }], "next": null }
```

### `GET /api/v1/metadata/datasources`

The sources behind the models in scope (and those homed in its workspaces) that
the account may see the settings of. Where a source is, **never how to log in**:
no user, password, key, token or connect string — nothing of `extra_config` but
a short list of non-secret keys (`projectId`, `dataset`, `location`, `catalog`,
`instanceName`, `account`, `warehouse`, the default schema).

```json
{ "metadata_format": 1, "datasources": [
  { "id": "…", "name": "Nyukom warehouse", "workspace_id": "…", "type": "database", "db_type": "postgres",
    "host": "pg.nyukom.local", "port": 5432, "db_name": "dwh", "default_schema": "public", "updated_at": "…", "hash": "…" },
  { "id": "…", "name": "budget.xlsx", "workspace_id": "…", "type": "file", "db_type": "duckdb",
    "default_schema": "main", "files": ["budget.xlsx"], "updated_at": "…", "hash": "…" }
], "next": null }
```

Map a database source to the catalog's database service by `host`, `port` and
`db_name`. A source has no modification date: `updated_at` is its creation, the
`hash` changes when it does.

### `GET /api/v1/metadata/models`

Summaries: `id`, `name`, `description`, `workspace_id`, `domains`, `updated_at`,
`hash`. With **`?include=all`**, the full models below (20 per page by default),
so a complete ingestion takes a handful of calls.

### `GET /api/v1/metadata/models/:id`

The semantic model, resolved.

- `datasources`: the model's own source (`primary: true`) and the files linked
  to it, with the `alias` their tables carry in the model.
- `tables`: `{ datasource_id, schema, table, alias_in_model, columns: [{ name, type }] }`.
  The columns are those the model reads (dimensions, measures, joins, type
  overrides), typed by the model's own column types: listing every column of a
  table would mean asking the source, which this API never does.
- `joins`: `from_table`, `from_column`, `to_table`, `to_column`, `join_type`, `cardinality`.
- `dimensions`: `name`, `label`, `description`, `synonyms`, `glossary_updated_at`, `role`, `table`,
  `column`, `expression` (raw SQL of a calculated dimension), `type`, and for a
  part of a date `date_part` and `date_part_of`.
- `measures`: see below.
- `rls`: only `{ "has_rls": true | false }`. The rules name people and groups:
  they never leave.

A measure:

| Field | |
|---|---|
| `name`, `label`, `description`, `synonyms`, `role`, `format` | As defined in the model |
| `glossary_updated_at` | When its description or synonyms last changed (see [Glossary](#glossary)); `null` if never documented |
| `aggregation`, `table`, `column` | `custom` for a SQL measure |
| `filters` | The measure's own filter rules: `{ field, op, values }` |
| `expression` | The **raw** SQL of a `custom` measure, with its `${ref}` references; `null` otherwise |
| `runningTotal`, `periodShift`, `lastValue`, `perPeriod`, `since`, `times` | Present when the measure uses them |
| `depends_on` | The measures it references, followed recursively |
| `source_columns` | Every physical column it reads, references included: `{ datasource_id, schema, table, column }`. This is what a column-level lineage is drawn from |
| `compiled_sql` | The measure's SQL **as Open Report's compiler writes it** for the source's dialect: the expression cut out of the statement `/models/:id/query` produces for that measure alone |
| `compiled_sql_scope` | `standalone`, or why `compiled_sql` is `null` (below) |
| `compiled_sql_note` | The reason, in words |
| `compiled_query` | The whole statement `/query` writes for the measure alone, paging included. Absent on a model with row-level security, whose statements carry the reader's allowed keys |

`compiled_sql_scope` when the measure only means something inside a query:

| Scope | |
|---|---|
| `window` | A running total: a window over the periods of the visual |
| `period_shift` | Read on a period moved back: it follows the date filters of the visual |
| `per_period` | A value given per period, read once per period and item |
| `multi_fact` | Reads several fact tables: each aggregated in its own sub-query, joined on the grain (`compiled_query` shows it) |
| `rls_dependent` | Its SQL carries the reader's row-level security |
| `needs_model_editor` | A report's own SQL measure, compiled only for an editor of the model's workspace |
| `not_compiled` | The compiler refused it (an unknown reference, a cycle…): the note says why |

```json
{
  "name": "_calc.taux_decroche",
  "label": "Taux de décroché",
  "aggregation": "custom",
  "expression": "${appels_decroches} / NULLIF(${appels_recus}, 0)",
  "depends_on": ["appels_decroches", "appels_recus"],
  "source_columns": [
    { "datasource_id": "…", "schema": "nyukom_appel_entrant", "table": "f_appel_entrant_agg", "column": "id_status" },
    { "datasource_id": "…", "schema": "nyukom_appel_entrant", "table": "f_appel_entrant_agg", "column": "id_appel" }
  ],
  "compiled_sql": "CAST(COUNT(CASE WHEN … THEN \"nyukom_appel_entrant\".\"f_appel_entrant_agg\".\"id_appel\" END) AS NUMERIC) / NULLIF(CAST(COUNT(\"nyukom_appel_entrant\".\"f_appel_entrant_agg\".\"id_appel\") AS NUMERIC), 0)",
  "compiled_sql_scope": "standalone",
  "compiled_query": "SELECT (…) AS \"Taux de décroché\" FROM … ORDER BY 1 LIMIT 1000"
}
```

### `GET /api/v1/metadata/reports` and `/api/v1/metadata/reports/:id`

Published reports only: drafts are left out. Lists come 20 per page by default
(each report's own measures are compiled).

```json
{
  "id": "…", "title": "Appels entrants", "workspace_id": "…", "shared_in": [], "model_id": "…",
  "url": "https://reports.example.com/view/…", "owner": "analyst@nyukom.fr", "updated_at": "…", "hash": "…",
  "pages": [{ "id": "page-1", "name": "Vue mensuelle", "widgets": [
    { "id": "<report id>:510904bf-…", "widget_id": "510904bf-…", "title": "Appels par mois", "type": "combo",
      "measures": ["_calc.nbr_appel_fin", "_calc.ratio_traite_perdu"], "dimensions": ["_date.month_name"],
      "filters": [{ "field": "nyukom_dimension.d_client.lib_client", "op": "in", "values": ["nyukom.lmc"] }] }
  ] }],
  "dimensions": [],
  "measures": [{ "name": "_calc.ratio_traite_perdu", "expression": "…", "depends_on": [], "source_columns": [], "compiled_sql": "…" }]
}
```

A widget's `id` is unique across the instance: the report's id and the
widget's own, `widget_id`, which is unique within its report only (an imported
or duplicated report keeps its source's widget ids). Name a catalog's charts by
`id`.

A widget lists the fields it reads by name: a model's (see its model) or the
report's own (the report's `measures` and `dimensions`, shaped like a model's).
Shapes and images are left out; a text lists the fields it prints. `url` is
built from the `PUBLIC_URL` environment variable when set (the address readers
open Open Report at), from the host the request came in on otherwise.

### `GET /api/v1/metadata/models/:id/measures/:name/explain`

How a measure is computed, for a person or an AI agent. `:name` is the
measure's name or label, URL-encoded.

```json
{
  "metadata_format": 1,
  "model": { "id": "…", "name": "Nyukom" },
  "measure": { "name": "…", "label": "…", "expression": "…", "depends_on": [], "source_columns": [], "compiled_sql": "…", "compiled_sql_scope": "standalone" },
  "tree": {
    "name": "…", "label": "…", "defined_in": "model", "aggregation": "custom", "expression": "${a} / NULLIF(${b}, 0)", "filters": [],
    "references": [{ "name": "a", "aggregation": "count", "column": { "datasource_id": "…", "schema": "…", "table": "…", "column": "…" },
                     "filters": [{ "field": "…", "op": "in", "values": ["Traité"] }], "references": [] }]
  },
  "filters_applied": [{ "measure": "a", "field": "…", "op": "in", "values": ["Traité"] }],
  "rls": { "has_rls": false },
  "summary": "\"Taux de décroché\" is computed as … It uses … It reads … SQL: …"
}
```

With row-level security, `rls` says so (`has_rls: true` and a note): the figure
depends on who reads it. The rules themselves are not exposed.

### `GET /api/v1/metadata/reports/:id/measures/:name/explain`

The same, for a measure as a report reads it: the report's own measures as well
as its model's, with the report's renamings applied.

## Glossary

For a catalog that keeps a model's vocabulary in sync **both ways**: the
description and synonyms of each dimension and measure, read through
[Metadata](#metadata), are written back here. Open Report never calls the
catalog: the catalog reads, compares, and writes.

### `PUT /api/v1/metadata/models/:id/glossary` — scope `glossary`

Writes the **description** and **synonyms** of a model's fields, nothing else:
roles and business domains stay managed in Open Report, and a `role` sent here
is ignored (and said so). The token's owner needs the right to document the
model in the browser — the same as Let's Talk's « Remember » card: anyone who
may build reports on it. The model's `updated_at` moves, like any change made to
the model by that user.

```json
{
  "synonyms_mode": "replace",
  "fields": {
    "_calc.nbr_appel_fin_perdu": {
      "description": "Appels entrants terminés au statut « Perdu ».",
      "synonyms": ["appels perdus", "appels manqués"]
    }
  }
}
```

- `synonyms_mode`: `"add"` (default) adds the synonyms given to those the field
  has, as the browser does; `"replace"` sets the list to exactly those given, so
  a synonym removed in the catalog is removed here too. A field without a
  `synonyms` key keeps its own in both modes.
- A field without a `description` key keeps its description; `""` or `null`
  clears it.
- A field set to `null` loses its description and synonyms (never its role).
- Bounds: a description is cut to 200 characters, a synonym to 40, a field
  holds at most 10 synonyms (case-insensitive duplicates merged). What is cut is
  reported in `errors`.

Response:

```json
{
  "metadata_format": 1,
  "model_id": "…",
  "changed": [
    { "name": "_calc.nbr_appel_fin_perdu", "kind": "measure",
      "description": "Appels entrants terminés au statut « Perdu ».",
      "synonyms": ["appels perdus", "appels manqués"],
      "glossary_updated_at": "2026-10-27T10:14:30.031Z" }
  ],
  "errors": ["ghost: not a field of the model"]
}
```

`changed` lists only the fields whose description or synonyms really changed;
a field sent with what it already had is not in it. An unknown field, a value
of the wrong type or anything cut is in `errors` — read them rather than assume
the whole patch landed.

### `glossary_updated_at`

Every dimension and measure of [`/api/v1/metadata/models`](#metadata) carries
`glossary_updated_at`: when its description or synonyms last changed, ISO 8601
in UTC, whatever wrote them — the model editor, Let's Talk or the assistant, a
YAML import, a report migrated onto the model, or this API. `null` for a field
never documented. It is computed by the server from what the field was, never
taken from a request. For a change made on both sides, compare it with the
catalog's own date: the most recent wins.

## OpenMetadata (read by the AI assistant)

The other direction: Open Report's assistant **reads** OpenMetadata to answer
"where does this number come from?". Nothing here is an endpoint of Open
Report; it is what Open Report calls, and what leaves for the AI provider.

- **Setting** — Admin › AI › Data catalog — OpenMetadata: the URL (e.g.
  `http://localhost:8585`), the token of a **read-only bot** (OpenMetadata ›
  Settings › Bots, e.g. `openreport-mcp`; stored encrypted, never shown again),
  and the Open Report service's name there (`openreport` by default). Off by
  default. Save & test calls `initialize` then `get_user_context`, shows the
  account, and warns when it is an OpenMetadata admin. Who switched it on or
  off, and when, is shown with the switch.
- **What Open Report calls** — the MCP server (`POST <OM>/mcp`, JSON-RPC,
  Bearer token, JSON or SSE answers) and the REST API (`<OM>/api/v1`: data
  model, lineage — whose edges carry the SQL —, tables, containers). Reads
  only: of the MCP tools, only `search_metadata`, `get_entity_details` and
  `get_entity_lineage` are relayed to the assistant, `get_user_context` serves
  the test; any other name is refused before anything is sent. 30 s timeout,
  answers capped. A redirect is refused (it would carry the token).
- **`explain_field`** — the assistant names a field of the model it is
  talking about; Open Report builds the data model's FQN
  (`<service>.model.<model id>`, `<service>.model.report-<report id>` for a
  report's own fields), reads its column, then walks the lineage upstream 3
  levels per call, 6 at most, column by column through `columnsLineage`
  (`function` = the rule), at the level of tables where an edge has none. The
  answer: the field, the steps with their rule, pipeline, edge description and
  SQL (cut at 1,500 characters), the sources, the gaps, and links to
  OpenMetadata's pages. Kept 5 minutes per field.
- **What reaches the AI provider** — that answer and what the three relayed
  tools return: names of tables and columns, descriptions, calculation rules,
  SQL, pipelines. Never a row of data, never the token.
- **Who** — whoever has the assistant on a report or a model they may use:
  the question is asked in the assistant's conversation, in their own words —
  report editor, AI studio, Let's Talk, model assistant. No button.

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
