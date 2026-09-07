# Open Report

[![License: PolyForm Noncommercial 1.0.0](https://img.shields.io/badge/License-PolyForm%20Noncommercial%201.0.0-blue.svg)](LICENSE)

> Source-available under [PolyForm Noncommercial 1.0.0](LICENSE) — forks allowed with attribution, commercial use prohibited.

Superset is too complicated ? Metabase is too limited ? Power BI is not open-source ? Thas is why I have created Open-Report.
An open-source, self-hosted reporting and data visualization platform easy to use and to configure. Build interactive dashboards with a drag-and-drop canvas, and with no vendor lock-in.

**Think Power BI / Looker Studio, but open source and self-hosted.**

## Features
- More than 10 types of vizualisations
- Capacity to build your own visuals
- Row Line Security
- Schedule refresh
- Cache management
- Workspace/user management
- Connect to PostgreSQL, Amazon Redshift, Snowflake, Databricks, ClickHouse, MySQL, Oracle, SQL Server, Azure SQL, BigQuery, DuckDB
- Import your files : CSV, Excel (.xlsx), Parquet, JSON, TSV


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

- Node.js >= 22
- npm >= 9

### Installation

```bash
# Clone the repository
git clone https://github.com/cracky777/openreport.git open-report
cd open-report

# Install server dependencies
cd server
npm install

# Install client dependencies
cd ../client
npm install
```

### Running

```bash
# Terminal 1: Start the server
cd server
node index.js

# Terminal 2: Start the client
cd client
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
├── LICENSE                 # PolyForm Noncommercial 1.0.0
├── CONTRIBUTING.md
└── README.md
```

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting a pull request.

## License

This project is licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE) — fork allowed with attribution, no commercial use.

## Author

Open Report contributors
