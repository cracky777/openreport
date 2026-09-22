# Changelog

All notable changes to OpenReport are listed here. Versions follow
[Semantic Versioning](https://semver.org/); each one is a git tag and a
`ghcr.io/cracky777/openreport` image.

## Unreleased

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
