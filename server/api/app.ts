import express, { type Express } from "express";
import type { AppDeps } from "./repos";
import { verifyOrBootstrapPassword, makeSessionToken, requireSession } from "./auth";
import { handleAnalyze } from "../analysis/pipeline";
import { compressToJpeg } from "./image";

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

  app.post("/api/analyze", auth, async (req, res) => {
    const { patientId, image, mime, mode, classifierFindings } = req.body ?? {};
    const patient = await deps.patients.get(String(patientId));
    if (!patient) {
      res.status(404).json({ error: "patient not found" });
      return;
    }

    let outcome: Awaited<ReturnType<typeof handleAnalyze>>;
    try {
      outcome = await handleAnalyze({ image, mime, mode }, deps.pipeline);
    } catch {
      outcome = { ok: false, reason: "analysis-unreliable" };
    }
    if (!outcome.ok && outcome.reason === "invalid-input") {
      res.status(400).json({ error: outcome.detail ?? "invalid input" });
      return;
    }

    const compressed = await compressToJpeg(Buffer.from(String(image), "base64"));
    const scan = await deps.scans.create({
      patientId: patient.id,
      mode,
      imageJpeg: compressed.jpeg,
      imageWidth: compressed.width,
      imageHeight: compressed.height,
      report: outcome.ok ? outcome.report : null,
      partial: !outcome.ok,
      classifierFindings: Array.isArray(classifierFindings) ? classifierFindings : [],
      promptVersion: outcome.ok ? outcome.promptVersion : null,
    });
    const { imageJpeg: _img, ...scanWire } = scan;
    res.json({ scan: scanWire });
  });

  app.post("/api/scans/:id/reanalyze", auth, async (req, res) => {
    const scan = await deps.scans.get(req.params.id);
    if (!scan) {
      res.status(404).json({ error: "not found" });
      return;
    }
    const image = Buffer.from(scan.imageJpeg).toString("base64");
    const outcome = await handleAnalyze({ image, mime: "image/jpeg", mode: scan.mode }, deps.pipeline);
    if (!outcome.ok) {
      res.status(502).json({ error: outcome.reason });
      return;
    }
    await deps.scans.updateReport(scan.id, outcome.report, outcome.promptVersion);
    res.json({ ok: true });
  });

  app.get("/api/patients/:id/scans", auth, async (req, res) => {
    res.json({ scans: await deps.scans.listByPatient(req.params.id) });
  });

  app.get("/api/scans/:id/image", auth, async (req, res) => {
    const img = await deps.scans.getImage(req.params.id);
    if (!img) {
      res.status(404).end();
      return;
    }
    res.setHeader("content-type", "image/jpeg");
    res.send(Buffer.from(img.jpeg));
  });

  app.delete("/api/scans/:id", auth, async (req, res) => {
    const ok = await deps.scans.remove(req.params.id);
    res.status(ok ? 204 : 404).end();
  });

  return app;
}
