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
