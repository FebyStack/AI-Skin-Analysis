import type { ScanConsent } from "@shared/training-governance";

// Consent captured by ScanConsentGate for the scan about to be taken. Module
// state (not persisted) so it is re-asked every session rather than assumed.
let current: ScanConsent = { analysis: false, training: false };

export function setScanConsent(c: ScanConsent): void {
  current = c;
}
export function scanConsent(): ScanConsent {
  return current;
}
