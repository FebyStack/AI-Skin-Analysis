import { confidenceBand } from "@shared/training-queue";

// Green ≥90% · Yellow 70–89% · Red <70%, with a warning icon on low confidence
// so a reviewer can't miss a prediction that needs checking.
const STYLES: Record<string, string> = {
  high: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  medium: "border-soon-edge bg-soon-surface text-soon",
  low: "border-urgent/40 bg-urgent/10 text-urgent",
};

function WarningIcon() {
  return (
    <svg
      width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden
    >
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

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
      {band === "low" && <WarningIcon />}
      {Math.round(confidence * 100)}%
    </span>
  );
}
