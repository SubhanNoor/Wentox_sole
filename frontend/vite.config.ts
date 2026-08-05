import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [inspectAttr(), react()],
  server: {
    port: 3000,
    // backend/package.json's "electron:dev" hardcodes VITE_DEV_SERVER_URL to port 3000 — if that
    // port is taken, Vite silently picking a different one would make Electron load nothing (or
    // someone else's stale server) with no error. Fail loudly instead.
    strictPort: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
