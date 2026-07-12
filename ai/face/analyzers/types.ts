// ai/face/analyzers/types.ts
import type { DimensionScore, FaceAnalysisZone } from "../../../shared/face";
import type { AnalyzedView, ZoneStats } from "../types";

export type Analyzer = (views: AnalyzedView[]) => DimensionScore;

export const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** Collect this zone's stats across all views that saw it (quality-weighted later by merge;
 * within a dimension we average views seeing the same zone). */
export function collectZones(views: AnalyzedView[], zones: FaceAnalysisZone[]): Map<FaceAnalysisZone, ZoneStats[]> {
  const out = new Map<FaceAnalysisZone, ZoneStats[]>();
  for (const v of views) {
    for (const z of zones) {
      const s = v.zones[z];
      if (s && s.pixelCount > 0) out.set(z, [...(out.get(z) ?? []), s]);
    }
  }
  return out;
}

/** Standard scaffold: score each zone via `zoneScore`, average views per zone, average zones. */
export function zoneMeanDimension(
  views: AnalyzedView[],
  zones: FaceAnalysisZone[],
  zoneScore: (s: ZoneStats) => number,
  evidence: string,
): DimensionScore {
  const collected = collectZones(views, zones);
  if (collected.size === 0) return { score: 0, confidence: 0, perZone: [], evidence: `${evidence} (no zones visible)` };
  const perZone = [...collected.entries()].map(([zone, list]) => ({
    zone, score: clamp01(list.reduce((a, s) => a + zoneScore(s), 0) / list.length),
  }));
  const score = clamp01(perZone.reduce((a, z) => a + z.score, 0) / perZone.length);
  const confidence = clamp01(collected.size / zones.length);   // zone coverage; merge refines further
  return { score, confidence, perZone, evidence };
}
