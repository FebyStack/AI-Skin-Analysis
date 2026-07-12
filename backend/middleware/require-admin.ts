import type { RequestHandler } from "express";
import { parseCookies, isValidSession } from "../modules/auth/service";
import type { SettingsRepo } from "../modules/settings/repository";

export function requireAdmin(settings: SettingsRepo, sessionSecret: string, now: () => number): RequestHandler {
  return async (req, res, next) => {
    try {
      const token = parseCookies(req.headers.cookie)["session"];
      if (!isValidSession(token, sessionSecret, now())) {
        res.status(401).json({ error: "login required" });
        return;
      }

      const enabled = await settings.get("admin_enabled");
      if (enabled !== "true") {
        res.status(403).json({ error: "admin actions are disabled on this server" });
        return;
      }

      next();
    } catch (err) {
      console.error("requireAdmin error:", err);
      res.status(500).json({ error: "admin check failed" });
    }
  };
}
