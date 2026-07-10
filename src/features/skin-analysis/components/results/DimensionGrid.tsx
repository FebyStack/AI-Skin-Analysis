import { DIMENSION_KEYS, PROXY_DIMENSIONS, type AnalysisReport } from "../../api/contract";

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
          <div key={key} className="rounded-xl border border-stone-200 bg-white p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-stone-900">{LABELS[key]}</span>
              {isProxy && (
                <span className="rounded-full bg-clinical-soft px-2 py-0.5 text-[10px] font-semibold text-clinical">
                  visual proxy
                </span>
              )}
            </div>
            <div className="mt-2 h-1.5 rounded bg-stone-100">
              <div
                className="h-full rounded bg-clinical"
                style={{ width: `${Math.round(d.score * 100)}%` }}
              />
            </div>
            <p className="mt-2 text-xs leading-relaxed text-stone-600">{d.note}</p>
          </div>
        );
      })}
    </div>
  );
}
