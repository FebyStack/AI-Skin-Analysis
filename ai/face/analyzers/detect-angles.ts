// Runs the acne detector across a scan's captured angles and turns the raw
// per-angle results into one sanitised, capped mark set — or null when nothing
// can be reported (no detector, deadline blown before anything ran, or the
// sanitised marks still fail the contract the server enforces).
import { MAX_MARKS, markErrors, type FaceAngle, type FindingMark } from "../../../shared/face";
import type { DetectorInput, DetectionResult } from "./acne-detector";

export const MAX_MARKS_PER_ANGLE = 100;

function markIsFinite(m: FindingMark): boolean {
  const nums =
    m.shape.type === "box"
      ? [m.shape.x, m.shape.y, m.shape.w, m.shape.h, m.confidence]
      : [...m.shape.polygon.flat(), m.confidence];
  return nums.every(Number.isFinite);
}

/** Drop bad numbers, cap per angle (highest confidence first), then cap overall. */
function sanitise(marks: FindingMark[]): FindingMark[] {
  const finite = marks.filter(markIsFinite);
  const byAngle = new Map<FaceAngle, FindingMark[]>();
  for (const m of finite) byAngle.set(m.angle, [...(byAngle.get(m.angle) ?? []), m]);
  const capped = [...byAngle.values()].flatMap((ms) =>
    [...ms].sort((a, b) => b.confidence - a.confidence).slice(0, MAX_MARKS_PER_ANGLE),
  );
  return capped.sort((a, b) => b.confidence - a.confidence).slice(0, MAX_MARKS);
}

/**
 * Sequential, one crop alive at a time (iOS memory): crop an angle, detect it,
 * release, move on. Stops before starting an angle once `now() > deadline`.
 */
export async function detectAngles(
  sources: { angle: FaceAngle; crop: () => Promise<DetectorInput | null> }[],
  detect: (inputs: DetectorInput[]) => Promise<DetectionResult | null>,
  deadline: number,
  now: () => number = Date.now,
): Promise<DetectionResult | null> {
  const marks: FindingMark[] = [];
  const examined: FaceAngle[] = [];
  for (const { crop } of sources) {
    if (now() > deadline) break;
    const input = await crop();
    if (!input) continue; // no face geometry / decode failure — not examined
    const result = await detect([input]);
    if (result === null) return null; // no detector at all
    marks.push(...result.marks);
    examined.push(...result.examined);
  }
  if (examined.length === 0) return null;
  const sanitisedMarks = sanitise(marks);
  // Never send a report the server will reject — the contract is the single
  // source of truth for what a valid mark set looks like.
  return markErrors(sanitisedMarks).length > 0 ? null : { marks: sanitisedMarks, examined };
}
