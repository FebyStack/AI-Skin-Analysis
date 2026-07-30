import type { NextFunction, Request, Response } from "express";
import { parseSession, parseCookies, type Session } from "../modules/auth/service";
import type { InviteRepo } from "../modules/invites/repository";
import { inviteDeniedMessage, inviteState } from "../../shared/invites";

declare module "express-serve-static-core" {
  interface Request {
    session?: Session;
  }
}

/**
 * Accepts the shared clinic login OR a scan-invite link.
 *
 * An invite's row is re-read on every request rather than trusted from the
 * token: revoking a link, or using up its last scan, has to take effect
 * immediately — not whenever a 12-hour cookie happens to expire.
 */
export function requireSession(secret: string, now: () => number, invites?: InviteRepo) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const token = parseCookies(req.headers.cookie)["session"];
    const session = parseSession(token, secret, now());
    if (!session) {
      res.status(401).json({ error: "login required" });
      return;
    }

    if (session.role === "invite") {
      // No repo wired → an invite token cannot be checked, so it is not
      // honoured. Fail closed rather than trust the cookie.
      const invite = invites ? await invites.get(session.inviteId) : null;
      if (!invite) {
        res.status(401).json({ error: "login required" });
        return;
      }
      const state = inviteState(invite, now());
      if (state !== "active") {
        res.status(403).json({ error: inviteDeniedMessage(state), inviteState: state });
        return;
      }
    }

    req.session = session;
    next();
  };
}

/**
 * Clinic staff only. Everything an invited patient must never reach — the
 * training queue, governance, the archive, analytics, other patients' scans —
 * sits behind this rather than behind `requireSession`.
 */
export function requireClinician(secret: string, now: () => number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const token = parseCookies(req.headers.cookie)["session"];
    const session = parseSession(token, secret, now());
    if (!session) {
      res.status(401).json({ error: "login required" });
      return;
    }
    if (session.role !== "clinic") {
      res.status(403).json({ error: "clinic staff only" });
      return;
    }
    req.session = session;
    next();
  };
}
