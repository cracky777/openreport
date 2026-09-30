# Changelog

All notable changes to OpenReport are listed here. Versions follow
[Semantic Versioning](https://semver.org/); each one is a git tag and a
`ghcr.io/cracky777/openreport` image.

## 0.4.0 — 2026-09-30

- **A data model can read several imported files.** Each imported file is a
  data source of its own; a model built on one can link others (Import a file
  or Add a data source, in the model editor's Tables step) and join their
  tables. A file used by several models is refreshed once. Imports run in a
  separate process and the server opens imported files read-only.
- **Relationship detection.** Tables added to a model arrive joined by the
  foreign keys the database declares, and Detect relationships also joins them
  by key column names (customer_id, id_customer, FK_customer…), from fact to
  dimension tables, without loops. A join between columns of incompatible types
  is flagged.
- **Model editor: search a table's fields.** The magnifier at the left of a
  table's FACT / DIM bar opens a search; D all / M all flag every match as a
  dimension or a measure at once.
- **AI assistant: take part of a proposal.** Each line of a card (a visual, a
  design change, a join, a column…) can be unticked; only the ticked ones are
  applied, and the assistant is told what was kept.
- **Title color** for every visual (Frame › Title color), which the Design
  assistant can now set too.
- **Journey overview**: the three stages side by side with their links;
  following a link highlights the branch instead of filtering the columns.
- A new report is a draft until its first save: leaving the editor without
  saving leaves no empty report behind, and a report created from the model
  editor lands in the open workspace.
- Reports shared into a workspace can be edited there by its editors and
  admins (deleting stays with the report's own workspace).
- The report editor's canvas works with a finger on phones and tablets.
- Lists reload when coming back from an editor.
- **Deleting an imported data source deletes its file.** The source's DuckDB
  file used to stay on disk after the source was deleted, and so did the
  previous version of a re-imported file when it could not be removed at once:
  the data of deleted sources remained on the server. A file the system still
  holds (Windows) is retried at the next start.

  **Upgrading.** Files already left behind are not removed automatically. List
  them, then delete them, with:

  ```
  docker compose exec openreport node server/scripts/cleanupOrphanDuckDB.js
  docker compose exec openreport node server/scripts/cleanupOrphanDuckDB.js --delete
  ```

  (`node scripts/cleanupOrphanDuckDB.js` from `server/` outside Docker.) Only
  files no source points at are touched, and none modified in the last hour.

## 0.3.0 — 2026-09-27

- **Rights on data sources and data models, by workspace.** Each source and
  each model now lives in one workspace and can be shared into others: a
  shared source lets that workspace's editors build models on it, a shared
  model lets them build reports on it. Sharing a model never shares its
  source. Viewers read reports and their data; editors see the workspace's
  sources and models, create models and build reports; workspace admins hold
  credentials, delete, move, share, set RLS and drive the cache. A new
  workspace starts empty, and My Reports shows only your personal workspace.
  A report can be shared read-only with other workspaces (Share report), as
  long as its model is available there.

  **Upgrading.** On first start, every existing source and model moves to its
  creator's personal workspace, and each model is shared into the team
  workspaces whose reports already use it, so every report keeps working.
  Sources are not shared: share one explicitly for another team to build new
  models on it. The instance admin still manages everything, but no longer
  reads data (queries, source preview, RLS bypass) in a workspace where they
  hold no role.
- Admin › Resources lists every source, model and report of the instance, with
  its creator, workspace and shares, and deletes them in dependency order.
- Import a Power BI template (.pbit) as a data model plus a report, from the
  single Import menu (Open Report or Power BI).
- Filtered measures follow Power BI's CALCULATE semantics: a measure's filter
  on a dimension the visual groups by replaces that grouping instead of
  intersecting it. New
  period-shifted measures (same period last year and similar), set from the
  Period column of the model editor.
- Any column can be used as a measure, with count distinct; dropping a field
  on the filter bar adds a filter.
- Text visuals can print measures where the text says `#tag`.
- Charts: adjustable grid, axis lines and X-label angle; scorecards pick the
  base of their % change; tables align headers and cells vertically; a shape
  can shrink to a point; a new visual lands on top.
- Report cards: Export report (the same `.openreport.json` as the editor's
  export). Each workspace in the picker has its own settings gear. Alerts and
  Admin moved to the user menu.
- Fixes: BigQuery aliases, an expression only joins the tables it names, a
  dimension and a measure with the same label are refused instead of merged,
  switching pages no longer reloads visuals already loaded.

## 0.2.0 — 2026-09-22

- One `docker-compose.yml` instead of two. By default it runs the published
  image as a single container on port 3001; `COMPOSE_PROFILES=https` in `.env`
  adds nginx and a Let's Encrypt certificate for a public host.
  `docker-compose.simple.yml` is gone.

  **Upgrading.** From the single-container file: nothing to do, the data stays
  in the same `openreport-data` volume — replace the file, then
  `docker compose up -d --remove-orphans`. From the full-stack file (nginx +
  certbot), the data was in the `app-data` volume: stop the stack, copy it
  once into the new volume, then start again with the https profile:

  ```bash
  docker compose down
  docker volume create <project>_openreport-data
  docker run --rm -v <project>_app-data:/from -v <project>_openreport-data:/to alpine cp -a /from/. /to/
  ```

  (`<project>` is the directory name, as shown by `docker volume ls`.)
- AI assistant in the report editor (Admin › AI: it turns on as soon as a
  provider is configured, and an admin can switch it off). Plug in
  Anthropic or any OpenAI-compatible server (OpenAI, Mistral, Ollama, LM Studio…).
  Ask a business question, get proposed visuals built on the report's fields;
  nothing changes until you add them, and adding is a single undo step. The
  assistant reads a report's **cached** data only — never the live source — and
  only if an admin allows data to be shared at all (schema only by default).
- The assistant also works on the design of a page: it proposes positions,
  sizes, colors, labels and the report theme with the business question first.
  Layout and style apply as one undo step; a theme change comes with its own
  Revert, since report settings are outside the undo history.
- When no built-in visual fits, the assistant can write a new custom visual.
  Workspace admins preview it, read its code and add it to the workspace
  library; AI-written visuals run sandboxed with no network access.
- **Assistant**: a panel on the right of Reports / Data Models / Data
  Sources, opened and closed from a bar docked on the right edge, resizable. Pick a model,
  ask a question, and the chart, its table and a one-line reason arrive in the
  panel — follow-ups and "build me a dashboard" included. **Add to report** puts the result in an existing report or a new
  one without opening the editor. Same AI provider and the same rule as in the
  editor: the assistant reads cached data only. 👍/👎 on answers, summarised for
  admins under Admin › AI.
- Moving between Reports, Data Models and Data Sources slides the stages as
  before; arriving on one of them from another page no longer plays the slide.
- The Explore page is removed: asking the assistant replaces it.
- An assistant in the data-model editor: ask it to join the tables, flag the
  columns as dimensions or measures, add measures, mark fact and dimension
  tables, or arrange the diagram; review the proposal, apply it, save the model.
- Asked to change the data model, the report and Ask assistants hand over an
  Open model assistant card (to the model's owner or an admin), which opens the
  model editor with the request ready to send.
- The assistant answers questions about how to use OpenReport ("how do I
  schedule a report?"), from a user guide shipped with the app, and offers to do
  it: asked to schedule a report, it shows a card that creates the schedule once
  confirmed.
- The assistant works in any language: it no longer looks for French or English
  words in the request. It writes down how it read the request (what to break
  down by, the top or bottom N, what a restyle may change) and its proposal is
  held to that reading.
- The assistant remembers what it read from the cache for the rest of the
  conversation.
- The assistant shapes the data of what it proposes, like the panel does:
  top / bottom N ("top 5 regions" is five bars, sorted), filters of the visual
  ("in 2023", "for France", "above one million") and rolling periods ("this
  year"). The N is the one you wrote, whatever the model copies.
- The assistant uses the custom visuals installed in the workspace like
  built-in types, and in Ask too a workspace admin can have a new kind of visual
  written — on request, or when nothing else draws what was asked. It joins the
  workspace library when it is added to a report.
- `POST /api/reports/:id/widgets` adds visuals to a saved report: validated and
  placed by the server, other pages and settings untouched, a version kept.
- Custom visuals always receive `data.rows` and `data.fields`, even before the
  first fetch — a visual reading `rows.length` no longer fails on a new widget.
- `/api/models/:id/query` accepts `cacheOnly`: answer from the rollup cache or
  return a miss, without ever connecting to the datasource.

## 0.1.0 — 2026-09-13

First tagged release.

- Report editor: drag-and-drop canvas, snap-to-grid, undo/redo, multiple pages,
  per-report themes, cross-filtering and cross-highlighting.
- Visuals: scorecard, table, pivot table, bar, line, combo, pie, donut, treemap,
  gauge, scatter, slicers, shapes and images, plus custom visuals.
- Semantic model: joins with cardinality, dimensions, measures, calculated
  fields, date intelligence (year-over-year, running totals), Row-Level Security.
- Connectors: PostgreSQL, Amazon Redshift, Snowflake, Databricks, ClickHouse,
  MySQL, Oracle, SQL Server, Azure SQL, BigQuery, DuckDB; file import for CSV,
  Excel, Parquet, JSON and TSV.
- Pre-aggregation cache with scheduled refresh.
- Workspaces, users and roles, public share links, embedding, OIDC single sign-on.
- Export to PDF, PNG and Excel; REST API with scoped tokens.
- Deployment: multi-arch Docker image (amd64, arm64), single-container compose
  file for plain HTTP, and a full nginx + Let's Encrypt stack for a public host.
