# Stage 1: Build the React frontend
FROM node:20-slim AS frontend-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# Stage 2: Production server
FROM node:20-slim AS production
WORKDIR /app

# Install build tools for native modules (better-sqlite3, duckdb)
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# Install server dependencies
COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev

# Copy server source
COPY server/ ./server/

# Custom visual starter template — served by /api/custom-visual-template.zip
COPY examples/custom-visual-template/ ./examples/custom-visual-template/

# Copy built frontend
COPY --from=frontend-build /app/client/dist ./client/dist

# Create data directories
RUN mkdir -p /app/server/data /app/server/data/uploads /app/server/data/duckdb

# Environment
ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

# Persistent data volume
VOLUME ["/app/server/data"]

CMD ["node", "server/index.js"]
