import { Router, type RequestHandler } from "express";
import { statSync } from "node:fs";
import path from "node:path";
import type { AppDeps } from "../../shared/deps";
import {
  ANNOTATION_FIELDS,
} from "../../../shared/training-queue";
import {
  DEFAULT_TRAIN_THRESHOLD,
  candidateBeatsProduction,
  type Deployment,
} from "../../../shared/training-governance";

// Dataset versions, model releases and the retrain threshold.
//
// Two invariants live here:
//   1. A dataset version is a frozen snapshot — creating a new one never edits
//      an old one, so any model stays reproducible from its dataset.
//   2. A better production model is never replaced automatically. Deployment is
//      a human click, and the API refuses to promote a candidate that scores
//      worse unless the caller explicitly forces it.
export function createGovernanceRoutes(deps: AppDeps, auth: RequestHandler): Router {
  const router = Router();

  const threshold = () => Number(process.env.TRAIN_THRESHOLD ?? DEFAULT_TRAIN_THRESHOLD);

  // ----- Dataset versions -----

  router.get("/api/datasets", auth, async (_req, res) => {
    res.json({ versions: await deps.scans.listDatasetVersions() });
  });

  /** Freeze every Ready-for-Training sample into a new immutable version. */
  router.post("/api/datasets", auth, async (req, res) => {
    const ready = await deps.scans.readySamples();
    // Fully-labeled only: a partial sample would silently weaken the dataset.
    const complete = ready.filter(
      (s) => ANNOTATION_FIELDS.every((f) => s.labels[f.key]),
    );
    if (complete.length === 0) {
      res.status(400).json({ error: "no samples are Ready for Training yet" });
      return;
    }
    const existing = await deps.scans.listDatasetVersions();
    const version = `v${existing.length + 1}`;
    await deps.scans.createDatasetVersion(
      version,
      complete,
      typeof req.body?.note === "string" ? req.body.note : null,
    );
    res.json({ ok: true, version, imageCount: complete.length });
  });

  /** Rollback = point `is_current` at an older version; nothing is rewritten. */
  router.post("/api/datasets/:version/current", auth, async (req, res) => {
    const ok = await deps.scans.setCurrentDataset(req.params.version);
    if (!ok) {
      res.status(404).json({ error: "unknown dataset version" });
      return;
    }
    res.json({ ok: true, version: req.params.version });
  });

  // ----- Model releases -----

  router.get("/api/models/releases", auth, async (_req, res) => {
    res.json({ releases: await deps.scans.listModelReleases() });
  });

  /**
   * Register a freshly trained candidate. Metrics come from the trainer's
   * model.json; size from the exported ONNX when present.
   */
  router.post("/api/models/releases", auth, async (req, res) => {
    const { version, datasetVersion, macroF1, acneF1, skintypeF1 } = req.body ?? {};
    if (typeof version !== "string" || !version) {
      res.status(400).json({ error: "version required" });
      return;
    }
    let sizeBytes: number | null = null;
    try {
      sizeBytes = statSync(
        path.resolve(process.cwd(), "frontend/public/models/face/model.onnx"),
      ).size;
    } catch {
      /* not exported yet */
    }
    await deps.scans.recordModelRelease({
      version,
      trainedAt: Date.now(),
      datasetVersion: typeof datasetVersion === "string" ? datasetVersion : null,
      macroF1: typeof macroF1 === "number" ? macroF1 : null,
      acneF1: typeof acneF1 === "number" ? acneF1 : null,
      skintypeF1: typeof skintypeF1 === "number" ? skintypeF1 : null,
      sizeBytes,
      deployment: "candidate",
    });
    res.json({ ok: true, version });
  });

  /**
   * Deploy / rollback. Promoting to production is refused when the candidate
   * scores below the current production model — pass force:true to override
   * deliberately. Rolling back to an older release is always allowed.
   */
  router.post("/api/models/releases/:version/deploy", auth, async (req, res) => {
    const deployment = (req.body?.deployment ?? "production") as Deployment;
    const force = req.body?.force === true;
    const releases = await deps.scans.listModelReleases();
    const target = releases.find((r) => r.version === req.params.version);
    if (!target) {
      res.status(404).json({ error: "unknown model version" });
      return;
    }
    if (deployment === "production" && !force) {
      const production = releases.find((r) => r.deployment === "production") ?? null;
      // Rolling back to a previously-deployed (archived) model is not a regression check.
      const isRollback = target.deployment === "archived";
      if (!isRollback && !candidateBeatsProduction(target, production)) {
        res.status(409).json({
          error: "candidate does not beat the current production model",
          candidateMacroF1: target.macroF1,
          productionMacroF1: production?.macroF1 ?? null,
        });
        return;
      }
    }
    await deps.scans.setDeployment(target.version, deployment);
    res.json({ ok: true, version: target.version, deployment });
  });

  // ----- Retrain readiness -----

  router.get("/api/training/readiness", auth, async (_req, res) => {
    const approved = await deps.scans.approvedSinceLastTraining();
    const t = threshold();
    res.json({ approvedSinceLastTraining: approved, threshold: t, ready: approved >= t });
  });

  return router;
}
