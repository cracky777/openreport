# Contributing to Open Report

Thank you for your interest in contributing to Open Report! This document provides guidelines for contributing to the project.

## Getting Started

1. **Fork** the repository on GitHub
2. **Clone** your fork locally: `git clone https://github.com/your-username/openreport.git`
3. **Create a branch** for your feature or fix: `git checkout -b feature/my-feature`
4. **Install**:
   ```bash
   ./install.sh
   ```
   It checks your Node version, installs Node 22 through nvm if yours is older,
   and pulls the dependencies of all three packages. On Windows, install Node 22
   yourself and run `npm run install:all`.
5. **Start the dev servers** (server on :3001, client on :5173):
   ```bash
   npm run dev
   ```
   Open http://localhost:5173. The first account you create becomes the admin.

Reading [ARCHITECTURE.md](ARCHITECTURE.md) first will save you more time than it
takes: it explains how a widget on a report turns into SQL, and which file to
open for which kind of change.

### Running the tests

Please run these before opening a pull request.

```bash
cd server && npm test        # Jest: routes, authorization, RLS, SQL snapshots
cd client && npm test        # Vitest: the pure utilities
cd client && npm run lint    # ESLint
cd server && npm run lint    # ESLint
npm run test:e2e             # Playwright, from the repository root
```

`npm run test:e2e` builds the client before it runs. Running `npx playwright test`
on its own serves whatever was built last, which is how a passing suite can hide
a broken change.

## Development Guidelines

### Code Style

- **Frontend**: React 19 with Vite, functional components with hooks
- **Backend**: Express.js with better-sqlite3
- **Styling**: Inline styles (no CSS frameworks)
- **Language**: JavaScript only (no TypeScript)
- **Icons**: [Tabler Icons](https://tabler-icons.io/) via `react-icons/tb`
- **Charts**: ECharts via `echarts` package

### Commit Messages

- Use clear, concise commit messages
- Start with a verb: `Add`, `Fix`, `Update`, `Remove`
- Reference issues when applicable: `Fix #42: resolve cross-filter on dates`

### Pull Requests

1. Ensure your code works locally (both server and client)
2. Keep PRs focused on a single feature or fix
3. Update documentation if needed
4. Describe what your PR does and why

## Reporting Bugs

Open a [GitHub Issue](https://github.com/cracky777/openreport/issues/new/choose) and
pick *Bug report*. The form asks for what turns out to matter: how you run Open
Report, which database you connected, and the exact steps. A report without the
database type is usually unanswerable, because most of the engine is SQL
generation and every dialect differs.

Found a security problem instead? Do not open an issue — see
[SECURITY.md](SECURITY.md).

## Feature Requests

Open a [Discussion](https://github.com/cracky777/openreport/discussions) first if you
are not sure the idea fits, or an [Issue](https://github.com/cracky777/openreport/issues/new/choose)
with the *Feature request* form if you are. Describe:

- The use case
- How it should work
- Reference to similar features in other tools (Power BI, Looker Studio, etc.)

## Contributor License Agreement

By opening a pull request you agree to two things.

**First**, your contribution is published under the [GNU AGPL-3.0](LICENSE), like
the rest of the project. Everyone who receives Open Report receives your work
under that licence, with every freedom it grants. That part never changes.

**Second**, you grant **Fritsch Holding**, a French *société par actions
simplifiée* registered under SIRET 954 081 980 00011, a perpetual, worldwide,
irrevocable, royalty-free right to use, modify, sublicense and relicense your
contribution, including under terms other than the AGPL.

That second paragraph is the one worth reading twice, so here is plainly what it
is for. Open Report is open-core: the project you are contributing to is AGPL and
always will be, and alongside it there is a hosted edition, run as a service,
whose source is not public. The grant is what allows a contribution to be carried
into that edition. Without it, every contributed line would have to be kept out
of the hosted product or rewritten, which in practice means such contributions
cannot be merged at all.

It also means you are handing over more than the AGPL alone would require, to a
single company. That is a real trade, and you are entitled to decline it. If
you would rather not sign it away, two options remain open to you and are
genuinely welcome: publish your work as a fork under the AGPL, or open an issue
describing the change so it can be written independently.

If any of this matters to your employer, check with them before contributing —
in most companies the code you write belongs to them, not to you, whatever this
file says.

## Code of Conduct

Three lines of it: be respectful and constructive, argue about the code rather
than the person, and give newcomers the patience you were given. The rest,
including what to do when someone does not, is in
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Questions?

Ask in [GitHub Discussions](https://github.com/cracky777/openreport/discussions) — that is the place for questions, ideas and "is this a bug or am I holding it wrong". [Issues](https://github.com/cracky777/openreport/issues) are for confirmed bugs and agreed features.
