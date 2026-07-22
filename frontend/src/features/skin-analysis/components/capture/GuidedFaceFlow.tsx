import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCamera } from "../../hooks/use-camera";
import { useFaceScan } from "../../hooks/use-face-scan";
import { makeAnalyzeFrame, FACE_MODEL_VERSIONS } from "./frame-adapter";
import { FaceReportView } from "../results/FaceReportView";
import { saveFaceScanWithFallback } from "../../pwa/save-flow";
import { HistoryView } from "../history/HistoryView";
import { ScanLabelControl } from "../patients/ScanLabelControl";
import { ACNE_CLASSES } from "@ai/face/analyzers/acne-model";
import { SKINTYPE_CLASSES } from "@ai/face/analyzers/skintype-model";
import { scanPatientId } from "../../store/patient-store";
import { refineAcneWithModel } from "@ai/face/analyzers/acne-model";
import { refineSkinTypeWithModel } from "@ai/face/analyzers/skintype-model";
import type { Pixels } from "@ai/face/types";
import { FACE_ANGLES, type FaceReport, type FaceAngle } from "@shared/face";
import type { CapturedAngle } from "../../api/face-client";

type View = "capture" | "saving" | "result" | "history";

// Grab the current video frame as a JPEG blob (persisted to Postgres + IndexedDB).
async function frameToJpeg(video: HTMLVideoElement | null): Promise<Blob | null> {
  if (!video || !video.videoWidth) return null;
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", 0.9));
}

// Decode a captured JPEG blob back to RGBA pixels for the learned acne model.
async function blobToPixels(blob: Blob): Promise<Pixels | null> {
  try {
    const bmp = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bmp, 0, 0);
    const { data, width, height } = ctx.getImageData(0, 0, bmp.width, bmp.height);
    return { data, width, height };
  } catch {
    return null;
  }
}

export function GuidedFaceFlow() {
  const camera = useCamera("face");
  const analyzeFrame = useMemo(() => makeAnalyzeFrame(() => camera.videoRef.current), [camera.videoRef]);
  const scan = useFaceScan({ analyzeFrame, modelVersions: FACE_MODEL_VERSIONS });
  // Keyed by angle so retakes overwrite the failed frame instead of stacking up.
  // Only the *last* frame for each angle survives — and since the sequence
  // doesn't advance past a failed capture, that last one is guaranteed good.
  const capturedByAngle = useRef<Map<FaceAngle, Blob>>(new Map());
  const [view, setView] = useState<View>("capture");
  const [saved, setSaved] = useState<FaceReport | null>(null);
  const [savedScanId, setSavedScanId] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    void camera.start();
    return () => camera.stop();
  }, []);

  const captureNow = useCallback(async () => {
    const angle = scan.currentAngle as FaceAngle;
    const blob = await frameToJpeg(camera.videoRef.current);
    if (blob) capturedByAngle.current.set(angle, blob);
    await scan.captureCurrent();
  }, [camera.videoRef, scan]);

  // When the pipeline finishes, save (local + server) and switch to result view.
  useEffect(() => {
    if (!scan.report || view !== "capture") return;
    (async () => {
      setView("saving");
      const angles: CapturedAngle[] = [];
      for (const a of FACE_ANGLES) {
        const blob = capturedByAngle.current.get(a);
        if (blob) angles.push({ angle: a, blob, mime: "image/jpeg" });
      }
      // Learned acne model refines the acne dimension when its ONNX is present
      // (offline-safe: no model → deterministic report unchanged).
      let report = scan.report as FaceReport;
      const frontBlob = capturedByAngle.current.get("front");
      if (frontBlob) {
        const px = await blobToPixels(frontBlob);
        if (px) {
          report = await refineAcneWithModel(report, px);
          report = await refineSkinTypeWithModel(report, px);
        }
      }

      try {
        const outcome = await saveFaceScanWithFallback(report, angles, scanPatientId());
        setSaved(outcome.localReport);
        setSavedScanId(outcome.scan?.id ?? null);
        setOffline(outcome.offline);
        setView("result");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Save failed.");
        setSaved(report);
        setView("result");
      }
    })();
  }, [scan.report, view]);

  const reset = useCallback(() => {
    scan.reset();
    capturedByAngle.current = new Map();
    setSaved(null);
    setSavedScanId(null);
    setOffline(false);
    setError("");
    setView("capture");
    void camera.start();
  }, [scan, camera]);

  if (view === "history") {
    return <HistoryView onBack={() => setView(saved ? "result" : "capture")} />;
  }

  if (view === "result" && saved) {
    return (
      <div className="w-full">
        {offline && (
          <p className="mx-auto mb-3 max-w-3xl rounded-xl border border-hairline bg-surface p-3 text-sm text-ink-secondary">
            You're offline — this scan is stored on-device and will sync when back online.
          </p>
        )}
        {error && (
          <p className="mx-auto mb-3 max-w-3xl rounded-xl border border-soon-edge bg-soon-surface p-3 text-sm text-soon" role="alert">
            {error}
          </p>
        )}
        <FaceReportView report={saved} />
        {savedScanId && (
          <>
            <ScanLabelControl scanId={savedScanId} dimension="acne" title="Clinician acne grade" labels={ACNE_CLASSES} />
            <ScanLabelControl scanId={savedScanId} dimension="skintype" title="Clinician skin type" labels={SKINTYPE_CLASSES} />
          </>
        )}
        <div className="mx-auto mt-6 flex max-w-3xl justify-center gap-3 px-4">
          <button onClick={reset} className="btn-primary px-6">New scan</button>
          <button onClick={() => setView("history")} className="btn-secondary px-6">History</button>
        </div>
      </div>
    );
  }

  if (view === "saving") {
    return <p className="py-8 text-center text-sm text-ink-secondary">Saving your scan…</p>;
  }

  // Capture state
  return (
    <div className="flex w-full flex-col items-center gap-4">
      <div className="relative aspect-[3/4] w-full max-w-sm overflow-hidden rounded-2xl border border-hairline bg-black shadow-card">
        <video
          ref={camera.videoRef}
          playsInline
          muted
          className="h-full w-full object-cover scale-x-[-1]" /* selfie preview mirror */
        />
        {camera.status !== "live" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/70 text-sm text-ink">
            {camera.status === "denied" && "Camera permission denied"}
            {camera.status === "no-camera" && "No camera available"}
            {camera.status === "starting" && "Starting camera…"}
            {camera.status === "idle" && "Waiting…"}
          </div>
        )}
      </div>

      <div className="flex flex-col items-center gap-1">
        <div className="text-xs font-semibold uppercase tracking-[0.1em] text-gold">
          Step {scan.stepIndex + 1} of {scan.totalSteps}
        </div>
        <p className="max-w-sm text-center text-sm text-ink">{scan.instruction}</p>
        {scan.lastIssues.length > 0 && (
          <p className="text-xs text-soon">Please retake: {scan.lastIssues.join(", ")}</p>
        )}
      </div>

      <button
        onClick={captureNow}
        disabled={camera.status !== "live" || scan.busy}
        className="btn-primary rounded-full px-8"
      >
        {scan.busy ? "Analyzing…" : "Capture"}
      </button>

      <button
        onClick={() => setView("history")}
        className="text-sm font-medium text-gold-bright underline-offset-2 hover:underline"
      >
        View scan history
      </button>
    </div>
  );
}
