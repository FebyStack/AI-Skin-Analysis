export type FindingSource = "classifier" | "llm";
export type Severity = "info" | "mild" | "moderate" | "attention";
export type CaptureMode = "face" | "closeup";
export type CaptureSource = "camera" | "upload";

export const FACE_ZONES = [
  "forehead",
  "nose",
  "left-cheek",
  "right-cheek",
  "chin",
  "periorbital",
  "other",
] as const;
export type FaceZone = (typeof FACE_ZONES)[number];

export interface Finding {
  id: string;
  label: string;
  source: FindingSource;
  confidence: number; // 0..1
  severity: Severity;
  note?: string;
  region?: FaceZone;
}

export type Agreement = "agree" | "llm-only" | "classifier-only" | "conflict";

export interface MergedFinding extends Finding {
  agreement: Agreement;
  escalated: boolean;
}

export interface Verdict {
  summary: string;
  findings: MergedFinding[];
  disclaimerShown: true;
  degraded?: "classifier-only" | "llm-only";
}

export interface ScanResult {
  createdAt: number;
  mode: CaptureMode;
  verdict: Verdict;
}

export interface CaptureResult {
  blob: Blob;
  mimeType: string;
  mode: CaptureMode;
  source: CaptureSource;
  width: number;
  height: number;
}

export function isFinding(x: unknown): x is Finding {
  if (typeof x !== "object" || x === null) return false;
  const f = x as Record<string, unknown>;
  return (
    typeof f.id === "string" &&
    typeof f.label === "string" &&
    (f.source === "classifier" || f.source === "llm") &&
    typeof f.confidence === "number" &&
    f.confidence >= 0 &&
    f.confidence <= 1 &&
    (f.severity === "info" ||
      f.severity === "mild" ||
      f.severity === "moderate" ||
      f.severity === "attention") &&
    (f.note === undefined || typeof f.note === "string") &&
    (f.region === undefined || (FACE_ZONES as readonly string[]).includes(f.region as string))
  );
}

export type QualityIssue =
  | "too-dark"
  | "overexposed"
  | "blur"
  | "no-region";

export interface QualityReport {
  ok: boolean;
  issues: QualityIssue[];
  brightness: number; // 0..1 mean luma
  sharpness: number; // 0..1 relative
  regionFound: boolean;
}

export interface ClassifierOutput {
  findings: Finding[];
}
