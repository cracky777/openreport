# Rollup cache — behavioral rules (single source of truth)

This document is the authoritative spec for how the rollup cache decides
**what to materialise** (builder) and **when a runtime query can be
served from a rollup** (planner). If behavior and this document
disagree, the document wins — fix the code.

Code: `server/utils/rollupBuilder.js`, `server/utils/rollupPlanner.js`,
`server/utils/rollupDuckDB.js`. Manifest table: `rollups` (SQLite
metadata DB). Physical rollup tables: **one embedded DuckDB file per
(model, GENERATION)** —
`server/data/rollups_[o<orgHash>_]m<modelHash>_g<gen>.duckdb` (cloud
prefixes the org hash). Every successful build writes a brand-new gen
file containing only that build's tables; the manifest's `table_name`
carries the `_g<gen>` suffix and the planner derives the file from it.
The OLD gen file is then referenced by nobody → deletable on **any** OS
(we never delete the file actively serving, so no fight with
node-duckdb's GC-deferred handle). A failed build never flips the
manifest, so its old gen stays referenced and is kept → **zero cache
loss**, and the fresh file is naturally tight (≈ real data size) so the
store never bloats. This replaced the earlier "single per-model file +
in-place DROP/CHECKPOINT/compaction" which could not shrink on disk
(DuckDB never truncates a file in place).

---

## 1. Core idea

A rollup is a **pre-aggregated, pre-filtered table** for one
`(model, grain, baked-global-filter, fact-table)` tuple. At runtime the
planner rewrites a widget's `/query` to hit the smallest matching rollup
instead of the source fact table, re-aggregating on the fly. Replaces
the old GROUPING SETS warmer + `displayCache`.

Two-layer cache: rollup table (persistent, survives restart) → wrapped
by `queryCache` (in-RAM, SHA-keyed) for repeat identical requests.

**Consolidation**: per baked-global-filter the builder materialises ONE
rollup at the *union* grain of every widget's grains (not one table per
widget-grain). The planner re-aggregates that base grain down to each
widget's coarser grain (superset match + `GROUP BY`). Fewer/larger
tables → far less DuckDB per-table block overhead.

**Constellation (galaxy schema)**: a model with several fact tables
sharing conformed dimensions gets ONE rollup *per fact* (joining facts
in a single query fans out cartesian on the shared dim). The planner
groups a widget's measures by fact, picks the per-fact rollup for each,
and combines them: `FULL JOIN ... USING (<conformed grain dims>)` when
there are grain dims, `CROSS JOIN` for a multi-fact scorecard, single
subquery for one fact. A measure whose `factsForMeasure` ≠ exactly one
fact (cross-fact ratio/expression, or unresolvable) → `MISS:cross-fact`.

**Conformed-grain restriction (mandatory)**: a fact's rollup grain is
clipped to the dimensions **conformed to that fact** — i.e. joined to it
in the model graph, directly or via a dim→dim (snowflake) chain, **never
reachable only through another fact**. `factConformedDimTables(joins)`
BFS-walks the join graph from each fact, never traversing a second fact,
to get its conformed dim-table set; `dimTableOf` maps each grain dim to
its table (`_date.*` extras → the model's date table). The consolidated
union grain is filtered per fact before a plan item is emitted.
Rationale — **this is not optional**: forcing a non-conformed dim into a
fact's build query gives `/query` no join path, so it comma-cross-joins
the bare tables → cartesian → the source query times out (observed: a
600s ×N timeout on `f_appel_entrant_agg` grouped by `d_destinataire`, a
dim that only joins `f_appel_entrant_fin`). Dropping the dim is correct:
a widget mixing that fact's measure with a non-conformed dim is
inherently a cartesian on the source too, so it legitimately MISSes →
live query (its pre-existing broken behaviour, not a rollup regression).
An empty post-filter grain is fine — a valid grand-total rollup. Unknown
/ unplaceable dims are kept (never silently drop a dim we can't map).

**Fact resolution** (`measureType.factsForMeasure`): a measure's fact is
`measure.table`, or — for a custom-SQL measure with no `${ref}` and an
empty `.table` — parsed from the `"schema"."fact"."col"` references in
its raw expression (`tablesInExpression`). Ratio/expression measures
union their refs' facts (cycle-guarded). This is why a calc measure like
`COUNT("s"."fact"."id")` is correctly single-fact and rollable.

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

> History note: a no-bake variant (global-filter fields as grain
> columns, sliced at query time) was tried — it removed all bar-change
> MISSes but exploded the rollup (full multi-client cube: 203k rows /
> ~10 MB vs ~2.5k / ~0.5 MB baked). Reverted to baking + N-1 (§4a).
> If you're tempted to "just put the filters in the grain", that's why
> it was rejected: size, dominated by high-cardinality bar fields.

### 4a. N-1 / period comparison — MUST be baked too

A widget doing year-over-year fires a **second** `/query` at runtime
with the year-like / full-date filter shifted **−1**
(`comparePeriod.shiftWidgetFiltersForN1`). That shifted `globalPart`
hashes to a **different** `base_filter_hash` than the main query, so:

- The builder, per widget, also bakes the **shifted slice**: for each
  baked filter that carries a year-like / full-date rule it emits an
  extra rollup whose `baseFilters` are the year-decremented rules (same
  grain, same fact). `comparePeriod` (server mirror) detects year-like
  dims via the report+model dimension defs.
- The planner needs no special path — the client sends the shifted
  filter, its `globalPart` hashes to the N-1 rollup's `base_filter_hash`,
  normal match.

This is **correctness, not just speed**: an override / filter-ignoring
measure (see §6a) served from a baked rollup that lacks the shifted
period would return a **WRONG number**, not merely be slow. If a
year-like dim isn't recognised (not in model dims / not int+name-match /
not `datePart`), the N-1 slice isn't baked → that N-1 query MISSes →
live query (safe, just slower).

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

### 6a. Filtered custom measures — two modes, only one is rollup-safe

A custom measure can carry its own `filterRules`. Two distinct modes
(set in the calc-measure form; see `client/.../DataPanel.jsx`):

1. **Intersection — `filterRules` WITHOUT `overrideFilters`** (the
   "filter context / CASE WHEN inside the aggregate" form). `/query`
   emits `SUM(CASE WHEN <rules> THEN <expr> END)`. The widget/global
   `WHERE` **still applies** to the whole query; the CASE WHEN is an
   *extra* restriction inside the already-filtered rowset. This is
   **fully rollup-safe**: the CASE-WHEN aggregate is additive, the
   builder fires `/query` with the baked global filter, the value is
   stored as a normal additive atom and re-aggregates correctly at any
   grain. `_filt.*` count-restricted measures and a ratio like
   `_calc.%` built on them are this mode → served from rollups.

2. **Override — `filterRules` WITH `overrideFilters`**. `/query` emits
   a correlated scalar subquery that **drops the visual's `WHERE` on
   the override fields** and substitutes the measure's own rules
   (`models.js: overrideMeasureInfos`). It deliberately ignores part of
   the widget/global filter. This is **NOT safely re-aggregatable from
   atoms**: the value ignores filters the atoms were grouped/baked by,
   so serving it from a rollup at any grain/filter ≠ the bake returns a
   **WRONG number**, not just a slow one.

**Implemented guard** (`measureType.isOverrideTainted`, used by
`componentPlanForMeasures`): a measure is "override-tainted" if it — or
ANY measure it transitively references (ratio num/den, expression
`${ref}`s, cycle-guarded) — has `filterRules` + `overrideFilters`.
Tainted measures are marked `supported:false`, never materialised; the
planner returns `MISS:non-decomposable:<m>` → live query → **always
correct**, just not accelerated. Intersection-mode measures are NOT
tainted (verified: `_filt.*` with `overrideFilters:false` → not
tainted → still rollup-served). **Do not** weaken this guard to
"optimise": silently wrong numbers are worse than a slow live query.

---

### 6b. Per-widget aggregation override — MISS → live (2026-05 decision)

A measure's aggregation can be overridden **per visual**: the model
measure is e.g. `sum`, but a widget displays it as `avg`
(`measureAggOverrides[name]` in the `/query` body; `models.js` applies
it at runtime **only when the model agg isn't `'custom'`**).

The builder does **not** see this. Grain/measure enumeration
(`measureNamesForWidget`) collects measure **names** only and resolves
them to **model** defs (`loadMeasureDefs`). So the rollup atoms are
materialised from the **model** aggregation — an `avg`-on-the-visual
measure whose model def is `sum` would be stored (and naively served)
as SUM. That is a **wrong number**, not just a slow one.

**Implemented guard** (`rollupPlanner.tryServeFromRollup`): the planner
receives `measureAggOverrides` and, per requested measure, MISSes with
`agg-override:<m>` when `ov && def.aggregation !== 'custom' && ov !==
def.aggregation` — the **exact** condition `models.js` uses to apply the
override. MISS → live fact query, which honours the override correctly.

**Accepted tradeoff**: a widget that overrides a measure's aggregation
is **not cache-served** (correct, just not accelerated). Materialising
the overridden variant too (enumerate `(name, effective-agg)` pairs,
decompose with the overridden agg — e.g. `avg` → the usual
`_avg_*_sum/_count` atoms — and key the manifest output by effective
agg so the planner can recompose per request) is a deliberate **future
enhancement**, not a v1 behaviour. Correctness first; never serve the
model agg when the request asked for a different one.

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
   `settings` (extras + `reportFilters`), load model+extra dim defs.
2. Partition the report's measures **by fact** (`factsForMeasure`);
   drop cross-fact / unresolved (planner falls to live for those).
3. Per baked-global-filter (`prepareGlobalRulesForWidget` per widget,
   exclusions applied), accumulate the **union** of every widget's
   grains → one consolidated grain per filter. For each baked filter
   carrying a year-like/full-date rule, also create the **N-1 shifted**
   baked filter (§4a). Plan item = `(grain, baseFilterHash, factTable)`
   deduped across the model; larger grains build first.
4. Per item fire `/query` over loopback with: `dimensionNames = grain`,
   `measureNames = that fact's decomposed fire-names`, `widgetFilters =
   baked global rules`, `reportId` + extras, `_rollupBuilder: true`
   (skips the planner, gets a 10-min timeout, bypasses queryCache).
4a. **Skip a fact group with no materialisable atoms.** If
   `componentPlanForMeasures` yields zero atom columns (every measure of
   the group is override-tainted §6a or non-decomposable §6), the build
   is **skipped — no `/query` fired**. Rationale: a measureless `/query`
   has no fact to anchor the join graph, so it comma-cross-joins the bare
   dimension tables (cartesian on the source). Skipped → no rollup for
   that (grain, fact); the planner MISSes those measures → live query
   (the correct path for them anyway). AVG-only groups have empty
   `fireNames` but non-empty synthetic atoms → NOT skipped.
   _Defense in depth_: independently of this skip, the live `/query`
   join builder (`models.js`, shared by the build-time fire) no longer
   comma-cross-joins a **filter-only table with no join path** — it
   **drops** that table and strips its dim `WHERE` clauses (RLS/security
   clauses are never dropped; a table genuinely required by
   SELECT/GROUP BY keeps the old cross-join fallback so SQL stays
   valid). So a stray global filter on an unrelated dim (e.g. a date
   filter on a fact-less slicer query) degrades to "filter ignored",
   **not** a Cartesian product / nginx timeout. The conformed-grain
   restriction (§1) and this skip remain the primary guards; the drop
   is the backstop.
5. **Blue-green at FILE level**: each build run gets one `gen` token; all
   its rollup tables are written into a brand-new
   `..._m<modelHash>_g<gen>.duckdb` file while the previous gen file
   keeps serving every query. The manifest row's `table_name`
   (`..._g<gen>`) only flips **after** that rollup's table is fully
   built. A failed build throws before the flip → manifest still points
   at the old gen file → **zero cache loss** on a transient error. The
   store is NEVER deleted up-front for a refresh.
6. Land aggregated rows (columns keyed by dim/measure **name**; `/query`
   response keyed by `label||name` — `buildNameLabelMaps` bridges, extras
   included). Upsert the manifest row → it now points at the new gen.
6b. **CHECKPOINT the gen file once** after the build loop
   (`rollupDuckDB.checkpoint(modelId, gen, orgId)`). We keep the
   connection open to serve queries, so DuckDB NEVER auto-checkpoints —
   without this the gen `.duckdb` is just a ~12 KB header and ALL the
   data sits in a sibling `.duckdb.wal` (durable via recovery, but the
   reported on-disk size is wrong and the file isn't self-contained).
   The checkpoint folds the WAL into the main file → its size is the
   true ≈ data size. (If you ever see a tiny `.duckdb` next to a big
   `.wal`, the checkpoint didn't run.)
7. **Cleanup = delete unreferenced gen files** (`pruneGenFiles`). Prune
   manifest rows no longer in the plan (no DROP TABLE — the table is in a
   gen file). Then delete every gen file whose `gen` is referenced by no
   surviving manifest row, plus the legacy single file. After a clean
   build the old gen is unreferenced → its file is opened by nobody →
   deleted on **any OS** (real disk reclaim, no handle fight; we never
   touch the gen actively serving). A fact whose build failed keeps its
   old-gen row → that gen file is kept. This *is* "delete the storage
   after the refresh and apply the new one", done safely and
   cross-platform — fresh gen file ≈ real data size, so no bloat ever.

`storage_mode`: `'duckdb'` (default) or `'source'` (per-datasource
opt-in, **not implemented in v1** — throws 501).

Triggers: `POST /api/rollups/run-now/:modelId`, the report Refresh
button (`/api/cache-schedules/run-now/:reportId`), and scheduled
`cache_warm` (`cacheScheduler`). No boot-warm — rollups persist across
restarts. Model edit / datasource change → `dropAllRollups` deletes the
model's whole DuckDB file (schema changed → rows invalid regardless;
this is the only path that deletes a store, and it's safe because the
data is invalid, not merely stale).

---

## 9. Runtime planner contract

In `POST /api/models/:id/query`, before any fact SQL:

1. Skip if `sqlOnly` or `_rollupBuilder`.
2. MISS if RLS applies.
3. Split `widgetFilters` → global vs runtime (§4). Compute
   `baseFilterHash` from the global portion (the N-1 query's shifted
   global hashes to its own baked rollup — §4a).
4. Requested grain = `dimensionNames ∪ runtime-filter dims` (object
   `filters` IN-lists are runtime). Group requested measures **by fact**
   (`factsForMeasure`); `MISS:cross-fact:<m>` if a measure ≠ 1 fact.
5. Per fact group `findBestRollup`: smallest rollup with
   `grain ⊇ requested` **and** `base_filter_hash == request hash` **and**
   `fact_table == fact` (exact-grain preferred). Any group unmatched →
   `MISS:no-rollup:<fact>`.
6. Per fact build a `SELECT <grain dims by name>, reagg(atoms) FROM
   <rollup> WHERE <runtime filters only> GROUP BY <dims>` subquery, then
   combine groups: 1 fact → single subquery; N facts + dims →
   `FULL JOIN ... USING (<dim name cols>)`; N facts + no dims (scorecard)
   → `CROSS JOIN`. Final SELECT aliases dims to label, selects all atoms;
   measures recomposed in JS (`recomposeMeasure`). Global filters are
   **not** re-applied (already baked).
7. Derive the gen from the rollup table name (`genOfTableName`); all
   fact groups must share one gen (a single connection can't FULL JOIN
   across two DuckDB files) — else `MISS:mixed-gen` (transient, only
   after a partially-failed multi-fact build; next build reunifies).
   Execute against that gen file; apply `top_n/bottom_n` in memory;
   return with `_cache.fromRollup` + `rollupMatch`.

Any MISS → fall through to the existing live fact-query path unchanged.

---

## 10. MISS reasons (diagnostic reference)

Logged as `[qXXXX] rollupPlanner MISS:<reason>`.

| reason | meaning | fix / expected? |
|---|---|---|
| `rls-restricted` | requester has RLS | expected; owner/admin only |
| `measure-not-model:<m>` | measure unresolved | check binding/model |
| `no-measures` | request had no measures | expected |
| `cross-fact:<m>` | measure resolves to ≠1 fact (cross-fact ratio/expr, or unresolvable fact) | expected (§1 constellation); not rolled up in v1 |
| `no-rollup:<fact>` | no rollup for that fact matches grain **and** baked-filter hash. Diagnostic logs `wantBf` + `runtime globalPart(norm)` + candidates' `bf/grain/baked` | global bar changed to an unbaked slice → rebuild; or an N-1 slice for a year-dim that wasn't recognised |
| `non-decomposable:<m>` | measure can't be split into additive atoms (COUNT DISTINCT, median, non-additive refs) | expected (see §6) |
| `agg-override:<m>` | the visual overrides the measure's aggregation (`measureAggOverrides`) to something the model-built rollup can't represent | expected (see §6b); v1 serves it live, correct but uncached |
| `no-atoms:<fact>` | manifest has no component columns (stale pre-decomposition rollup) | rebuild |
| `mixed-gen:<g\|g>` | a multi-fact widget's per-fact rollups are in different generation files (only after a partially-failed build) | transient — next successful build writes all facts into one gen |
| `source-storage-unsupported` | rollup `storage_mode='source'` | v1 limitation |
| `unsupported-op:<op>` | a widgetFilter op the planner can't emit | extend `scalarClause` |
| `duckdb-error:<msg>` | rollup SQL failed | investigate; falls back to fact |

---

## 11. Known v1 limitations

- Non-decomposable measures (COUNT DISTINCT, median, ratio of
  non-additive refs) → fact (§6). Decomposable ratios/AVG/expressions
  are served at any grain.
- Cross-fact measures (ratio/expression whose refs span >1 fact, or a
  measure with no resolvable fact) are not rolled up → live query
  (§1 constellation).
- Pure scorecards: served from the consolidated rollup (empty requested
  grain matches any rollup under the same baked filter; atoms summed) —
  no Postgres hit.
- Changing the global filter bar selection to an unbaked slice → MISS
  until rebuild (§4). N-1 of a baked slice IS covered (§4a) **iff** the
  year/date dim is recognised by `comparePeriod` (model dim with
  `datePart`, or int/number whose name matches a year regex); otherwise
  that N-1 query MISSes → live.
- Override / filter-ignoring measures (`filterRules` + `overrideFilters`)
  are auto-detected (`isOverrideTainted`, transitive) and forced
  `supported:false` → planner MISS → live query (always correct, not
  accelerated). Intersection-mode filtered measures stay rollup-served.
  See **§6a**; never weaken the guard to "optimise".
- Per-widget aggregation override (`measureAggOverrides`, e.g. a `sum`
  model measure shown as `avg` on the visual) is **not cache-served**:
  the builder materialises the model aggregation only, so the planner
  MISSes (`agg-override:<m>`) → live query (correct, not accelerated).
  Materialising the overridden variant is a future enhancement. See
  **§6b**; never serve the model agg when the request overrode it.
- Two reports on the same model colliding on
  `(grain, base_filter, fact)` overwrite — last build wins.
- Per-rollup `bytes` in the manifest is an estimate (row count ×
  sampled row width). Real on-disk size = `fs.statSync` of the model's
  DuckDB file: admin dashboard sums all model files
  (`totalStoreBytes`); the per-report inspector shows that model's file
  (`modelStoreBytes`) distributed across its rollups.
- DuckDB never truncates a file in place — solved by **per-generation
  files** (§intro, §8.5–8.7): each build writes a fresh tight file and
  the old one is deleted once unreferenced. Real OS reclaim on every OS
  (the deleted file is never the one open). Transient extra disk during
  a build = old gen + new gen coexist until the manifest flips + prune.
  A partially-failed multi-fact build can leave a widget's facts split
  across gens → `MISS:mixed-gen` until the next clean build.
- Cross-filter grain over-generation for drillable sources (§3 note).
- A widget that mixes a fact's measure with a dim NOT conformed to that
  fact is not rollup-servable (the conformed-grain restriction drops the
  dim from that fact's grain) → MISS → live query. That live query is
  itself a cartesian on the source (no join path) — a pre-existing
  modelling issue, surfaced not caused by the rollup layer.
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
