import { describe, it, expect } from "vitest";
import {
  mergeFindings,
  buildVerdict,
  combineConfidence,
  parseConfidenceThreshold,
  INCONCLUSIVE_DETAIL,
} from "./verdict";
import type { Finding } from "../types";
import type { AnalysisReport } from "../api/contract";
import golden from "@ai/evaluation/fixtures/golden-report.json";

const report = golden as unknown as AnalysisReport;

const classifierAcne: Finding = {
  id: "acne",
  label: "Acne",
  source: "classifier",
  confidence: 0.6,
  severity: "mild",
};
const classifierLesion: Finding = {
  id: "suspicious-lesion",
  label: "Lesion needing evaluation",
  source: "classifier",
  confidence: 0.5,
  severity: "attention",
};
const classifierEczema: Finding = {
  id: "eczema",
  label: "Eczema",
  source: "classifier",
  confidence: 0.4,
  severity: "moderate",
};

describe("combineConfidence", () => {
  it("is higher than either input and capped below 1", () => {
    const c = combineConfidence(0.7, 0.6);
    expect(c).toBeGreaterThan(0.7);
    expect(c).toBeLessThan(1);
  });
});

describe("confidence threshold", () => {
  it("parses decimal and percent threshold values", () => {
    expect(parseConfidenceThreshold("0.7")).toBe(0.7);
    expect(parseConfidenceThreshold("70%")).toBe(0.7);
    expect(parseConfidenceThreshold("70")).toBe(0.7);
  });
});

describe("mergeFindings", () => {
  it("marks findings present in both sources as agree with combined confidence", () => {
    const merged = mergeFindings([classifierAcne], report.findings);
    const acne = merged.find((f) => f.id === "acne");
    expect(acne?.agreement).toBe("agree");
    expect(acne?.confidence).toBeGreaterThan(0.72); // combined > llm alone
  });

  it("labels llm-only and classifier-only findings", () => {
    const merged = mergeFindings([classifierEczema], report.findings);
    expect(merged.find((f) => f.id === "eczema")?.agreement).toBe("classifier-only");
    expect(merged.find((f) => f.id === "acne")?.agreement).toBe("llm-only");
  });

  it("escalates attention findings from either source (safety override)", () => {
    const merged = mergeFindings([classifierLesion], report.findings);
    const lesion = merged.find((f) => f.id === "suspicious-lesion");
    expect(lesion?.escalated).toBe(true);
    expect(lesion?.severity).toBe("attention");
  });

  it("keeps the higher severity when sources agree but differ in severity", () => {
    const moderateAcne = { ...classifierAcne, severity: "moderate" as const };
    const merged = mergeFindings([moderateAcne], report.findings);
    expect(merged.find((f) => f.id === "acne")?.severity).toBe("moderate");
  });

  it("sorts escalated findings first, then by confidence", () => {
    const merged = mergeFindings([classifierLesion, classifierAcne], report.findings);
    expect(merged[0].id).toBe("suspicious-lesion");
  });
});

describe("buildVerdict", () => {
  it("builds a full verdict from a report plus classifier findings", () => {
    const v = buildVerdict(report, [classifierAcne]);
    expect(v.summary).toBe(report.summary);
    expect(v.disclaimerShown).toBe(true);
    expect(v.degraded).toBeUndefined();
    expect(v.findings.some((f) => f.agreement === "agree")).toBe(true);
  });

  it("builds a classifier-only degraded verdict when the report is null (partial scan)", () => {
    const v = buildVerdict(null, [classifierAcne, classifierLesion]);
    expect(v.degraded).toBe("classifier-only");
    expect(v.findings).toHaveLength(2);
    expect(v.findings.every((f) => f.agreement === "classifier-only")).toBe(true);
    expect(v.summary).toMatch(/partial/i);
  });

  it("builds an llm-only degraded verdict when classifier findings are absent", () => {
    const v = buildVerdict(report, []);
    expect(v.degraded).toBe("llm-only");
  });

  it("marks the result inconclusive when all predictions are below the threshold", () => {
    const lowConfidenceReport: AnalysisReport = {
      ...report,
      summary: "Low confidence condition summary",
      findings: report.findings.map((finding) => ({ ...finding, confidence: 0.4 })),
    };
    const v = buildVerdict(lowConfidenceReport, [classifierEczema], 0.7);
    expect(v.summary).toBe("Inconclusive Analysis");
    expect(v.inconclusive).toBe(true);
    expect(v.confidenceThreshold).toBe(0.7);
    expect(v.findings).toHaveLength(lowConfidenceReport.findings.length + 1);
  });

  it("keeps high-confidence results visible", () => {
    const v = buildVerdict(report, [classifierAcne], 0.7);
    expect(v.inconclusive).toBeUndefined();
    expect(v.summary).toBe(report.summary);
  });

  it("uses the required inconclusive explanation text", () => {
    expect(INCONCLUSIVE_DETAIL).toMatch(/does not provide sufficient confidence/i);
    expect(INCONCLUSIVE_DETAIL).toMatch(/dermatologist/i);
  });
});
