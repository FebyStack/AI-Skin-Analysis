import { useEffect, useState } from "react";
import { clinicAnalytics, type ClinicAnalytics } from "../../api/queue-client";

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card p-4">
      <p className="text-[11px] uppercase tracking-[0.14em] text-ink-tertiary">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-ink-secondary">{hint}</p>}
    </div>
  );
}

/** Minimal inline bar chart — no chart library, no extra bundle weight. */
function Bars({ points }: { points: { label: string; value: number; sub: string }[] }) {
  if (points.length === 0) return <p className="text-xs text-ink-tertiary">No history yet.</p>;
  const max = Math.max(...points.map((p) => p.value)) || 1;
  return (
    <ul className="space-y-2">
      {points.map((p) => (
        <li key={p.label} className="grid grid-cols-[5rem_1fr_auto] items-center gap-2">
          <span className="truncate font-mono text-[11px] text-ink-secondary">{p.label}</span>
          <span className="h-1.5 rounded-full bg-surface">
            <span
              className="block h-full rounded-full bg-gold transition-[width] duration-700 ease-spring"
              style={{ width: `${Math.round((p.value / max) * 100)}%` }}
            />
          </span>
          <span className="tabular-nums text-[11px] text-ink-tertiary">{p.sub}</span>
        </li>
      ))}
    </ul>
  );
}

const pct = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const cap = (v: string | null) => (v == null ? "—" : v.replace(/-/g, " "));

export function AnalyticsDashboard() {
  const [a, setA] = useState<ClinicAnalytics | null>(null);

  useEffect(() => {
    let alive = true;
    clinicAnalytics().then((r) => alive && setA(r));
    return () => {
      alive = false;
    };
  }, []);

  if (!a) return <p className="text-sm text-ink-tertiary">Loading analytics…</p>;

  const reviewHours = a.avgReviewMs == null ? null : a.avgReviewMs / 3_600_000;

  return (
    <section className="space-y-6">
      <header>
        <h3 className="text-base font-semibold text-ink">Clinic analytics</h3>
        <p className="mt-1 text-xs text-ink-secondary">
          Aggregate activity across every patient, scan and review.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Patients" value={String(a.totalPatients)} />
        <Stat label="Visits" value={String(a.totalVisits)} />
        <Stat label="AI analyses" value={String(a.totalAnalyses)} />
        <Stat label="Avg confidence" value={pct(a.avgConfidence)} />
        <Stat label="Common skin type" value={cap(a.topSkinType)} />
        <Stat label="Common acne severity" value={cap(a.topAcneSeverity)} />
        <Stat
          label="Avg review time"
          value={
            reviewHours == null
              ? "—"
              : reviewHours < 1
                ? `${Math.round(reviewHours * 60)}m`
                : `${reviewHours.toFixed(1)}h`
          }
          hint="Queued → decided"
        />
        <Stat
          label="Queue"
          value={String(a.queueSize)}
          hint={`${a.pending} pending · ${a.needsExpert} expert`}
        />
        <Stat label="Approved" value={String(a.approved)} />
        <Stat label="Rejected" value={String(a.rejected)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card p-4">
          <h4 className="mb-3 text-sm font-semibold text-ink">Dataset growth</h4>
          <Bars
            points={a.datasetGrowth.map((d) => ({
              label: d.version,
              value: d.imageCount,
              sub: `${d.imageCount} img`,
            }))}
          />
        </section>
        <section className="card p-4">
          <h4 className="mb-3 text-sm font-semibold text-ink">Model performance</h4>
          <Bars
            points={a.modelHistory.map((m) => ({
              label: m.version,
              value: m.macroF1 ?? 0,
              sub: m.macroF1 == null ? m.deployment : `F1 ${m.macroF1.toFixed(3)}`,
            }))}
          />
        </section>
      </div>
    </section>
  );
}
