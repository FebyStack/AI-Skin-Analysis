// shared/label-consistency.ts
// Catches annotation drift: a reviewer grading the same patient very differently
// from their last approved visit, too soon for the skin to have actually changed.
//
// It never blocks — a real flare can move two levels in a week. It surfaces the
// pair and lets the reviewer decide, and every warning is logged for audit.
import { ANNOTATION_FIELDS } from "./training-queue";

/** A jump of at least this many levels is worth questioning. */
export const LEVEL_JUMP = 2;
/** …but only when the visits are close enough that skin couldn't plausibly change. */
export const SHORT_PERIOD_DAYS = 30;

const DAY_MS = 86_400_000;

export interface LabelInconsistency {
  field: string;          // dimension key, e.g. "acne"
  label: string;          // human label, e.g. "Acne Severity"
  previous: string;
  current: string;
  levelJump: number;      // ordinal distance between the two
  daysApart: number;
  reason: string;
}

function levelIndex(field: string, value: string): number {
  const spec = ANNOTATION_FIELDS.find((f) => f.key === field);
  return spec ? spec.options.indexOf(value) : -1;
}

/** Ordered scales only — skin type is categorical, so "oily → dry" isn't a jump. */
function isOrdinal(field: string): boolean {
  return field !== "skintype";
}

export interface ConsistencyInput {
  current: Record<string, string>;
  previous: Record<string, string>;
  /** Epoch ms of each visit. */
  currentAt: number;
  previousAt: number;
}

/**
 * Every field whose label moved far in a short time. Empty when the visits are
 * far apart or the changes are gradual.
 */
export function checkConsistency(i: ConsistencyInput): LabelInconsistency[] {
  const daysApart = Math.max(0, Math.round((i.currentAt - i.previousAt) / DAY_MS));
  if (daysApart > SHORT_PERIOD_DAYS) return [];

  const out: LabelInconsistency[] = [];
  for (const spec of ANNOTATION_FIELDS) {
    if (!isOrdinal(spec.key)) continue;
    const cur = i.current[spec.key];
    const prev = i.previous[spec.key];
    if (!cur || !prev || cur === prev) continue;

    const a = levelIndex(spec.key, prev);
    const b = levelIndex(spec.key, cur);
    if (a < 0 || b < 0) continue;

    const levelJump = Math.abs(b - a);
    if (levelJump < LEVEL_JUMP) continue;

    out.push({
      field: spec.key,
      label: spec.label,
      previous: prev,
      current: cur,
      levelJump,
      daysApart,
      reason:
        daysApart <= 1
          ? "Large change detected on the same day."
          : "Large change detected within a short period.",
    });
  }
  return out;
}
