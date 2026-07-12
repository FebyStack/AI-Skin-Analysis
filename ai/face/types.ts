// ai/face/types.ts
import type { FaceAngle, FaceAnalysisZone, AngleQuality } from "../../shared/face";

export interface Pixels { data: Uint8ClampedArray; width: number; height: number } // RGBA rows
export interface Landmark { x: number; y: number; z: number }  // normalized 0..1 image coords
export interface FaceGeometry {
  landmarks: Landmark[];   // 478 MediaPipe face-landmarker points
  yawDeg: number;          // + = facing right
  pitchDeg: number;
  rollDeg: number;
}
export interface CapturedView {
  angle: FaceAngle;
  pixels: Pixels;
  geometry: FaceGeometry | null;  // null = no face detected
}
export interface ZoneStats {
  zone: FaceAnalysisZone;
  pixelCount: number;
  meanR: number; meanG: number; meanB: number;
  meanLuma: number;      // 0..1
  lumaStd: number;       // 0..1
  rednessIdx: number;    // mean of (r - (g+b)/2)/255, clamped ≥ 0
  highFreqRatio: number; // |luma - 4-neighbour mean| average, 0..1
  darkSpotRatio: number; // share of pixels with luma < meanLuma - 2*lumaStd
  brightSpotRatio: number; // share with luma > meanLuma + 2*lumaStd (specular)
  redSpotRatio: number;  // share with per-pixel redness > rednessIdx + 0.08
}
export interface AnalyzedView {
  angle: FaceAngle;
  quality: AngleQuality;
  zones: Partial<Record<FaceAnalysisZone, ZoneStats>>; // only zones visible from this angle
  /** parsing = SegFormer skin masks; landmarks = polygon fallback */
  maskSource?: "parsing" | "landmarks";
  /** 0..1 — share of visible zones with enough parsed skin pixels */
  maskQuality?: number;
}
