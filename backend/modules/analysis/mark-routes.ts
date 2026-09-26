import { Router, type RequestHandler } from "express";
import type { AppDeps } from "../../shared/deps";
import { FACE_ANGLES, parseManualPoints, type FaceAngle } from "../../../shared/face";

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

  return router;
}
