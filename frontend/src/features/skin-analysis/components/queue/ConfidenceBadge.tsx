import { confidenceBand } from "@shared/training-queue";
import { WarningIcon } from "../ui/icons";

// Green ≥90% · Yellow 70–89% · Red <70%, with a warning icon on low confidence
// so a reviewer can't miss a prediction that needs checking.
const STYLES: Record<string, string> = {
  high: "border-ok-edge bg-ok-surface text-ok",
  medium: "border-soon-edge bg-soon-surface text-soon",
  low: "border-urgent-edge bg-urgent-surface text-urgent",
};

export function ConfidenceBadge({
  confidence,
  label,
}: {
  confidence: number | null | undefined;
  label?: string;
}) {
  if (typeof confidence !== "number") {
    return <span className="text-xs text-ink-tertiary">—</span>;
  }
  const band = confidenceBand(confidence);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium tabular-nums ${STYLES[band]}`}
      title={
        band === "low"
          ? "Low confidence — verify before approving"
          : `${label ?? "Confidence"} ${Math.round(confidence * 100)}%`
      }
    >
      {band === "low" && <WarningIcon size={11} />}
      {Math.round(confidence * 100)}%
    </span>
  );
}
