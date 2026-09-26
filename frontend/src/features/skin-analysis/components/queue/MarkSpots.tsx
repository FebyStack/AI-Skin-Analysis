import { useEffect, useState, type MouseEvent } from "react";
import type { ManualPoint } from "@shared/face";

/** Staff ground truth: tap each real acne spot on one photo. Feeds the localization exam. */
export function MarkSpots({ scanId, angle, src }: { scanId: string; angle: string; src: string }) {
  const [points, setPoints] = useState<ManualPoint[]>([]);
  const [status, setStatus] = useState<"loading" | "idle" | "saving" | "saved" | "error">("loading");

  useEffect(() => {
    let live = true;
    setStatus("loading");
    fetch(`/api/face-scans/${scanId}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("load failed"))))
      .then((j: { angles?: { angle: string; manualMarks?: ManualPoint[] | null }[] }) => {
        if (!live) return;
        setPoints(j.angles?.find((a) => a.angle === angle)?.manualMarks ?? []);
        setStatus("idle");
      })
      .catch(() => live && setStatus("error"));
    return () => {
      live = false;
    };
  }, [scanId, angle]);

  function tap(e: MouseEvent<HTMLDivElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - box.left) / box.width;
    const y = (e.clientY - box.top) / box.height;
    if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) return;
    // A tap within 3% of an existing marker removes it; otherwise it adds one.
    const near = points.findIndex((p) => Math.hypot(p.x - x, p.y - y) < 0.03);
    setPoints(near >= 0 ? points.filter((_, i) => i !== near) : [...points, { kind: "acne", x, y }]);
    setStatus("idle");
  }

  async function save() {
    setStatus("saving");
    const r = await fetch(`/api/face-scans/${scanId}/images/${angle}/marks`, {
      method: "PUT",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ points }),
    }).catch(() => null);
    setStatus(r?.ok ? "saved" : "error");
  }

  const message =
    status === "loading" ? "Loading…"
      : status === "saved" ? `Saved ${points.length} spot${points.length === 1 ? "" : "s"}.`
        : status === "error" ? "Could not load or save — try again."
          : `${points.length} marked`;

  return (
    <div>
      <p className="text-xs text-ink-secondary">
        Tap every acne spot you can see; tap a marker again to remove it. These marks test the detector's accuracy.
      </p>
      <div className="relative mt-2 cursor-crosshair touch-manipulation" onClick={tap} data-testid="mark-surface">
        <img src={src} alt={`${angle} photo to mark`} className="block w-full select-none rounded-xl" draggable={false} />
        {points.map((p, i) => (
          <span
            key={i}
            aria-hidden="true"
            className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-gold"
            style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
          />
        ))}
      </div>
      <div className="mt-2 flex items-center gap-3">
        <button type="button" className="btn-primary px-4" onClick={save} disabled={status === "saving" || status === "loading"}>
          Save marks
        </button>
        <span className="text-xs text-ink-secondary" role="status" aria-live="polite">{message}</span>
      </div>
    </div>
  );
}
