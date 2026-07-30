/**
 * Scan invites — a private link that lets someone outside the clinic run a
 * limited number of scans and see nothing else.
 *
 * The quota is the whole point, so it is enforced server-side on the save
 * endpoint, never in the UI. A client that skips the counter must still be
 * refused by the database.
 */

export const DEFAULT_MAX_SCANS = 2;

/**
 * Two separate clocks, and conflating them breaks a scan in progress.
 *
 * `DEFAULT_TTL_MINUTES` is the window to OPEN the link. Once opened it is bound
 * to that device, and `CLAIM_WINDOW_MINUTES` is how long that device then has to
 * finish. Without the second clock, someone opening the link at minute 14 would
 * be cut off two minutes into a five-step scan.
 */
export const DEFAULT_TTL_MINUTES = 15;
export const CLAIM_WINDOW_MINUTES = 60;

export type InviteState = "unopened" | "active" | "exhausted" | "expired" | "revoked";

export interface Invite {
  id: string;
  /** The secret in the URL. Never logged, never shown after creation except to the creator. */
  token: string;
  /** Who this was sent to, for the clinician's own records. Free text. */
  label: string | null;
  maxScans: number;
  usedScans: number;
  /** Deadline to OPEN the link. Irrelevant once claimed. */
  expiresAt: number | null;
  /** When the first device opened it. Null = still up for grabs. */
  claimedAt: number | null;
  /**
   * Random secret minted at claim time and embedded in that device's session.
   * A forwarded link cannot produce it, which is what makes the link single-use
   * per device rather than per link.
   */
  claimId: string | null;
  revokedAt: number | null;
  createdAt: number;
}

/** Deadline for the device that claimed the link to finish its scans. */
export function claimDeadline(i: Invite): number | null {
  return i.claimedAt === null ? null : i.claimedAt + CLAIM_WINDOW_MINUTES * 60_000;
}

export function inviteState(i: Invite, nowMs: number): InviteState {
  if (i.revokedAt !== null) return "revoked";
  if (i.usedScans >= i.maxScans) return "exhausted";
  if (i.claimedAt === null) {
    // Never opened: the open-by deadline applies.
    if (i.expiresAt !== null && i.expiresAt <= nowMs) return "expired";
    return "unopened";
  }
  // Opened: the open-by deadline no longer matters, the claim window does.
  const deadline = claimDeadline(i);
  if (deadline !== null && deadline <= nowMs) return "expired";
  return "active";
}

export function scansLeft(i: Invite): number {
  return Math.max(0, i.maxScans - i.usedScans);
}

export const INVITE_STATE_LABEL: Record<InviteState, string> = {
  unopened: "Not opened yet",
  active: "In use",
  exhausted: "All scans used",
  expired: "Expired",
  revoked: "Revoked",
};

/** An invite may be used for a scan only in these states. */
export function isUsable(state: InviteState): boolean {
  return state === "unopened" || state === "active";
}

/**
 * Why a link stopped working, in words a patient can act on. Deliberately does
 * not distinguish "revoked" from "expired" to the link holder — that is the
 * clinic's business, and the answer is the same either way: ask for a new link.
 */
export function inviteDeniedMessage(state: InviteState): string {
  if (state === "exhausted") return "This link has already been used for all of its scans.";
  return "This link is no longer active. Ask the clinic for a new one.";
}

/**
 * Shown when a link is opened on a second device. Deliberately explicit: the
 * likeliest cause is a forwarded link, and the second reader needs to know that
 * asking for their own link is the fix, not retrying.
 */
export const ALREADY_CLAIMED_MESSAGE =
  "This link was already opened on another device. Links work on one device only — ask the clinic for your own.";

/** The shareable URL for a token, given the origin the clinic is reachable on. */
export function inviteUrl(origin: string, token: string): string {
  return `${origin.replace(/\/$/, "")}/?invite=${encodeURIComponent(token)}`;
}
