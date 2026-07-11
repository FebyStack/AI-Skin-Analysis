// ai/face/testing/fixtures.ts
// Synthetic pixels + geometry so the whole core is testable without MediaPipe or a camera.
import type { FaceAngle } from "../../../shared/face";
import type { FaceGeometry, Pixels } from "../types";

export function makePixels(width: number, height: number, c: { r: number; g: number; b: number }): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = c.r; data[i + 1] = c.g; data[i + 2] = c.b; data[i + 3] = 255;
  }
  return { data, width, height };
}

export function paintRect(px: Pixels, rect: { x: number; y: number; w: number; h: number }, c: { r: number; g: number; b: number }): void {
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const i = (y * px.width + x) * 4;
      px.data[i] = c.r; px.data[i + 1] = c.g; px.data[i + 2] = c.b;
    }
  }
}

export function addNoise(px: Pixels, amplitude: number, seed = 42): void {
  let s = seed;
  const rand = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < px.data.length; i += 4) {
    const n = Math.round((rand() - 0.5) * 2 * amplitude);
    px.data[i] = Math.max(0, Math.min(255, px.data[i] + n));
    px.data[i + 1] = Math.max(0, Math.min(255, px.data[i + 1] + n));
    px.data[i + 2] = Math.max(0, Math.min(255, px.data[i + 2] + n));
  }
}

const ANGLE_YAW: Record<FaceAngle, number> = {
  front: 0, "left-45": -45, "right-45": 45, "left-profile": -80, "right-profile": 80,
};

/** 478 landmarks laid out as an ellipse-ish grid centered in the image; enough geometry
 * for zone polygons and pose tests. NOT anatomically exact — tests assert structure, not beauty. */
export function syntheticGeometry(angle: FaceAngle, cx = 0.5, cy = 0.5, scale = 0.35): FaceGeometry {
  const landmarks = Array.from({ length: 478 }, (_, i) => {
    const t = (i / 478) * Math.PI * 2;
    const ring = 0.3 + 0.7 * ((i % 10) / 10);
    return { x: cx + Math.cos(t) * scale * ring, y: cy + Math.sin(t) * scale * ring * 1.3, z: 0 };
  });
  return { landmarks, yawDeg: ANGLE_YAW[angle], pitchDeg: 0, rollDeg: 0 };
}
