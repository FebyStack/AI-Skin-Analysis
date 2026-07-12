import { useEffect, useRef, useState } from "react";
import { useCamera } from "../../hooks/use-camera";
import { stripMetadata, canvasCodec, toCaptureResult } from "../../privacy/redact";
import type { CaptureMode, CaptureResult } from "../../types";

export function CameraFeed({
  mode,
  onCapture,
  onUnavailable,
  onLive,
}: {
  mode: CaptureMode;
  onCapture: (r: CaptureResult) => void;
  onUnavailable: (reason: "denied" | "no-camera") => void;
  onLive?: () => void;
}) {
  const { videoRef, status, start } = useCamera(mode);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [guideStep, setGuideStep] = useState<"front" | "left" | "right">("front");

  useEffect(() => {
    start();
  }, []);

  useEffect(() => {
    if (status === "denied") onUnavailable("denied");
    if (status === "no-camera") onUnavailable("no-camera");
  }, [status, onUnavailable]);

  useEffect(() => {
    if (status === "live") onLive?.();
  }, [status, onLive]);

  const snap = async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    const raw: Blob | null = await new Promise((res) =>
      canvas.toBlob(res, "image/jpeg", 0.92),
    );
    if (!raw) return;
    const clean = await stripMetadata(raw, "image/jpeg", canvasCodec);
    onCapture(toCaptureResult(clean, mode, "camera"));
  };

  return (
    <div className="flex flex-col items-center gap-4 w-full">
      <div className="relative aspect-[3/4] w-full max-w-sm overflow-hidden rounded-2xl bg-black shadow-inner">
        <video
          ref={videoRef}
          playsInline
          muted
          // Mirror the LIVE PREVIEW only for the selfie camera (facingMode:"user")
          // so what the user sees matches a real mirror during framing. The
          // captured photo is drawn from the raw video stream (untransformed)
          // in snap() below, so the stored image is not mirrored.
          className={`h-full w-full object-cover ${mode === "face" ? "scale-x-[-1]" : ""}`}
        />

        {/* Interactive facial positioning overlay.
            The video is mirrored in face mode (see className above); mirror the
            alignment shapes too so "left cheek" guidance stays over the user's
            actual left cheek in the mirrored preview. */}
        {status === "live" && mode === "face" && (
          <>
            {/* Oval Alignment Grid - mathematically centered in the entire container */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none scale-x-[-1]">
              <div
                className={`transition-all duration-500 transform ${
                  guideStep === "left"
                    ? "rotate-[15deg] translate-x-4 scale-95 text-amber-400"
                    : guideStep === "right"
                    ? "-rotate-[15deg] -translate-x-4 scale-95 text-amber-400"
                    : "text-clinical scale-100"
                }`}
              >
                <svg
                  className="w-40 h-52 sm:w-44 sm:h-56 transition-colors duration-300"
                  viewBox="0 0 100 100"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                >
                  {/* Outer positioning ellipse */}
                  <ellipse cx="50" cy="50" rx="30" ry="40" strokeDasharray="3 3" />
                  
                  {/* Eye alignment guide lines */}
                  {guideStep === "front" && (
                    <>
                      <line x1="38" y1="42" x2="46" y2="42" strokeWidth="1.5" opacity="0.8" />
                      <line x1="54" y1="42" x2="62" y2="42" strokeWidth="1.5" opacity="0.8" />
                      <path d="M50 46 L50 56 L47 56" strokeWidth="1.5" opacity="0.8" />
                    </>
                  )}

                  {/* Left profile target marker */}
                  {guideStep === "left" && (
                    <path
                      d="M38 50 Q30 50 30 55"
                      strokeWidth="2"
                      className="animate-pulse"
                    />
                  )}

                  {/* Right profile target marker */}
                  {guideStep === "right" && (
                    <path
                      d="M62 50 Q70 50 70 55"
                      strokeWidth="2"
                      className="animate-pulse"
                    />
                  )}
                </svg>
              </div>
            </div>

            {/* Top/Bottom Controls Overlay */}
            <div className="absolute inset-0 flex flex-col justify-between p-4 pointer-events-none bg-gradient-to-b from-black/40 via-transparent to-black/60">
              {/* Instruction Banner */}
              <div className="self-center rounded-full bg-stone-900/80 px-4 py-1.5 text-center text-xs font-semibold text-white backdrop-blur-sm pointer-events-auto border border-stone-700">
                {guideStep === "front" && "Step 1 of 3: Align front face profile"}
                {guideStep === "left" && "Step 2 of 3: Turn head slightly right (left cheek)"}
                {guideStep === "right" && "Step 3 of 3: Turn head slightly left (right cheek)"}
              </div>

              {/* Stepper Dots & Navigation Actions */}
              <div className="flex flex-col items-center gap-3 pointer-events-auto w-full">
                {/* Stepper Indicator */}
                <div className="flex justify-center gap-1.5">
                  {(["front", "left", "right"] as const).map((step) => (
                    <div
                      key={step}
                      className={`h-1.5 w-1.5 rounded-full transition-all ${
                        guideStep === step ? "w-4 bg-clinical" : "bg-stone-400"
                      }`}
                    />
                  ))}
                </div>

                {/* Stepper control buttons */}
                <div className="flex justify-center gap-3 w-full max-w-[200px]">
                  {guideStep !== "front" && (
                    <button
                      onClick={() =>
                        setGuideStep(guideStep === "right" ? "left" : "front")
                      }
                      className="flex-1 rounded-full bg-stone-900/70 border border-stone-700 py-1.5 text-xs font-semibold text-white hover:bg-stone-900 transition"
                    >
                      Back
                    </button>
                  )}
                  {guideStep !== "right" ? (
                    <button
                      onClick={() =>
                        setGuideStep(guideStep === "front" ? "left" : "right")
                      }
                      className="flex-1 rounded-full bg-clinical py-1.5 text-xs font-bold text-white hover:bg-clinical/90 transition shadow"
                    >
                      Next
                    </button>
                  ) : (
                    <button
                      onClick={snap}
                      className="flex-1 rounded-full bg-emerald-600 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 transition shadow animate-bounce"
                    >
                      Capture Scan
                    </button>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      <canvas ref={canvasRef} className="hidden" />

      {/* Manual Snap fallback button for closeup or default modes */}
      {(mode !== "face" || status !== "live") && (
        <button
          onClick={snap}
          disabled={status !== "live"}
          className="rounded-lg bg-clinical px-6 py-3 text-sm font-semibold text-white disabled:opacity-40 shadow transition hover:bg-clinical/95"
        >
          Capture
        </button>
      )}
    </div>
  );
}
