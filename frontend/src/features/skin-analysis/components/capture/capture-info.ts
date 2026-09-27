import type { CaptureInfo } from "@shared/face";

/** Set once per clinic device by staff; iOS gives web pages no model name to read. */
export const DEVICE_NAME_KEY = "clinic-device-name";

/** Coarse platform from the user agent. iPadOS reports a Mac UA, told apart by touch. */
export function platformFromUA(ua: string, touchPoints: number): string {
  const ios = ua.match(/(iPhone|iPad|iPod).*? OS (\d+)[_.](\d+)/);
  if (ios) return `${ios[1]} iOS ${ios[2]}.${ios[3]}`;
  if (/Macintosh/.test(ua) && touchPoints > 1) {
    return `iPad iPadOS ${ua.match(/Version\/(\d+\.\d+)/)?.[1] ?? "?"}`;
  }
  const android = ua.match(/Android (\d+(?:\.\d+)?)(?:; ([^;)]+))?/);
  if (android) {
    const model = android[2]?.trim();
    return `Android ${android[1]}${model && model !== "K" ? ` ${model}` : ""}`;
  }
  if (/Windows/.test(ua)) return "Windows";
  if (/Macintosh/.test(ua)) return "Mac";
  return "other";
}

export const DEVICE_NAME_MAX = 60;

export function getDeviceName(): string {
  try {
    return localStorage.getItem(DEVICE_NAME_KEY) ?? "";
  } catch {
    return ""; // private mode / storage blocked — leave unnamed
  }
}

/** Returns false when this browser refuses storage (e.g. private browsing). */
export function setDeviceName(name: string): boolean {
  try {
    const clean = name.trim().slice(0, DEVICE_NAME_MAX);
    if (clean) localStorage.setItem(DEVICE_NAME_KEY, clean);
    else localStorage.removeItem(DEVICE_NAME_KEY);
    return true;
  } catch {
    return false;
  }
}

export function currentPlatform(): string {
  return platformFromUA(navigator.userAgent, navigator.maxTouchPoints ?? 0);
}

export function captureInfo(video: HTMLVideoElement): CaptureInfo {
  const track = (video.srcObject as MediaStream | null)?.getVideoTracks?.()[0];
  return {
    device: getDeviceName(),
    platform: currentPlatform(),
    camera: track?.label || String(track?.getSettings?.().facingMode ?? ""),
    width: video.videoWidth,
    height: video.videoHeight,
  };
}
