# Rollup cache — behavioral rules (single source of truth)

This document is the authoritative spec for how the rollup cache decides
**what to materialise** (builder) and **when a runtime query can be
served from a rollup** (planner). If behavior and this document
disagree, the document wins — fix the code.

Code: `server/utils/rollupBuilder.js`, `server/utils/rollupPlanner.js`,
`server/utils/rollupDuckDB.js`. Manifest table: `rollups` (SQLite
metadata DB). Physical rollup tables: embedded `server/data/rollups.duckdb`.

---

## 1. Core idea

A rollup is a **pre-aggregated, pre-filtered table** for one
`(model, grain, baked-global-filter)` triple. At runtime the planner
rewrites a widget's `/query` to hit the smallest matching rollup instead
of the source fact table, re-aggregating on the fly. Replaces the old
GROUPING SETS warmer + `displayCache`.

Two-layer cache: rollup table (persistent, survives restart) → wrapped
by `queryCache` (in-RAM, SHA-keyed) for repeat identical requests.

---

## 2. The grain

The **grain** of a rollup = the set of dimensions a runtime query for
that widget might `GROUP BY`. The builder enumerates, per widget:

| Source | In grain? |
|---|---|
| `selectedDimensions` (+ drill prefixes for drillable widgets) | **yes** |
| `groupBy` | **yes** |
| `columnDimensions` | **yes** |
| cross-filter dims contributed by sibling widgets (every subset) | **yes** |
| widget-own fixed `widgetFilters` dims (non-measure) | **yes** |
| **global filter bar dims** | **NO — baked, see §4** |

A widget with hierarchy dims `[A,B,C]` and a drillable type yields one
grain per drill prefix: `[A]`, `[A,B]`, `[A,B,C]` (each also unioned
with groupBy/colDims and crossed with every cross-filter subset).

Empty grain (pure scorecard: no display/drill/cross-filter/own-filter
dims) **IS materialised** as a 1-row grand-total rollup, one per
distinct baked-global-filter signature. The planner serves it via an
exact match (`grain_hash == hash([])` + matching `base_filter_hash`),
emitting `SELECT <atom aggregates>` with no GROUP BY → one recomposed
row. Scorecards therefore HIT exact (instant) and never fall through to
Postgres on drill/cross-filter refresh. (As a fallback, an empty
requested grain also matches any larger rollup under the same
`base_filter_hash` and sums its atoms — used only if the dedicated
grand-total rollup is somehow absent.)

---

## 3. Drill-down (forage) — authoritative rule

> When a widget is drilled, the drill filters data **only on that
> widget**. When at the **deepest drill level**, clicking an element
> turns the widget into a cross-filter **source** that filters the
> **other** widgets.

Consequences:

- **Own-widget drill**: drilling widget W to level _i_ → W requests
  `dimensionNames = dims[0..i]` plus a `widgetFilter` pinning the
  clicked parent value(s). Those parent dims are hierarchy dims, hence
  already in W's grain → the planner re-applies the pin at query time
  against the rollup. Other widgets are untouched (W's drill state never
  enters their request).
- **Leaf cross-filter**: only at the deepest level does W emit a filter
  on the **leaf** dim to sibling widgets. The builder covers this
  because `crossFilterDimsForWidget` folds a source widget's display
  dims into every other widget's cross-filter subsets, so the target
  widget's grain contains the leaf dim and the planner applies the
  cross-filter `WHERE` at runtime.
- Intermediate drill levels do **not** cross-filter siblings (only the
  leaf does). _v1 note: the builder currently adds a drillable source's
  whole hierarchy (not just the leaf) to sibling cross-filter subsets —
  this over-generates grains (more/larger rollups) but is not
  incorrect; the planner still matches. Tightening to "leaf only" is a
  future optimization._

Drill is **fast from a rollup only for additive measures** (see §6). A
ratio/AVG drilled above its stored grain → MISS → live fact query.

---

## 4. Global filter bar — baked at build (2026-05 decision)

The report's **global filter bar** is NOT in the grain. Instead the
builder bakes the currently-selected values into the rollup:

- For each widget the builder computes
  `prepareGlobalRulesForWidget(settings.reportFilters, widgetId)` — the
  same effective rule set the client merges into the widget's
  `widgetFilters` at runtime (per-widget **exclusions already applied**).
- Those rules are passed to the build `/query` call as `widgetFilters`.
  `/query` applies them through the **model join graph**, exactly as at
  runtime. A global filter on a dim with **no join relation** to a
  widget is therefore **not** applied to that widget (build == runtime
  — the "ne pas figer les visuels sans interaction" rule is satisfied
  by delegation to `/query`, never by forcing a dim/WHERE manually).
- The normalized rule set is stored as `base_filters` and hashed into
  `base_filter_hash`, which participates in the manifest UNIQUE key and
  the physical table name. Two widgets at the same grain but different
  global selection / exclusion sets get **distinct** rollups.

**Runtime matching**: the planner loads `settings.reportFilters` via
`reportId`, splits the request's `widgetFilters` into:

- **global portion** — rules whose `field|op` matches a `reportFilters`
  rule (exclusions already applied client-side). Its normalized hash
  must equal the rollup's `base_filter_hash`.
- **runtime portion** — everything else (cross-filter, drill pin,
  widget-own). Applied as `WHERE` against the rollup at query time.

If the user **changes the global filter bar selection**, the hash no
longer matches any rollup → **MISS → live fact query** until the next
refresh rebuilds that slice. This is the explicitly accepted tradeoff
(small/fast rollups vs. rebuild-on-global-filter-change). Cross-filter
and drill stay fast because they are runtime-applied, not baked.

---

## 5. Filter precedence summary

| Filter kind | Where it lives | When applied |
|---|---|---|
| Global filter bar | baked into rollup data | build time (`/query` join graph) |
| Cross-filter (sibling → widget) | grain dim | runtime `WHERE` on rollup |
| Drill parent-pin (own widget) | grain dim | runtime `WHERE` on rollup |
| Widget-own fixed filter | grain dim | runtime `WHERE` on rollup |
| Measure filter (HAVING) | — | not rolled up; widget falls through |
| `top_n` / `bottom_n` | — | applied in memory after rollup query |

---

## 6. Measures — additive vs non-additive

The planner **always** `GROUP BY` the requested display dims and
re-aggregates the rollup. Whether that is correct depends on the
measure (`server/utils/measureType.js: additiveTypeForMeasure`):

- **Additive** — `sum`, `count` → `SUM(col)`; `min` → `MIN(col)`;
  `max` → `MAX(col)`. Always correct for any rollup whose
  grain ⊇ (displayDims ∪ runtime-filter dims).
- **Non-additive but decomposable** — `avg`, ratios (`${a}/${b}*N`),
  and custom expressions whose `${refs}` are all additive. The builder
  does **not** store the final value; it stores the additive
  **components** (`measureType.componentPlanForMeasures`):
  - `avg(col)` → two columns `_avg_<t>_<col>_sum` (SUM) +
    `_avg_<t>_<col>_count` (COUNT), injected as synthetic
    `extraMeasures`.
  - ratio `${a}/${b}` → the named ref measures `a`, `b` (recursively
    decomposed) fired by name.
  - expression → each `${ref}` (additive) fired by name.
  Each atom column has a stored re-agg fn (SUM / MIN / MAX). At runtime
  the planner `GROUP BY` display dims, re-aggregates the atoms in SQL,
  then **recomposes the final value in JS per row**
  (`measureType.recomposeMeasure`): `sum/count` for AVG,
  `(num/den)*scale` for ratios, the compiled expression for custom.
  This is correct at **any** grain ≥ the rollup grain — drill-up and
  coarser views stay fast.
- **Non-decomposable** — `COUNT(DISTINCT)`, median/percentile, ratio
  whose refs aren't additive, expression that won't transpile. The
  planner returns `MISS: non-decomposable:<measure>` → live fact query.

The rollup `measures` manifest column stores the recipe:
`{ outputs:[{name,label,spec,supported}], atoms:[{col,agg}] }`. The
planner reads it; no model lookup needed at query time.

---

## 7. RLS

If row-level security applies to the requesting user
(`rlsApplies === true`), the planner **MISSes** (rollups are built under
the trigger user's visibility; serving a row-limited user would leak).
Owner/admin (no RLS) is served normally.

---

## 8. Build contract

`buildRollupsForModel({ modelId, internalUserId, orgId })`:

1. Walk every report on the model. Per report parse `widgets` +
   `settings` (extras + `reportFilters`).
2. Per widget: enumerate grains (§2, no global dims), compute the
   baked global rule set + its hash (§4), collect the report's measure
   union (resolvable under that report's extras).
3. Plan item = `(grain, baseFilterHash)` deduped across the model.
   Larger grains build first.
4. Per item fire `/query` over loopback with: `dimensionNames = grain`,
   `measureNames = report measure union`, `widgetFilters = baked global
   rules`, `reportId` + extras, `_rollupBuilder: true` (skips the
   planner, gets a 10-min timeout, bypasses queryCache).
5. Land the aggregated rows in `rollups.duckdb` (columns keyed by
   dim/measure **name**; the `/query` response is keyed by `label||name`
   — `buildNameLabelMaps` bridges that, extras included).
6. Upsert the manifest row; GC manifest rows + DuckDB tables no longer
   in the plan (keyed by `grain_hash::base_filter_hash`).

`storage_mode`: `'duckdb'` (default) or `'source'` (per-datasource
opt-in, **not implemented in v1** — throws 501).

Triggers: `POST /api/rollups/run-now/:modelId`, the report Refresh
button (`/api/cache-schedules/run-now/:reportId`), and scheduled
`cache_warm` (`cacheScheduler`). No boot-warm — rollups persist across
restarts. Model edit / datasource change drops the affected rollups.

---

## 9. Runtime planner contract

In `POST /api/models/:id/query`, before any fact SQL:

1. Skip if `sqlOnly` or `_rollupBuilder`.
2. MISS if RLS applies.
3. Split `widgetFilters` → global vs runtime (§4). Compute
   `baseFilterHash` from the global portion.
4. Requested grain = `dimensionNames ∪ runtime-filter dims` (object
   `filters` IN-lists are runtime).
5. `findBestRollup`: smallest rollup with `grain ⊇ requested` **and**
   `base_filter_hash == request hash` (exact-grain preferred).
6. Build `SELECT displayDims, reagg(measures) FROM rollup
   WHERE <runtime filters only> GROUP BY displayDims ORDER BY dim1
   LIMIT n`. Global filters are **not** re-applied (already baked).
7. Execute against DuckDB; apply `top_n/bottom_n` in memory; return
   with `_cache.fromRollup` + `rollupMatch`.

Any MISS → fall through to the existing live fact-query path unchanged.

---

## 10. MISS reasons (diagnostic reference)

Logged as `[qXXXX] rollupPlanner MISS:<reason>`.

| reason | meaning | fix / expected? |
|---|---|---|
| `rls-restricted` | requester has RLS | expected; owner/admin only |
| `no-rollup` (empty grain) | scorecard whose baked-filter hash matches no built rollup | global bar changed → rebuild |
| `measure-not-model:<m>` | measure unresolved | check binding/model |
| `no-measures` | request had no measures | expected |
| `no-rollup` | no rollup matches grain **and** baked-filter hash | rebuild, or global filter changed |
| `non-decomposable:<m>` | measure can't be split into additive atoms (COUNT DISTINCT, median, non-additive refs) | expected (see §6) |
| `no-atoms` | manifest has no component columns (stale pre-decomposition rollup) | rebuild |
| `source-storage-unsupported` | rollup `storage_mode='source'` | v1 limitation |
| `unsupported-op:<op>` | a widgetFilter op the planner can't emit | extend `scalarClause` |
| `duckdb-error:<msg>` | rollup SQL failed | investigate; falls back to fact |

---

## 11. Known v1 limitations

- Non-decomposable measures (COUNT DISTINCT, median, ratio of
  non-additive refs) → fact (§6). Decomposable ratios/AVG/expressions
  are served at any grain.
- Pure scorecards: dedicated 1-row grand-total rollup per baked-filter
  signature → served exact, no Postgres hit.
- Changing the global filter bar selection → MISS until rebuild (§4).
- Two reports on the same model colliding on
  `(grain, base_filter)` overwrite — last build wins.
- Per-rollup `bytes` in the manifest equals row count (DuckDB
  `estimated_size` is cardinality, not bytes). No longer surfaced in the
  UI — the admin dashboard and the per-report inspector both show the
  real on-disk size (`fs.statSync` of `rollups.duckdb`) + row counts.
- Cross-filter grain over-generation for drillable sources (§3 note).
- `storage_mode='source'` not implemented.

---

## 12. Cloud parity

The cloud edition mirrors this architecture. OSS-mirror files
(`server/routes/*`, `server/utils/*`, `server/db/index.js`) are copied
verbatim. The genuine forks that were Phase-B-ported by hand:
`server/cloud/routes/models.js` (tenant-scoped /query shadow — rollup
planner block + GROUPING SETS removed, org-scoped via
`req.organizationId`) and `server/cloud/scheduler.js` (`cache_warm`
kind → `rollupBuilder.buildRollupsForModel`). `server/cloud/index.js`
and `server/cloud/routes/billing.js` dropped the in-RAM preAgg quota
(rollups are on disk; per-org rollup-disk quota is a future Phase-C
item). Legacy modules deleted in both repos. The 46 tenant-isolation
jest tests pass post-mirror. Per workflow: OSS is validated first, then
cloud is validated on a deployment before any push.

## 13. When you (or an agent) change rollup behavior

Update **this document first**, then the code, then the project memory
note. The user should not have to re-explain these rules.
