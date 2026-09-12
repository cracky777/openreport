# Architecture

A map for someone about to change something. It answers two questions: how a
chart on a screen becomes SQL against your database, and which file to open for
which kind of change.

Read this before the code. The interesting parts of Open Report are not in any
single file — they are in the path a query takes through six of them.

## The three objects, and why the order matters

Everything rests on three things, each built on the one before:

1. **A datasource** is a connection: credentials for a PostgreSQL, MySQL, SQL
   Server, BigQuery or DuckDB database. Nothing more.
2. **A model** is the semantic layer over that connection: which tables, how
   they join, which columns are *dimensions* (things you group by) and which are
   *measures* (things you aggregate), plus row-level security rules and column
   type overrides. This is where meaning lives. A measure defined once is
   correct in every report that uses it.
3. **A report** is a layout: pages of widgets, each widget bound to some
   dimensions and measures *of one model*, with its own filters and formatting.

A report never talks to a database. It talks to its model, and the model knows
how to build SQL. That indirection is the whole design, and most bugs that look
like report bugs are model-compilation bugs.

Models and reports are stored as JSON columns in SQLite. See
`server/db/schema.sql`, and `server/db/modelRow.js` for `parseModel()`, which
inflates a row into the object the compiler expects.

## The path of a query

This is the sequence worth knowing by heart.

```
widget on the canvas
  │  the client turns its binding into a payload: dimensionNames, measureNames,
  │  filters, widgetFilters, limit…            client/src/utils/widgetQueryPayload.js
  ▼
POST /api/models/:id/query                     server/routes/models.js
  │  parseModel() → the semantic layer
  │  each measure is decomposed: is it a plain aggregate, an expression over
  │  other measures, a ratio, a distinct count?     server/utils/measureType/
  │  the SQL is assembled piece by piece:            server/utils/sqlBuilder/
  │     joinGraph / fromClause  — which tables, joined how
  │     measureAgg / measureSelect — the SELECT list
  │     filterClause / overrideSubquery — WHERE, and filters that must not apply
  │     orderLimit — ORDER BY, LIMIT, Top N
  │  dialect differences (quoting, date parts, casts)  server/utils/sqlDialect.js
  │  row-level security is applied LAST, and cannot be opted out of  utils/rls.js
  ▼
rollupPlanner                                  server/utils/rollupPlanner.js
  │  can this query be answered from a pre-aggregated rollup instead of the
  │  live database? if yes, it is rewritten against the rollup.
  ▼
queryCache                                     server/utils/queryCache.js
  │  keyed on a hash of { datasourceId, sql, rlsContext } — so a cache entry can
  │  never be served to a user whose RLS differs. `bypassCache` skips it.
  ▼
dbConnector                                    server/utils/dbConnector.js
  │  executes against the external database, or against a rollup DuckDB file
  ▼
rows → the widget renders                      client/src/components/Widgets/
```

If a report shows wrong numbers, walk that path downwards. The fastest first
step is almost always to read the generated SQL: select the widget and click the
code icon ("View the SQL query").

## Where things live

### Server (`server/`) — Node, CommonJS, Express 4

| Path | What it is |
|---|---|
| `routes/models.js` | The compiler and the `/query` handler. The heart of the project, and the largest file in it. |
| `utils/sqlBuilder/` | SQL assembled in pieces: joins, the select list, filters, ordering, casts. |
| `utils/measureType/` | Decomposing a measure into something executable — the part that makes ratios and distinct counts work. |
| `utils/sqlDialect.js` | Everything the five dialects disagree about. |
| `utils/rls.js` | Row-level security. A regression here leaks one customer's rows to another. |
| `utils/rollup*.js` | The pre-aggregation cache: builder, planner, DuckDB storage. Spec in `ROLLUP-CACHE.md`. |
| `utils/dbConnector.js` | The drivers, and the pooling around them. |
| `routes/` | One router per resource: reports, datasources, workspaces, admin, auth… |
| `db/` | SQLite schema, idempotent `ALTER` migrations in `index.js`, `parseModel()`. |
| `cloud/` | Extension point. A no-op stub in this repository. |

### Client (`client/`) — React 19, Vite, plain JSX

| Path | What it is |
|---|---|
| `pages/Editor.jsx` | The report editor: state, save, undo/redo, the fetch orchestration. |
| `components/Canvas/` | The canvas and each positioned widget. Drag, resize, merge, z-order. |
| `components/PropertyPanel/` | Everything configurable about a widget: field wells, filters, formatting. |
| `components/DataPanel/` | The field list, and its own fetch for the selected widget. |
| `components/Widgets/` | One component per visual type, plus the shared chart helpers. |
| `hooks/useWidgetFetch.js` | The editor's fetch loop: what refetches, when, and what must not. |
| `utils/` | Pure functions, and the place to add logic you want tested. |

State is hooks and contexts. There is no Redux, and no TypeScript anywhere.

## Two subsystems worth understanding before you touch them

**Row-level security** (`utils/rls.js`) is applied at the end of compilation, to
every query, and there is no path that skips it. It is also the boundary between
tenants. If you are changing how SQL is assembled, the question to ask is not
"does this work" but "can this be made to return a row the user should not see".

**The rollup cache** (`ROLLUP-CACHE.md` is the source of truth, and is expected
to stay aligned with the code) pre-aggregates a model into DuckDB files so that
common queries do not hit the live database. The planner decides per query
whether a rollup can answer it. Getting that decision wrong does not produce an
error — it produces wrong numbers, silently, which is why the planner is
deliberately conservative and sends anything unusual to the live path.

## Fetching, on the client

Two things fetch widget data, and confusing them causes real bugs:

- `hooks/useWidgetFetch.js` — the editor's loop. It watches every widget's
  binding signature and refetches the ones that actually changed.
- `components/DataPanel` — its own effect, for the **selected** widget.

A slicer is deliberately skipped by the loop: its values are a `DISTINCT` on one
column, not the aggregate the loop knows how to ask for, so it is refreshed
through its own path.

## Tests

```bash
cd server && npm test        # Jest — 67 suites: routes, authorization, RLS, SQL snapshots
cd client && npm test        # Vitest — the pure utilities
cd client && npm run lint    # ESLint (the server is not linted yet — patches welcome)
npm run test:e2e             # Playwright, from the repository root
```

The end-to-end suite exists for behaviour no unit test can see: a fetch that must
survive a component unmounting, a drag that must land in the right well, a
separator that must be painted at the right layer. Several of its specs were
written by reintroducing the bug to check that the test actually fails — if you
add one, do that too. A test that passes either way is worse than no test,
because it will be believed.

`npm run test:e2e` builds the client first. Running `npx playwright test`
directly serves whatever was built last, which is an excellent way to prove that
a broken change works.

## Large files

Four files carry more than they should. They are being split, and a pull request
that moves a coherent piece out of one of them — *without changing behaviour*,
and ideally behind existing tests — is welcome.

| File | Lines |
|---|---|
| `client/src/components/PropertyPanel/PropertyPanel.jsx` | ~2280 |
| `server/routes/models.js` | ~2220 |
| `client/src/pages/Editor.jsx` | ~2070 |
| `client/src/pages/Dashboard.jsx` | ~1720 |

## Conventions

- JavaScript only. Server is CommonJS, client is ESM. Functional components.
- Comments explain **why**, not what. No banners, no `[INFO]` logging, no "Step
  N" narration.
- `catch { /* the reason */ }` — never an uncommented empty catch.
- Delete dead code rather than commenting it out; the history keeps it.
- User-facing strings are in English. The interface has no translations.

## Security-sensitive surfaces

Read these carefully before changing them, and say in your pull request that you
did:

- **SQL assembly** (`routes/models.js`, `utils/sqlBuilder/`, `sqlDialect.js`).
  Every identifier and value coming from a model or a payload must pass through
  `quoteIdent` / `quoteLiteral`, or be coerced to a number. No raw interpolation,
  ever.
- **Access control** — `utils/rls.js`, and the `canAccessReport` / `canAccessModel`
  checks.
- **Secrets** — `SESSION_SECRET`, `INTERNAL_TOKEN_SECRET`, `DATASOURCE_ENC_KEY`.
  See [SECURITY.md](SECURITY.md).
