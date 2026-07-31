import { useCallback, useEffect, useState } from "react";
import { daysLeft } from "@shared/lifecycle";
import {
  listArchive,
  purgeArchived,
  restoreArchived,
  type ArchiveEntry,
} from "../../api/queue-client";
import { ConfirmDialog } from "../queue/ConfirmDialog";
import { LoadingState } from "../ui/LoadingState";

/** Archived images: recoverable until their retention window runs out. */
export function ArchivePanel() {
  const [rows, setRows] = useState<ArchiveEntry[] | null>(null);
  const [stats, setStats] = useState<{ archived: number; expiringSoon: number; retentionDays: number } | null>(null);
  const [purging, setPurging] = useState<ArchiveEntry | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await listArchive();
    setRows(r?.images ?? []);
    setStats(r?.stats ?? null);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const restore = async (e: ArchiveEntry) => {
    setBusy(true);
    await restoreArchived(e.scanId, e.angle);
    await load();
    setBusy(false);
  };

  const purge = async () => {
    if (!purging) return;
    setBusy(true);
    await purgeArchived(purging.scanId, purging.angle);
    setPurging(null);
    await load();
    setBusy(false);
  };

  if (!rows) return <LoadingState label="Loading archive…" variant="inline" />;

  return (
    <section className="space-y-4">
      <header>
        <h3 className="text-base font-semibold text-ink">Archive</h3>
        <p className="mt-1 text-xs text-ink-secondary">
          Archived images are kept for {stats?.retentionDays ?? 30} days, then deleted automatically.
          {stats?.expiringSoon ? ` ${stats.expiringSoon} expiring within a week.` : ""}
        </p>
      </header>

      {rows.length === 0 ? (
        <p className="card p-4 text-sm text-ink-tertiary">Nothing archived.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((e) => {
            const left = daysLeft(e.archivedAt);
            return (
              <li
                key={`${e.scanId}-${e.angle}`}
                className="card flex flex-wrap items-center gap-3 p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-ink">
                    {e.patientName ?? "Unknown patient"}
                    <span className="text-ink-tertiary"> · {e.angle}</span>
                  </p>
                  <p className="text-[11px] tabular-nums text-ink-tertiary">
                    Archived {new Date(e.archivedAt).toLocaleDateString()} ·{" "}
                    <span className={left <= 7 ? "text-soon" : ""}>
                      {left <= 0 ? "deleting now" : `${left} day${left === 1 ? "" : "s"} left`}
                    </span>
                  </p>
                </div>
                <button
                  onClick={() => restore(e)}
                  disabled={busy}
                  className="btn-secondary min-h-[32px] px-3 text-xs"
                >
                  Restore
                </button>
                <button
                  onClick={() => setPurging(e)}
                  disabled={busy}
                  className="min-h-[32px] rounded-lg border border-urgent-edge bg-urgent-surface px-3 text-xs font-medium text-urgent disabled:opacity-50"
                >
                  Delete permanently
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {purging && (
        <ConfirmDialog
          title="Delete this image permanently?"
          body="It cannot be recovered afterwards. The scan's audit history is kept."
          onCancel={() => setPurging(null)}
          onConfirm={purge}
        />
      )}
    </section>
  );
}
