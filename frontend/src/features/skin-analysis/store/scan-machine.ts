import { create } from "zustand";
import type {
  CaptureResult,
  CaptureSource,
  QualityIssue,
  QualityReport,
  Verdict,
} from "../types";

export type ScanState =
  | "idle"
  | "permission"
  | "framing"
  | "capturing"
  | "analyzing"
  | "results"
  | "error";

export type ScanError = "denied" | "no-camera" | "low-light" | "blur" | "analysis-failed" | "upload-failed";

interface ScanStore {
  state: ScanState;
  error: ScanError | null;
  quality: QualityReport | null;
  captureSource: CaptureSource;
  capture: CaptureResult | null;
  verdict: Verdict | null;
  scanId: string | null;
  grantConsent(): void;
  cameraReady(): void;
  cameraDenied(): void;
  noCamera(): void;
  chooseUpload(): void;
  chooseCamera(): void;
  captured(result: CaptureResult): void;
  analysisFailed(): void;
  uploadFailed(): void;
  qualityRejected(report: QualityReport): void;
  resultsReady(verdict: Verdict, scanId: string): void;
  reset(): void;
}

function qualityErrorForIssues(issues: QualityIssue[]): ScanError {
  if (issues.includes("no-region")) return "no-camera";
  if (issues.includes("too-dark") || issues.includes("too-bright") || issues.includes("glare")) {
    return "low-light";
  }
  return "blur";
}

export const useScanMachine = create<ScanStore>((set) => ({
  state: "idle",
  error: null,
  quality: null,
  captureSource: "camera",
  capture: null,
  verdict: null,
  scanId: null,
  grantConsent: () => set({ state: "permission", error: null, quality: null }),
  cameraReady: () => set({ state: "framing", captureSource: "camera", quality: null }),
  cameraDenied: () => set({ state: "error", error: "denied", quality: null }),
  noCamera: () => set({ state: "error", error: "no-camera", quality: null }),
  chooseUpload: () => set({ state: "framing", captureSource: "upload", error: null, quality: null }),
  chooseCamera: () =>
    set({ state: "permission", captureSource: "camera", error: null, quality: null }),
  captured: (result) => set({ state: "analyzing", capture: result, quality: null }),
  analysisFailed: () => set({ state: "error", error: "analysis-failed", quality: null }),
  uploadFailed: () => set({ state: "error", error: "upload-failed", quality: null }),
  qualityRejected: (quality) =>
    set({
      state: "error",
      error: qualityErrorForIssues(quality.issues),
      quality,
    }),
  resultsReady: (verdict, scanId) => set({ state: "results", verdict, scanId, quality: null }),
  reset: () =>
    set({
      state: "idle",
      error: null,
      quality: null,
      capture: null,
      captureSource: "camera",
      verdict: null,
      scanId: null,
    }),
}));
