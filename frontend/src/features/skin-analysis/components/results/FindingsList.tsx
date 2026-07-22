import type { MergedFinding } from "../../types";

const BADGES = {
  agree: { text: "2 analyses agree", cls: "bg-gold/[0.12] text-gold-bright border-gold/30" },
  "llm-only": { text: "AI analysis only", cls: "bg-white/[0.05] text-ink-secondary border-hairline" },
  "classifier-only": {
    text: "Flagged by classifier",
    cls: "bg-white/[0.05] text-ink-secondary border-hairline",
  },
  conflict: { text: "Analyses differ", cls: "bg-soon-surface text-soon border-soon-edge" },
} as const;

export function FindingsList({ findings }: { findings: MergedFinding[] }) {
  if (findings.length === 0) {
    return <p className="text-sm text-ink-secondary">No notable findings.</p>;
  }
  return (
    <ul className="space-y-3">
      {findings.map((f) => {
        const badge = BADGES[f.agreement];
        return (
          <li key={f.id} className={`card p-4 ${f.escalated ? "border-soon-edge" : ""}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-bold text-ink">{f.label}</span>
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${badge.cls}`}>
                {badge.text}
              </span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
              <div className="h-full rounded-full bg-gold" style={{ width: `${Math.round(f.confidence * 100)}%` }} />
            </div>
            {f.note && <p className="mt-2 text-xs text-ink-secondary">{f.note}</p>}
            {f.escalated && (
              <p className="mt-2 text-xs font-semibold text-soon">
                Worth a professional look — a dermatologist can evaluate this properly.
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
