import type { MergedFinding } from "../../types";

const BADGES = {
  agree: { text: "✓ 2 analyses agree", cls: "bg-clinical-soft text-clinical border-clinical/30" },
  "llm-only": { text: "AI analysis only", cls: "bg-stone-100 text-stone-600 border-stone-200" },
  "classifier-only": {
    text: "Flagged by classifier",
    cls: "bg-stone-100 text-stone-600 border-stone-200",
  },
  conflict: { text: "⚑ Analyses differ", cls: "bg-amber-50 text-amber-700 border-amber-200" },
} as const;

export function FindingsList({ findings }: { findings: MergedFinding[] }) {
  if (findings.length === 0) {
    return <p className="text-sm text-stone-500">No notable findings.</p>;
  }
  return (
    <ul className="space-y-3">
      {findings.map((f) => {
        const badge = BADGES[f.agreement];
        return (
          <li
            key={f.id}
            className={`rounded-xl border bg-white p-4 ${
              f.escalated ? "border-flag" : "border-stone-200"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-bold text-stone-900">{f.label}</span>
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${badge.cls}`}>
                {badge.text}
              </span>
            </div>
            <div className="mt-2 h-1.5 rounded bg-stone-100">
              <div
                className="h-full rounded bg-clinical"
                style={{ width: `${Math.round(f.confidence * 100)}%` }}
              />
            </div>
            {f.note && <p className="mt-2 text-xs text-stone-600">{f.note}</p>}
            {f.escalated && (
              <p className="mt-2 text-xs font-semibold text-amber-700">
                Worth a professional look — a dermatologist can evaluate this properly.
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
