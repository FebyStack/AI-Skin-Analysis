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
  confidence: number;   // 0..1
  perZone: { zone: FaceAnalysisZone; score: number }[];
  evidence: string;     // camera-honest: names the pixel metric used
}

export interface AngleQuality { ok: boolean; issues: string[] }

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
  capture: { angles: { angle: string; quality: AngleQuality }[] };
  recommendations: { skincare: string[]; treatments: string[] };
  explanation: FaceExplanation | null;   // filled in Phase C
  disclaimer: string;
  pipelineVersion: number;
  modelVersions: Record<string, string>;
}

const in01 = (n: unknown): n is number => typeof n === "number" && n >= 0 && n <= 1 && !Number.isNaN(n);

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
  return errors.length === 0 ? { ok: true, report: x as FaceReport } : { ok: false, errors };
}
