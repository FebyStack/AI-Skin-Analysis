import { Router, type RequestHandler } from "express";
import type { AppDeps } from "../../shared/deps";
import { ARCHIVE_RETENTION_DAYS, expiresAt } from "../../../shared/lifecycle";

const RETENTION_MS = ARCHIVE_RETENTION_DAYS * 86_400_000;
const SOON_MS = 7 * 86_400_000;

/**
 * Image archive + clinic analytics.
 *
 * Deleting an image archives it rather than destroying it: it disappears from
 * the scan but stays recoverable for the retention window, after which it is
 * purged. Expiry is swept lazily on read — a clinic laptop isn't always on, so a
 * background timer would miss days; checking when someone opens the archive is
 * both simpler and more reliable.
 */
export function createArchiveRoutes(deps: AppDeps, auth: RequestHandler): Router {
  const router = Router();

  router.get("/api/archive", auth, async (_req, res) => {
    const purged = await deps.scans.purgeExpired(RETENTION_MS);
    const rows = await deps.scans.listArchived();
    const now = Date.now();
    res.json({
      images: rows.map((r) => ({ ...r, expiresAt: expiresAt(r.archivedAt) })),
      stats: {
        archived: rows.length,
        expiringSoon: rows.filter((r) => expiresAt(r.archivedAt) - now <= SOON_MS).length,
        retentionDays: ARCHIVE_RETENTION_DAYS,
      },
      purgedNow: purged,
    });
  });

  router.post("/api/archive/:scanId/:angle/restore", auth, async (req, res) => {
    const { scanId, angle } = req.params;
    const ok = await deps.scans.restoreImage(scanId, angle);
    if (!ok) {
      res.status(404).json({ error: "not in archive" });
      return;
    }
    await deps.scans.recordEvent(scanId, "restored", { angle });
    res.json({ ok: true });
  });

  /** Irreversible — the UI confirms before calling this. */
  router.delete("/api/archive/:scanId/:angle", auth, async (req, res) => {
    const { scanId, angle } = req.params;
    // Log before deleting: the image row goes, the audit trail stays.
    await deps.scans.recordEvent(scanId, "purged", { angle });
    const ok = await deps.scans.purgeImage(scanId, angle);
    if (!ok) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json({ ok: true });
  });

  router.get("/api/analytics", auth, async (_req, res) => {
    const [base, queue, datasets, releases] = await Promise.all([
      deps.scans.analytics(),
      deps.scans.queueStats(),
      deps.scans.listDatasetVersions(),
      deps.scans.listModelReleases(),
    ]);
    res.json({
      ...base,
      queueSize: Object.values(queue).reduce((a, b) => a + b, 0),
      approved: queue.approved ?? 0,
      rejected: queue.rejected ?? 0,
      pending: queue.pending ?? 0,
      needsExpert: queue.needs_expert ?? 0,
      // Growth + performance series for the charts, oldest first.
      datasetGrowth: [...datasets]
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((d) => ({ version: d.version, at: d.createdAt, imageCount: d.imageCount })),
      modelHistory: [...releases]
        .sort((a, b) => a.trainedAt - b.trainedAt)
        .map((r) => ({
          version: r.version,
          at: r.trainedAt,
          macroF1: r.macroF1,
          deployment: r.deployment,
        })),
    });
  });

  return router;
}
