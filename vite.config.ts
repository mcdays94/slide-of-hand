import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  /**
   * `__PROJECT_ROOT__` is the absolute path to the developer's checkout,
   * injected at compile time so the `/admin` deck list can build
   * `vscode://file/...` links pointing at deck source files.
   *
   * In `vite build` (`command === "build"`) we deliberately inject the
   * empty string — the path is meaningless on a deployed Worker and we
   * don't want the developer's local filesystem layout in the production
   * bundle. The consumer (`src/lib/vscode-url.ts`) treats `""` as a
   * sentinel and returns `""`, and the admin page additionally guards on
   * `import.meta.env.DEV` so the button never renders in production.
   */
  define: {
    __PROJECT_ROOT__:
      command === "serve"
        ? JSON.stringify(process.cwd())
        : JSON.stringify(""),
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
  server: {
    port: 5173,
    strictPort: false,
  },
  test: {
    environment: "happy-dom",
    globals: false,
    include: [
      "tests/**/*.test.ts",
      "tests/**/*.test.tsx",
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
    ],
  },
}));
