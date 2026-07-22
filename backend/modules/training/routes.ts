import { Router, type RequestHandler } from "express";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { AppDeps } from "../../shared/deps";

// Labels a clinician can assign per dimension → training data for learned analyzers.
const ACNE_LABELS = new Set(["clear", "mild", "moderate", "severe", "very-severe"]);
const SKINTYPE_LABELS = new Set(["normal", "oily", "dry", "combination"]);
const LABELS_BY_DIMENSION: Record<string, Set<string>> = {
  acne: ACNE_LABELS,
  skintype: SKINTYPE_LABELS,
};

// Export lands where the Python trainer reads it ($DATASETS_DIR/acne/scans/...).
// Backend runs from repo root, so ai/datasets is relative to cwd (mirrors schema read).
function datasetsDir(): string {
  return process.env.DATASETS_DIR ?? path.resolve(process.cwd(), "ai/datasets");
}

export function createTrainingRoutes(deps: AppDeps, auth: RequestHandler, admin: RequestHandler): Router {
  const router = Router();

  // Assign / update a clinician label on a scan (session auth — any clinician).
  router.post("/api/scans/:id/label", auth, async (req, res) => {
    const { dimension, label } = req.body ?? {};
    const allowed = typeof dimension === "string" ? LABELS_BY_DIMENSION[dimension] : undefined;
    if (!allowed) {
      res.status(400).json({ error: `unknown dimension: ${dimension}` });
      return;
    }
    if (typeof label !== "string" || !allowed.has(label)) {
      res.status(400).json({ error: `invalid ${dimension} label`, allowed: [...allowed] });
      return;
    }
    const scan = await deps.scans.get(req.params.id);
    if (!scan) {
      res.status(404).json({ error: "scan not found" });
      return;
    }
    await deps.scans.setLabel(scan.id, dimension, label);
    res.json({ ok: true, dimension, label });
  });

  router.get("/api/scans/:id/labels", auth, async (req, res) => {
    res.json({ labels: await deps.scans.getLabels(req.params.id) });
  });

  // Export every labeled scan's image into the training folder layout
  // ($DATASETS_DIR/<dimension>/scans/<label>/<scanId>.jpg) that the trainer reads.
  // Admin-only: it writes to disk and exposes patient imagery as training data.
  router.post("/api/training/:dimension/export", admin, async (req, res) => {
    const dimension = req.params.dimension;
    if (!LABELS_BY_DIMENSION[dimension]) {
      res.status(400).json({ error: `unknown dimension: ${dimension}` });
      return;
    }
    const labeled = await deps.scans.listLabeled(dimension);
    const outBase = path.join(datasetsDir(), dimension, "scans");
    let written = 0;
    const missing: string[] = [];
    for (const { scanId, label } of labeled) {
      // Prefer the front angle image; fall back to the scan's headline image.
      const img =
        (await deps.scans.getScanImage(scanId, "front")) ?? (await deps.scans.getImage(scanId));
      if (!img) {
        missing.push(scanId);
        continue;
      }
      const dir = path.join(outBase, label);
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, `${scanId}.jpg`), Buffer.from(img.jpeg));
      written++;
    }
    res.json({ ok: true, exported: written, labeled: labeled.length, missing, dir: outBase });
  });

  return router;
}
