import { createHmac, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import type { SettingsRepo } from "../settings/repository";

const PASSWORD_KEY = "password_hash";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h shift

export async function verifyOrBootstrapPassword(
  settings: SettingsRepo,
  password: string,
): Promise<boolean> {
  if (typeof password !== "string" || password.length < 8) return false;
  const hash = await settings.get(PASSWORD_KEY);
  if (!hash) {
    // First run: the first login sets the clinic password.
    await settings.set(PASSWORD_KEY, await bcrypt.hash(password, 10));
    return true;
  }
  return bcrypt.compare(password, hash);
}

export function makeSessionToken(secret: string, nowMs: number): string {
  const expires = nowMs + SESSION_TTL_MS;
  const sig = createHmac("sha256", secret).update(String(expires)).digest("hex");
  return `${expires}.${sig}`;
}

function signaturesMatch(payload: string, sig: string | undefined, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(payload).digest("hex");
  // timingSafeEqual throws on a length mismatch, so screen that first.
  if (sig?.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

/**
 * A session is either the shared clinic login or a scan-invite link. The role
 * travels inside the signed token so it cannot be escalated client-side; the
 * invite's remaining quota is NOT in here, because it changes — that is read
 * from the database on every invite-authenticated request.
 */
export type Session =
  | { role: "clinic" }
  | { role: "invite"; inviteId: string; claimId: string };

const INVITE_PREFIX = "v2";

/**
 * Session cookie for an invite link, carrying the claim secret minted when the
 * link was opened. The middleware requires it to still match the invite row, so
 * this cookie is only good for the one device that claimed the link.
 */
export function makeInviteSessionToken(
  secret: string,
  nowMs: number,
  inviteId: string,
  claimId: string,
  ttlMs = SESSION_TTL_MS,
): string {
  const payload = `${INVITE_PREFIX}.${nowMs + ttlMs}.invite.${inviteId}.${claimId}`;
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("hex")}`;
}

export function parseSession(
  token: string | undefined,
  secret: string,
  nowMs: number,
): Session | null {
  if (!token) return null;
  const parts = token.split(".");

  if (parts[0] === INVITE_PREFIX) {
    const [, expiresStr, role, inviteId, claimId, sig] = parts;
    if (parts.length !== 6 || role !== "invite" || !inviteId || !claimId) return null;
    const expires = Number(expiresStr);
    if (!Number.isFinite(expires) || expires < nowMs) return null;
    const payload = `${INVITE_PREFIX}.${expiresStr}.${role}.${inviteId}.${claimId}`;
    if (!signaturesMatch(payload, sig, secret)) return null;
    return { role: "invite", inviteId, claimId };
  }

  // Legacy two-part clinic token: `<expires>.<sig>`. Kept as-is so sessions
  // issued before invites existed keep working.
  const [expiresStr, sig] = parts;
  const expires = Number(expiresStr);
  if (parts.length !== 2 || !Number.isFinite(expires) || expires < nowMs) return null;
  if (!signaturesMatch(expiresStr, sig, secret)) return null;
  return { role: "clinic" };
}

export function isValidSession(token: string | undefined, secret: string, nowMs: number): boolean {
  return parseSession(token, secret, nowMs) !== null;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header?.split(";") ?? []) {
    const idx = part.indexOf("=");
    if (idx > 0) out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return out;
}
