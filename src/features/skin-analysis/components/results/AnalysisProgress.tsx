import type { AnalysisStage } from "../../hooks/use-analysis";

export const STAGE_LABELS: Record<AnalysisStage | "quality", string> = {
  quality: "Checking image quality",
  classifier: "Mapping skin surface",
  analyzing: "Running deep analysis",
  crosscheck: "Cross-checking with second AI",
  report: "Preparing the report",
};

const ORDER: (AnalysisStage | "quality")[] = [
  "quality",
  "classifier",
  "analyzing",
  "crosscheck",
  "report",
];

export function AnalysisProgress({ stage }: { stage: AnalysisStage | "quality" }) {
  const currentIdx = ORDER.indexOf(stage);
  return (
    <div
      role="status"
      aria-label={`Analyzing: ${STAGE_LABELS[stage]}`}
      className="mx-auto flex min-h-64 max-w-sm flex-col items-center justify-center gap-6 motion-reduce:transition-none"
    >
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-clinical-soft border-t-clinical motion-reduce:animate-none" />
      <ol className="w-full space-y-2">
        {ORDER.map((s, i) => (
          <li
            key={s}
            aria-current={s === stage ? "step" : undefined}
            className={`flex items-center gap-2 text-sm ${
              i < currentIdx
                ? "text-stone-400 line-through"
                : s === stage
                  ? "font-semibold text-clinical"
                  : "text-stone-500"
            }`}
          >
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                i <= currentIdx ? "bg-clinical" : "bg-stone-300"
              }`}
            />
            {STAGE_LABELS[s]}
          </li>
        ))}
      </ol>
    </div>
  );
}
