import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Router, type RequestHandler } from "express";
import type { AppDeps } from "../../shared/deps";
import { datasetsDir } from "../training/governance-routes";
import { FACE_ANGLES, parseManualPoints, type FaceAngle, type FindingMark } from "../../../shared/face";

/**
 * Staff ground truth for the localization exam. Every route here takes `clinician`, so an
 * invite (patient) session gets 403 before reaching a handler.
 */
export function createMarkRoutes(deps: AppDeps, clinician: RequestHandler): Router {
  const router = Router();

  router.put("/api/face-scans/:id/images/:angle/marks", clinician, async (req, res) => {
    if (!FACE_ANGLES.includes(req.params.angle as FaceAngle)) {
      res.status(404).json({ error: "not found" });
      return;
    }
    const points = parseManualPoints(req.body?.points);
    if (!points) {
      res.status(400).json({ error: "points must be up to 500 {kind, x, y} with x and y in 0..1" });
      return;
    }
    if (!(await deps.scans.setManualMarks(req.params.id, req.params.angle, points))) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json({ ok: true, count: points.length });
  });

  // Writes the locked clinic localization exam for ai/training/localize/eval_marks.py.
  router.post("/api/localization-exam/export", clinician, async (_req, res) => {
    try {
      const dir = path.join(datasetsDir(), "localization", "clinic");
      mkdirSync(dir, { recursive: true });
      // Start clean each run: a stale photo whose scan was later archived, unmarked,
      // or excluded by consent must not linger from a previous export.
      for (const name of readdirSync(dir)) {
        if (name.endsWith(".jpg") || name === "marks.jsonl") rmSync(path.join(dir, name));
      }
      const lines: string[] = [];
      for (const m of await deps.scans.listManuallyMarked()) {
        const scan = await deps.scans.get(m.scanId);
        const img = await deps.scans.getScanImage(m.scanId, m.angle);
        if (!scan || !img) continue;
        // Only training-consented scans may leave the app as exam/training data —
        // the PUT that records marks does not itself check consent.
        if (!(await deps.scans.getConsent(m.scanId)).training) continue;
        const report = scan.report as unknown as {
          marks?: FindingMark[];
          markedAngles?: FaceAngle[];
          modelVersions?: Record<string, string>;
        } | null;
        // A report with no marks array never had the detector run on it (older scans,
        // scans saved before the model shipped); it would only ever score as a miss.
        if (!Array.isArray(report?.marks)) continue;
        // markedAngles (when present) says which angles the locator actually examined —
        // skip an angle it never saw rather than counting it as a false "found nothing".
        if (report.markedAngles !== undefined && !report.markedAngles.includes(m.angle as FaceAngle)) continue;
        const file = `${m.scanId}_${m.angle}.jpg`;
        writeFileSync(path.join(dir, file), Buffer.from(img.jpeg));
        const predictions = report.marks.flatMap((k) =>
          k.angle === m.angle && k.kind === "acne" && k.shape.type === "box"
            ? [{ x: k.shape.x, y: k.shape.y, w: k.shape.w, h: k.shape.h, confidence: k.confidence }]
            : [],
        );
        lines.push(JSON.stringify({
          image: file,
          angle: m.angle,
          points: m.points.filter((p) => p.kind === "acne"),
          predictions,
          device: m.capture?.device || m.capture?.platform || "unknown",
          model: report.modelVersions?.acneMarks ?? "unknown",
        }));
      }
      writeFileSync(path.join(dir, "marks.jsonl"), lines.join("\n") + (lines.length ? "\n" : ""));
      res.json({ exported: lines.length, dir });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "export failed" });
    }
  });

  return router;
}
