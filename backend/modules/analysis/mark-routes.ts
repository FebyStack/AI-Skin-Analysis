import { mkdirSync, writeFileSync } from "node:fs";
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
    const dir = path.join(datasetsDir(), "localization", "clinic");
    mkdirSync(dir, { recursive: true });
    const lines: string[] = [];
    for (const m of await deps.scans.listManuallyMarked()) {
      const scan = await deps.scans.get(m.scanId);
      const img = await deps.scans.getScanImage(m.scanId, m.angle);
      if (!scan || !img) continue;
      const file = `${m.scanId}_${m.angle}.jpg`;
      writeFileSync(path.join(dir, file), Buffer.from(img.jpeg));
      const saved = (scan.report as unknown as { marks?: FindingMark[] } | null)?.marks ?? [];
      const predictions = saved.flatMap((k) =>
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
      }));
    }
    writeFileSync(path.join(dir, "marks.jsonl"), lines.join("\n") + (lines.length ? "\n" : ""));
    res.json({ exported: lines.length, dir });
  });

  return router;
}
