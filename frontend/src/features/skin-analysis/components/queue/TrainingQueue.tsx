import { useCallback, useEffect, useState } from "react";
import {
  QUEUE_STATUSES,
  QUEUE_STATUS_LABEL,
  type QueueEntry,
  type QueueStats,
  type QueueStatus,
} from "@shared/training-queue";
import { listQueue, queueStats } from "../../api/queue-client";
import { ELIGIBILITY_LABEL, type Eligibility } from "@shared/training-governance";
import { AnnotationPanel } from "./AnnotationPanel";
import { ConfidenceBadge } from "./ConfidenceBadge";

const STATUS_PILL: Record<QueueStatus, string> = {
  pending: "border-hairline-strong bg-surface-raised text-ink-secondary",
  approved: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  rejected: "border-urgent/40 bg-urgent/10 text-urgent",
  needs_expert: "border-soon-edge bg-soon-surface text-soon",
};

function StatCard({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="card px-4 py-3">
      <div className={`font-mono text-2xl font-semibold tabular-nums ${accent ? "text-gold-bright" : "text-ink"}`}>
        {value}
      </div>
      <div className="mt-0.5 text-[11px] uppercase tracking-[0.08em] text-ink-tertiary">{label}</div>
    </div>
  );
}

export function TrainingQueue() {
  const [tab, setTab] = useState<QueueStatus>("pending");
  const [search, setSearch] = useState("");
  const [date, setDate] = useState("");
  const [entries, setEntries] = useState<QueueEntry[]>([]);
  const [stats, setStats] = useState<QueueStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [rows, s] = await Promise.all([
      listQueue({ status: tab, q: search || undefined, from: date || undefined, to: date || undefined }),
      queueStats(),
    ]);
    setEntries(rows);
    setStats(s);
    setLoading(false);
  }, [tab, search, date]);

  // Debounced so typing a patient id doesn't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(load, search || date ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, search, date]);

  return (
    <div className="mx-auto w-full max-w-4xl animate-rise px-1 py-2">
      <div className="mb-4">
        <h2 className="font-serif text-xl font-semibold tracking-tight text-ink">Training Queue</h2>
        <p className="mt-0.5 text-sm text-ink-secondary">
          Every completed scan lands here for review. Verified labels train the next model.
        </p>
      </div>

      {/* Statistics */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <StatCard label="Total" value={stats?.total ?? 0} />
        {QUEUE_STATUSES.map((s) => (
          <StatCard
            key={s}
            label={QUEUE_STATUS_LABEL[s]}
            value={stats?.[s] ?? 0}
            accent={s === "pending"}
          />
        ))}
      </div>

      {/* Filter tabs */}
      <div className="mt-5 flex flex-wrap gap-2">
        {QUEUE_STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => {
              setTab(s);
              setOpenId(null);
            }}
            aria-pressed={tab === s}
            className={`min-h-[36px] rounded-full px-3.5 text-sm font-medium transition-colors ${
              tab === s
                ? "bg-gold text-gold-ink"
                : "border border-hairline-strong bg-surface-raised text-ink-secondary hover:text-ink"
            }`}
          >
            {QUEUE_STATUS_LABEL[s]}
            {stats && <span className="ml-1.5 tabular-nums opacity-70">{stats[s] ?? 0}</span>}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="mt-3 flex flex-wrap gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search patient ID or name"
          className="field min-w-0 flex-1"
        />
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="field"
          aria-label="Scan date"
        />
        {(search || date) && (
          <button
            onClick={() => {
              setSearch("");
              setDate("");
            }}
            className="btn-secondary text-sm"
          >
            Clear
          </button>
        )}
      </div>

      {/* List */}
      <div className="mt-4">
        {loading ? (
          <ul className="space-y-3" aria-hidden>
            {[0, 1, 2].map((i) => (
              <li key={i} className="skeleton h-[4.5rem]" />
            ))}
          </ul>
        ) : entries.length === 0 ? (
          <div className="card p-10 text-center">
            <p className="text-sm text-ink-secondary">
              {search || date
                ? "No samples match that search."
                : `Nothing in ${QUEUE_STATUS_LABEL[tab]}. Completed scans appear here automatically.`}
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {entries.map((e) => {
              const open = openId === e.scanId;
              return (
                <li key={e.scanId} className="card overflow-hidden">
                  <button
                    onClick={() => setOpenId(open ? null : e.scanId)}
                    aria-expanded={open}
                    className="flex w-full items-center justify-between gap-3 p-4 text-left"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink">{e.patientName ?? e.patientId}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-ink-tertiary">
                        <span className="font-mono">{new Date(e.createdAt).toLocaleString()}</span>
                        <span>· {e.angleCount} images</span>
                        {e.labeledCount > 0 && <span>· {e.labeledCount} labeled</span>}
                        <span className={`rounded-full border px-2 py-0.5 ${STATUS_PILL[e.status]}`}>
                          {QUEUE_STATUS_LABEL[e.status]}
                        </span>
                        <span
                          className={`rounded-full border px-2 py-0.5 ${
                            e.eligibility === "ready"
                              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                              : "border-hairline-strong bg-surface-raised text-ink-tertiary"
                          }`}
                        >
                          {ELIGIBILITY_LABEL[e.eligibility as Eligibility] ?? e.eligibility}
                        </span>
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <ConfidenceBadge confidence={e.overallConfidence} label="Overall" />
                      <svg
                        width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                        className={`text-ink-tertiary transition-transform ${open ? "rotate-180" : ""}`}
                      >
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </div>
                  </button>
                  {open && (
                    <div className="border-t border-hairline px-4 pb-4">
                      <AnnotationPanel
                        scanId={e.scanId}
                        onClose={() => {
                          setOpenId(null);
                          void load();
                        }}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
