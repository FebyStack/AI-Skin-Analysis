import { Router, type RequestHandler } from "express";
import type { AppDeps } from "../../shared/deps";
import { handleAnalyze } from "../../../ai/llm/pipeline";
import { compressToJpeg } from "../../utils/image";

export function createAnalysisRoutes(deps: AppDeps, auth: RequestHandler): Router {
  const router = Router();

  router.post("/api/analyze", auth, async (req, res) => {
    const { patientId, image, mime, mode, classifierFindings } = req.body ?? {};

    let patient;
    if (patientId === "walk-in") {
      const list = await deps.patients.list();
      patient = list.find((p) => p.externalRef === "walk-in");
      if (!patient) {
        patient = await deps.patients.create({
          name: "Walk-in Patient",
          externalRef: "walk-in",
          notes: "Auto-created placeholder for walk-in scans",
          consentVersion: 1,
        });
      }
    } else {
      patient = await deps.patients.get(String(patientId));
    }

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

  router.post("/api/scans/:id/reanalyze", auth, async (req, res) => {
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

  router.get("/api/scans/:id/image", auth, async (req, res) => {
    const img = await deps.scans.getImage(req.params.id);
    if (!img) {
      res.status(404).end();
      return;
    }
    res.setHeader("content-type", "image/jpeg");
    res.send(Buffer.from(img.jpeg));
  });

  router.delete("/api/scans/:id", auth, async (req, res) => {
    const ok = await deps.scans.remove(req.params.id);
    res.status(ok ? 204 : 404).end();
  });

  return router;
}
