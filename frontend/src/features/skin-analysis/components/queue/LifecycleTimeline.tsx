import { useEffect, useState } from "react";
import { EVENT_LABEL, describeEvent, type ScanEvent } from "@shared/lifecycle";
import { scanEvents } from "../../api/queue-client";

const fmt = (ms: number) =>
  new Date(ms).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

// Warnings and destructive steps read differently from the happy path.
const TONE: Record<string, string> = {
  warning: "bg-soon text-soon-ink",
  rejected: "bg-urgent text-urgent-ink",
  purged: "bg-urgent text-urgent-ink",
  approved: "bg-ok text-canvas",
};

/** Where an image has been: captured → analyzed → reviewed → dataset → trained. */
export function LifecycleTimeline({ scanId }: { scanId: string }) {
  const [events, setEvents] = useState<ScanEvent[] | null>(null);

  useEffect(() => {
    let alive = true;
    scanEvents(scanId).then((e) => alive && setEvents(e));
    return () => {
      alive = false;
    };
  }, [scanId]);

  if (!events) return <p className="text-xs text-ink-tertiary">Loading history…</p>;
  if (events.length === 0) return <p className="text-xs text-ink-tertiary">No history recorded yet.</p>;

  return (
    <ol className="space-y-3">
      {events.map((e) => (
        <li key={e.id} className="flex gap-3">
          <span
            className={`mt-1 h-2 w-2 shrink-0 rounded-full ${TONE[e.kind] ?? "bg-gold"}`}
            aria-hidden
          />
          <div className="min-w-0">
            <p className="text-xs font-medium text-ink">
              {EVENT_LABEL[e.kind] ?? e.kind}
              {e.actor && <span className="font-normal text-ink-tertiary"> · {e.actor}</span>}
            </p>
            <p className="text-[11px] text-ink-secondary">{describeEvent(e)}</p>
            <p className="text-[11px] tabular-nums text-ink-tertiary">{fmt(e.at)}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
