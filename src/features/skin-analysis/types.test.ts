import { describe, it, expect } from "vitest";
import { isFinding, FACE_ZONES, type Finding, type CaptureResult } from "./types";

describe("type guards", () => {
  it("accepts a well-formed Finding", () => {
    const f: Finding = {
      id: "acne",
      label: "Mild acne",
      source: "llm",
      confidence: 0.7,
      severity: "mild",
    };
    expect(isFinding(f)).toBe(true);
  });

  it("rejects an object missing required fields", () => {
    expect(isFinding({ id: "x" })).toBe(false);
  });

  it("rejects out-of-range confidence", () => {
    expect(
      isFinding({ id: "x", label: "y", source: "llm", confidence: 2, severity: "mild" }),
    ).toBe(false);
  });

  it("models a CaptureResult carrying a Blob and mode", () => {
    const c: CaptureResult = {
      blob: new Blob(["x"], { type: "image/jpeg" }),
      mimeType: "image/jpeg",
      mode: "face",
      source: "camera",
      width: 640,
      height: 480,
    };
    expect(c.mode).toBe("face");
  });
});

describe("isFinding — hardened validation", () => {
  const base = { id: "acne", label: "Acne", source: "llm", confidence: 0.5, severity: "mild" };

  it("rejects a non-string note", () => {
    expect(isFinding({ ...base, note: 123 })).toBe(false);
  });

  it("accepts a valid region and rejects an unknown one", () => {
    expect(isFinding({ ...base, region: "forehead" })).toBe(true);
    expect(isFinding({ ...base, region: "elbow" })).toBe(false);
  });

  it("rejects NaN confidence", () => {
    expect(isFinding({ ...base, confidence: NaN })).toBe(false);
  });

  it("exposes the face zone vocabulary", () => {
    expect(FACE_ZONES).toContain("left-cheek");
    expect(FACE_ZONES.length).toBe(7);
  });
});
