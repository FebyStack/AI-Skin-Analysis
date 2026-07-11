import { Router, type RequestHandler } from "express";
import type { AppDeps } from "../../shared/deps";
import { LesionUnavailableError } from "./lesion-client";
import { builtinLesionExplanation } from "../../../ai/llm/fallback/lesion-education";

// Close-up lesion classification via the Python service. Stateless in this slice
// (no persistence yet — that lands with the scan_images work).
export function createLesionRoutes(deps: AppDeps, auth: RequestHandler): Router {
  const router = Router();

  router.post("/api/lesion", auth, async (req, res) => {
    const { image, mime } = req.body ?? {};
    if (typeof image !== "string" || image.length === 0) {
      res.status(400).json({ error: "image (base64) is required" });
      return;
    }
    try {
      const analysis = await deps.lesion.analyze(image, typeof mime === "string" ? mime : "image/jpeg");
      // Explanation: try the online Gemini explainer; fall back to the offline builtin.
      // The builtin is always a valid, guardrail-safe explanation.
      const online = deps.lesionExplain ? await deps.lesionExplain(analysis).catch(() => null) : null;
      const explanation = online ?? builtinLesionExplanation(analysis);
      res.json({ analysis, explanation });
    } catch (err) {
      if (err instanceof LesionUnavailableError) {
        res.status(503).json({ error: "lesion service unavailable" });
        return;
      }
      throw err;
    }
  });

  return router;
}
