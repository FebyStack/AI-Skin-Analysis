import { Router, type RequestHandler } from "express";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
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
export function datasetsDir(): string {
  return process.env.DATASETS_DIR ?? path.resolve(process.cwd(), "ai/datasets");
}
function modelsDir(): string {
  return process.env.MODELS_DIR ?? path.resolve(process.cwd(), "ai/models");
}

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

    // Materialize the frozen set on disk so the trainer reads exactly this
    // version: $DATASETS_DIR/<dimension>/scans/<label>/<scanId>.jpg. Without
    // this the manifest and the training data could drift apart.
    let written = 0;
    const missing: string[] = [];
    for (const sample of complete) {
      const img =
        (await deps.scans.getScanImage(sample.scanId, "front")) ??
        (await deps.scans.getImage(sample.scanId));
      if (!img) {
        missing.push(sample.scanId);
        continue;
      }
      for (const field of ANNOTATION_FIELDS) {
        const label = sample.labels[field.key];
        if (!label) continue;
        const dir = path.join(datasetsDir(), field.key, "scans", label);
        mkdirSync(dir, { recursive: true });
        writeFileSync(path.join(dir, `${sample.scanId}.jpg`), Buffer.from(img.jpeg));
      }
      written++;
    }
    await deps.scans.markExported(complete.map((s) => s.scanId));
    for (const s of complete) {
      await deps.scans.recordEvent(s.scanId, "dataset", { version }).catch(() => undefined);
    }
    res.json({ ok: true, version, imageCount: complete.length, written, missing });
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
  // NOTE: deliberately /api/model-releases, not /api/models/... — the admin-gated
  // model-distribution router owns /api/models and would swallow these (503).

  router.get("/api/model-releases", auth, async (_req, res) => {
    res.json({ releases: await deps.scans.listModelReleases() });
  });

  /**
   * Register a freshly trained candidate. Metrics come from the trainer's
   * model.json; size from the exported ONNX when present.
   */
  router.post("/api/model-releases", auth, async (req, res) => {
    // Reads the trainer's own output so `make retrain-face` needs no API call:
    // one click here registers whatever candidate is on disk, with its metrics.
    let meta: { version?: string; metrics?: Record<string, number> } = {};
    try {
      meta = JSON.parse(
        readFileSync(path.join(modelsDir(), "face", "candidate", "model.json"), "utf8"),
      );
    } catch {
      res.status(404).json({
        error: "no trained candidate found — run `make retrain-face` first",
      });
      return;
    }
    const version = typeof req.body?.version === "string" ? req.body.version : meta.version;
    if (!version) {
      res.status(400).json({ error: "candidate has no version" });
      return;
    }
    const m = meta.metrics ?? {};
    let sizeBytes: number | null = null;
    try {
      sizeBytes = statSync(
        path.resolve(process.cwd(), "frontend/public/models/face/model.onnx"),
      ).size;
    } catch {
      /* not exported yet */
    }
    // Attribute the model to whichever dataset version is current.
    const currentDataset = (await deps.scans.listDatasetVersions()).find((d) => d.isCurrent);
    await deps.scans.recordModelRelease({
      version,
      trainedAt: Date.now(),
      datasetVersion: currentDataset?.version ?? null,
      macroF1: m.val_macro_f1 ?? null,
      acneF1: m.val_macro_f1_acne ?? null,
      skintypeF1: m.val_macro_f1_skintype ?? null,
      sizeBytes,
      deployment: "candidate",
    });
    // Every sample in the current dataset contributed to this model.
    if (currentDataset) {
      for (const s of await deps.scans.readySamples()) {
        await deps.scans.recordEvent(s.scanId, "trained", { version }).catch(() => undefined);
      }
    }
    res.json({ ok: true, version, datasetVersion: currentDataset?.version ?? null });
  });

  /**
   * Deploy / rollback. Promoting to production is refused when the candidate
   * scores below the current production model — pass force:true to override
   * deliberately. Rolling back to an older release is always allowed.
   */
  router.post("/api/model-releases/:version/deploy", auth, async (req, res) => {
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
