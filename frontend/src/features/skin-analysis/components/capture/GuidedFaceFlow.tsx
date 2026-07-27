import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCamera } from "../../hooks/use-camera";
import { useFaceScan } from "../../hooks/use-face-scan";
import { makeAnalyzeFrame, FACE_MODEL_VERSIONS } from "./frame-adapter";
import { FaceReportView } from "../results/FaceReportView";
import { saveFaceScanWithFallback } from "../../pwa/save-flow";
import { HistoryView } from "../history/HistoryView";
import { ScanLabelControl } from "../patients/ScanLabelControl";
import { TrainingExport } from "../admin/TrainingExport";
import { ACNE_CLASSES } from "@ai/face/analyzers/acne-model";
import { SKINTYPE_CLASSES } from "@ai/face/analyzers/skintype-model";
import { scanPatientId } from "../../store/patient-store";
import { refineAcneWithModel } from "@ai/face/analyzers/acne-model";
import { refineSkinTypeWithModel } from "@ai/face/analyzers/skintype-model";
import { refineDimensionsWithModels } from "@ai/face/analyzers/dimension-model";
import { detectGeometry } from "@ai/face/landmarks/mediapipe";
import { ANGLE_YAW_WINDOWS } from "@ai/face/quality/validate";
import type { FaceGeometry, Pixels } from "@ai/face/types";
import { FACE_ANGLES, type FaceReport, type FaceAngle } from "@shared/face";
import type { CapturedAngle } from "../../api/face-client";

type View = "capture" | "saving" | "result" | "history";

// Auto-capture: this many consecutive good pose checks (at CHECK_MS apart)
// triggers the shot — roughly a one-second steady hold.
const HOLD_CHECKS = 3;
const CHECK_MS = 350;

// Face bbox (pixel coords, 15% margin) from normalized MediaPipe landmarks.
function faceRect(g: FaceGeometry, w: number, h: number) {
  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  for (const l of g.landmarks) {
    if (l.x < minX) minX = l.x;
    if (l.y < minY) minY = l.y;
    if (l.x > maxX) maxX = l.x;
    if (l.y > maxY) maxY = l.y;
  }
  const mx = (maxX - minX) * 0.15;
  const my = (maxY - minY) * 0.15;
  const x = Math.max(0, Math.floor((minX - mx) * w));
  const y = Math.max(0, Math.floor((minY - my) * h));
  return {
    x,
    y,
    w: Math.min(w, Math.ceil((maxX + mx) * w)) - x,
    h: Math.min(h, Math.ceil((maxY + my) * h)) - y,
  };
}

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

// Decode a captured JPEG blob back to RGBA pixels for the learned models,
// cropped to the face bbox when geometry is known (less background noise).
async function blobToPixels(blob: Blob, geometry: FaceGeometry | null): Promise<Pixels | null> {
  try {
    const bmp = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bmp, 0, 0);
    const full = { x: 0, y: 0, w: bmp.width, h: bmp.height };
    let rect = geometry ? faceRect(geometry, bmp.width, bmp.height) : full;
    if (rect.w < 32 || rect.h < 32) rect = full; // degenerate bbox — use whole frame
    const { data, width, height } = ctx.getImageData(rect.x, rect.y, rect.w, rect.h);
    return { data, width, height };
  } catch {
    return null;
  }
}

export function GuidedFaceFlow() {
  const camera = useCamera("face");
  // Face geometry per captured angle — used to crop saved frames to the face
  // bbox before the learned models see them.
  const geometryByAngle = useRef<Map<FaceAngle, FaceGeometry>>(new Map());
  const analyzeFrame = useMemo(
    () =>
      makeAnalyzeFrame(
        () => camera.videoRef.current,
        (angle, g) => {
          if (g) geometryByAngle.current.set(angle, g);
        },
      ),
    [camera.videoRef],
  );
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

  // Auto-capture: poll the pose cheaply (landmarks only, no full analysis) and
  // shoot after HOLD_CHECKS consecutive in-window frames — "just turn your
  // head". The Capture button stays as a manual fallback.
  const [holdStreak, setHoldStreak] = useState(0);
  const poseCheckBusy = useRef(false);
  useEffect(() => setHoldStreak(0), [scan.stepIndex]); // new step → re-arm
  useEffect(() => {
    if (view !== "capture" || camera.status !== "live") return;
    const id = setInterval(async () => {
      // Never overlap with a capture in flight or a previous check.
      if (poseCheckBusy.current || scan.busy || scan.done) return;
      const el = camera.videoRef.current;
      const angle = scan.currentAngle as FaceAngle | undefined;
      if (!el || !el.videoWidth || !angle) return;
      poseCheckBusy.current = true;
      try {
        const g = await detectGeometry(el, performance.now());
        const [lo, hi] = ANGLE_YAW_WINDOWS[angle];
        const good = g !== null && g.yawDeg >= lo && g.yawDeg <= hi;
        setHoldStreak((s) => (good ? s + 1 : 0));
      } catch {
        setHoldStreak(0);
      } finally {
        poseCheckBusy.current = false;
      }
    }, CHECK_MS);
    return () => clearInterval(id);
  }, [view, camera.status, camera.videoRef, scan.busy, scan.done, scan.currentAngle]);

  useEffect(() => {
    if (holdStreak >= HOLD_CHECKS && view === "capture" && !scan.busy) {
      setHoldStreak(0);
      void captureNow();
    }
  }, [holdStreak, view, scan.busy, captureNow]);

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
      // Learned models refine acne + skin type when their ONNX is present
      // (offline-safe: no model → deterministic report unchanged). Every
      // captured angle contributes: each frame is cropped to its face bbox and
      // the models average class probabilities across views.
      let report = scan.report as FaceReport;
      const views: Pixels[] = [];
      for (const a of FACE_ANGLES) {
        const blob = capturedByAngle.current.get(a);
        if (!blob) continue;
        const px = await blobToPixels(blob, geometryByAngle.current.get(a) ?? null);
        if (px) views.push(px);
      }
      if (views.length > 0) {
        report = await refineAcneWithModel(report, views);
        report = await refineSkinTypeWithModel(report, views);
        // redness / wrinkles / pores / pigmentation — each overrides only if a
        // trained model exists for it and clears the confidence gate.
        report = await refineDimensionsWithModels(report, views);
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
    geometryByAngle.current = new Map();
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
            <TrainingExport />
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

  // Capture state — per-step guidance derived from the angle being captured.
  const currentAngle = scan.currentAngle as FaceAngle;
  const turnDir: "left" | "right" | "none" = currentAngle?.startsWith("left")
    ? "left"
    : currentAngle?.startsWith("right")
      ? "right"
      : "none";
  const holding = holdStreak > 0;
  const positionCue = holding
    ? "Hold still…"
    : turnDir === "none"
      ? "Center your face in the oval"
      : `Turn ${turnDir} — keep your face in the oval`;
  return (
    <div className="flex w-full flex-col items-center gap-4">
      <div className="relative aspect-[3/4] w-full max-w-sm overflow-hidden rounded-2xl border border-hairline bg-black shadow-card">
        <video
          ref={camera.videoRef}
          playsInline
          muted
          className="h-full w-full object-cover scale-x-[-1]" /* selfie preview mirror */
        />
        {/* Face-positioning guide: dim everything outside a centred oval + dashed outline. */}
        {camera.status === "live" && (
          <div className="pointer-events-none absolute inset-0">
            <svg viewBox="0 0 100 133" preserveAspectRatio="none" className="h-full w-full text-gold">
              <defs>
                <mask id="faceHole">
                  <rect width="100" height="133" fill="white" />
                  <ellipse cx="50" cy="58" rx="29" ry="38" fill="black" />
                </mask>
              </defs>
              <rect width="100" height="133" fill="rgba(0,0,0,0.5)" mask="url(#faceHole)" />
              <ellipse
                cx="50" cy="58" rx="29" ry="38"
                fill="none" stroke="currentColor"
                strokeWidth={holding ? 1.4 : 0.7}
                strokeDasharray={holding ? undefined : "3 2"}
              />
            </svg>
            {/* Directional chevron for the current step (front shows none). */}
            {turnDir !== "none" && (
              <div
                className={`absolute top-1/2 -translate-y-1/2 animate-pulse text-gold ${turnDir === "left" ? "left-2" : "right-2"}`}
              >
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  {turnDir === "left" ? <polyline points="15 18 9 12 15 6" /> : <polyline points="9 18 15 12 9 6" />}
                </svg>
              </div>
            )}
            <p className="absolute inset-x-0 top-3 px-4 text-center text-xs font-medium text-white/90">
              {positionCue}
            </p>
          </div>
        )}
        {camera.status !== "live" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/70 text-sm text-ink">
            {camera.status === "denied" && "Camera permission denied"}
            {camera.status === "no-camera" && "No camera available"}
            {camera.status === "starting" && "Starting camera…"}
            {camera.status === "idle" && "Waiting…"}
          </div>
        )}
      </div>

      <div className="flex flex-col items-center gap-2">
        {/* Per-step progress: one segment per angle (done / current / pending). */}
        <div className="flex items-center gap-1.5">
          {FACE_ANGLES.map((a, i) => (
            <span
              key={a}
              className={`h-1.5 rounded-full transition-all ${
                i < scan.stepIndex ? "w-4 bg-gold" : i === scan.stepIndex ? "w-6 bg-gold-bright" : "w-4 bg-hairline"
              }`}
            />
          ))}
        </div>
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
