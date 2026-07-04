import express, { type Express } from "express";
import type { AppDeps } from "./repos";
import { verifyOrBootstrapPassword, makeSessionToken, requireSession } from "./auth";

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.use(express.json({ limit: "12mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.post("/api/auth/login", async (req, res) => {
    const ok = await verifyOrBootstrapPassword(deps.settings, req.body?.password);
    if (!ok) {
      res.status(401).json({ error: "invalid password" });
      return;
    }
    const token = makeSessionToken(deps.sessionSecret, deps.now());
    res.setHeader(
      "Set-Cookie",
      `session=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=43200`,
    );
    res.json({ ok: true });
  });

  const auth = requireSession(deps.sessionSecret, deps.now);

  // Protected routes are added below in later tasks; placeholder list route
  // proves the middleware works end-to-end.
  app.get("/api/patients", auth, async (req, res) => {
    res.json({ patients: await deps.patients.list(req.query.q as string | undefined) });
  });

  return app;
}
