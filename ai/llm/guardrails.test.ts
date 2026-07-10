import { describe, it, expect } from "vitest";
import { validateInput, checkOutputGuardrails, MAX_IMAGE_BYTES } from "./guardrails";
import golden from "../evaluation/fixtures/golden-report.json";
import type { AnalysisReport } from "../../shared/contract";

const g = golden as unknown as AnalysisReport;

describe("validateInput", () => {
  const b64 = "aGVsbG8=";

  it("accepts a jpeg under the size cap", () => {
    expect(validateInput({ image: b64, mime: "image/jpeg", mode: "face" }).ok).toBe(true);
  });

  it("rejects a disallowed mime type", () => {
    const r = validateInput({ image: b64, mime: "application/pdf", mode: "face" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/mime/i);
  });

  it("rejects invalid base64", () => {
    expect(validateInput({ image: "!!!not-base64!!!", mime: "image/jpeg", mode: "face" }).ok).toBe(false);
  });

  it("rejects an oversized image", () => {
    const big = "A".repeat(Math.ceil((MAX_IMAGE_BYTES + 4) * (4 / 3)));
    expect(validateInput({ image: big, mime: "image/jpeg", mode: "face" }).ok).toBe(false);
  });

  it("rejects an invalid mode", () => {
    expect(validateInput({ image: b64, mime: "image/jpeg", mode: "xray" as never }).ok).toBe(false);
  });
});

describe("checkOutputGuardrails", () => {
  it("passes the golden report", () => {
    expect(checkOutputGuardrails(g).ok).toBe(true);
  });

  it("rejects diagnosis language in the summary", () => {
    const bad = { ...g, summary: "You have melanoma." };
    const r = checkOutputGuardrails(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violations.join()).toMatch(/diagnosis language/i);
  });

  it("rejects prescription language in a finding note", () => {
    const bad = structuredClone(g);
    bad.findings[0].note = "Take this medication twice daily.";
    expect(checkOutputGuardrails(bad).ok).toBe(false);
  });

  it("rejects a report whose disclaimer lacks the non-diagnosis statement", () => {
    const bad = { ...g, disclaimer: "Ask a doctor maybe." };
    expect(checkOutputGuardrails(bad).ok).toBe(false);
  });

  it("requires professional referral in summary when any finding is attention-level", () => {
    const bad = structuredClone(g);
    bad.summary = "All looks fine.";
    expect(checkOutputGuardrails(bad).ok).toBe(false);
  });

  it("rejects benign/malignant verdicts anywhere", () => {
    const bad = structuredClone(g);
    bad.findings[1].note = "This looks benign.";
    expect(checkOutputGuardrails(bad).ok).toBe(false);
  });
});
