// shared/training-queue.ts
// Wire contract for the Training Queue — the human-review layer over completed
// scans. Frontend and backend both import this, so the annotation vocabulary
// can't drift between the UI, the API validator, and the training export.

export const QUEUE_STATUSES = ["pending", "approved", "rejected", "needs_expert"] as const;
export type QueueStatus = (typeof QUEUE_STATUSES)[number];

export const QUEUE_STATUS_LABEL: Record<QueueStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  needs_expert: "Needs Expert Review",
};

/** 4-level severity for the continuous dimensions (maps to 0 / .33 / .67 / 1). */
export const SEVERITY_LEVELS = ["none", "mild", "moderate", "severe"] as const;
export const ACNE_LEVELS = ["clear", "mild", "moderate", "severe", "very-severe"] as const;
export const SKIN_TYPE_LEVELS = ["normal", "oily", "dry", "combination"] as const;

export interface AnnotationField {
  /** Matches a FaceDimension, or "skintype" for the categorical skin-type field. */
  key: string;
  label: string;
  options: readonly string[];
}

/** The editable fields of the annotation panel, in display order. */
export const ANNOTATION_FIELDS: AnnotationField[] = [
  { key: "skintype", label: "Skin Type", options: SKIN_TYPE_LEVELS },
  { key: "acne", label: "Acne Severity", options: ACNE_LEVELS },
  { key: "redness", label: "Redness", options: SEVERITY_LEVELS },
  { key: "pigmentation", label: "Pigmentation", options: SEVERITY_LEVELS },
  { key: "oiliness", label: "Oiliness", options: SEVERITY_LEVELS },
  { key: "texture", label: "Texture", options: SEVERITY_LEVELS },
  { key: "pores", label: "Pores", options: SEVERITY_LEVELS },
  { key: "fine-lines", label: "Fine Lines", options: SEVERITY_LEVELS },
  { key: "wrinkles", label: "Wrinkles", options: SEVERITY_LEVELS },
  // These three are in FACE_DIMENSIONS and shown to patients, but were not
  // gradeable — so no ground truth could ever accumulate for them. Labels are
  // phrased so "severe" is unambiguous: every dimension scores 0..1 as
  // "more pronounced", i.e. more shadowing / more unevenness / more dryness.
  { key: "dryness", label: "Dryness", options: SEVERITY_LEVELS },
  { key: "under-eye", label: "Under-Eye Shadowing", options: SEVERITY_LEVELS },
  { key: "tone-consistency", label: "Tone Unevenness", options: SEVERITY_LEVELS },
];

/** Continuous 0..1 dimension score → the nearest severity level (AI suggestion). */
export function scoreToSeverity(score: number): string {
  const i = Math.min(SEVERITY_LEVELS.length - 1, Math.max(0, Math.round(score * 3)));
  return SEVERITY_LEVELS[i];
}

/** Ordinal acne score (0..1 over 5 classes) → the nearest acne level. */
export function scoreToAcneLevel(score: number): string {
  const i = Math.min(ACNE_LEVELS.length - 1, Math.max(0, Math.round(score * 4)));
  return ACNE_LEVELS[i];
}

// --- Confidence banding (shared so the UI and any report use one rule) ---
export type ConfidenceBand = "high" | "medium" | "low";

/** ≥90% high (green), 70–89% medium (yellow), <70% low (red + warning). */
export function confidenceBand(confidence: number): ConfidenceBand {
  if (confidence >= 0.9) return "high";
  if (confidence >= 0.7) return "medium";
  return "low";
}

/** At/above this the new scan is treated as a near-duplicate of an earlier one. */
export const DUPLICATE_THRESHOLD = 0.95;

export interface QueueEntry {
  scanId: string;
  patientId: string;
  patientName: string | null;
  createdAt: number;
  status: QueueStatus;
  reviewedBy: string | null;
  reviewedAt: number | null;
  updatedAt: number | null;
  note: string | null;
  /** Approved but deliberately withheld from training (e.g. a near-duplicate). */
  skipTraining: boolean;
  /** Set when an earlier scan of the same patient looks near-identical. */
  duplicateOf: string | null;
  similarity: number | null;
  /** Set once a training export has consumed this sample. */
  exportedAt: number | null;
  /** Headline AI numbers for the list row. */
  overallScore: number | null;
  overallConfidence: number | null;
  modelVersion: string | null;
  angleCount: number;
  labeledCount: number;
  consentTraining: boolean;
  eligibility: string;
}

export interface QueueStats {
  pending: number;
  approved: number;
  rejected: number;
  needs_expert: number;
  total: number;
}
