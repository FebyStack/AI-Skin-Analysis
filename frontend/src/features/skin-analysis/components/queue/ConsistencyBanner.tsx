import type { LabelInconsistency } from "@shared/label-consistency";
import { ANNOTATION_FIELDS } from "@shared/training-queue";

const FIELD_LABEL: Record<string, string> = Object.fromEntries(
  ANNOTATION_FIELDS.map((f) => [f.key, f.label]),
);

/**
 * Advisory only. A big label swing between two close visits is usually an
 * annotation slip — but it can be real (a flare, a new treatment), so the
 * reviewer decides. Every warning is already logged for audit by the time this
 * renders.
 */
export function ConsistencyBanner({
  warnings,
  onReview,
  onEdit,
  onDismiss,
}: {
  warnings: LabelInconsistency[];
  onReview: () => void;
  onEdit: () => void;
  onDismiss: () => void;
}) {
  if (warnings.length === 0) return null;

  return (
    <section className="rounded-xl border border-soon-edge bg-soon-surface p-3">
      <h4 className="text-sm font-semibold text-soon">Unusual change since the last visit</h4>
      <ul className="mt-2 space-y-1.5">
        {warnings.map((w) => (
          <li key={w.field} className="text-xs text-ink-secondary">
            <span className="font-medium text-ink">{FIELD_LABEL[w.field] ?? w.field}</span> went{" "}
            <span className="text-ink">{w.previous}</span> → <span className="text-ink">{w.current}</span>{" "}
            in {w.daysApart === 0 ? "the same day" : `${w.daysApart} day${w.daysApart === 1 ? "" : "s"}`}.{" "}
            {w.reason}
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={onReview} className="btn-secondary min-h-[32px] px-3 text-xs">
          Review again
        </button>
        <button onClick={onEdit} className="btn-secondary min-h-[32px] px-3 text-xs">
          Edit label
        </button>
        <button onClick={onDismiss} className="min-h-[32px] px-3 text-xs text-ink-tertiary hover:text-ink">
          Approve anyway
        </button>
      </div>
    </section>
  );
}
