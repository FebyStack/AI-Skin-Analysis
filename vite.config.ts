import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  root: "frontend",
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "frontend/src"),
      "@ai": resolve(__dirname, "ai"),
      "@shared": resolve(__dirname, "shared"),
    },
  },
  build: {
    outDir: "../dist", // repo-root dist/ — matches Dockerfile + nginx expectations
    emptyOutDir: true,
  },
  worker: {
    // onnxruntime-web forces code-splitting in the classify worker; the default
    // iife worker format can't split — es can.
    format: "es",
  },
  server: {
    proxy: {
      "/api": "http://localhost:3001",
      "/capture": "http://localhost:3001",
    },
  },
});
