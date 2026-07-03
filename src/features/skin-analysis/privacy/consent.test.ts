import { describe, it, expect, beforeEach } from "vitest";
import { CONSENT_VERSION, hasValidConsent, recordConsent, revokeConsent } from "./consent";

describe("consent", () => {
  beforeEach(() => localStorage.clear());

  it("reports no consent initially", () => {
    expect(hasValidConsent()).toBe(false);
  });

  it("reports valid consent after recording the current version", () => {
    recordConsent();
    expect(hasValidConsent()).toBe(true);
  });

  it("invalidates consent recorded under an older version", () => {
    localStorage.setItem(
      "skin-analysis.consent",
      JSON.stringify({ version: CONSENT_VERSION - 1, at: Date.now() }),
    );
    expect(hasValidConsent()).toBe(false);
  });

  it("revokes consent", () => {
    recordConsent();
    revokeConsent();
    expect(hasValidConsent()).toBe(false);
  });
});
