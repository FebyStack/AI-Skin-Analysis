import { Router } from "express";
import type { AppDeps } from "../../shared/deps";
import {
  verifyOrBootstrapPassword,
  makeSessionToken,
  parseCookies,
  isValidSession,
} from "./service";

export function createAuthRoutes(deps: AppDeps): Router {
  const router = Router();

  router.post("/api/auth/login", async (req, res) => {
    const ok = await verifyOrBootstrapPassword(deps.settings, req.body?.password);
    if (!ok) {
      res.status(401).json({ error: "invalid password" });
      return;
    }
    const token = makeSessionToken(deps.sessionSecret, deps.now());
    res.setHeader(
      "Set-Cookie",
      `session=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=43200`,
    );
    res.json({ ok: true });
  });

  router.get("/api/auth/status", (req, res) => {
    const token = parseCookies(req.headers.cookie)["session"];
    const authenticated = isValidSession(token, deps.sessionSecret, deps.now());
    res.json({ authenticated });
  });

  return router;
}
