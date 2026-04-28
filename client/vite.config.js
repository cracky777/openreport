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
    },
  },
})
