// Wire contract for the Python lesion service (ai/service/lesion_service.py).
// The backend calls that service over HTTP; the frontend renders this shape.
// Kept structurally identical to LesionPipeline.analyze() output.

export interface LesionClassification {
  predicted: string | null;
  confidence: number;
  top: { label: string; confidence: number }[];
}

export interface LesionDetection {
  bbox: [number, number, number, number] | null; // null = whole-image fallback
  detectorConfidence: number | null;
  classification: LesionClassification;
}

export interface LesionAnalysis {
  lesions: LesionDetection[];
  wholeImageFallback: boolean;
  model: { classifier: string; detector: string };
}

// Malignant / concerning classes in the 6-class PAD-UFES/ISIC scheme.
// MEL melanoma · BCC basal-cell · SCC squamous-cell carcinoma (all malignant).
export const LESION_MALIGNANT = ["MEL", "BCC", "SCC"] as const;

export type ReferralUrgency = "routine" | "soon" | "urgent";

export interface LesionExplanation {
  patientSummary: string;
  education: string;
  referral: { recommended: boolean; urgency: ReferralUrgency; reason: string };
  disclaimer: string;
  source: "gemini" | "builtin";
  promptVersion: number;
}

const URGENCIES: readonly string[] = ["routine", "soon", "urgent"];

export function validateLesionExplanation(
  x: unknown,
): { ok: true; explanation: LesionExplanation } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (typeof x !== "object" || x === null) return { ok: false, errors: ["not an object"] };
  const e = x as Record<string, unknown>;
  if (typeof e.patientSummary !== "string" || e.patientSummary.length === 0) errors.push("patientSummary missing");
  if (typeof e.education !== "string" || e.education.length === 0) errors.push("education missing");
  const ref = e.referral as Record<string, unknown> | undefined;
  if (typeof ref?.recommended !== "boolean" || !URGENCIES.includes(ref?.urgency as string) || typeof ref?.reason !== "string")
    errors.push("referral malformed");
  if (typeof e.disclaimer !== "string" || e.disclaimer.length === 0) errors.push("disclaimer missing");
  if (e.source !== "gemini" && e.source !== "builtin") errors.push("source malformed");
  if (typeof e.promptVersion !== "number") errors.push("promptVersion missing");
  return errors.length === 0 ? { ok: true, explanation: x as LesionExplanation } : { ok: false, errors };
}

// Does the analysis surface a malignant class with meaningful weight anywhere in top-k?
export function hasMalignantSignal(analysis: LesionAnalysis, floor = 0.15): boolean {
  return analysis.lesions.some((l) =>
    l.classification.top.some((t) => (LESION_MALIGNANT as readonly string[]).includes(t.label) && t.confidence >= floor),
  );
}

const in01 = (n: unknown): n is number =>
  typeof n === "number" && n >= 0 && n <= 1 && !Number.isNaN(n);

// Validate the raw JSON from the Python service (snake→camel: whole_image_fallback,
// detector_confidence). Returns a normalized LesionAnalysis or errors.
export function validateLesionAnalysis(
  x: unknown,
): { ok: true; analysis: LesionAnalysis } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (typeof x !== "object" || x === null) return { ok: false, errors: ["not an object"] };
  const r = x as Record<string, unknown>;

  if (!Array.isArray(r.lesions) || r.lesions.length === 0) errors.push("lesions missing");
  const lesions: LesionDetection[] = [];
  if (Array.isArray(r.lesions)) {
    r.lesions.forEach((raw, i) => {
      const l = raw as Record<string, unknown>;
      const c = l.classification as Record<string, unknown> | undefined;
      if (!c) {
        errors.push(`lesions[${i}].classification missing`);
        return;
      }
      const top = c.top as unknown;
      const topOk =
        Array.isArray(top) &&
        top.every((t) => typeof (t as { label?: unknown }).label === "string" && in01((t as { confidence?: unknown }).confidence));
      if (!topOk) errors.push(`lesions[${i}].classification.top malformed`);
      if (c.predicted !== null && typeof c.predicted !== "string") errors.push(`lesions[${i}].predicted malformed`);
      if (!in01(c.confidence)) errors.push(`lesions[${i}].confidence out of range`);
      const bbox = l.bbox;
      const bboxOk = bbox === null || (Array.isArray(bbox) && bbox.length === 4 && bbox.every((n) => typeof n === "number"));
      if (!bboxOk) errors.push(`lesions[${i}].bbox malformed`);
      const detConf = (l.detector_confidence ?? l.detectorConfidence) as unknown;
      lesions.push({
        bbox: (bbox as LesionDetection["bbox"]) ?? null,
        detectorConfidence: typeof detConf === "number" ? detConf : null,
        classification: {
          predicted: (c.predicted as string | null) ?? null,
          confidence: (c.confidence as number) ?? 0,
          top: topOk ? (top as LesionClassification["top"]) : [],
        },
      });
    });
  }

  const model = r.model as Record<string, unknown> | undefined;
  if (typeof model?.classifier !== "string" || typeof model?.detector !== "string") errors.push("model malformed");

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    analysis: {
      lesions,
      wholeImageFallback: Boolean(r.whole_image_fallback ?? r.wholeImageFallback),
      model: { classifier: String(model!.classifier), detector: String(model!.detector) },
    },
  };
}
