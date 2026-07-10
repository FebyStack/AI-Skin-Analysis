import { describe, it, expect, vi } from "vitest";
import { runAnalysisPipeline, type AnalysisStage } from "./use-analysis";
import type { CaptureResult, Finding } from "../types";
import type { ScanWire } from "../api/analyze-client";
import golden from "../../../../server/analysis/fixtures/golden-report.json";
import type { AnalysisReport } from "../api/contract";

const capture: CaptureResult = {
  blob: new Blob(["x"], { type: "image/jpeg" }),
  mimeType: "image/jpeg",
  mode: "face",
  source: "camera",
  width: 100,
  height: 100,
};

const classifierFinding: Finding = {
  id: "acne",
  label: "Acne",
  source: "classifier",
  confidence: 0.6,
  severity: "mild",
};

function scanWith(report: AnalysisReport | null, partial: boolean): ScanWire {
  return {
    id: "scan-1",
    patientId: "p-1",
    mode: "face",
    createdAt: 1,
    imageWidth: 100,
    imageHeight: 100,
    report,
    partial,
    classifierFindings: [],
    promptVersion: report ? 2 : null,
  };
}

describe("runAnalysisPipeline", () => {
  it("runs classifier → analyze → verdict, emitting stages in order", async () => {
    const stages: AnalysisStage[] = [];
    const result = await runAnalysisPipeline(capture, "p-1", {
      classify: vi.fn(async () => [classifierFinding]),
      analyze: vi.fn(async () => scanWith(golden as unknown as AnalysisReport, false)),
      onStage: (s) => stages.push(s),
    });
    expect(stages).toEqual(["classifier", "analyzing", "crosscheck", "report"]);
    expect(result.scan.id).toBe("scan-1");
    expect(result.verdict.findings.some((f) => f.agreement === "agree")).toBe(true);
  });

  it("continues with an empty classifier result when the classifier fails", async () => {
    const result = await runAnalysisPipeline(capture, "p-1", {
      classify: vi.fn(async () => {
        throw new Error("no model");
      }),
      analyze: vi.fn(async () => scanWith(golden as unknown as AnalysisReport, false)),
      onStage: () => {},
    });
    expect(result.verdict.degraded).toBe("llm-only");
  });

  it("produces a classifier-only verdict for a partial scan", async () => {
    const result = await runAnalysisPipeline(capture, "p-1", {
      classify: vi.fn(async () => [classifierFinding]),
      analyze: vi.fn(async () => scanWith(null, true)),
      onStage: () => {},
    });
    expect(result.verdict.degraded).toBe("classifier-only");
  });

  it("propagates analyze failures (caller maps to machine error)", async () => {
    await expect(
      runAnalysisPipeline(capture, "p-1", {
        classify: vi.fn(async () => []),
        analyze: vi.fn(async () => {
          throw new Error("api down");
        }),
        onStage: () => {},
      }),
    ).rejects.toThrow(/api down/);
  });
});
