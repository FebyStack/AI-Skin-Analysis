import { create } from "zustand";
import type { CaptureResult, CaptureSource, QualityIssue } from "../types";

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
  captureSource: CaptureSource;
  capture: CaptureResult | null;
  grantConsent(): void;
  cameraReady(): void;
  cameraDenied(): void;
  noCamera(): void;
  chooseUpload(): void;
  chooseCamera(): void;
  captured(result: CaptureResult): void;
  analysisFailed(): void;
  uploadFailed(): void;
  qualityRejected(issue: QualityIssue): void;
  reset(): void;
}

export const useScanMachine = create<ScanStore>((set) => ({
  state: "idle",
  error: null,
  captureSource: "camera",
  capture: null,
  grantConsent: () => set({ state: "permission", error: null }),
  cameraReady: () => set({ state: "framing", captureSource: "camera" }),
  cameraDenied: () => set({ state: "error", error: "denied" }),
  noCamera: () => set({ state: "error", error: "no-camera" }),
  chooseUpload: () => set({ state: "framing", captureSource: "upload", error: null }),
  chooseCamera: () => set({ state: "permission", captureSource: "camera", error: null }),
  captured: (result) => set({ state: "analyzing", capture: result }),
  analysisFailed: () => set({ state: "error", error: "analysis-failed" }),
  uploadFailed: () => set({ state: "error", error: "upload-failed" }),
  qualityRejected: (issue) =>
    set({
      state: "error",
      error:
        issue === "too-dark" || issue === "overexposed"
          ? "low-light"
          : issue === "no-region"
            ? "no-camera"
            : "blur",
    }),
  reset: () =>
    set({ state: "idle", error: null, capture: null, captureSource: "camera" }),
}));
