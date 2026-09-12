# Open Report

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](LICENSE)

> Free and open source under [AGPL-3.0](LICENSE). Self-host it, fork it, use it at work.

Superset too complicated? Metabase too limited? Power BI not open source? That's why I built Open Report.

An open source, self-hosted reporting and data visualization platform, easy to run and easy to configure. Point it at your database, describe your tables once (joins, dimensions, measures), then build interactive dashboards on a drag-and-drop canvas. It compiles the SQL for you, in your dialect, against your data. Nothing leaves your infrastructure.

**Think Power BI / Looker Studio, but open source and self-hosted.**

## Features

- 10+ visualization types, and you can write your own
- Drag-and-drop canvas with snap-to-grid, shapes and free positioning
- Semantic model: joins, dimensions, measures, calculated fields, date intelligence
- Row-Level Security
- Scheduled refresh and a pre-aggregation cache
- Cross-filtering and cross-highlighting between visuals
- Workspace and user management, public share links
- Export to PDF, PNG, Excel
- Connects to PostgreSQL, Amazon Redshift, Snowflake, Databricks, ClickHouse, MySQL, Oracle, SQL Server, Azure SQL, BigQuery, DuckDB
- Imports CSV, Excel (.xlsx), Parquet, JSON, TSV
- [REST API](API.md) for scripted refreshes, with scoped tokens

## What it doesn't do (yet)

- One fact table per widget. Combining two fact tables in a single query inflates the numbers through join fan-out, so it is deliberately not offered.
- The pre-aggregation cache doesn't cover every measure. Non-additive ones and exotic SQL functions fall back to a live query against the source.
- Report building is a desktop workflow. Viewing on mobile works; editing on mobile is not something I have designed for.
- Pivot tables are computed client-side, so very large result sets will hurt.
- No schema migration tool. Upgrades run idempotent ALTERs at boot.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + Vite |
| Charts | ECharts |
| Icons | Tabler Icons (react-icons) |
| Backend | Node.js + Express |
| Metadata DB | SQLite (better-sqlite3) |
| Auth | Passport.js (local strategy) |
| File Import | DuckDB |

## Quick Start

### Prerequisites

- Node.js >= 22 - an older one is refused with an `EBADENGINE` error, because DuckDB
  cannot be built on it (the failure used to surface as an unrelated `SyntaxError`)
- npm >= 9

### Installation

```bash
git clone https://github.com/cracky777/openreport.git open-report
cd open-report
./install.sh
```

`install.sh` settles the Node version first — it installs Node 22 through nvm,
under your own home directory and without sudo, when the one on your PATH is
missing or too old — then installs every dependency. Set `OPENREPORT_SKIP_NODE=1`
to manage Node yourself.

On Windows, or to do it by hand: install Node 22, then `npm run install:all`.

### Running

```bash
npm run dev
```

The app will be available at:
- **Frontend**: http://localhost:5173
- **API**: http://localhost:3001

### First admin

There is no pre-seeded admin account. The **first user to sign up becomes the admin** — visit `/login`, click *Sign up*, and the account you create will be promoted automatically.

## Project Structure

```
open-report/
├── client/                 # React frontend (Vite)
│   ├── src/
│   │   ├── components/
│   │   │   ├── Canvas/     # Report canvas with drag & drop
│   │   │   ├── DataPanel/  # Data binding panel
│   │   │   ├── DropZone/   # Field wells with reordering
│   │   │   ├── PropertyPanel/ # Widget configuration
│   │   │   ├── SettingsPanel/ # Report settings
│   │   │   ├── Toolbar/    # Top toolbar
│   │   │   └── Widgets/    # All widget components
│   │   ├── pages/          # Editor, Dashboard, Viewer, Admin
│   │   ├── hooks/          # useHistory (undo/redo)
│   │   └── utils/          # formatNumber, dateHelpers, etc.
├── server/                 # Express API
│   ├── routes/             # REST endpoints
│   ├── db/                 # SQLite schema & connection
│   ├── utils/              # Database connectors
│   └── middleware/         # Auth middleware
├── API.md                  # Public API (v1) reference
├── LICENSE                 # GNU AGPL-3.0
├── CONTRIBUTING.md
└── README.md
```

## Contributing

Contributions are welcome.

- **[ARCHITECTURE.md](ARCHITECTURE.md)** — how a widget becomes SQL, and which file
  to open for which change. Read this first; it saves more time than it takes.
- **[CONTRIBUTING.md](CONTRIBUTING.md)** — setup, tests, and what a good pull request looks like.
- **[SECURITY.md](SECURITY.md)** — how to report a vulnerability. Please do not open an issue for one.
- **[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)**

Questions and ideas go to [Discussions](https://github.com/cracky777/openreport/discussions);
confirmed bugs go to [Issues](https://github.com/cracky777/openreport/issues/new/choose).


## License

[GNU Affero General Public License v3.0](LICENSE).

Free to use, self-host, modify and redistribute. If you run a modified version
as a network service, the AGPL requires you to publish your changes under the
same license.

Contributions are accepted under the same license (see
[CONTRIBUTING.md](CONTRIBUTING.md)).
