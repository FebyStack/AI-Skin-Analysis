import type { AnalysisReport } from "../../shared/contract";

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8MB decoded
const ALLOWED_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

export interface AnalyzeInput {
  image: string; // base64, no data: prefix
  mime: string;
  mode: "face" | "closeup";
}

export type InputCheck = { ok: true } | { ok: false; error: string };

export function validateInput(x: AnalyzeInput): InputCheck {
  if (!ALLOWED_MIMES.includes(x.mime as (typeof ALLOWED_MIMES)[number])) {
    return { ok: false, error: `mime type not allowed: ${x.mime}` };
  }
  if (x.mode !== "face" && x.mode !== "closeup") {
    return { ok: false, error: "invalid mode" };
  }
  if (typeof x.image !== "string" || x.image.length === 0 || !BASE64_RE.test(x.image)) {
    return { ok: false, error: "image is not valid base64" };
  }
  const decodedBytes = Math.floor((x.image.length * 3) / 4);
  if (decodedBytes > MAX_IMAGE_BYTES) {
    return { ok: false, error: "image exceeds size cap" };
  }
  return { ok: true };
}

// Phrases that must never appear in analysis text (disclaimer is exempt from
// the diagnosis-word check — it legitimately contains "diagnosis").
const FORBIDDEN = [
  /\byou have\b/i,
  /\bdiagnos(is|ed|e)\b/i,
  /\bprescri(be|ption|bed)\b/i,
  /\btake (this|these|the) (medication|medicine|drug)/i,
  /\bbenign\b/i,
  /\bmalignan(t|cy)\b/i,
  /\bcancer(ous)?\b/i,
];

const REFERRAL_RE = /(professional|dermatologist)/i;
const NON_DIAGNOSIS_RE = /not a diagnosis/i;

export type OutputCheck = { ok: true } | { ok: false; violations: string[] };

export function checkOutputGuardrails(report: AnalysisReport): OutputCheck {
  const violations: string[] = [];

  const texts: string[] = [
    report.summary,
    ...report.findings.map((f) => f.note ?? ""),
    ...Object.values(report.dimensions).map((d) => d.note),
    ...report.zoneObservations.map((z) => z.observation),
  ];
  for (const text of texts) {
    for (const re of FORBIDDEN) {
      if (re.test(text)) {
        violations.push(`diagnosis language: ${re} matched "${text.slice(0, 60)}"`);
      }
    }
  }

  if (!NON_DIAGNOSIS_RE.test(report.disclaimer)) {
    violations.push("disclaimer must state this is not a diagnosis");
  }

  const hasAttention = report.findings.some((f) => f.severity === "attention");
  if (hasAttention && !REFERRAL_RE.test(report.summary)) {
    violations.push("attention-level finding requires professional referral in summary");
  }

  return violations.length === 0 ? { ok: true } : { ok: false, violations };
}
