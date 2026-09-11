#!/usr/bin/env bash
#
# From a fresh clone to a running OpenReport, in one command.
#
# The prerequisite that trips people up is Node itself. A distribution's
# `apt install nodejs` can be years behind — Debian 10 still ships Node 12 —
# and on a runtime that old the install used to run all the way to compiling
# DuckDB before dying inside node-pre-gyp on "SyntaxError: Unexpected token
# '.'", a message that names neither Node nor its version. So the version is
# settled first, and installed when it is missing or too old.
#
# Node is installed through nvm, under the invoking user's home directory: no
# sudo, no system package touched, and deleting ~/.nvm undoes it. Set
# OPENREPORT_SKIP_NODE=1 to manage Node yourself and only install the
# dependencies.
#
# Windows: use Docker (see README) or install Node 22 from nodejs.org and run
# `npm run install:all`.
set -euo pipefail

REQUIRED_MAJOR=22
NVM_VERSION=v0.40.1

cd "$(cd "$(dirname "$0")" && pwd)"

say() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
die() { printf '\n%s\n' "$1" >&2; exit 1; }

# The major version of the Node on PATH, or nothing at all when there is none.
node_major() {
  command -v node >/dev/null 2>&1 || return 0
  node -p 'process.versions.node.split(".")[0]' 2>/dev/null || return 0
}

# Checked before the download rather than inside it: `die` in a pipeline only
# ends its own subshell, so refusing there let the rest of the pipe run on and
# fail again, further from the cause.
require_fetcher() {
  command -v curl >/dev/null 2>&1 && return 0
  command -v wget >/dev/null 2>&1 && return 0
  die "Neither curl nor wget is available. Install one, or install Node $REQUIRED_MAJOR yourself and re-run."
}

fetch() {
  if command -v curl >/dev/null 2>&1; then curl -fsSL "$1"
  else wget -qO- "$1"
  fi
}

install_node() {
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [ ! -s "$NVM_DIR/nvm.sh" ]; then
    require_fetcher
    say "Installing nvm into $NVM_DIR"
    fetch "https://raw.githubusercontent.com/nvm-sh/nvm/$NVM_VERSION/install.sh" | bash
  fi
  # nvm is a shell function, not a program: it has to be sourced to exist, and
  # sourcing it is also what puts the Node it installs on PATH for the rest of
  # this script.
  # shellcheck source=/dev/null
  . "$NVM_DIR/nvm.sh"
  say "Installing Node $REQUIRED_MAJOR"
  nvm install "$REQUIRED_MAJOR"
  nvm use "$REQUIRED_MAJOR"
}

current="$(node_major)"
if [ -n "$current" ] && [ "$current" -ge "$REQUIRED_MAJOR" ]; then
  say "Node $(node -v) — ok"
elif [ "${OPENREPORT_SKIP_NODE:-0}" = "1" ]; then
  die "Node $REQUIRED_MAJOR or newer is required, found ${current:-none}. OPENREPORT_SKIP_NODE is set, so nothing was installed."
else
  [ -n "$current" ] && say "Node $(node -v) is too old — OpenReport needs $REQUIRED_MAJOR or newer"
  install_node
fi

# `ci`, not `install`: it installs exactly what the lockfiles pin, the way the
# Docker image and the CI do, and it leaves the clone untouched — `npm install`
# rewrites a lockfile as soon as one drifts, so a fresh clone came out dirty.
say "Installing dependencies"
npm ci
(cd client && npm ci)
(cd server && npm ci)

say "Ready"
cat <<TXT

  npm run dev        server on :3001, client on :5173

Then open http://localhost:5173 — the first account you create becomes the
admin. For production, build the client once with 'npm run build' and serve it
with 'npm start'.
TXT

if [ -n "${NVM_DIR:-}" ] && [ -s "${NVM_DIR}/nvm.sh" ] && [ "${current:-0}" != "$REQUIRED_MAJOR" ]; then
  cat <<TXT

Node $REQUIRED_MAJOR was installed for this shell only. To make it the default
in new shells: nvm alias default $REQUIRED_MAJOR
TXT
fi
