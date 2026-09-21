import path from "path"
import { defineConfig } from "vitest/config"

// Separate from vite.config.ts on purpose: tests here are plain TS logic (math/mapping functions),
// not component rendering, so there's no need for the React plugin, jsdom, or dev-server settings —
// keeps `npm test` fast. Add a jsdom environment + @vitejs/plugin-react here if a future test needs
// to render a component.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
