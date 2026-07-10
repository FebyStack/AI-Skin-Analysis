export const CONSENT_VERSION = 1;
const KEY = "skin-analysis.consent";

interface ConsentRecord {
  version: number;
  at: number;
}

export function hasValidConsent(): boolean {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return false;
    const rec = JSON.parse(raw) as ConsentRecord;
    return rec.version === CONSENT_VERSION;
  } catch {
    return false;
  }
}

export function recordConsent(): void {
  try {
    const rec: ConsentRecord = { version: CONSENT_VERSION, at: Date.now() };
    localStorage.setItem(KEY, JSON.stringify(rec));
  } catch {
    // storage unavailable (private mode / quota) — consent stays session-less
  }
}

export function revokeConsent(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // storage unavailable — nothing to revoke
  }
}
