import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";

// HTTPS enables getUserMedia + "Install to Home Screen" on phones/iPads.
// Preferred: mkcert (see certs/README.md). If certs are missing, fall back
// to plain HTTP so nothing breaks — a warning is printed to remind you.
const CERT_DIR = resolve(__dirname, "certs");
const KEY_PATH = resolve(CERT_DIR, "dev-key.pem");
const CRT_PATH = resolve(CERT_DIR, "dev-cert.pem");

function httpsOption(): { key: Buffer; cert: Buffer } | undefined {
  if (existsSync(KEY_PATH) && existsSync(CRT_PATH)) {
    return { key: readFileSync(KEY_PATH), cert: readFileSync(CRT_PATH) };
  }
  if (process.env.VITE_HTTPS === "1") {
    console.warn(
      "\n[vite] VITE_HTTPS=1 but no certs at certs/ — see certs/README.md for one-time setup. Falling back to HTTP.\n",
    );
  }
  return undefined;
}

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
    // host:true binds to 0.0.0.0 so phones on the same Wi-Fi can reach vite.
    // The proxy still targets the local backend running on this machine.
    host: true,
    // Vite 5.4+ rejects requests whose Host header it does not recognise, which
    // blocks every tunnel hostname. Trust the two tunnel providers rather than
    // disabling the check outright.
    allowedHosts: [".trycloudflare.com", ".ngrok-free.app", ".ngrok.io", "localhost"],
    fs: {
      // Deps have lived outside the project root (iCloud evicts node_modules on
      // this Desktop, so they were moved out and symlinked). Vite refuses to
      // serve files outside the root unless they are allow-listed, which broke
      // its own client at /skin-analysis-deps/.../vite/dist/client/env.mjs.
      allow: [resolve(__dirname), "/Users/febrielotud/skin-analysis-deps"],
    },
    https: httpsOption(),
    proxy: {
      // Override with VITE_API_TARGET to point the dev frontend at a different
      // backend (a second instance, a staging box) without editing this file.
      "/api": process.env.VITE_API_TARGET ?? "http://localhost:3001",
      "/capture": process.env.VITE_API_TARGET ?? "http://localhost:3001",
    },
  },
  preview: {
    // Same for `vite preview` (production build). Handy for testing the PWA.
    host: true,
    https: httpsOption(),
  },
});
