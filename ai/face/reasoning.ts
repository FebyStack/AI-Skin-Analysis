// Reviewer-facing "why did the AI suggest this?" bullets, derived from the
// report's own numbers. Read-only in the UI.
//
// Deriving these (rather than asking an LLM to imagine a rationale) means every
// bullet cites a score the model actually produced, including the zones that
// drove it. The backend serves Gemini prose when available and falls back to
// this — so the panel always has content, offline included.
import { FACE_DIMENSIONS, type FaceDimension, type FaceReport } from "../../shared/face";

const PROMINENT = 0.4; // at/above this a dimension is called out
const QUIET = 0.2; // below this it's worth noting as a negative finding

const PHRASE: Record<FaceDimension, string> = {
  acne: "acne",
  pigmentation: "pigmentation",
  redness: "redness",
  texture: "uneven surface texture",
  pores: "visible pores",
  oiliness: "sebum",
  dryness: "dryness",
  "fine-lines": "fine lines",
  wrinkles: "wrinkles",
  "under-eye": "under-eye shadowing",
  "tone-consistency": "uneven tone",
};

const ZONE_PHRASE: Record<string, string> = {
  forehead: "the forehead",
  nose: "the nose",
  "left-cheek": "the left cheek",
  "right-cheek": "the right cheek",
  chin: "the chin",
  periorbital: "the eye area",
  "under-eye": "under the eyes",
};

function severityWord(score: number): string {
  if (score >= 0.7) return "Marked";
  if (score >= 0.55) return "Moderate";
  return "Mild";
}

/** The zones driving a dimension, strongest first (max 2, only if above average). */
function topZones(report: FaceReport, dim: FaceDimension): string[] {
  const zones = report.dimensions[dim]?.perZone ?? [];
  if (zones.length === 0) return [];
  const avg = zones.reduce((a, z) => a + z.score, 0) / zones.length;
  return zones
    .filter((z) => z.score > avg)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map((z) => ZONE_PHRASE[z.zone] ?? z.zone);
}

/**
 * Clinical bullets explaining the AI's suggested labels. Ordered by prominence,
 * with one negative finding at the end so the reviewer sees what was ruled out.
 */
export function deriveReasoning(report: FaceReport): string[] {
  const ranked = [...FACE_DIMENSIONS].sort(
    (a, b) => report.dimensions[b].score - report.dimensions[a].score,
  );

  const bullets: string[] = [];
  for (const dim of ranked) {
    const d = report.dimensions[dim];
    if (!d || d.score < PROMINENT || bullets.length >= 4) continue;
    const zones = topZones(report, dim);
    const where = zones.length > 0 ? ` — most evident on ${zones.join(" and ")}` : "";
    bullets.push(
      `${severityWord(d.score)} ${PHRASE[dim]} (${Math.round(d.score * 100)}%)${where}.`,
    );
  }

  if (report.skinType) {
    bullets.push(
      `Skin reads as ${report.skinType.type} (${Math.round(report.skinType.confidence * 100)}% confidence).`,
    );
  }

  // One negative finding — what the scan did NOT show.
  const quiet = ranked.filter((d) => report.dimensions[d].score < QUIET).slice(-2);
  if (quiet.length > 0) {
    bullets.push(`No significant ${quiet.map((d) => PHRASE[d]).join(" or ")} detected.`);
  }

  if (bullets.length === 0) {
    bullets.push("No dimension reached a notable level on this scan.");
  }

  const lowConf = ranked.filter((d) => report.dimensions[d].confidence < 0.7);
  if (lowConf.length > 0) {
    bullets.push(
      `Lower confidence on ${lowConf.slice(0, 3).map((d) => PHRASE[d]).join(", ")} — verify before approving.`,
    );
  }
  return bullets;
}
