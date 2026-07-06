# Stage 1: build the React frontend
FROM node:22-slim AS frontend-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# Stage 2: build server dependencies. The native modules (better-sqlite3, duckdb)
# need a toolchain to compile — kept in THIS stage only so it never reaches the
# runtime image.
FROM node:22-slim AS server-deps
WORKDIR /app/server
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY server/package*.json ./
# node-gyp only builds the native modules (better-sqlite3/duckdb) at install
# time — the runtime uses the compiled .node binaries. Drop it (and its
# make-fetch-happen/cacache/old-tar chain, the source of the duckdb audit
# highs) from the shipped tree; the patched tar@7.x used by node-pre-gyp for
# runtime binary resolution stays.
RUN npm ci --omit=dev \
    && rm -rf node_modules/node-gyp node_modules/make-fetch-happen node_modules/cacache

# Stage 3: production runtime — no build toolchain, runs as a non-root user.
FROM node:22-slim AS production
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001

# Prebuilt production deps from the builder (node_modules is .dockerignore'd, so
# the source COPY below can't clobber it).
COPY --from=server-deps /app/server/node_modules ./server/node_modules
COPY server/ ./server/
# Custom visual starter template — served by /api/custom-visual-template.zip
COPY examples/custom-visual-template/ ./examples/custom-visual-template/
# Built frontend
COPY --from=frontend-build /app/client/dist ./client/dist

# Data dirs owned by the image's built-in non-root `node` user (UID 1000).
RUN mkdir -p /app/server/data/uploads /app/server/data/duckdb \
    && chown -R node:node /app/server/data
USER node

EXPOSE 3001
VOLUME ["/app/server/data"]

# Node 22 ships a global fetch, so the healthcheck needs no curl/wget.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
