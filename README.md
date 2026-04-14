# Open Report

An open-source, self-hosted reporting and data visualization tool inspired by Google Data Studio (Looker Studio).

Build beautiful, interactive dashboards with a drag & drop canvas — no vendor lock-in.

## Features

- **Drag & drop canvas** — freely position and resize widgets on a grid
- **6 widget types** — Bar, Line, Pie, Table, Scorecard, Text
- **SQL data sources** — connect to PostgreSQL, MySQL, and more via Cube.js
- **Customizable styling** — colors, fonts, borders per widget
- **Save & share reports** — persistent reports with shareable viewer links
- **Self-hosted** — your data stays on your infrastructure

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React (Vite) |
| Canvas | react-grid-layout |
| Backend | Node.js + Express |
| Query Engine | Cube.js |
| Metadata DB | SQLite |
| Auth | Passport.js |

## Quick Start

### Prerequisites

- Node.js >= 18
- npm >= 9

### Installation

```bash
# Clone the repository
git clone https://github.com/your-org/open-report.git
cd open-report

# Install dependencies
npm install

# Start development servers
npm run dev
```

The app will be available at `http://localhost:5173` (frontend) and `http://localhost:3001` (API).

### Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

| Variable | Description | Default |
|---|---|---|
| `PORT` | API server port | `3001` |
| `SESSION_SECRET` | Express session secret | (required) |
| `CUBEJS_DB_TYPE` | Database type for Cube.js | `postgres` |
| `CUBEJS_DB_HOST` | Database host | `localhost` |
| `CUBEJS_DB_NAME` | Database name | — |
| `CUBEJS_DB_USER` | Database user | — |
| `CUBEJS_DB_PASS` | Database password | — |

## Project Structure

```
open-report/
├── client/              → React frontend (Vite)
│   ├── src/
│   │   ├── components/  → UI components
│   │   ├── pages/       → App pages
│   │   ├── hooks/       → Custom React hooks
│   │   └── utils/       → Helpers
├── server/              → Express API
│   ├── routes/          → API endpoints
│   ├── db/              → SQLite schema & connection
│   └── middleware/      → Auth & validation
├── LICENSE
└── README.md
```

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting a pull request.

## License

[MIT](LICENSE)
