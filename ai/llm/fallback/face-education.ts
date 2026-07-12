// Pre-authored offline face-report education. Cosmetic-educational language only —
// no clinical claims, no treatment, no certainty. Same shape as the Gemini explanation.
import { FACE_DIMENSIONS, type FaceDimension, type FaceExplanation, type FaceReport } from "../../../shared/face";

export const BUILTIN_FACE_VERSION = 1;

const OVERALL_LOW = 0.25;
const OVERALL_HIGH = 0.5;

const DIMENSION_EDU: Record<FaceDimension, string> = {
  acne: "Acne varies with hormones, sleep, and skincare consistency; a gentle, non-comedogenic routine and daily sunscreen usually help over weeks.",
  pigmentation: "Uneven pigment often comes from cumulative sun exposure. The single most useful step is broad-spectrum sunscreen every day.",
  redness: "Redness can stem from irritation, temperature, or vascular sensitivity. Fragrance-free products and avoiding very hot water often reduce it.",
  texture: "Surface texture reflects turnover and hydration. Gentle exfoliation and consistent moisturizing can smooth it over time.",
  pores: "Pore appearance is largely genetic; consistent cleansing and oil control help visibility.",
  oiliness: "Sebum production varies through the day. A lightweight, oil-free moisturizer often works better than over-washing.",
  dryness: "Dryness responds well to layering a richer moisturizer on damp skin and, in dry rooms, a humidifier.",
  "fine-lines": "Fine lines are shaped by hydration and cumulative sun exposure. Hydration plus daily sunscreen slows their progression.",
  wrinkles: "Deeper wrinkles reflect long-term skin history. Sun protection and consistent moisturizing matter most day to day.",
  "under-eye": "Under-eye appearance is influenced by sleep, hydration, and thin skin over blood vessels. Rest and hydration help.",
  "tone-consistency": "Uneven tone often traces back to sun exposure. Even, daily sunscreen application improves evenness over time.",
};

const DIMENSION_LABEL: Record<FaceDimension, string> = {
  acne: "acne",
  pigmentation: "pigmentation",
  redness: "redness",
  texture: "surface texture",
  pores: "pore visibility",
  oiliness: "oiliness",
  dryness: "dryness",
  "fine-lines": "fine lines",
  wrinkles: "wrinkles",
  "under-eye": "under-eye darkness",
  "tone-consistency": "tone consistency",
};

function summaryBand(overall: number): string {
  if (overall < OVERALL_LOW) {
    return "Overall your skin looks calm on this analysis — nothing here rises to a strong signal. Small routine tweaks may still be worthwhile.";
  }
  if (overall < OVERALL_HIGH) {
    return "The analysis picked up a moderate signal across a few areas. Focused routine improvements over weeks are usually enough to see change.";
  }
  return "The analysis suggests several areas worth attention. A consistent, gentle routine tuned to those areas — and a professional's input if you want one — is a reasonable next step.";
}

export function builtinFaceExplanation(report: FaceReport): FaceExplanation {
  const top3 = [...FACE_DIMENSIONS]
    .sort((a, b) => report.dimensions[b].score - report.dimensions[a].score)
    .slice(0, 3);

  const patientSummary = `${summaryBand(report.overall.score)} The most prominent areas from this scan were ${top3
    .map((d) => DIMENSION_LABEL[d])
    .join(", ")}.`;

  const education = top3.map((d) => `${DIMENSION_LABEL[d]}: ${DIMENSION_EDU[d]}`).join(" ");

  return {
    patientSummary,
    education,
    source: "builtin",
    promptVersion: BUILTIN_FACE_VERSION,
  };
}
