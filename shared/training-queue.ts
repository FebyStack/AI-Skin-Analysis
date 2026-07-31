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
/**
 * Presence, not severity.
 *
 * The 4-level severity scale was never groundable: no public dataset grades
 * these dimensions by degree, "mild vs moderate" is a judgement two clinicians
 * disagree on, and after months of grading the clinic held 43 none / 23 mild /
 * 4 moderate / 0 severe — untrainable. The same labels collapse to 43/27 here,
 * which is a usable split, and "is it visibly present?" is a question a model
 * and a clinician can both answer reproducibly.
 *
 * Degree is still communicated — by the model's probability, which is honest
 * about its own uncertainty in a way a fabricated "moderate" is not.
 */
export const PRESENCE_LEVELS = ["absent", "present"] as const;

/**
 * The retired scale. Kept only to read labels stored before the change —
 * `normalizePresence` maps them forward. Nothing writes these any more.
 */
export const LEGACY_SEVERITY_LEVELS = ["none", "mild", "moderate", "severe"] as const;

/** Old label → new. Anything at all visible counts as present. */
export function normalizePresence(label: string): string {
  const k = label.trim().toLowerCase();
  if (k === "absent" || k === "present") return k;
  if (k === "none" || k === "clear") return "absent";
  if (["mild", "moderate", "severe", "very-severe", "marked"].includes(k)) return "present";
  return k;
}
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
  { key: "redness", label: "Redness", options: PRESENCE_LEVELS },
  { key: "pigmentation", label: "Pigmentation", options: PRESENCE_LEVELS },
  { key: "oiliness", label: "Oiliness", options: PRESENCE_LEVELS },
  { key: "texture", label: "Texture", options: PRESENCE_LEVELS },
  { key: "pores", label: "Pores", options: PRESENCE_LEVELS },
  { key: "fine-lines", label: "Fine Lines", options: PRESENCE_LEVELS },
  { key: "wrinkles", label: "Wrinkles", options: PRESENCE_LEVELS },
  // These three are in FACE_DIMENSIONS and shown to patients, but were not
  // gradeable — so no ground truth could ever accumulate for them. Labels are
  // phrased so "severe" is unambiguous: every dimension scores 0..1 as
  // "more pronounced", i.e. more shadowing / more unevenness / more dryness.
  { key: "dryness", label: "Dryness", options: PRESENCE_LEVELS },
  { key: "under-eye", label: "Under-Eye Shadowing", options: PRESENCE_LEVELS },
  { key: "tone-consistency", label: "Tone Unevenness", options: PRESENCE_LEVELS },
];

/** Continuous 0..1 dimension score → present/absent (the AI suggestion). */
export function scoreToPresence(score: number): string {
  return score >= 0.5 ? "present" : "absent";
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
