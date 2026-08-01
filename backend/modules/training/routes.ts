import { Router, type RequestHandler } from "express";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { AppDeps } from "../../shared/deps";
import { ANNOTATION_FIELDS } from "../../../shared/training-queue";
import { rebuildExport } from "./rebuild-export";
import { checkConsistency } from "../../../shared/label-consistency";

// Every field of the Training Queue annotation panel. Vocabularies come from the
// shared contract so the UI, this validator, and the training export can't drift.
const LABELS_BY_DIMENSION: Record<string, Set<string>> = Object.fromEntries(
  ANNOTATION_FIELDS.map((f) => [f.key, new Set<string>(f.options)]),
);

// Export lands where the Python trainer reads it ($DATASETS_DIR/acne/scans/...).
// Backend runs from repo root, so ai/datasets is relative to cwd (mirrors schema read).
function datasetsDir(): string {
  return process.env.DATASETS_DIR ?? path.resolve(process.cwd(), "ai/datasets");
}

// Trained models + their live progress/history live here (ai/models/<dim>/...).
function modelsDir(): string {
  return process.env.MODELS_DIR ?? path.resolve(process.cwd(), "ai/models");
}

export function createTrainingRoutes(deps: AppDeps, auth: RequestHandler): Router {
  const router = Router();

  // Live training progress the dashboard polls: the trainer writes
  // ai/models/<dim>/candidate/progress.json each epoch. null = no run yet.
  router.get("/api/training/:dimension/progress", auth, (req, res) => {
    const dim = req.params.dimension;
    if (!LABELS_BY_DIMENSION[dim]) {
      res.status(400).json({ error: `unknown dimension: ${dim}` });
      return;
    }
    try {
      const raw = readFileSync(path.join(modelsDir(), dim, "candidate", "progress.json"), "utf8");
      res.json(JSON.parse(raw));
    } catch {
      res.json(null);
    }
  });

  // Before/after model history: one record per evaluated retrain.
  router.get("/api/training/:dimension/history", auth, (req, res) => {
    const dim = req.params.dimension;
    if (!LABELS_BY_DIMENSION[dim]) {
      res.status(400).json({ error: `unknown dimension: ${dim}` });
      return;
    }
    try {
      const raw = readFileSync(path.join(modelsDir(), dim, "history.jsonl"), "utf8");
      const runs = raw.split("\n").filter(Boolean).map((l) => JSON.parse(l));
      res.json({ runs });
    } catch {
      res.json({ runs: [] });
    }
  });

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

    // Compare against this patient's most recent APPROVED visit. A big jump in a
    // short window is usually an annotation slip, not real skin change — surface
    // it, log it for audit, but never block the reviewer.
    let inconsistencies: unknown[] = [];
    try {
      const siblings = (await deps.scans.listByPatient(scan.patientId))
        .filter((s) => s.id !== scan.id && s.createdAt < scan.createdAt)
        .sort((a, b) => b.createdAt - a.createdAt);
      for (const prev of siblings) {
        const entry = await deps.scans.getQueueEntry(prev.id);
        if (entry?.status !== "approved") continue;
        const prevLabels = Object.fromEntries(
          (await deps.scans.getLabels(prev.id)).map((l) => [l.dimension, l.label]),
        );
        const curLabels = Object.fromEntries(
          (await deps.scans.getLabels(scan.id)).map((l) => [l.dimension, l.label]),
        );
        inconsistencies = checkConsistency({
          current: curLabels,
          previous: prevLabels,
          currentAt: scan.createdAt,
          previousAt: prev.createdAt,
        });
        for (const w of inconsistencies) {
          await deps.scans.recordEvent(scan.id, "warning", { ...(w as object), previousScanId: prev.id });
        }
        break; // most recent approved visit only
      }
    } catch {
      /* consistency is advisory — never fail the save */
    }
    res.json({ ok: true, dimension, label, inconsistencies });
  });

  router.get("/api/scans/:id/labels", auth, async (req, res) => {
    res.json({ labels: await deps.scans.getLabels(req.params.id) });
  });

  /**
   * Rebuild $DATASETS_DIR/<dimension>/scans/ from the current database labels.
   *
   * This used to append, so the folder only ever grew: a scan deleted from the
   * database left its exported JPEG behind forever, and a re-graded scan gained
   * a second copy under the new label while the old one stayed. On this install
   * that produced 29 orphans out of 36 files for one dimension, alongside
   * retired-vocabulary folders — so what trained the model was not what the
   * clinicians currently believed.
   *
   * Logic lives in ./rebuild-export so the CLI runs exactly the same routine.
   * `?dryRun=1` reports the plan without touching the disk.
   */
  router.post("/api/training/:dimension/export", auth, async (req, res) => {
    const dimension = req.params.dimension;
    const vocabulary = LABELS_BY_DIMENSION[dimension];
    if (!vocabulary) {
      res.status(400).json({ error: `unknown dimension: ${dimension}` });
      return;
    }
    const result = await rebuildExport(
      deps.scans,
      dimension,
      vocabulary,
      path.join(datasetsDir(), dimension, "scans"),
      { dryRun: req.query.dryRun === "1" || req.query.dryRun === "true" },
    );
    // `exported` and `labeled` are the names this endpoint has always returned
    // and the admin UI still reads. Renaming them silently broke that.
    const { labelled, written, ...rest } = result;
    res.json({ ok: true, ...rest, labeled: labelled, exported: written, labelled, written });
  });

  return router;
}
