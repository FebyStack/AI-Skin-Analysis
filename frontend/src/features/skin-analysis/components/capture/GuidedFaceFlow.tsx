import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCamera } from "../../hooks/use-camera";
import { useFaceScan } from "../../hooks/use-face-scan";
import { makeAnalyzeFrame, FACE_MODEL_VERSIONS } from "./frame-adapter";
import { FaceReportView } from "../results/FaceReportView";
import { saveFaceScanWithFallback } from "../../pwa/save-flow";
import { HistoryView } from "../history/HistoryView";
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
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    void camera.start();
  }, [camera]);

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
      try {
        const outcome = await saveFaceScanWithFallback(scan.report as FaceReport, angles);
        setSaved(outcome.localReport);
        setOffline(outcome.offline);
        setView("result");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Save failed.");
        setSaved(scan.report as FaceReport);
        setView("result");
      }
    })();
  }, [scan.report, view]);

  const reset = useCallback(() => {
    scan.reset();
    capturedByAngle.current = new Map();
    setSaved(null);
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
          <p className="mx-auto mb-3 max-w-3xl rounded-lg bg-stone-100 p-3 text-sm text-stone-600">
            You're offline — this scan is stored on-device and will sync when back online.
          </p>
        )}
        {error && (
          <p className="mx-auto mb-3 max-w-3xl rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="alert">
            {error}
          </p>
        )}
        <FaceReportView report={saved} />
        <div className="mx-auto mt-4 flex max-w-3xl justify-center gap-3 px-4">
          <button onClick={reset} className="min-h-[44px] rounded-lg bg-clinical px-6 text-sm font-semibold text-white">
            New scan
          </button>
          <button
            onClick={() => setView("history")}
            className="min-h-[44px] rounded-lg border border-stone-300 px-6 text-sm font-medium text-stone-700"
          >
            History
          </button>
        </div>
      </div>
    );
  }

  if (view === "saving") {
    return <p className="py-8 text-center text-sm text-stone-500">Saving your scan…</p>;
  }

  // Capture state
  return (
    <div className="flex w-full flex-col items-center gap-4">
      <div className="relative aspect-[3/4] w-full max-w-sm overflow-hidden rounded-2xl bg-black shadow-inner">
        <video
          ref={camera.videoRef}
          playsInline
          muted
          className="h-full w-full object-cover scale-x-[-1]" /* selfie preview mirror */
        />
        {camera.status !== "live" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-sm text-white">
            {camera.status === "denied" && "Camera permission denied"}
            {camera.status === "no-camera" && "No camera available"}
            {camera.status === "starting" && "Starting camera…"}
            {camera.status === "idle" && "Waiting…"}
          </div>
        )}
      </div>

      <div className="flex flex-col items-center gap-1">
        <div className="text-xs font-semibold text-stone-500">
          Step {scan.stepIndex + 1} of {scan.totalSteps}
        </div>
        <p className="max-w-sm text-center text-sm text-stone-800">{scan.instruction}</p>
        {scan.lastIssues.length > 0 && (
          <p className="text-xs text-amber-700">
            Please retake: {scan.lastIssues.join(", ")}
          </p>
        )}
      </div>

      <button
        onClick={captureNow}
        disabled={camera.status !== "live" || scan.busy}
        className="min-h-[44px] rounded-full bg-clinical px-8 py-2 text-sm font-semibold text-white shadow disabled:opacity-40"
      >
        {scan.busy ? "Analyzing…" : "Capture"}
      </button>

      <button
        onClick={() => setView("history")}
        className="text-sm font-medium text-clinical underline-offset-2 hover:underline"
      >
        View scan history
      </button>
    </div>
  );
}
