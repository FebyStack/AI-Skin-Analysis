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

  app.post("/api/patients", auth, async (req, res) => {
    const { name, externalRef, notes } = req.body ?? {};
    if (typeof name !== "string" || name.trim().length === 0) {
      res.status(400).json({ error: "name is required" });
      return;
    }
    const patient = await deps.patients.create({
      name: name.trim(),
      externalRef: typeof externalRef === "string" ? externalRef : null,
      notes: typeof notes === "string" ? notes : "",
      consentVersion: null,
    });
    res.status(201).json({ patient });
  });

  app.patch("/api/patients/:id", auth, async (req, res) => {
    const { name, externalRef, notes } = req.body ?? {};
    const patient = await deps.patients.update(req.params.id, {
      ...(typeof name === "string" ? { name } : {}),
      ...(typeof externalRef === "string" ? { externalRef } : {}),
      ...(typeof notes === "string" ? { notes } : {}),
    });
    if (!patient) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json({ patient });
  });

  app.delete("/api/patients/:id", auth, async (req, res) => {
    const ok = await deps.patients.remove(req.params.id);
    res.status(ok ? 204 : 404).end();
  });

  app.post("/api/patients/:id/consent", auth, async (req, res) => {
    const version = Number(req.body?.version);
    if (!Number.isInteger(version) || version < 1) {
      res.status(400).json({ error: "version required" });
      return;
    }
    const patient = await deps.patients.update(req.params.id, { consentVersion: version });
    if (!patient) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json({ patient });
  });

  return app;
}
