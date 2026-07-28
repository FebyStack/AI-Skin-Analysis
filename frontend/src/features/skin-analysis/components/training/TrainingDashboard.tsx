import { useEffect, useState } from "react";
import { GovernancePanel } from "./GovernancePanel";
import { AnalyticsDashboard } from "./AnalyticsDashboard";
import { ArchivePanel } from "./ArchivePanel";

// Mirrors the JSON the trainer + evaluator write (train.py / history.py).
interface EpochPoint {
  epoch: number;
  train_loss: number;
  val_macro_f1: number;
}
interface Progress {
  version: string;
  epoch: number;
  total_epochs: number;
  train_loss: number;
  val_macro_f1: number;
  history: EpochPoint[];
  done: boolean;
}
interface Run {
  version: string;
  at: string;
  metrics: Record<string, number>;
  counts: Record<string, number>;
}

const MODELS = [
  { dim: "acne", label: "Acne severity" },
  { dim: "skintype", label: "Skin type" },
] as const;

async function getJSON<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url, { credentials: "include" });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

// Tiny inline sparkline: values → a normalized polyline in a 100×28 box.
function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return <span className="text-xs text-ink-tertiary">—</span>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values
    .map((v, i) => `${(i / (values.length - 1)) * 100},${28 - ((v - min) / span) * 26 - 1}`)
    .join(" ");
  return (
    <svg viewBox="0 0 100 28" preserveAspectRatio="none" className="h-7 w-24">
      <polyline points={pts} fill="none" stroke="var(--gold, #c9a24b)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function pct(n: number | undefined): string {
  return typeof n === "number" ? `${Math.round(n * 100)}%` : "—";
}

function ModelPanel({ dim, label }: { dim: string; label: string }) {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);

  useEffect(() => {
    let alive = true;
    const loadHistory = () =>
      getJSON<{ runs: Run[] }>(`/api/training/${dim}/history`).then((d) => alive && setRuns(d?.runs ?? []));
    const loadProgress = () =>
      getJSON<Progress | null>(`/api/training/${dim}/progress`).then((d) => alive && setProgress(d));
    loadHistory();
    loadProgress();
    // Poll progress while something may be training; refresh history on completion.
    const id = setInterval(() => {
      loadProgress();
    }, 3000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [dim]);

  // When a live run finishes, pull the (now-updated) history once.
  useEffect(() => {
    if (progress?.done) getJSON<{ runs: Run[] }>(`/api/training/${dim}/history`).then((d) => setRuns(d?.runs ?? []));
  }, [progress?.done, progress?.version, dim]);

  const training = progress && !progress.done;
  const f1History = runs.map((r) => r.metrics.val_macro_f1).filter((n): n is number => typeof n === "number");
  const first = f1History[0];
  const latest = f1History[f1History.length - 1];
  const delta = first != null && latest != null ? latest - first : null;

  return (
    <section className="card p-5">
      <div className="flex items-center justify-between">
        <h3 className="font-serif text-lg font-semibold text-ink">{label}</h3>
        {training ? (
          <span className="rounded-full bg-gold/15 px-2.5 py-1 text-xs font-medium text-gold">Training…</span>
        ) : latest != null ? (
          <span className="text-xs text-ink-secondary">
            latest F1 <span className="font-mono text-ink">{pct(latest)}</span>
            {delta != null && delta !== 0 && (
              <span className={delta > 0 ? "text-ok" : "text-urgent"}>
                {" "}
                ({delta > 0 ? "+" : ""}
                {Math.round(delta * 100)} pts)
              </span>
            )}
          </span>
        ) : (
          <span className="text-xs text-ink-tertiary">no runs yet</span>
        )}
      </div>

      {/* Live progress */}
      {training && progress && (
        <div className="mt-3 rounded-xl border border-hairline bg-surface p-3">
          <div className="flex items-center justify-between text-xs text-ink-secondary">
            <span>
              Epoch {progress.epoch}/{progress.total_epochs}
            </span>
            <span className="font-mono">
              loss {progress.train_loss.toFixed(3)} · val F1 {pct(progress.val_macro_f1)}
            </span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-hairline">
            <div
              className="h-full rounded-full bg-gold transition-all"
              style={{ width: `${(progress.epoch / progress.total_epochs) * 100}%` }}
            />
          </div>
          <div className="mt-2">
            <Spark values={progress.history.map((h) => h.val_macro_f1)} />
          </div>
        </div>
      )}

      {/* Before / after history */}
      {runs.length > 0 ? (
        <div className="mt-4 overflow-x-auto">
          <div className="mb-2 flex items-center gap-3">
            <span className="text-xs text-ink-tertiary">Macro-F1 across retrains</span>
            <Spark values={f1History} />
          </div>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs text-ink-tertiary">
                <th className="py-1 pr-3 font-medium">When</th>
                <th className="py-1 pr-3 font-medium">Macro-F1</th>
                <th className="py-1 pr-3 font-medium">{dim === "acne" ? "Ord. MAE" : "Accuracy"}</th>
                <th className="py-1 font-medium">Images</th>
              </tr>
            </thead>
            <tbody className="text-ink">
              {runs
                .slice()
                .reverse()
                .map((r, i) => {
                  const total = Object.values(r.counts).reduce((a, b) => a + b, 0);
                  const second = dim === "acne" ? r.metrics.acne_ordinal_mae : r.metrics.skintype_accuracy;
                  return (
                    <tr key={r.version + i} className="border-t border-hairline">
                      <td className="py-1.5 pr-3 font-mono text-xs text-ink-secondary">
                        {new Date(r.at).toLocaleString()}
                      </td>
                      <td className="py-1.5 pr-3 font-mono tabular-nums">{pct(r.metrics.val_macro_f1)}</td>
                      <td className="py-1.5 pr-3 font-mono tabular-nums">
                        {typeof second === "number" ? (dim === "acne" ? second.toFixed(3) : pct(second)) : "—"}
                      </td>
                      <td className="py-1.5 font-mono tabular-nums text-ink-secondary">{total || "—"}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      ) : (
        !training && (
          <p className="mt-3 text-sm text-ink-secondary">
            No training runs recorded yet. Run <code className="text-gold">make retrain-{dim}</code>, then
            re-open this page to see the before/after history.
          </p>
        )
      )}
    </section>
  );
}

export function TrainingDashboard() {
  return (
    <div className="mx-auto w-full max-w-3xl animate-rise space-y-5 px-1 py-2">
      <p className="text-sm text-ink-secondary">
        On-device model training — live progress and how each model improved across retrains. For detailed
        curves, run <code className="text-gold">tensorboard --logdir ai/models/runs</code>.
      </p>
      <AnalyticsDashboard />
      <GovernancePanel />
      {MODELS.map((m) => (
        <ModelPanel key={m.dim} dim={m.dim} label={m.label} />
      ))}
      <ArchivePanel />
    </div>
  );
}
