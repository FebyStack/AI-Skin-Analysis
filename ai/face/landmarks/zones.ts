// ai/face/landmarks/zones.ts
// Zone polygons from MediaPipe face-landmarker indices. Index sets are v1-coarse and
// TUNABLE — tests assert structure (≥3 points, in-bounds, nontrivial masks), not anatomy.
import type { FaceAngle, FaceAnalysisZone } from "../../../shared/face";
import type { FaceGeometry } from "../types";

// Canonical MediaPipe FaceMesh indices (coarse convex outlines per zone).
const ZONE_INDICES: Record<FaceAnalysisZone, number[]> = {
  forehead: [10, 338, 297, 332, 284, 251, 21, 54, 103, 67, 109],
  nose: [6, 197, 195, 5, 4, 1, 19, 94, 2, 98, 327],
  "left-cheek": [116, 123, 147, 213, 192, 214, 212, 202, 210, 169, 150],
  "right-cheek": [345, 352, 376, 433, 416, 434, 432, 422, 430, 394, 379],
  chin: [148, 152, 377, 400, 378, 379, 365, 397, 288, 361, 323],
  periorbital: [70, 63, 105, 66, 107, 336, 296, 334, 293, 300],
  "under-eye": [111, 117, 118, 119, 120, 121, 350, 349, 348, 347, 346, 340],
};

const VISIBILITY: Record<FaceAngle, FaceAnalysisZone[]> = {
  front: ["forehead", "nose", "left-cheek", "right-cheek", "chin", "periorbital", "under-eye"],
  "left-45": ["forehead", "nose", "left-cheek", "chin", "periorbital", "under-eye"],
  "right-45": ["forehead", "nose", "right-cheek", "chin", "periorbital", "under-eye"],
  "left-profile": ["left-cheek", "chin"],
  "right-profile": ["right-cheek", "chin"],
};

export function zonesVisibleFrom(angle: FaceAngle): FaceAnalysisZone[] {
  return VISIBILITY[angle];
}

export function zonePolygon(zone: FaceAnalysisZone, g: FaceGeometry): { x: number; y: number }[] {
  const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
  return ZONE_INDICES[zone].map((i) => ({ x: clamp01(g.landmarks[i].x), y: clamp01(g.landmarks[i].y) }));
}

/** Rasterize a zone polygon → Uint8Array mask (1 = inside), even-odd point-in-polygon. */
export function maskForZone(zone: FaceAnalysisZone, g: FaceGeometry, width: number, height: number): Uint8Array {
  const poly = zonePolygon(zone, g).map((p) => ({ x: p.x * width, y: p.y * height }));
  const mask = new Uint8Array(width * height);
  const xs = poly.map((p) => p.x), ys = poly.map((p) => p.y);
  const minX = Math.max(0, Math.floor(Math.min(...xs))), maxX = Math.min(width - 1, Math.ceil(Math.max(...xs)));
  const minY = Math.max(0, Math.floor(Math.min(...ys))), maxY = Math.min(height - 1, Math.ceil(Math.max(...ys)));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const yi = poly[i].y, yj = poly[j].y, xi = poly[i].x, xj = poly[j].x;
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) mask[y * width + x] = 1;
    }
  }
  return mask;
}
