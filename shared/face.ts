// shared/face.ts
// Wire contract for whole-face analysis (v3 spec). Frontend renders ONLY these shapes.

export const FACE_ANGLES = ["front", "left-45", "right-45", "left-profile", "right-profile"] as const;
export type FaceAngle = (typeof FACE_ANGLES)[number];
export const OPTIONAL_ANGLES = ["forehead", "chin"] as const;

export const FACE_DIMENSIONS = [
  "acne", "pigmentation", "redness", "texture", "pores", "oiliness",
  "dryness", "fine-lines", "wrinkles", "under-eye", "tone-consistency",
] as const;
export type FaceDimension = (typeof FACE_DIMENSIONS)[number];

export const FACE_ANALYSIS_ZONES = [
  "forehead", "nose", "left-cheek", "right-cheek", "chin", "periorbital", "under-eye",
] as const;
export type FaceAnalysisZone = (typeof FACE_ANALYSIS_ZONES)[number];

export interface DimensionScore {
  score: number;        // 0..1, higher = more pronounced
  /**
   * Meaning depends on `source`, which is exactly why `source` exists:
   *  - "model": the trained head's class probability. A real certainty.
   *  - "heuristic": ZONE COVERAGE — the fraction of zones that were visible.
   *    It says nothing about whether the value is right, so it must never be
   *    shown to a clinician as a confidence percentage.
   */
  confidence: number;   // 0..1
  perZone: { zone: FaceAnalysisZone; score: number }[];
  evidence: string;     // camera-honest: names the pixel metric used
  /** Absent on reports saved before this field existed → treat as heuristic. */
  source?: "model" | "heuristic";
}

/**
 * Dimensions a trained model actually covers. Everything else in
 * FACE_DIMENSIONS is an uncalibrated pixel heuristic, and the UI has to say so.
 */
export const MODELLED_DIMENSIONS = ["acne"] as const;

export function isModelled(d: FaceDimension, score?: DimensionScore): boolean {
  return score?.source === "model" || (MODELLED_DIMENSIONS as readonly string[]).includes(d);
}

// Skin type is categorical (no severity order) → a separate report field, not a
// 0..1 FaceDimension. Optional: absent when no trained skintype model is present.
export const SKIN_TYPES = ["normal", "oily", "dry", "combination"] as const;
export type SkinType = (typeof SKIN_TYPES)[number];
export interface SkinTypeResult {
  type: SkinType;
  confidence: number;   // 0..1, top-class probability
  evidence: string;     // names the model/version behind it
}

/** Raw capture measurements, carried so quality can be scored after the fact. */
export interface QualityMetrics {
  minEdge: number;        // shortest image side, px
  luma: number;           // mean frame luminance 0..1
  sharpness: number;      // high-frequency energy (blur proxy)
  faceFraction: number;   // face bbox height / image height
  centerOffset: number;   // 0 centred .. ~1 at a corner
}

export interface AngleQuality { ok: boolean; issues: string[]; metrics?: QualityMetrics }

/**
 * Which device and camera took a photo, so model accuracy can be checked per device
 * as clinic hardware and lighting change. Deliberately coarse: iOS never exposes the
 * exact model to a web page, so `device` is a staff-assigned name (may be "").
 */
export interface CaptureInfo {
  device: string;   // e.g. "Clinic iPad 1" — localStorage "clinic-device-name"
  platform: string; // e.g. "iPhone iOS 17.5", from the user agent
  camera: string;   // track label or facing mode, e.g. "Front Camera"
  width: number;    // actual capture resolution
  height: number;
}

export const MARK_KINDS = ["acne", "dark-spot", "redness", "shine", "under-eye", "wrinkle", "eye-bag"] as const;
export type MarkKind = (typeof MARK_KINDS)[number];
export const MAX_MARKS = 500;

/** Position in the captured image of `angle`, normalised to 0..1 (resolution-independent). */
export type MarkShape =
  | { type: "box"; x: number; y: number; w: number; h: number }
  | { type: "area"; polygon: [number, number][] };

/** Where one finding is. Counts are per angle — one lesion shows in several photos. */
export interface FindingMark {
  kind: MarkKind;
  angle: FaceAngle;
  shape: MarkShape;
  confidence: number;                 // 0..1; 1 for measurements
  source: "model" | "measurement";
}

/** A staff-tapped ground-truth point, normalised to the stored image. */
export interface ManualPoint { kind: MarkKind; x: number; y: number }

export interface FaceExplanation {
  patientSummary: string;
  education: string;
  source: "gemini" | "builtin";
  promptVersion: number;
}

export function validateFaceExplanation(
  x: unknown,
): { ok: true; explanation: FaceExplanation } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (typeof x !== "object" || x === null) return { ok: false, errors: ["not an object"] };
  const e = x as Record<string, unknown>;
  if (typeof e.patientSummary !== "string" || e.patientSummary.length === 0) errors.push("patientSummary missing");
  if (typeof e.education !== "string" || e.education.length === 0) errors.push("education missing");
  if (e.source !== "gemini" && e.source !== "builtin") errors.push("source malformed");
  if (typeof e.promptVersion !== "number") errors.push("promptVersion missing");
  return errors.length === 0 ? { ok: true, explanation: x as FaceExplanation } : { ok: false, errors };
}

export interface FaceReport {
  kind: "face-v2";
  overall: { score: number; confidence: number };
  dimensions: Record<FaceDimension, DimensionScore>;
  skinType?: SkinTypeResult | null;   // filled by the trained skintype model when present
  capture: { angles: { angle: string; quality: AngleQuality }[] };
  recommendations: { skincare: string[]; treatments: string[] };
  explanation: FaceExplanation | null;   // filled in Phase C
  disclaimer: string;
  pipelineVersion: number;
  modelVersions: Record<string, string>;
  /** Where findings are, per captured angle. Present (maybe empty) only when a locator ran. */
  marks?: FindingMark[];
}

const in01 = (n: unknown): n is number => typeof n === "number" && n >= 0 && n <= 1 && !Number.isNaN(n);

function validBox(s: Record<string, unknown>): boolean {
  const { x, y, w, h } = s;
  return in01(x) && in01(y) && in01(w) && in01(h) && w > 0 && h > 0 && x + w <= 1 + 1e-6 && y + h <= 1 + 1e-6;
}

function validPolygon(p: unknown): boolean {
  return Array.isArray(p) && p.length >= 3
    && p.every((pt) => Array.isArray(pt) && pt.length === 2 && in01(pt[0]) && in01(pt[1]));
}

export function markErrors(marks: unknown): string[] {
  if (!Array.isArray(marks)) return ["marks must be an array"];
  if (marks.length > MAX_MARKS) return [`at most ${MAX_MARKS} marks`];
  const errors: string[] = [];
  marks.forEach((m, i) => {
    const r = (m ?? {}) as Record<string, unknown>;
    const s = (r.shape ?? {}) as Record<string, unknown>;
    const shapeOk = s.type === "box" ? validBox(s) : s.type === "area" ? validPolygon(s.polygon) : false;
    if (!MARK_KINDS.includes(r.kind as MarkKind) || !FACE_ANGLES.includes(r.angle as FaceAngle)
      || !shapeOk || !in01(r.confidence) || (r.source !== "model" && r.source !== "measurement")) {
      errors.push(`mark ${i} malformed`);
    }
  });
  return errors;
}

export function parseManualPoints(raw: unknown): ManualPoint[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_MARKS) return null;
  const out: ManualPoint[] = [];
  for (const p of raw) {
    const r = (p ?? {}) as Record<string, unknown>;
    if (!MARK_KINDS.includes(r.kind as MarkKind) || !in01(r.x) || !in01(r.y)) return null;
    out.push({ kind: r.kind as MarkKind, x: r.x, y: r.y });
  }
  return out;
}

export function validateFaceReport(x: unknown): { ok: true; report: FaceReport } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (typeof x !== "object" || x === null) return { ok: false, errors: ["not an object"] };
  const r = x as Record<string, unknown>;
  if (r.kind !== "face-v2") errors.push("kind must be face-v2");
  const overall = r.overall as Record<string, unknown> | undefined;
  if (!in01(overall?.score) || !in01(overall?.confidence)) errors.push("overall malformed");
  const dims = r.dimensions as Record<string, unknown> | undefined;
  if (!dims) errors.push("dimensions missing");
  else {
    for (const key of FACE_DIMENSIONS) {
      const d = dims[key] as Record<string, unknown> | undefined;
      if (!d || !in01(d.score) || !in01(d.confidence) || !Array.isArray(d.perZone) || typeof d.evidence !== "string")
        errors.push(`dimension ${key} missing or malformed`);
    }
  }
  const cap = r.capture as Record<string, unknown> | undefined;
  if (!Array.isArray(cap?.angles)) errors.push("capture.angles missing");
  const rec = r.recommendations as Record<string, unknown> | undefined;
  if (!Array.isArray(rec?.skincare) || !Array.isArray(rec?.treatments)) errors.push("recommendations malformed");
  if (typeof r.disclaimer !== "string" || r.disclaimer.length === 0) errors.push("disclaimer missing");
  if (typeof r.pipelineVersion !== "number") errors.push("pipelineVersion missing");
  if (typeof r.modelVersions !== "object" || r.modelVersions === null) errors.push("modelVersions missing");
  if (r.skinType != null) {
    const st = r.skinType as Record<string, unknown>;
    if (!SKIN_TYPES.includes(st.type as SkinType) || !in01(st.confidence)) errors.push("skinType malformed");
  }
  if (r.marks !== undefined) errors.push(...markErrors(r.marks));
  return errors.length === 0 ? { ok: true, report: x as FaceReport } : { ok: false, errors };
}
