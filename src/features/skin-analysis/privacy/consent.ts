export const CONSENT_VERSION = 1;
const KEY = "skin-analysis.consent";

interface ConsentRecord {
  version: number;
  at: number;
}

export function hasValidConsent(): boolean {
  const raw = localStorage.getItem(KEY);
  if (!raw) return false;
  try {
    const rec = JSON.parse(raw) as ConsentRecord;
    return rec.version === CONSENT_VERSION;
  } catch {
    return false;
  }
}

export function recordConsent(): void {
  const rec: ConsentRecord = { version: CONSENT_VERSION, at: Date.now() };
  localStorage.setItem(KEY, JSON.stringify(rec));
}

export function revokeConsent(): void {
  localStorage.removeItem(KEY);
}
