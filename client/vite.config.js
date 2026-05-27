import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
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
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
