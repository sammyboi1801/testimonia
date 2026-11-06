import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// In development the Python API runs on :8765 (`python -m testimonia serve`); Vite proxies /api to it.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { "/api": "http://127.0.0.1:8765" } },
  build: { outDir: "dist", sourcemap: true, chunkSizeWarningLimit: 900 },
  test: { environment: "jsdom" },
});
