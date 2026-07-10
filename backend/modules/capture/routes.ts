import { Router, type RequestHandler } from "express";
import type { CaptureSessionStore } from "./store";

export function createCaptureRoutes(captures: CaptureSessionStore, auth: RequestHandler): Router {
  const router = Router();

  router.post("/api/capture-sessions", auth, (_req, res) => {
    const { token } = captures.create();
    res.status(201).json({ token, path: `/capture/${token}` });
  });

  // Phone-side: token IS the authorization (single-use, 5-min TTL, upload-only).
  router.post("/api/capture-sessions/:token/image", (req, res) => {
    const { image, mime, mode } = req.body ?? {};
    if (typeof image !== "string" || typeof mime !== "string" || (mode !== "face" && mode !== "closeup")) {
      res.status(400).json({ error: "invalid capture" });
      return;
    }
    const ok = captures.submit(req.params.token, { image, mime, mode });
    res.status(ok ? 200 : 410).json(ok ? { ok: true } : { error: "session expired or used" });
  });

  router.get("/api/capture-sessions/:token", auth, (req, res) => {
    const capture = captures.take(req.params.token);
    if (!capture) {
      res.status(404).json({ error: "no capture yet" });
      return;
    }
    res.json({ capture });
  });

  return router;
}
