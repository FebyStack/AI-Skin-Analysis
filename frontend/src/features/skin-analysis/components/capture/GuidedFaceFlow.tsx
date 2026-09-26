import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCamera } from "../../hooks/use-camera";
import { useFaceScan } from "../../hooks/use-face-scan";
import { makeAnalyzeFrame, FACE_MODEL_VERSIONS } from "./frame-adapter";
import { FaceReportView } from "../results/FaceReportView";
import { ReportBoundary } from "../results/ReportBoundary";
import { saveFaceScanWithFallback } from "../../pwa/save-flow";
import { HistoryView } from "../history/HistoryView";
import { ScanLabelControl } from "../patients/ScanLabelControl";
import { TrainingExport } from "../admin/TrainingExport";
import { ACNE_CLASSES } from "@ai/face/analyzers/face-model";
import { SKINTYPE_CLASSES } from "@ai/face/analyzers/skintype-model";
import { scanPatientId } from "../../store/patient-store";
import { refineAcneWithModel } from "@ai/face/analyzers/acne-model";
import { refineSkinTypeWithModel } from "@ai/face/analyzers/skintype-model";
import { ensureFaceModel, refineFaceWithModel } from "@ai/face/analyzers/face-model";
import { detectGeometry } from "@ai/face/landmarks/mediapipe";
import {
  ANGLE_YAW_WINDOWS,
  FACE_MIN_FRACTION,
  centerOffset,
  faceFraction,
} from "@ai/face/quality/validate";
import type { FaceGeometry, Pixels } from "@ai/face/types";
import { FACE_ANGLES, type FaceReport, type FaceAngle } from "@shared/face";
import { captureInfo } from "./capture-info";
import { FaceRejectedError, type CapturedAngle } from "../../api/face-client";
import { SILHOUETTE_YAW_RATIO, maskPaths, outerPathD, svgGuide } from "./phi-mask";
import { useEasedYaw } from "./use-eased-yaw";
import { useInviteAllowance } from "../../hooks/use-invite-allowance";
import { LoadingState } from "../ui/LoadingState";

type View = "capture" | "saving" | "result" | "history";

// Auto-capture tuning. Previously this fired ~1s after the camera went live
// while the patient was still reading the instruction, because it only checked
// yaw — and "front" is a ±12° window that almost any glance satisfies.
const CHECK_MS = 350;
const HOLD_CHECKS = 5;        // ~1.75s of CONTINUOUS good pose
const ARM_DELAY_MS = 1000;    // grace after each step appears, to read + get set
const CENTER_MAX = 0.32;      // face must be near frame centre, not just facing it

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

// Decode a captured JPEG blob to RGBA pixels for the learned models, cropped to
// the face bbox (less background noise) AND scaled straight down to the models'
// input size. The models resize to 224 internally anyway, so keeping full-res
// buffers for all 5 angles just burned ~40x the memory — enough to get the tab
// OOM-killed on iOS Safari. Browser scaling is also better than our nearest-
// neighbour resample.
const MODEL_INPUT = 224;

// Learned-model refinement must never block saving: on a phone the ONNX loads +
// inferences can be very slow, and a stall left the UI stuck on "Saving your
// scan…". Cap it and save the deterministic report instead.
const REFINE_TIMEOUT_MS = Number(import.meta.env?.VITE_REFINE_TIMEOUT_MS ?? "20000");

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    let done = false;
    const settle = (v: T) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(v);
    };
    const timer = setTimeout(() => settle(fallback), ms);
    p.then(settle, () => settle(fallback));
  });
}

async function blobToPixels(blob: Blob, geometry: FaceGeometry | null): Promise<Pixels | null> {
  let bmp: ImageBitmap | null = null;
  try {
    bmp = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = MODEL_INPUT;
    canvas.height = MODEL_INPUT;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const full = { x: 0, y: 0, w: bmp.width, h: bmp.height };
    let rect = geometry ? faceRect(geometry, bmp.width, bmp.height) : full;
    if (rect.w < 32 || rect.h < 32) rect = full; // degenerate bbox — use whole frame
    ctx.drawImage(bmp, rect.x, rect.y, rect.w, rect.h, 0, 0, MODEL_INPUT, MODEL_INPUT);
    const { data, width, height } = ctx.getImageData(0, 0, MODEL_INPUT, MODEL_INPUT);
    return { data, width, height };
  } catch {
    return null;
  } finally {
    bmp?.close(); // release the decoded frame promptly
  }
}

export function GuidedFaceFlow({ isInvite = false }: { isInvite?: boolean }) {
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
  // A permanent refusal (link used up / expired / revoked). Distinct from a
  // transient error, because there is nothing to retry and no saved scan.
  const [rejected, setRejected] = useState<string>("");
  const { allowance, refresh: refreshAllowance } = useInviteAllowance(isInvite);
  const inviteExhausted = isInvite && allowance !== null && allowance.scansLeft <= 0;

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
  // Auto-capture stays disarmed for ARM_DELAY_MS after a step appears so the
  // patient can read the instruction and settle before anything can fire.
  const armedAt = useRef(Date.now() + ARM_DELAY_MS);
  useEffect(() => {
    setHoldStreak(0);
    armedAt.current = Date.now() + ARM_DELAY_MS;
  }, [scan.stepIndex, camera.status]);
  useEffect(() => {
    if (view !== "capture" || camera.status !== "live") return;
    const id = setInterval(async () => {
      // Never overlap with a capture in flight or a previous check.
      if (poseCheckBusy.current || scan.busy || scan.done) return;
      const el = camera.videoRef.current;
      const angle = scan.currentAngle as FaceAngle | undefined;
      if (!el || !el.videoWidth || !angle) return;
      if (Date.now() < armedAt.current) return; // still in the grace period
      poseCheckBusy.current = true;
      try {
        const g = await detectGeometry(el, performance.now());
        const [lo, hi] = ANGLE_YAW_WINDOWS[angle];
        // Facing the right way is NOT enough — the patient must also be close
        // enough and centred, or we shoot someone sitting back reading the screen.
        const good =
          g !== null &&
          g.yawDeg >= lo &&
          g.yawDeg <= hi &&
          faceFraction(g) >= FACE_MIN_FRACTION &&
          centerOffset(g) <= CENTER_MAX;
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
      const video = camera.videoRef.current;
      const capture = video ? captureInfo(video) : undefined;
      for (const a of FACE_ANGLES) {
        const blob = capturedByAngle.current.get(a);
        if (blob) angles.push({ angle: a, blob, mime: "image/jpeg", capture });
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
        const base = report;
        report = await withTimeout(
          (async () => {
            // Preferred: ONE multi-head model — a single download and a single
            // forward pass per view for every task. Falls back to the older
            // per-task models until `make retrain-face` has been run.
            if (await ensureFaceModel()) return refineFaceWithModel(base, views);
            let r = await refineAcneWithModel(base, views);
            return refineSkinTypeWithModel(r, views);
          })(),
          REFINE_TIMEOUT_MS,
          base, // too slow → save the deterministic report rather than hang
        );
      }

      try {
        const outcome = await saveFaceScanWithFallback(report, angles, scanPatientId());
        setSaved(outcome.localReport);
        setSavedScanId(outcome.scan?.id ?? null);
        setOffline(outcome.offline);
        setView("result");
        void refreshAllowance();
      } catch (err) {
        if (err instanceof FaceRejectedError) {
          // Nothing was stored and nothing will be. Say so instead of showing a
          // report that implies the visit was recorded.
          setRejected(err.message);
          void refreshAllowance();
          setView("capture");
          return;
        }
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

  // NOTE: this block sits ABOVE every early return because it contains hooks
  // (useEasedYaw, useMemo). It used to live down with the capture markup, so a
  // render that returned early for another view skipped two hooks and React
  // threw "Rendered fewer hooks than expected" — which unmounted the app the
  // moment a scan finished. Hooks must run on every render, unconditionally.
  // Capture state — per-step guidance derived from the angle being captured.
  const currentAngle = scan.currentAngle as FaceAngle;
  const turnDir: "left" | "right" | "none" = currentAngle?.startsWith("left")
    ? "left"
    : currentAngle?.startsWith("right")
      ? "right"
      : "none";
  // Turn the guide to the middle of the window this step actually accepts, so
  // the mask and the validator can never disagree about the target pose.
  //
  // The signs work out to the same number, via two flips that cancel:
  // the window is measured on the RAW camera frame, where the patient's left is
  // image-right, so "left-45" is negative. The preview is CSS-mirrored, which
  // puts the patient's left back on screen-left. And a negative Y-rotation of
  // the mask swings its nose to screen-left. So the midpoint is used as-is.
  const [yawLo, yawHi] = ANGLE_YAW_WINDOWS[currentAngle] ?? [0, 0];
  const guideYaw = (yawLo + yawHi) / 2;
  const holding = holdStreak > 0;
  // One eased angle drives the scrim, the outline and the wireframe together.
  const easedYaw = useEasedYaw(guideYaw);
  const { maskPath, innerPaths } = useMemo(() => {
    const { cx, cy, scale } = svgGuide(100, 133);
    return {
      // The framing silhouette only leans; the face inside turns the whole way.
      maskPath: outerPathD(cx, cy, scale, easedYaw * SILHOUETTE_YAW_RATIO),
      innerPaths: maskPaths(cx, cy, scale, easedYaw),
    };
  }, [easedYaw]);
  const countdown = Math.max(0, HOLD_CHECKS - holdStreak);
  const positionCue = holding
    ? `Hold still — capturing in ${countdown}…`
    : turnDir === "none"
      ? "Center your face in the guide"
      : `Turn ${turnDir} — keep your face in the guide`;
  const stepLabel = `Step ${scan.stepIndex + 1} of ${scan.totalSteps}`;

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
        <ReportBoundary onViewHistory={isInvite ? undefined : () => setView("history")}>
          <FaceReportView report={saved} />
        </ReportBoundary>
        {savedScanId && !isInvite && (
          <>
            <ScanLabelControl scanId={savedScanId} dimension="acne" title="Clinician acne grade" labels={ACNE_CLASSES} />
            <ScanLabelControl scanId={savedScanId} dimension="skintype" title="Clinician skin type" labels={SKINTYPE_CLASSES} />
            <TrainingExport />
          </>
        )}
        <div className="mx-auto mt-6 flex max-w-3xl justify-center gap-3 px-4">
          {!inviteExhausted && (
            <button onClick={reset} className="btn-primary px-6">New scan</button>
          )}
          {!isInvite && (
            <button onClick={() => setView("history")} className="btn-secondary px-6">History</button>
          )}
        </div>
      </div>
    );
  }

  // Reached "result" with no report to show. The scan itself is saved, so send
  // the user to history rather than falling through to the capture UI — whose
  // camera has already been torn down, which just renders as a black rectangle.
  if (view === "result") {
    return (
      <div className="mx-auto max-w-lg space-y-3 p-6 text-center">
        <p className="text-sm text-ink-secondary">
          Your scan was saved, but the report could not be loaded.
        </p>
        {!isInvite && (
          <button onClick={() => setView("history")} className="btn-primary px-5">
            View scan history
          </button>
        )}
      </div>
    );
  }

  if (rejected) {
    return (
      <div className="mx-auto max-w-md animate-reveal space-y-3 p-6 text-center">
        <h2 className="font-serif text-xl font-semibold text-ink">Scan not saved</h2>
        <p className="text-sm leading-relaxed text-ink-secondary">{rejected}</p>
        <p className="text-xs text-ink-tertiary">
          Nothing was stored. Ask the clinic for a new link to try again.
        </p>
      </div>
    );
  }

  if (inviteExhausted && view === "capture") {
    return (
      <div className="mx-auto max-w-md animate-reveal space-y-3 p-6 text-center">
        <h2 className="font-serif text-xl font-semibold text-ink">This link is used up</h2>
        <p className="text-sm leading-relaxed text-ink-secondary">
          All {allowance?.maxScans} scans on this link have been completed. Ask the clinic for a new
          link if you need another.
        </p>
      </div>
    );
  }

  if (view === "saving") {
    return <LoadingState label="Reading your scan…" />;
  }


  return (
    <div className="relative flex w-full animate-reveal flex-col items-center">
      {/* Local ambient glow behind the camera — brand warmth without competing
          with the live preview. Fixed layers are reserved for the login screen. */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-8 h-[26rem] w-[26rem] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(201,162,75,0.13),transparent_68%)] blur-3xl"
      />

      {/* Editorial instruction — the patient reads this, so it leads. */}
      <div className="relative mb-5 text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-hairline-strong bg-surface/60 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.2em] text-ink-secondary">
          <span className={`h-1 w-1 rounded-full ${holding ? "bg-ok" : "bg-gold"}`} />
          {stepLabel}
        </span>
        <p className="mx-auto mt-3 max-w-[22ch] font-serif text-[clamp(1.35rem,4.5vw,1.75rem)] font-semibold leading-tight tracking-tight text-ink [text-wrap:balance]">
          {scan.instruction}
        </p>
      </div>

      {/* Camera: double-bezel tray so the preview reads as a machined plate. */}
      {isInvite && allowance && (
        <p className="mb-3 text-[11px] uppercase tracking-[0.14em] text-ink-tertiary">
          {allowance.scansLeft} of {allowance.maxScans} scan{allowance.maxScans === 1 ? "" : "s"} left
          on this link
        </p>
      )}

      <div className="relative w-full max-w-sm rounded-[2rem] border border-hairline bg-white/[0.04] p-2 shadow-card">
        <div className="relative aspect-[3/4] w-full overflow-hidden rounded-[1.5rem] bg-black">
          <video
            ref={camera.videoRef}
            playsInline
            muted
            className="h-full w-full object-cover scale-x-[-1]" /* selfie preview mirror */
          />

          {/* Face-positioning guide: the golden-ratio mask. The SVG layer owns the
              scrim, silhouette and hold progress; the WebGL layer adds the
              wireframe interior and turns it to this step's target pose. */}
          {camera.status === "live" && (
            <div className="pointer-events-none absolute inset-0">
              <svg viewBox="0 0 100 133" className="h-full w-full">
                <defs>
                  <mask id="faceHole">
                    <rect width="100" height="133" fill="white" />
                    <path d={maskPath} fill="black" />
                  </mask>
                </defs>
                <rect width="100" height="133" fill="rgba(0,0,0,0.52)" mask="url(#faceHole)" />

                {/* The construction drawing. Kept faint deliberately: it has to
                    read as the phi mask without hiding the skin being framed. */}
                {innerPaths.map((p, i) => (
                  <path
                    key={i}
                    d={p.d}
                    fill="none"
                    stroke="currentColor"
                    strokeLinejoin="round"
                    className={
                      holding
                        ? "text-ok"
                        : p.ink === "construction"
                          ? "text-gold/25"
                          : p.ink === "feature"
                            ? "text-gold/60"
                            : "text-gold/70"
                    }
                    strokeOpacity={holding ? (p.ink === "construction" ? 0.3 : 0.7) : 1}
                    strokeWidth={p.ink === "construction" ? 0.28 : 0.42}
                  />
                ))}

                <path
                  d={maskPath}
                  fill="none"
                  className={`transition-all duration-500 ease-spring ${holding ? "text-gold-bright" : "text-gold/70"}`}
                  stroke="currentColor"
                  strokeWidth={holding ? 1.5 : 0.7}
                  strokeDasharray={holding ? undefined : "3 2"}
                  strokeLinejoin="round"
                />
                {/* Hold progress traces the silhouette as the countdown runs. */}
                {holding && (
                  <path
                    d={maskPath}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    className="text-ok transition-[stroke-dashoffset] duration-300 ease-linear"
                    pathLength={100}
                    strokeDasharray="100"
                    strokeDashoffset={100 - (holdStreak / HOLD_CHECKS) * 100}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}
              </svg>

              {/* Directional chevron for the current step (front shows none). */}
              {turnDir !== "none" && (
                <div
                  className={`absolute top-1/2 -translate-y-1/2 animate-pulse text-gold ${turnDir === "left" ? "left-3" : "right-3"}`}
                >
                  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    {turnDir === "left" ? <polyline points="15 18 9 12 15 6" /> : <polyline points="9 18 15 12 9 6" />}
                  </svg>
                </div>
              )}

              <p className="absolute inset-x-0 bottom-4 px-4 text-center text-xs font-medium tracking-wide text-white/90">
                {positionCue}
              </p>
            </div>
          )}

          {camera.status !== "live" && (
            <div className="absolute inset-0 grid place-items-center bg-black/70 px-6 text-center text-sm text-ink">
              {camera.status === "denied" && "Camera permission denied"}
              {camera.status === "no-camera" && "No camera available"}
              {camera.status === "starting" && "Starting camera…"}
              {camera.status === "idle" && "Waiting…"}
            </div>
          )}
        </div>
      </div>

      {/* Progress: one segment per angle (done / current / pending). */}
      <div className="relative mt-5 flex items-center gap-1.5" aria-label={stepLabel}>
        {FACE_ANGLES.map((a, i) => (
          <span
            key={a}
            className={`h-1.5 rounded-full transition-all duration-500 ease-spring ${
              i < scan.stepIndex ? "w-5 bg-gold" : i === scan.stepIndex ? "w-8 bg-gold-bright" : "w-5 bg-hairline"
            }`}
          />
        ))}
      </div>

      {scan.lastIssues.length > 0 && (
        <p className="relative mt-3 rounded-xl border border-soon-edge bg-soon-surface px-3 py-1.5 text-xs text-soon">
          Please retake: {scan.lastIssues.join(", ")}
        </p>
      )}

      {/* Auto-capture fires on a steady hold; this stays as the manual fallback. */}
      <button
        onClick={captureNow}
        disabled={camera.status !== "live" || scan.busy}
        className="group btn-primary relative mt-6 w-full max-w-[16rem] justify-between rounded-full py-3 pl-6 pr-2"
      >
        <span>{scan.busy ? "Analyzing…" : "Capture"}</span>
        <span className="grid h-8 w-8 place-items-center rounded-full bg-gold-ink/10 transition-transform duration-500 ease-spring group-hover:-translate-y-px group-hover:scale-105">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="12" cy="13" r="3.5" />
            <path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h2.2a1.5 1.5 0 0 0 1.25-.67l.8-1.2A1.5 1.5 0 0 1 10 4.5h4a1.5 1.5 0 0 1 1.25.67l.8 1.2A1.5 1.5 0 0 0 17.3 7h2.2A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5Z" />
          </svg>
        </span>
      </button>

      <p className="relative mt-3 text-xs text-ink-tertiary">
        Hold the pose for a moment and it captures on its own.
      </p>

      {!isInvite && (
        <button
          onClick={() => setView("history")}
          className="relative mt-5 text-sm font-medium text-gold-bright underline-offset-4 transition-colors hover:text-gold hover:underline"
        >
          View scan history
        </button>
      )}
    </div>
  );
}
