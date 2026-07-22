import { DIMENSION_KEYS, PROXY_DIMENSIONS, type AnalysisReport } from "@shared/contract";

const LABELS: Record<(typeof DIMENSION_KEYS)[number], string> = {
  "hydration-appearance": "Hydration",
  oiliness: "Oiliness",
  pigmentation: "Pigmentation",
  spots: "Spots",
  pores: "Pores",
  blackheads: "Blackheads",
  "wrinkles-texture": "Wrinkles & texture",
  acne: "Acne",
  inflammation: "Inflammation",
  redness: "Redness",
  sensitivity: "Sensitivity",
  "elasticity-appearance": "Elasticity",
};

export function DimensionGrid({ dimensions }: { dimensions: AnalysisReport["dimensions"] }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {DIMENSION_KEYS.map((key) => {
        const d = dimensions[key];
        const isProxy = (PROXY_DIMENSIONS as readonly string[]).includes(key);
        return (
          <div key={key} className="card p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-ink">{LABELS[key]}</span>
              {isProxy && (
                <span className="rounded-full border border-gold/30 bg-gold/[0.12] px-2 py-0.5 text-[10px] font-semibold text-gold-bright">
                  visual proxy
                </span>
              )}
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
              <div className="h-full rounded-full bg-gold" style={{ width: `${Math.round(d.score * 100)}%` }} />
            </div>
            <p className="mt-2 text-xs leading-relaxed text-ink-secondary">{d.note}</p>
          </div>
        );
      })}
    </div>
  );
}
