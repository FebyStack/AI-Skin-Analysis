import { Router, type RequestHandler } from "express";
import type { AppDeps } from "../../shared/deps";
import { makeInviteSessionToken, parseCookies, parseSession } from "../auth/service";
import { newClaimId } from "./repository";
import {
  ALREADY_CLAIMED_MESSAGE,
  CLAIM_WINDOW_MINUTES,
  DEFAULT_MAX_SCANS,
  DEFAULT_TTL_MINUTES,
  claimDeadline,
  inviteDeniedMessage,
  inviteState,
  isUsable,
  scansLeft,
  type Invite,
} from "../../../shared/invites";

/**
 * The token AND the claim secret are withheld: the token is the URL secret, and
 * the claim id is what proves a device owns the link.
 */
function publicInvite(i: Invite, nowMs: number) {
  const { token: _token, claimId: _claim, ...rest } = i;
  return {
    ...rest,
    state: inviteState(i, nowMs),
    scansLeft: scansLeft(i),
    expiresAt: i.claimedAt === null ? i.expiresAt : claimDeadline(i),
  };
}

const CLAIM_WINDOW_MS = CLAIM_WINDOW_MINUTES * 60_000;

function inviteCookie(secret: string, now: number, inviteId: string, claimId: string): string {
  const token = makeInviteSessionToken(secret, now, inviteId, claimId, CLAIM_WINDOW_MS);
  return `session=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${Math.floor(CLAIM_WINDOW_MS / 1000)}`;
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
    const { label, maxScans, ttlMinutes } = req.body ?? {};
    const scans = maxScans === undefined ? DEFAULT_MAX_SCANS : Number(maxScans);
    if (!Number.isInteger(scans) || scans < 1 || scans > 50) {
      res.status(400).json({ error: "maxScans must be a whole number from 1 to 50" });
      return;
    }
    const ttl = ttlMinutes === undefined ? DEFAULT_TTL_MINUTES : Number(ttlMinutes);
    if (!Number.isFinite(ttl) || ttl < 0 || ttl > 43_200) {
      res.status(400).json({ error: "ttlMinutes must be between 0 and 43200" });
      return;
    }
    const invite = await deps.invites.create({
      label: typeof label === "string" && label.trim() ? label.trim() : null,
      maxScans: scans,
      ttlMinutes: ttl,
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
  /**
   * Exchange the link's token for a session. Unauthenticated by design.
   *
   * First caller CLAIMS the link and is handed a session carrying the claim
   * secret. Anyone opening the same URL afterwards is refused — that is what
   * makes a forwarded link useless. The original device may re-open its own link
   * (a reload, or tapping it again in the message thread) because it still holds
   * a cookie with the matching claim.
   */
  router.post("/api/auth/invite", async (req, res) => {
    const token = req.body?.token;
    if (!deps.invites || typeof token !== "string" || !token) {
      res.status(400).json({ error: "invite token required" });
      return;
    }
    const invite = await deps.invites.getByToken(token);
    if (!invite) {
      res.status(404).json({ error: "This link is not valid." });
      return;
    }

    const now = deps.now();
    const state = inviteState(invite, now);
    if (!isUsable(state)) {
      res.status(403).json({ error: inviteDeniedMessage(state), inviteState: state });
      return;
    }

    if (invite.claimedAt !== null) {
      // Already opened. Only the device holding the matching claim gets back in.
      const existing = parseSession(
        parseCookies(req.headers.cookie)["session"],
        deps.sessionSecret,
        now,
      );
      const sameDevice =
        existing?.role === "invite" &&
        existing.inviteId === invite.id &&
        existing.claimId === invite.claimId;
      if (!sameDevice) {
        res.status(409).json({ error: ALREADY_CLAIMED_MESSAGE, inviteState: "claimed" });
        return;
      }
      res.setHeader(
        "Set-Cookie",
        inviteCookie(deps.sessionSecret, now, invite.id, invite.claimId as string),
      );
      res.json({ ok: true, scansLeft: scansLeft(invite), maxScans: invite.maxScans });
      return;
    }

    const claimId = newClaimId();
    const claimed = await deps.invites.claim(invite.id, claimId);
    if (!claimed) {
      // Lost the race to another device opening the same link this instant.
      res.status(409).json({ error: ALREADY_CLAIMED_MESSAGE, inviteState: "claimed" });
      return;
    }
    res.setHeader("Set-Cookie", inviteCookie(deps.sessionSecret, now, claimed.id, claimId));
    res.json({
      ok: true,
      scansLeft: scansLeft(claimed),
      maxScans: claimed.maxScans,
      expiresAt: claimDeadline(claimed),
    });
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
        expiresAt: claimDeadline(invite),
      },
    });
  });

  return router;
}
