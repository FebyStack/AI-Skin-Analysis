/**
 * Scan invites — a private link that lets someone outside the clinic run a
 * limited number of scans and see nothing else.
 *
 * The quota is the whole point, so it is enforced server-side on the save
 * endpoint, never in the UI. A client that skips the counter must still be
 * refused by the database.
 */

export const DEFAULT_MAX_SCANS = 2;

/** How long a link stays usable even if nobody scans. Keeps stale links from lingering. */
export const DEFAULT_TTL_DAYS = 7;

export type InviteState = "active" | "exhausted" | "expired" | "revoked";

export interface Invite {
  id: string;
  /** The secret in the URL. Never logged, never shown after creation except to the creator. */
  token: string;
  /** Who this was sent to, for the clinician's own records. Free text. */
  label: string | null;
  maxScans: number;
  usedScans: number;
  expiresAt: number | null;
  revokedAt: number | null;
  createdAt: number;
}

export function inviteState(i: Invite, nowMs: number): InviteState {
  if (i.revokedAt !== null) return "revoked";
  if (i.expiresAt !== null && i.expiresAt <= nowMs) return "expired";
  if (i.usedScans >= i.maxScans) return "exhausted";
  return "active";
}

export function scansLeft(i: Invite): number {
  return Math.max(0, i.maxScans - i.usedScans);
}

export const INVITE_STATE_LABEL: Record<InviteState, string> = {
  active: "Active",
  exhausted: "All scans used",
  expired: "Expired",
  revoked: "Revoked",
};

/**
 * Why a link stopped working, in words a patient can act on. Deliberately does
 * not distinguish "revoked" from "expired" to the link holder — that is the
 * clinic's business, and the answer is the same either way: ask for a new link.
 */
export function inviteDeniedMessage(state: InviteState): string {
  if (state === "exhausted") return "This link has already been used for all of its scans.";
  return "This link is no longer active. Ask the clinic for a new one.";
}

/** The shareable URL for a token, given the origin the clinic is reachable on. */
export function inviteUrl(origin: string, token: string): string {
  return `${origin.replace(/\/$/, "")}/?invite=${encodeURIComponent(token)}`;
}
