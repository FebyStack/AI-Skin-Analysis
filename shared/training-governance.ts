// shared/training-governance.ts
// Consent, retrain eligibility, dataset versions and model releases — the rules
// that decide which samples may ever become training data, and which model is
// allowed to serve. Shared so the UI, the API and the export agree exactly.

// ---------- Consent ----------

export interface ScanConsent {
  /** Required to run a scan at all. */
  analysis: boolean;
  /** Optional and independent — the ONLY gate into the Training Queue. */
  training: boolean;
}

export const DEFAULT_CONSENT: ScanConsent = { analysis: false, training: false };

// ---------- Retrain eligibility ----------

export const ELIGIBILITY = [
  "ready",
  "missing_labels",
  "consent_not_given",
  "low_quality",
  "needs_expert",
  "rejected",
] as const;
export type Eligibility = (typeof ELIGIBILITY)[number];

export const ELIGIBILITY_LABEL: Record<Eligibility, string> = {
  ready: "Ready for Training",
  missing_labels: "Missing Labels",
  consent_not_given: "Consent Not Given",
  low_quality: "Low Image Quality",
  needs_expert: "Needs Expert Review",
  rejected: "Rejected",
};

export interface EligibilityInput {
  status: string;             // queue status
  consentTraining: boolean;
  labeledCount: number;
  requiredLabels: number;
  /** Lowest per-angle quality score, or null when the capture predates metrics. */
  minQualityScore: number | null;
  qualityThreshold: number;
  skipTraining?: boolean;
}

/**
 * Exactly one status per sample, most-blocking first: a rejected sample is
 * rejected regardless of its labels, and a sample without training consent can
 * never be "ready" no matter how good it is.
 */
export function eligibilityOf(i: EligibilityInput): Eligibility {
  if (i.status === "rejected") return "rejected";
  if (!i.consentTraining) return "consent_not_given";
  if (i.status === "needs_expert") return "needs_expert";
  if (i.minQualityScore !== null && i.minQualityScore < i.qualityThreshold) return "low_quality";
  if (i.labeledCount < i.requiredLabels) return "missing_labels";
  // Approved + fully labeled + consented + good quality, and not deliberately held back.
  if (i.status === "approved" && !i.skipTraining) return "ready";
  return "missing_labels";
}

// ---------- Dataset versions ----------

export interface DatasetVersion {
  id: string;
  version: string;
  createdAt: number;
  imageCount: number;
  note: string | null;
  isCurrent: boolean;
}

// ---------- Model releases ----------

export type Deployment = "candidate" | "production" | "archived";

export interface ModelRelease {
  id: string;
  version: string;
  trainedAt: number;
  datasetVersion: string | null;
  macroF1: number | null;
  acneF1: number | null;
  skintypeF1: number | null;
  sizeBytes: number | null;
  deployment: Deployment;
}

/**
 * A candidate may only be promoted when it actually beats production. Never
 * replace a better model automatically — deployment stays a human click, and
 * this is the check behind it.
 */
export function candidateBeatsProduction(
  candidate: Pick<ModelRelease, "macroF1">,
  production: Pick<ModelRelease, "macroF1"> | null,
): boolean {
  if (!production || production.macroF1 == null) return true; // nothing to lose to
  return (candidate.macroF1 ?? 0) > production.macroF1;
}

// ---------- Retrain threshold ----------

export const DEFAULT_TRAIN_THRESHOLD = 50;

export interface TrainingReadiness {
  approvedSinceLastTraining: number;
  threshold: number;
  /** Threshold reached — training may START, but only when a human asks. */
  ready: boolean;
}
