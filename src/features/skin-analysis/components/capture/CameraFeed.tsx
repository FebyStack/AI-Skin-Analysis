import { useEffect, useRef } from "react";
import { useCamera } from "../../hooks/use-camera";
import { stripMetadata, canvasCodec, toCaptureResult } from "../../privacy/redact";
import type { CaptureMode, CaptureResult } from "../../types";

export function CameraFeed({
  mode,
  onCapture,
  onUnavailable,
}: {
  mode: CaptureMode;
  onCapture: (r: CaptureResult) => void;
  onUnavailable: (reason: "denied" | "no-camera") => void;
}) {
  const { videoRef, status, start } = useCamera(mode);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    start();
  }, [start]);

  useEffect(() => {
    if (status === "denied") onUnavailable("denied");
    if (status === "no-camera") onUnavailable("no-camera");
  }, [status, onUnavailable]);

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
    <div className="flex flex-col items-center gap-3">
      <video
        ref={videoRef}
        playsInline
        muted
        className="aspect-[3/4] w-full max-w-sm rounded-2xl bg-black object-cover sm:aspect-video"
      />
      <canvas ref={canvasRef} className="hidden" />
      <button
        onClick={snap}
        disabled={status !== "live"}
        className="rounded-lg bg-clinical px-6 py-3 text-sm font-semibold text-white disabled:opacity-40"
      >
        Capture
      </button>
    </div>
  );
}
