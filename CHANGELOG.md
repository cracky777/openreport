# Changelog

All notable changes to OpenReport are listed here. Versions follow
[Semantic Versioning](https://semver.org/); each one is a git tag and a
`ghcr.io/cracky777/openreport` image.

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
