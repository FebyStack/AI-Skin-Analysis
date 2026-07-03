import { useCallback, useEffect, useRef, useState } from "react";
import type { CaptureMode } from "../types";

export function cameraConstraints(mode: CaptureMode): MediaStreamConstraints {
  return {
    video: {
      facingMode: mode === "face" ? "user" : "environment",
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
    audio: false,
  };
}

export function isSecureContextForCamera(protocol: string, hostname: string): boolean {
  if (protocol === "https:") return true;
  return hostname === "localhost" || hostname === "127.0.0.1";
}

export type CameraStatus = "idle" | "starting" | "live" | "denied" | "no-camera";

export function useCamera(mode: CaptureMode) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<CameraStatus>("idle");

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const start = useCallback(async () => {
    if (!isSecureContextForCamera(location.protocol, location.hostname)) {
      setStatus("no-camera");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("no-camera");
      return;
    }
    setStatus("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia(cameraConstraints(mode));
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setStatus("live");
    } catch (err) {
      const name = (err as DOMException)?.name;
      setStatus(name === "NotAllowedError" ? "denied" : "no-camera");
    }
  }, [mode]);

  useEffect(() => stop, [stop]);

  return { videoRef, status, start, stop };
}
