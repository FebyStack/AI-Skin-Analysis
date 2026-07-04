import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
  worker: {
    // onnxruntime-web forces code-splitting in the classify worker; the default
    // iife worker format can't split — es can.
    format: "es",
  },
});
