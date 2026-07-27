import { useCallback, useEffect, useState } from "react";
import type {
  DatasetVersion,
  ModelRelease,
  TrainingReadiness,
} from "@shared/training-governance";
import type { QueueStats } from "@shared/training-queue";

async function getJSON<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url, { credentials: "include" });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}
async function post(url: string, body?: unknown): Promise<{ ok: boolean; error?: string }> {
  const r = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, error: j.error };
}

function Stat({ label, value, accent }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <div className="card px-4 py-3">
      <div className={`font-mono text-xl font-semibold tabular-nums ${accent ? "text-gold-bright" : "text-ink"}`}>
        {value}
      </div>
      <div className="mt-0.5 text-[11px] uppercase tracking-[0.08em] text-ink-tertiary">{label}</div>
    </div>
  );
}

const pct = (n: number | null | undefined) =>
  typeof n === "number" ? `${Math.round(n * 100)}%` : "—";
const mb = (n: number | null) => (typeof n === "number" ? `${Math.round(n / 1_000_000)} MB` : "—");

const DEPLOY_PILL: Record<string, string> = {
  production: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  candidate: "border-soon-edge bg-soon-surface text-soon",
  archived: "border-hairline-strong bg-surface-raised text-ink-tertiary",
};

export function GovernancePanel() {
  const [datasets, setDatasets] = useState<DatasetVersion[]>([]);
  const [releases, setReleases] = useState<ModelRelease[]>([]);
  const [readiness, setReadiness] = useState<TrainingReadiness | null>(null);
  const [stats, setStats] = useState<QueueStats | null>(null);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const [d, r, k, s] = await Promise.all([
      getJSON<{ versions: DatasetVersion[] }>("/api/datasets"),
      getJSON<{ releases: ModelRelease[] }>("/api/models/releases"),
      getJSON<TrainingReadiness>("/api/training/readiness"),
      getJSON<QueueStats>("/api/training-queue/stats"),
    ]);
    setDatasets(d?.versions ?? []);
    setReleases(r?.releases ?? []);
    setReadiness(k);
    setStats(s);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const currentDataset = datasets.find((d) => d.isCurrent) ?? null;
  const production = releases.find((r) => r.deployment === "production") ?? null;
  const pctReady = readiness ? Math.min(100, (readiness.approvedSinceLastTraining / readiness.threshold) * 100) : 0;

  const createDataset = async () => {
    setMsg("Creating…");
    const r = await post("/api/datasets");
    setMsg(r.ok ? "New dataset version created." : r.error ?? "Could not create dataset.");
    void load();
  };

  const deploy = async (version: string, force = false) => {
    const r = await post(`/api/models/releases/${version}/deploy`, { deployment: "production", force });
    setMsg(
      r.ok
        ? `Deployed ${version}.`
        : r.error ?? "Could not deploy.",
    );
    void load();
  };

  return (
    <div className="space-y-5">
      {/* Headline numbers */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Dataset Size" value={currentDataset?.imageCount ?? 0} accent />
        <Stat label="Pending Reviews" value={stats?.pending ?? 0} />
        <Stat label="Approved" value={stats?.approved ?? 0} />
        <Stat label="Rejected" value={stats?.rejected ?? 0} />
        <Stat label="Needs Expert" value={stats?.needs_expert ?? 0} />
        <Stat label="Dataset Version" value={currentDataset?.version ?? "—"} />
        <Stat label="Model Version" value={production?.version ?? "none"} />
        <Stat label="Macro F1" value={pct(production?.macroF1)} accent />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Acne F1" value={pct(production?.acneF1)} />
        <Stat label="Skin Type F1" value={pct(production?.skintypeF1)} />
        <Stat
          label="Training Date"
          value={production ? new Date(production.trainedAt).toLocaleDateString() : "—"}
        />
      </div>

      {/* Retrain threshold — reaching it enables training, never starts it. */}
      <section className="card p-4">
        <div className="flex items-baseline justify-between">
          <h3 className="text-sm font-semibold text-ink">Next Training Threshold</h3>
          <span className="font-mono text-sm tabular-nums text-ink">
            {readiness?.approvedSinceLastTraining ?? 0} / {readiness?.threshold ?? 0}
          </span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-hairline">
          <div
            className={`h-full rounded-full transition-all ${readiness?.ready ? "bg-emerald-500" : "bg-gold"}`}
            style={{ width: `${pctReady}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-ink-secondary">
          Approved since the last deployed model.{" "}
          {readiness?.ready
            ? "Threshold reached — you can create a dataset version and train a candidate."
            : "Training stays available, but this is the point where a retrain is worth it."}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={createDataset} className="btn-primary text-sm">
            Create Dataset Version
          </button>
          <span className="self-center text-xs text-ink-tertiary">
            then run <code className="text-gold">make retrain-face</code> and register the candidate
          </span>
        </div>
        {msg && <p className="mt-2 text-xs text-ink-secondary">{msg}</p>}
      </section>

      {/* Dataset versions */}
      <section className="card p-4">
        <h3 className="text-sm font-semibold text-ink">Dataset Versions</h3>
        <p className="mt-0.5 text-xs text-ink-tertiary">
          Frozen snapshots — creating a new one never alters an older one.
        </p>
        {datasets.length === 0 ? (
          <p className="mt-3 text-sm text-ink-secondary">
            No dataset versions yet. Approve some samples, then create the first one.
          </p>
        ) : (
          <table className="mt-3 w-full text-left text-sm">
            <thead>
              <tr className="text-xs text-ink-tertiary">
                <th className="py-1 pr-3 font-medium">Version</th>
                <th className="py-1 pr-3 font-medium">Images</th>
                <th className="py-1 pr-3 font-medium">Created</th>
                <th className="py-1 font-medium" />
              </tr>
            </thead>
            <tbody>
              {datasets.map((d) => (
                <tr key={d.id} className="border-t border-hairline">
                  <td className="py-1.5 pr-3 font-mono text-ink">
                    {d.version}
                    {d.isCurrent && <span className="ml-2 text-[10px] uppercase text-gold">current</span>}
                  </td>
                  <td className="py-1.5 pr-3 font-mono tabular-nums text-ink-secondary">{d.imageCount}</td>
                  <td className="py-1.5 pr-3 font-mono text-xs text-ink-tertiary">
                    {new Date(d.createdAt).toLocaleDateString()}
                  </td>
                  <td className="py-1.5 text-right">
                    {!d.isCurrent && (
                      <button
                        onClick={async () => {
                          await post(`/api/datasets/${d.version}/current`);
                          void load();
                        }}
                        className="btn-secondary min-h-[30px] text-xs"
                      >
                        Roll back
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Model releases */}
      <section className="card p-4">
        <h3 className="text-sm font-semibold text-ink">Model Versions</h3>
        <p className="mt-0.5 text-xs text-ink-tertiary">
          A candidate can only be promoted when it beats production. Rollback is always allowed.
        </p>
        {releases.length === 0 ? (
          <p className="mt-3 text-sm text-ink-secondary">
            No models registered yet. Train a candidate, then register it from the API.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs text-ink-tertiary">
                  <th className="py-1 pr-3 font-medium">Version</th>
                  <th className="py-1 pr-3 font-medium">Trained</th>
                  <th className="py-1 pr-3 font-medium">Dataset</th>
                  <th className="py-1 pr-3 font-medium">Macro</th>
                  <th className="py-1 pr-3 font-medium">Acne</th>
                  <th className="py-1 pr-3 font-medium">Skin</th>
                  <th className="py-1 pr-3 font-medium">Size</th>
                  <th className="py-1 pr-3 font-medium">Status</th>
                  <th className="py-1 font-medium" />
                </tr>
              </thead>
              <tbody>
                {releases.map((r) => (
                  <tr key={r.id} className="border-t border-hairline">
                    <td className="py-1.5 pr-3 font-mono text-xs text-ink">{r.version}</td>
                    <td className="py-1.5 pr-3 font-mono text-xs text-ink-tertiary">
                      {new Date(r.trainedAt).toLocaleDateString()}
                    </td>
                    <td className="py-1.5 pr-3 font-mono text-xs text-ink-secondary">
                      {r.datasetVersion ?? "—"}
                    </td>
                    <td className="py-1.5 pr-3 font-mono tabular-nums text-ink">{pct(r.macroF1)}</td>
                    <td className="py-1.5 pr-3 font-mono tabular-nums text-ink-secondary">{pct(r.acneF1)}</td>
                    <td className="py-1.5 pr-3 font-mono tabular-nums text-ink-secondary">{pct(r.skintypeF1)}</td>
                    <td className="py-1.5 pr-3 font-mono text-xs text-ink-tertiary">{mb(r.sizeBytes)}</td>
                    <td className="py-1.5 pr-3">
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] ${DEPLOY_PILL[r.deployment]}`}>
                        {r.deployment}
                      </span>
                    </td>
                    <td className="py-1.5 text-right">
                      {r.deployment !== "production" && (
                        <button
                          onClick={() => deploy(r.version)}
                          className="btn-secondary min-h-[30px] text-xs"
                        >
                          {r.deployment === "archived" ? "Roll back" : "Deploy"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
