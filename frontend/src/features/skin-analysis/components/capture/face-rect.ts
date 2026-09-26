import type { FaceGeometry, Pixels } from "@ai/face/types";
import type { FaceAngle } from "@shared/face";
import type { DetectorInput } from "@ai/face/analyzers/acne-detector";

export interface Rect { x: number; y: number; w: number; h: number }

// Face bbox (pixel coords, 15% margin) from normalized MediaPipe landmarks.
export function faceRect(g: FaceGeometry, w: number, h: number): Rect {
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

const DETECTOR_SIZE = 640;

/**
 * The face region of a captured frame, scaled so its longer side is 640, for the acne
 * detector. No face geometry → null: never guess lesions on a whole frame.
 */
export async function cropForDetector(
  blob: Blob,
  geometry: FaceGeometry | null,
  angle: FaceAngle,
): Promise<DetectorInput | null> {
  if (!geometry) return null;
  let bmp: ImageBitmap | null = null;
  let canvas: HTMLCanvasElement | null = null;
  try {
    bmp = await createImageBitmap(blob);
    const rect = faceRect(geometry, bmp.width, bmp.height);
    if (rect.w < 32 || rect.h < 32) return null;
    const scale = DETECTOR_SIZE / Math.max(rect.w, rect.h);
    canvas = document.createElement("canvas");
    canvas.width = Math.round(rect.w * scale);
    canvas.height = Math.round(rect.h * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bmp, rect.x, rect.y, rect.w, rect.h, 0, 0, canvas.width, canvas.height);
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const crop: Pixels = { data, width, height };
    return { angle, crop, rect, frame: { w: bmp.width, h: bmp.height } };
  } catch {
    return null;
  } finally {
    bmp?.close();
    // iOS reaches its canvas memory ceiling sooner at 1080p — release promptly
    // rather than waiting on GC.
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}
