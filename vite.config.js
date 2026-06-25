import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

const BACKEND_ORIGIN = "http://127.0.0.1:8787";

export default defineConfig({
  plugins: [react({ jsxRuntime: "automatic" })],
  server: {
    host: "localhost",
    port: 3005,
    strictPort: true,
    proxy: {
      "/api": {
        target: BACKEND_ORIGIN,
        changeOrigin: true
      },
      "/uploads": {
        target: BACKEND_ORIGIN,
        changeOrigin: true
      }
    }
  },
  preview: {
    host: "localhost",
    port: 3005,
    strictPort: true
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, "index.html")
    }
  }
});
