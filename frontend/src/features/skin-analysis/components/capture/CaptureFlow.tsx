import { useCallback, useEffect, useState } from "react";
import { useScanMachine } from "../../store/scan-machine";
import { CameraFeed } from "./CameraFeed";
import { UploadDropzone } from "./UploadDropzone";
import { useQualityGate } from "../../hooks/use-quality-gate";
import { useAnalysis, type AnalysisStage } from "../../hooks/use-analysis";
import { AnalysisProgress } from "../results/AnalysisProgress";
import { ReportView } from "../results/ReportView";
import { stripMetadata, canvasCodec, toCaptureResult } from "../../privacy/redact";
import { getScan } from "../../api/analyze-client";
import type { AnalysisReport } from "@shared/contract";
import type { CaptureMode, CaptureResult } from "../../types";

export function CaptureFlow({ mode, patientId }: { mode: CaptureMode; patientId: string }) {
  const machine = useScanMachine();
  const runQualityGate = useQualityGate();
  const [stage, setStage] = useState<AnalysisStage | "quality">("quality");
  const runAnalysis = useAnalysis(setStage);

  const process = useCallback(
    async (result: CaptureResult) => {
      const report = await runQualityGate(result.blob);
      if (!report.ok) {
        console.error("Image quality check failed:", report.issues, report);
        machine.qualityRejected(report);
        return;
      }
      setStage("quality");
      machine.captured(result);
      void runAnalysis(result, patientId);
    },
    [machine, runQualityGate, runAnalysis, patientId],
  );

  const onUpload = useCallback(
    async (file: File) => {
      try {
        const clean = await stripMetadata(file, "image/jpeg", canvasCodec);
        await process(toCaptureResult(clean, mode, "upload"));
      } catch (err) {
        console.error("Failed to strip metadata and process uploaded file:", err);
        machine.uploadFailed();
      }
    },
    [machine, mode, process],
  );

  const onUnavailable = useCallback(
    (reason: "denied" | "no-camera") =>
      reason === "denied" ? machine.cameraDenied() : machine.noCamera(),
    [machine],
  );
  const quality = machine.quality;

  // The scan's report already exists server-side by the time we reach "results" —
  // fetch it by id so results survive a reload and work for scans synced later
  // from the offline queue, rather than trusting only in-memory state from this capture.
  const [report, setReport] = useState<AnalysisReport | null>(null);
  const [reportError, setReportError] = useState(false);
  useEffect(() => {
    if (machine.state !== "results" || !machine.scanId) return;
    let cancelled = false;
    setReportError(false);
    getScan(machine.scanId)
      .then((scan) => {
        if (!cancelled) setReport(scan?.report ?? null);
      })
      .catch((err) => {
        console.error("Failed to fetch scan report:", err);
        if (!cancelled) setReportError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [machine.state, machine.scanId]);

  // Results view
  if (machine.state === "results" && machine.verdict) {
    return (
      <ReportView
        report={report}
        verdict={machine.verdict}
        onNewScan={machine.reset}
        capturedBlob={machine.capture?.blob}
        reportUnavailable={reportError}
      />
    );
  }

  if (machine.state === "idle") {
    return (
      <button
        onClick={machine.grantConsent}
        className="rounded-lg bg-clinical px-6 py-3 text-sm font-semibold text-white"
      >
        Start scan
      </button>
    );
  }

  const captureErrors = ["denied", "no-camera", "upload-failed", "blur", "low-light"] as const;
  const isCaptureError =
    machine.state === "error" &&
    captureErrors.includes(machine.error as (typeof captureErrors)[number]);
  const isAnalysisError = machine.state === "error" && !isCaptureError;
  const useUpload = machine.captureSource === "upload" || isCaptureError;

  return (
    <div className="flex flex-col items-center gap-4">
      {machine.state === "error" && (
        <>
          {quality ? (
            <div
              className="max-w-xl rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
              role="alert"
            >
              <p className="font-semibold">This photo cannot be analyzed yet.</p>
              <p className="mt-1">{quality.guidance}</p>
            </div>
          ) : (
            <>
              {machine.error === "blur" && (
                <p className="text-sm text-stone-600" role="status">
                  That photo looked blurry — hold steady and try again, or upload a clearer one.
                </p>
              )}
              {machine.error === "low-light" && (
                <p className="text-sm text-stone-600" role="status">
                  Lighting was too dark or bright — find even light, or upload a photo.
                </p>
              )}
              {machine.error === "denied" && (
                <p className="text-sm text-stone-600">
                  Camera unavailable — upload a photo instead.
                </p>
              )}
              {machine.error === "upload-failed" && (
                <p className="text-sm text-stone-600" role="status">
                  Couldn't process that photo — it may be corrupt or unsupported. Try another.
                </p>
              )}
            </>
          )}
        </>
      )}
      {isAnalysisError && (
        <div className="flex flex-col items-center gap-3" role="alert">
          <p className="text-sm text-stone-600">
            Analysis failed — nothing was saved. You can try again.
          </p>
          <button
            onClick={machine.reset}
            className="rounded-lg bg-clinical px-6 py-3 text-sm font-semibold text-white"
          >
            Try again
          </button>
        </div>
      )}
      {!isAnalysisError && machine.state !== "analyzing" &&
        (useUpload ? (
          <>
            <UploadDropzone onFile={onUpload} />
            <button
              onClick={machine.chooseCamera}
              className="text-sm font-medium text-clinical underline-offset-2 hover:underline"
            >
              Use camera instead
            </button>
          </>
        ) : (
          <>
            <CameraFeed
              mode={mode}
              onCapture={process}
              onUnavailable={onUnavailable}
              onLive={machine.cameraReady}
            />
            <button
              onClick={machine.chooseUpload}
              className="text-sm font-medium text-clinical underline-offset-2 hover:underline"
            >
              Upload a photo instead
            </button>
          </>
        ))}
      {machine.state === "analyzing" && <AnalysisProgress stage={stage} />}
    </div>
  );
}
