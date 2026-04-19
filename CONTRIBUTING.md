# Contributing to Open Report

Thank you for your interest in contributing to Open Report! This document provides guidelines for contributing to the project.

## Getting Started

1. **Fork** the repository on GitHub
2. **Clone** your fork locally: `git clone https://github.com/your-username/open-report.git`
3. **Create a branch** for your feature or fix: `git checkout -b feature/my-feature`
4. **Install dependencies**:
   ```bash
   cd server && npm install
   cd ../client && npm install
   ```
5. **Start dev servers**:
   ```bash
   # Terminal 1: server
   cd server && node index.js

   # Terminal 2: client
   cd client && npm run dev
   ```

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

Open a [GitHub Issue](https://github.com/DataKhi/open-report/issues) with:

- Steps to reproduce
- Expected vs actual behavior
- Browser and OS information
- Screenshots if applicable

## Feature Requests

Open a [GitHub Issue](https://github.com/DataKhi/open-report/issues) with the `enhancement` label. Describe:

- The use case
- How it should work
- Reference to similar features in other tools (Power BI, Looker Studio, etc.)

## Contributor License Agreement

By submitting a pull request, you agree that your contributions are licensed under the same [AGPL-3.0 License](LICENSE) that covers the project, and you grant the project maintainer the right to relicense your contributions if needed for the project.

## Code of Conduct

- Be respectful and constructive
- Focus on the code, not the person
- Welcome newcomers and help them get started

## Questions?

Open a discussion on [GitHub Issues](https://github.com/DataKhi/open-report/issues) or reach out to the maintainer.
