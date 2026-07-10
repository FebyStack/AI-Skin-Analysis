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

export function isValidSession(token: string | undefined, secret: string, nowMs: number): boolean {
  if (!token) return false;
  const [expiresStr, sig] = token.split(".");
  const expires = Number(expiresStr);
  if (!Number.isFinite(expires) || expires < nowMs) return false;
  const expected = createHmac("sha256", secret).update(expiresStr).digest("hex");
  if (sig?.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header?.split(";") ?? []) {
    const idx = part.indexOf("=");
    if (idx > 0) out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return out;
}
