/**
 * One statistic. Shared so the Queue and Training dashboards can't drift apart —
 * they previously had two near-identical copies at different sizes.
 * Numbers are tabular so columns of figures stay optically aligned.
 */
export function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent?: boolean;
}) {
  return (
    <div className="card px-4 py-3">
      <div
        className={`font-mono text-xl font-semibold tabular-nums ${
          accent ? "text-gold-bright" : "text-ink"
        }`}
      >
        {value}
      </div>
      <div className="mt-1 text-[11px] uppercase tracking-[0.08em] text-ink-tertiary">{label}</div>
    </div>
  );
}
