import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
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
});
