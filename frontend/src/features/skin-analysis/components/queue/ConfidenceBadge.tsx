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
  source,
}: {
  confidence: number | null | undefined;
  label?: string;
  /** Omitted or "heuristic" → no trained model stands behind this number. */
  source?: "model" | "heuristic";
}) {
  if (typeof confidence !== "number") {
    return <span className="text-xs text-ink-tertiary">—</span>;
  }

  // For a heuristic, `confidence` is ZONE COVERAGE, not certainty. Rendering it
  // as a green "100%" told the clinician the model was sure of a value no model
  // ever produced — it read "Wrinkles: None · 100%" on a face with obvious
  // wrinkles. Show it for what it is.
  if (source !== "model") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full border border-hairline bg-surface px-2 py-0.5 text-[11px] font-medium text-ink-tertiary"
        title="No trained model for this dimension yet — a pixel-based estimate, not a prediction. Grade it yourself."
      >
        estimate
      </span>
    );
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
