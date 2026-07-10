import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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

describe("consent — storage unavailable", () => {
  afterEach(() => vi.restoreAllMocks());

  it("hasValidConsent returns false when getItem throws", () => {
    const g = globalThis.localStorage;
    vi.spyOn(g, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(hasValidConsent()).toBe(false);
  });

  it("recordConsent does not throw when setItem throws", () => {
    const g = globalThis.localStorage;
    vi.spyOn(g, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => recordConsent()).not.toThrow();
  });

  it("revokeConsent does not throw when removeItem throws", () => {
    const g = globalThis.localStorage;
    vi.spyOn(g, "removeItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(() => revokeConsent()).not.toThrow();
  });
});
