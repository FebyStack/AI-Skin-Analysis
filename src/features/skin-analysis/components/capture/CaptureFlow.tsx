import { useCallback } from "react";
import { useScanMachine } from "../../store/scan-machine";
import { CameraFeed } from "./CameraFeed";
import { UploadDropzone } from "./UploadDropzone";
import { stripMetadata, canvasCodec, toCaptureResult } from "../../privacy/redact";
import type { CaptureMode, CaptureResult } from "../../types";

export function CaptureFlow({ mode }: { mode: CaptureMode }) {
  const machine = useScanMachine();

  const onCapture = useCallback(
    (r: CaptureResult) => machine.captured(r),
    [machine],
  );

  const onUpload = useCallback(
    async (file: File) => {
      const clean = await stripMetadata(file, "image/jpeg", canvasCodec);
      machine.captured(toCaptureResult(clean, mode, "upload"));
    },
    [machine, mode],
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
      {useUpload ? (
        <>
          {machine.error === "denied" && (
            <p className="text-sm text-stone-600">
              Camera unavailable — upload a photo instead.
            </p>
          )}
          <UploadDropzone onFile={onUpload} />
        </>
      ) : (
        <CameraFeed mode={mode} onCapture={onCapture} onUnavailable={onUnavailable} />
      )}
      {machine.state === "analyzing" && (
        <p className="text-sm text-clinical">Analyzing… (pipeline lands in a later plan)</p>
      )}
    </div>
  );
}
