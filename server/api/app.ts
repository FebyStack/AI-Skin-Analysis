import express, { type Express } from "express";
import type { AppDeps } from "./repos";

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.use(express.json({ limit: "12mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  void deps; // consumed by routes added in later tasks
  return app;
}
