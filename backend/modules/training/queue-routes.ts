import { Router, type RequestHandler } from "express";
import type { AppDeps } from "../../shared/deps";
import { QUEUE_STATUSES, type QueueStatus } from "../../../shared/training-queue";
import { deriveReasoning } from "../../../ai/face/reasoning";
import type { FaceReport } from "../../../shared/face";

// Training Queue — the human-review layer over completed scans.
//
// The AI prediction is never copied or mutated here: it stays in scans.report,
// the human-verified labels live in scan_labels, and this module only moves a
// sample through pending → approved / rejected / needs_expert.
//
// Session auth throughout: in a single-clinic tool everyone logged in is trusted
// staff, and they can already view every scan.
export function createQueueRoutes(deps: AppDeps, auth: RequestHandler): Router {
  const router = Router();

  const isStatus = (s: unknown): s is QueueStatus =>
    typeof s === "string" && (QUEUE_STATUSES as readonly string[]).includes(s);

  router.get("/api/training-queue/stats", auth, async (_req, res) => {
    const counts = await deps.scans.queueStats();
    const stats = Object.fromEntries(QUEUE_STATUSES.map((s) => [s, counts[s] ?? 0]));
    res.json({ ...stats, total: Object.values(counts).reduce((a, b) => a + b, 0) });
  });

  router.get("/api/training-queue", auth, async (req, res) => {
    const { status, q, from, to } = req.query;
    if (status !== undefined && !isStatus(status)) {
      res.status(400).json({ error: `unknown status: ${status}` });
      return;
    }
    const entries = await deps.scans.listQueue({
      status: typeof status === "string" ? status : undefined,
      q: typeof q === "string" && q.trim() ? q.trim() : undefined,
      from: typeof from === "string" && from ? from : undefined,
      to: typeof to === "string" && to ? to : undefined,
    });

    // Attach the headline AI numbers each row shows.
    const rows = await Promise.all(
      entries.map(async (e) => {
        const scan = await deps.scans.get(e.scanId);
        const report = scan?.report as FaceReport | undefined;
        const angles = await deps.scans.listImages(e.scanId);
        return {
          ...e,
          overallScore: report?.overall?.score ?? null,
          overallConfidence: report?.overall?.confidence ?? null,
          modelVersion: report?.modelVersions?.acne ?? null,
          angleCount: angles.length,
        };
      }),
    );
    res.json({ entries: rows });
  });

  // Full sample: AI prediction (immutable), human labels, images, reasoning.
  router.get("/api/training-queue/:scanId", auth, async (req, res) => {
    const entry = await deps.scans.getQueueEntry(req.params.scanId);
    const scan = await deps.scans.get(req.params.scanId);
    if (!entry || !scan) {
      res.status(404).json({ error: "not in queue" });
      return;
    }
    const report = scan.report as FaceReport | null;
    const angles = await deps.scans.listImages(scan.id);
    const labels = await deps.scans.getLabels(scan.id);

    let reasoning: string[] = report ? deriveReasoning(report) : [];
    let reasoningSource: "gemini" | "derived" = "derived";
    if (report && deps.faceExplain) {
      // Gemini prose when configured; the derived bullets remain the fallback.
      const online = await deps.faceExplain(report).catch(() => null);
      const text = online?.education?.trim();
      if (text) {
        reasoning = text.split(/(?<=\.)\s+/).filter(Boolean);
        reasoningSource = "gemini";
      }
    }

    res.json({
      entry,
      report,
      labels,
      reasoning,
      reasoningSource,
      angles: angles.map((a) => ({ angle: a.angle, quality: a.quality })),
    });
  });

  router.post("/api/training-queue/:scanId/status", auth, async (req, res) => {
    const { status, note } = req.body ?? {};
    if (!isStatus(status)) {
      res.status(400).json({ error: "invalid status", allowed: QUEUE_STATUSES });
      return;
    }
    const ok = await deps.scans.setQueueStatus(
      req.params.scanId,
      status,
      null,
      typeof note === "string" ? note : null,
    );
    if (!ok) {
      res.status(404).json({ error: "not in queue" });
      return;
    }
    res.json({ ok: true, status });
  });

  return router;
}
