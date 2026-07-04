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

export const DIMENSION_KEYS = [
  "hydration-appearance",
  "oiliness",
  "pigmentation",
  "spots",
  "pores",
  "blackheads",
  "wrinkles-texture",
  "acne",
  "inflammation",
  "redness",
  "sensitivity",
  "elasticity-appearance",
] as const;
export type DimensionKey = (typeof DIMENSION_KEYS)[number];

// Dimensions that are visual inferences of hardware-style measurements —
// UI and PDF must label them "visual proxy".
export const PROXY_DIMENSIONS: readonly DimensionKey[] = [
  "hydration-appearance",
  "redness",
  "elasticity-appearance",
];

export const SEBUM_TYPES = ["normal", "oily", "dry", "combination"] as const;
export type SebumType = (typeof SEBUM_TYPES)[number];

export interface WireFinding {
  id: string;
  label: string;
  source: "llm";
  confidence: number;
  severity: "info" | "mild" | "moderate" | "attention";
  region?: FaceZone;
  note?: string;
}

export interface DimensionReport {
  score: number; // 0..1, higher = more pronounced
  note: string;
}

export interface SkinTypeInfo {
  sebum: SebumType;
  sensitivityCues: boolean;
  fitzpatrickApprox: 1 | 2 | 3 | 4 | 5 | 6;
  approximate: true;
}

export interface ZoneObservation {
  zone: FaceZone;
  observation: string;
}

export interface AnalysisReport {
  summary: string;
  findings: WireFinding[];
  dimensions: Record<DimensionKey, DimensionReport>;
  skinType: SkinTypeInfo;
  zoneObservations: ZoneObservation[];
  disclaimer: string;
  promptVersion: number;
}

export type ValidationResult =
  | { ok: true; report: AnalysisReport }
  | { ok: false; errors: string[] };

const SEVERITIES = ["info", "mild", "moderate", "attention"] as const;

function isWireFinding(x: unknown, errors: string[], i: number): x is WireFinding {
  if (typeof x !== "object" || x === null) {
    errors.push(`findings[${i}]: not an object`);
    return false;
  }
  const f = x as Record<string, unknown>;
  const ok =
    typeof f.id === "string" &&
    typeof f.label === "string" &&
    f.source === "llm" &&
    typeof f.confidence === "number" &&
    f.confidence >= 0 &&
    f.confidence <= 1 &&
    SEVERITIES.includes(f.severity as (typeof SEVERITIES)[number]) &&
    (f.note === undefined || typeof f.note === "string") &&
    (f.region === undefined || (FACE_ZONES as readonly string[]).includes(f.region as string));
  if (!ok) errors.push(`findings[${i}]: malformed`);
  return ok;
}

export function validateAnalysisReport(x: unknown): ValidationResult {
  const errors: string[] = [];
  if (typeof x !== "object" || x === null) return { ok: false, errors: ["not an object"] };
  const r = x as Record<string, unknown>;

  if (typeof r.summary !== "string" || r.summary.length === 0) errors.push("summary missing");
  if (typeof r.disclaimer !== "string" || r.disclaimer.length === 0)
    errors.push("disclaimer missing");
  if (typeof r.promptVersion !== "number") errors.push("promptVersion missing");

  if (!Array.isArray(r.findings)) errors.push("findings not an array");
  else r.findings.forEach((f, i) => isWireFinding(f, errors, i));

  if (typeof r.dimensions !== "object" || r.dimensions === null) {
    errors.push("dimensions missing");
  } else {
    const dims = r.dimensions as Record<string, unknown>;
    for (const key of DIMENSION_KEYS) {
      const d = dims[key] as Record<string, unknown> | undefined;
      if (
        d === undefined ||
        typeof d.score !== "number" ||
        d.score < 0 ||
        d.score > 1 ||
        Number.isNaN(d.score) ||
        typeof d.note !== "string"
      ) {
        errors.push(`dimension ${key} missing or malformed`);
      }
    }
  }

  const st = r.skinType as Record<string, unknown> | undefined;
  if (
    st === undefined ||
    !SEBUM_TYPES.includes(st.sebum as SebumType) ||
    typeof st.sensitivityCues !== "boolean" ||
    typeof st.fitzpatrickApprox !== "number" ||
    st.fitzpatrickApprox < 1 ||
    st.fitzpatrickApprox > 6 ||
    st.approximate !== true
  ) {
    errors.push("skinType missing or malformed");
  }

  if (!Array.isArray(r.zoneObservations)) {
    errors.push("zoneObservations not an array");
  } else {
    r.zoneObservations.forEach((z, i) => {
      const zo = z as Record<string, unknown>;
      if (
        typeof zo !== "object" ||
        zo === null ||
        !(FACE_ZONES as readonly string[]).includes(zo.zone as string) ||
        typeof zo.observation !== "string"
      ) {
        errors.push(`zoneObservations[${i}] malformed`);
      }
    });
  }

  return errors.length === 0
    ? { ok: true, report: x as AnalysisReport }
    : { ok: false, errors };
}
