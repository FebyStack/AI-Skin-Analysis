import { Router, type RequestHandler } from "express";
import type { AppDeps } from "../../shared/deps";
import type { LesionScanReport } from "../../../shared/lesion";
import { LesionUnavailableError } from "./lesion-client";
import { builtinLesionExplanation } from "../../../ai/llm/fallback/lesion-education";
import { compressToJpeg } from "../../utils/image";

// Resolve (or lazily create) the shared walk-in patient — mirrors /api/analyze.
async function walkInPatient(deps: AppDeps) {
  const list = await deps.patients.list();
  return (
    list.find((p) => p.externalRef === "walk-in") ??
    (await deps.patients.create({
      name: "Walk-in Patient",
      externalRef: "walk-in",
      notes: "Auto-created placeholder for walk-in scans",
      consentVersion: 1,
    }))
  );
}

export function createLesionRoutes(deps: AppDeps, auth: RequestHandler): Router {
  const router = Router();

  router.post("/api/lesion", auth, async (req, res) => {
    const { image, mime } = req.body ?? {};
    if (typeof image !== "string" || image.length === 0) {
      res.status(400).json({ error: "image (base64) is required" });
      return;
    }

    let analysis;
    try {
      analysis = await deps.lesion.analyze(image, typeof mime === "string" ? mime : "image/jpeg");
    } catch (err) {
      if (err instanceof LesionUnavailableError) {
        res.status(503).json({ error: "lesion service unavailable" });
        return;
      }
      throw err;
    }

    // Explanation: online Gemini when wired+reachable, else the offline builtin.
    const online = deps.lesionExplain ? await deps.lesionExplain(analysis).catch(() => null) : null;
    const explanation = online ?? builtinLesionExplanation(analysis);

    // Persist so it appears in history.
    const report: LesionScanReport = { kind: "lesion", analysis, explanation };
    const patient = await walkInPatient(deps);
    const compressed = await compressToJpeg(Buffer.from(image, "base64"));
    const scan = await deps.scans.create({
      patientId: patient.id,
      mode: "closeup",
      imageJpeg: compressed.jpeg,
      imageWidth: compressed.width,
      imageHeight: compressed.height,
      report,
      partial: false,
      classifierFindings: [],
      promptVersion: explanation.promptVersion,
    });
    const { imageJpeg: _img, ...scanWire } = scan;
    res.json({ scan: scanWire, analysis, explanation });
  });

  return router;
}
