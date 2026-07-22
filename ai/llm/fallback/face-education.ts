// Pre-authored offline face-report education. Cosmetic-educational language only —
// no clinical claims, no treatment, no certainty. Same shape as the Gemini
// explanation, so the app reads well with Gemini turned off entirely.
import {
  FACE_DIMENSIONS,
  type FaceDimension,
  type FaceExplanation,
  type FaceReport,
  type SkinType,
} from "../../../shared/face";

export const BUILTIN_FACE_VERSION = 2;

const CALM = 0.25;        // overall below this: skin looks calm
const ATTENTION = 0.5;    // overall at/above this: suggest a professional read
const PROMINENT = 0.4;    // a dimension at/above this counts as a signal
const STRONG = 0.7;       // a single strong dimension also warrants a referral

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

const DIMENSION_EDU: Record<FaceDimension, string> = {
  acne: "Acne shifts with hormones, sleep, and routine. A gentle non-comedogenic routine plus daily sunscreen helps over weeks.",
  pigmentation: "Uneven pigment traces back to sun exposure. Daily broad-spectrum sunscreen is the main lever.",
  redness: "Redness follows irritation, heat, or sensitive skin. Fragrance-free products and cooler water settle it.",
  texture: "Texture reflects turnover and hydration. Gentle exfoliation and steady moisturizing smooth it.",
  pores: "Genetics set pore size. Consistent cleansing and oil control cut how much they show.",
  oiliness: "Sebum rises and falls through the day. A light, oil-free moisturizer beats over-washing.",
  dryness: "Dry skin drinks up a richer cream on damp skin. A humidifier helps dry rooms.",
  "fine-lines": "Fine lines track hydration and sun history. Hydration plus daily sunscreen slows them.",
  wrinkles: "Deeper wrinkles reflect years of sun and movement. Sun protection and moisturizing matter most.",
  "under-eye": "Under-eye shadow follows sleep, hydration, and thin skin. Rest and water help.",
  "tone-consistency": "Uneven tone starts with sun. Even, daily sunscreen builds evenness back.",
};

const SKINTYPE_EDU: Record<SkinType, string> = {
  normal: "Balanced skin stays that way with a simple cleanse, moisturizer, and daily sunscreen.",
  oily: "Oily skin does better with a light, oil-free moisturizer than with extra washing.",
  dry: "Dry skin holds moisture when you layer a richer cream onto damp skin.",
  combination: "Combination skin wants a lighter touch on the T-zone and richer care on the cheeks.",
};

function joinAreas(labels: string[]): string {
  if (labels.length === 1) return `The clearest signal was ${labels[0]}.`;
  return `The clearest signals were ${labels[0]} and ${labels[1]}.`;
}

export function builtinFaceExplanation(report: FaceReport): FaceExplanation {
  const overall = report.overall.score;
  const ranked = [...FACE_DIMENSIONS].sort(
    (a, b) => report.dimensions[b].score - report.dimensions[a].score,
  );
  const signals = ranked.filter((d) => report.dimensions[d].score >= PROMINENT).slice(0, 2);
  const skin = report.skinType?.type ?? null;

  const parts: string[] = [];
  if (overall < CALM && signals.length === 0) {
    parts.push("Your skin looks calm in this scan. No area stands out.");
  } else if (overall < ATTENTION) {
    parts.push("This scan flags a few areas to work on.");
  } else {
    parts.push("This scan flags several areas worth attention.");
  }
  if (signals.length > 0) parts.push(joinAreas(signals.map((d) => DIMENSION_LABEL[d])));
  if (skin) parts.push(`Your skin reads as ${skin}.`);

  const needsReferral =
    overall >= ATTENTION || ranked.some((d) => report.dimensions[d].score >= STRONG);
  if (needsReferral) parts.push("For a professional read, see a dermatologist.");

  const eduLines = signals.map((d) => DIMENSION_EDU[d]);
  if (skin) eduLines.push(SKINTYPE_EDU[skin]);
  if (eduLines.length === 0) eduLines.push(DIMENSION_EDU[ranked[0]]);

  return {
    patientSummary: parts.join(" "),
    education: eduLines.join(" "),
    source: "builtin",
    promptVersion: BUILTIN_FACE_VERSION,
  };
}
