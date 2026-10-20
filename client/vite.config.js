import net from 'node:net'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const BACKEND = { host: 'localhost', port: 3001 }

const backendUp = () => new Promise((resolve) => {
  const socket = net.connect(BACKEND, () => { socket.destroy(); resolve(true) })
  socket.once('error', () => resolve(false))
  socket.setTimeout(500, () => { socket.destroy(); resolve(false) })
})

// The API server runs under `node --watch` and restarts for a few seconds on
// every change of a server file. Without this, each request in flight during
// the restart comes back as "http proxy error … ECONNREFUSED" / 500, and the
// page reacts as if the session were gone. Here the request waits for the
// port to answer again (up to WAIT_MS) before being handed to the proxy.
const WAIT_MS = 15000
const waitForBackend = () => ({
  name: 'wait-for-backend',
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (!/^\/(api|uploads)\//.test(req.url || '')) return next()
      const until = Date.now() + WAIT_MS
      while (!(await backendUp())) {
        if (Date.now() > until) break
        await new Promise((r) => setTimeout(r, 300))
      }
      next()
    })
  },
})

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), waitForBackend()],
  server: {
    proxy: {
      '/api': {
        target: `http://${BACKEND.host}:${BACKEND.port}`,
        changeOrigin: true,
        // Large uploads (CSV/Excel/Parquet up to 500MB) are processed synchronously
        // by DuckDB on the backend — that can take a couple of minutes. Without
        // generous timeouts the dev proxy returns 502 mid-import even though the
        // backend is still working.
        timeout: 10 * 60 * 1000,        // 10 min — client-side socket timeout
        proxyTimeout: 10 * 60 * 1000,   // 10 min — upstream response timeout
      },
      // Uploaded image binaries are served by Express's static middleware
      // at `/uploads/images/...` (see server/index.js). Without this proxy
      // the browser requests them off the Vite dev server (port 5173),
      // which doesn't know about them → 404 → ImageWidget's onError fires
      // and hides the <img>, leaving a white widget. In prod a single
      // Express serves both API and static so this never bites.
      '/uploads': {
        target: `http://${BACKEND.host}:${BACKEND.port}`,
        changeOrigin: true,
      },
    },
  },
})
