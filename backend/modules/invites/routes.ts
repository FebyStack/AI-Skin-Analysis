import { Router, type RequestHandler } from "express";
import type { AppDeps } from "../../shared/deps";
import { makeInviteSessionToken } from "../auth/service";
import {
  DEFAULT_MAX_SCANS,
  DEFAULT_TTL_DAYS,
  inviteDeniedMessage,
  inviteState,
  scansLeft,
  type Invite,
} from "../../../shared/invites";

/** The token is the secret in the URL — never send it back on list/status. */
function publicInvite(i: Invite, nowMs: number) {
  const { token: _token, ...rest } = i;
  return { ...rest, state: inviteState(i, nowMs), scansLeft: scansLeft(i) };
}

export function createInviteRoutes(
  deps: AppDeps,
  clinician: RequestHandler,
  session: RequestHandler,
): Router {
  const router = Router();

  // ── clinic side ───────────────────────────────────────────────────────────
  router.post("/api/invites", clinician, async (req, res) => {
    if (!deps.invites) {
      res.status(503).json({ error: "invites unavailable" });
      return;
    }
    const { label, maxScans, ttlDays } = req.body ?? {};
    const scans = maxScans === undefined ? DEFAULT_MAX_SCANS : Number(maxScans);
    if (!Number.isInteger(scans) || scans < 1 || scans > 50) {
      res.status(400).json({ error: "maxScans must be a whole number from 1 to 50" });
      return;
    }
    const ttl = ttlDays === undefined ? DEFAULT_TTL_DAYS : Number(ttlDays);
    if (!Number.isFinite(ttl) || ttl < 0 || ttl > 365) {
      res.status(400).json({ error: "ttlDays must be between 0 and 365" });
      return;
    }
    const invite = await deps.invites.create({
      label: typeof label === "string" && label.trim() ? label.trim() : null,
      maxScans: scans,
      ttlDays: ttl,
    });
    // The only time the token is ever returned — it cannot be recovered later.
    res.json({ invite: publicInvite(invite, deps.now()), token: invite.token });
  });

  router.get("/api/invites", clinician, async (_req, res) => {
    if (!deps.invites) {
      res.json({ invites: [] });
      return;
    }
    const now = deps.now();
    res.json({ invites: (await deps.invites.list()).map((i) => publicInvite(i, now)) });
  });

  router.post("/api/invites/:id/revoke", clinician, async (req, res) => {
    if (!deps.invites) {
      res.status(503).json({ error: "invites unavailable" });
      return;
    }
    const ok = await deps.invites.revoke(req.params.id);
    res.status(ok ? 200 : 404).json(ok ? { ok: true } : { error: "not found or already revoked" });
  });

  // ── patient side ──────────────────────────────────────────────────────────
  /** Exchange the link's token for an invite session. Unauthenticated by design. */
  router.post("/api/auth/invite", async (req, res) => {
    const token = req.body?.token;
    if (!deps.invites || typeof token !== "string" || !token) {
      res.status(400).json({ error: "invite token required" });
      return;
    }
    const invite = await deps.invites.getByToken(token);
    // Same response for "no such token" and "dead token": a wrong guess must not
    // be distinguishable from a real link that has run out.
    if (!invite) {
      res.status(404).json({ error: "This link is not valid." });
      return;
    }
    const state = inviteState(invite, deps.now());
    if (state !== "active") {
      res.status(403).json({ error: inviteDeniedMessage(state), inviteState: state });
      return;
    }
    res.setHeader(
      "Set-Cookie",
      `session=${makeInviteSessionToken(deps.sessionSecret, deps.now(), invite.id)}; HttpOnly; Path=/; SameSite=Strict; Max-Age=43200`,
    );
    res.json({ ok: true, scansLeft: scansLeft(invite), maxScans: invite.maxScans });
  });

  /** How many scans the current link has left, for the patient's own UI. */
  router.get("/api/auth/invite-status", session, async (req, res) => {
    if (req.session?.role !== "invite" || !deps.invites) {
      res.json({ invite: null });
      return;
    }
    const invite = await deps.invites.get(req.session.inviteId);
    if (!invite) {
      res.json({ invite: null });
      return;
    }
    res.json({
      invite: {
        scansLeft: scansLeft(invite),
        maxScans: invite.maxScans,
        state: inviteState(invite, deps.now()),
      },
    });
  });

  return router;
}
