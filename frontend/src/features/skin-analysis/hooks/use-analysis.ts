import { useCallback } from "react";
import type { CaptureResult, Finding, Verdict } from "../types";
import type { ScanWire } from "../api/analyze-client";
import { analyzeCapture } from "../api/analyze-client";
import { buildVerdict } from "../ml/verdict";
import { useClassifier } from "./use-classifier";
import { useScanMachine } from "../store/scan-machine";

export type AnalysisStage = "classifier" | "analyzing" | "crosscheck" | "report";

export interface PipelineHooks {
  classify: (blob: Blob) => Promise<Finding[]>;
  analyze: (capture: CaptureResult, patientId: string, findings: Finding[]) => Promise<ScanWire>;
  onStage: (stage: AnalysisStage) => void;
}

export interface PipelineResult {
  scan: ScanWire;
  verdict: Verdict;
}

export async function runAnalysisPipeline(
  capture: CaptureResult,
  patientId: string,
  hooks: PipelineHooks,
): Promise<PipelineResult> {
  hooks.onStage("classifier");
  let classifierFindings: Finding[] = [];
  try {
    classifierFindings = await hooks.classify(capture.blob);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("not found")) {
      console.warn("On-device classifier skipped (no model file):", msg);
    } else {
      console.error("Classifier failed, running in LLM-only degraded mode:", err);
    }
  }

  hooks.onStage("analyzing");
  const scan = await hooks.analyze(capture, patientId, classifierFindings);

  hooks.onStage("crosscheck");
  const verdict = buildVerdict(scan.report, classifierFindings);

  hooks.onStage("report");
  return { scan, verdict };
}

export function useAnalysis(onStage: (stage: AnalysisStage) => void) {
  const classify = useClassifier();
  const machine = useScanMachine();

  return useCallback(
    async (capture: CaptureResult, patientId: string) => {
      try {
        const { scan, verdict } = await runAnalysisPipeline(capture, patientId, {
          classify,
          analyze: (c, pid, findings) => analyzeCapture(c, pid, findings),
          onStage,
        });
        machine.resultsReady(verdict, scan.id);
      } catch (err) {
        console.error("Analysis pipeline failed:", err);
        machine.analysisFailed();
      }
    },
    [classify, machine, onStage],
  );
}
