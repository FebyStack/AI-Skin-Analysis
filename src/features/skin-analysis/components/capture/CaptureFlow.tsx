import { useCallback } from "react";
import { useScanMachine } from "../../store/scan-machine";
import { CameraFeed } from "./CameraFeed";
import { UploadDropzone } from "./UploadDropzone";
import { useQualityGate } from "../../hooks/use-quality-gate";
import { useClassifier } from "../../hooks/use-classifier";
import { stripMetadata, canvasCodec, toCaptureResult } from "../../privacy/redact";
import type { CaptureMode, CaptureResult } from "../../types";

export function CaptureFlow({ mode }: { mode: CaptureMode }) {
  const machine = useScanMachine();
  const runQualityGate = useQualityGate();
  const classify = useClassifier();

  const process = useCallback(
    async (result: CaptureResult) => {
      const report = await runQualityGate(result.blob);
      if (!report.ok) {
        machine.qualityRejected(report.issues[0]);
        return;
      }
      machine.captured(result);
      // Independent second opinion runs off the main thread. The verdict merge
      // that consumes these findings alongside the LLM output lands in Plan 4.
      classify(result.blob).catch(() => machine.analysisFailed());
    },
    [machine, runQualityGate, classify],
  );

  const onUpload = useCallback(
    async (file: File) => {
      try {
        const clean = await stripMetadata(file, "image/jpeg", canvasCodec);
        await process(toCaptureResult(clean, mode, "upload"));
      } catch {
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

  const useUpload = machine.captureSource === "upload" || machine.state === "error";

  return (
    <div className="flex flex-col items-center gap-4">
      {machine.state === "error" && (
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
      {useUpload ? (
        <UploadDropzone onFile={onUpload} />
      ) : (
        <CameraFeed
          mode={mode}
          onCapture={process}
          onUnavailable={onUnavailable}
          onLive={machine.cameraReady}
        />
      )}
      {machine.state === "analyzing" && (
        // TODO(plan-4): verdict merge + results; add a "New scan" reset affordance
        <p className="text-sm text-clinical">Analyzing… (verdict merge lands in Plan 4)</p>
      )}
    </div>
  );
}
