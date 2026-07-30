import { Router } from "express";
import type { AppDeps } from "../../shared/deps";
import { createFailureLimiter } from "../../middleware/rate-limit";
import {
  verifyOrBootstrapPassword,
  makeSessionToken,
  parseCookies,
  parseSession,
} from "./service";

export function createAuthRoutes(deps: AppDeps): Router {
  const router = Router();

  // The clinic password is the only gate on a publicly reachable URL, so failed
  // guesses are budgeted. 10 per 15 minutes per caller; a success clears it.
  const loginLimit = createFailureLimiter({ max: 10, windowMs: 15 * 60_000 }, deps.now);

  router.post("/api/auth/login", loginLimit.guard, async (req, res) => {
    const ok = await verifyOrBootstrapPassword(deps.settings, req.body?.password);
    if (!ok) {
      loginLimit.fail(req);
      res.status(401).json({ error: "invalid password" });
      return;
    }
    loginLimit.succeed(req);
    const token = makeSessionToken(deps.sessionSecret, deps.now());
    res.setHeader(
      "Set-Cookie",
      `session=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=43200`,
    );
    res.json({ ok: true });
  });

  /**
   * The session cookie is HttpOnly, so the client CANNOT clear it — the previous
   * client-side logout was a no-op and left the session live. This is the only
   * way to actually end one, which matters most for an invite link opened on a
   * shared or family device.
   */
  router.post("/api/auth/logout", (_req, res) => {
    res.setHeader("Set-Cookie", "session=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0");
    res.json({ ok: true });
  });

  router.get("/api/auth/status", (req, res) => {
    const token = parseCookies(req.headers.cookie)["session"];
    const session = parseSession(token, deps.sessionSecret, deps.now());
    // The role scopes the UI. It is advisory only — every clinician route is
    // gated server-side regardless of what the client chooses to render.
    res.json({ authenticated: session !== null, role: session?.role ?? null });
  });

  return router;
}
