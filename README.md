# Open Report

[![License: PolyForm Noncommercial 1.0.0](https://img.shields.io/badge/License-PolyForm%20Noncommercial%201.0.0-blue.svg)](LICENSE)

> Source-available under [PolyForm Noncommercial 1.0.0](LICENSE) — forks allowed with attribution, commercial use prohibited.

An open-source, self-hosted reporting and data visualization platform. Build interactive dashboards with a drag-and-drop canvas — no vendor lock-in.

**Think Power BI / Looker Studio, but open source and self-hosted.**

## Features

### Visualizations
- **Bar Chart** — Clustered, Stacked, 100% Stacked with 4-direction orientation
- **Line Chart** — Line, Area, Stacked Area, 100% Stacked Area
- **Combo Chart** — Line + Stacked Bar, Line + Clustered Bar with secondary Y axis
- **Pie / Donut Chart** — With inside/outside labels
- **Scatter / Bubble Chart** — X, Y, Size measures with custom symbols and images
- **Table** — Sortable, paginated, conditional formatting, column reordering
- **Pivot Table** — Client-side pivoting with row/column dimensions
- **Scorecard** — Single KPI display
- **Filter / Slicer** — List, Dropdown, Buttons, Range, Date Range, Relative Date

### Design
- **Drag & drop canvas** — Freely position and resize widgets
- **Snap-to-grid** — Configurable grid with magnet snapping
- **Shape objects** — Square, Round, Line, Arrow for layout decoration
- **Container rotation** — Rotate any widget 0-360 degrees
- **Custom legend colors** — Per-value color customization on all charts
- **Data labels** — Configurable content, position, size, color, background

### Data
- **Multi-database** — PostgreSQL, MySQL, Azure SQL, BigQuery, DuckDB
- **File import** — CSV, Excel (.xlsx), Parquet, JSON, TSV
- **Data modeling** — Visual schema editor with joins, dimensions, measures, calculated fields
- **Date intelligence** — Auto-detection, date parts (year, month, week, day), chronological sorting
- **Cross-filtering** — Click on any chart to filter all other visuals
- **Cross-highlighting** — Power BI-style opacity highlight on source widget

### Platform
- **Role-based access** — Admin, Editor, Viewer roles
- **Workspaces** — Organize reports with team members
- **Public sharing** — Share reports via public link
- **Export** — PDF, PNG, Excel, Print
- **Undo/Redo** — Full history with Ctrl+Z / Ctrl+Y
- **Self-hosted** — Your data stays on your infrastructure

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

- Node.js >= 18
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
