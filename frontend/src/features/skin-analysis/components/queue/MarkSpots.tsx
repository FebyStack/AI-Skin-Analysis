import { useEffect, useState, type MouseEvent } from "react";
import type { ManualPoint } from "@shared/face";

const ZOOMS = [1, 2, 3];

/** Staff ground truth: tap each real acne spot on one photo. Feeds the localization exam. */
export function MarkSpots({ scanId, angle, src }: { scanId: string; angle: string; src: string }) {
  const [points, setPoints] = useState<ManualPoint[]>([]);
  const [status, setStatus] = useState<"loading" | "idle" | "saving" | "saved" | "error">("loading");
  const [zoom, setZoom] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  // Distinct from `status`: a save can fail (status "error") after a perfectly good
  // load, and that must not freeze tapping/saving — only a load that never
  // succeeded may do that. `loaded` tracks "do we have real ground truth yet?".
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let live = true;
    setStatus("loading");
    fetch(`/api/face-scans/${scanId}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("load failed"))))
      .then((j: { angles?: { angle: string; manualMarks?: ManualPoint[] | null }[] }) => {
        if (!live) return;
        setPoints(j.angles?.find((a) => a.angle === angle)?.manualMarks ?? []);
        setLoaded(true);
        setStatus("idle");
      })
      .catch(() => live && setStatus("error"));
    return () => {
      live = false;
    };
  }, [scanId, angle, reloadKey]);

  // A tap always adds a point — adjacent lesions must both be markable. A marker
  // removes itself only via its own button (below), never by a nearby tap.
  function addPoint(e: MouseEvent<HTMLDivElement>) {
    if (!loaded) return; // nothing real to add to until the load succeeds
    const box = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - box.left) / box.width;
    const y = (e.clientY - box.top) / box.height;
    if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) return;
    setPoints([...points, { kind: "acne", x, y }]);
    setStatus("idle");
  }

  function removePoint(i: number) {
    if (!loaded) return;
    setPoints(points.filter((_, idx) => idx !== i));
    setStatus("idle");
  }

  async function save() {
    if (!loaded) return; // never overwrite ground truth unless a load has succeeded
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
        Tap every acne spot you can see; tap a marker's dot to remove it. These marks test the detector's accuracy.
      </p>
      <div className="mt-2 flex items-center gap-1">
        {ZOOMS.map((z) => (
          <button
            key={z}
            type="button"
            onClick={() => setZoom(z)}
            className={`min-h-[32px] rounded-lg px-2 text-xs font-medium ${
              zoom === z ? "bg-gold text-gold-ink" : "border border-hairline-strong bg-surface-raised text-ink-secondary"
            }`}
          >
            {z}×
          </button>
        ))}
      </div>
      <div className="relative mt-2 max-h-[70vh] overflow-auto rounded-xl border border-hairline">
        <div
          className="relative cursor-crosshair touch-manipulation"
          style={{ width: `${zoom * 100}%` }}
          onClick={addPoint}
          data-testid="mark-surface"
        >
          <img src={src} alt={`${angle} photo to mark`} className="block w-full select-none" draggable={false} />
          {points.map((p, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Remove spot ${i + 1}`}
              onClick={(e) => {
                e.stopPropagation();
                removePoint(i);
              }}
              className="absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-gold bg-transparent"
              style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
            />
          ))}
        </div>
      </div>
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          className="btn-primary px-4"
          onClick={save}
          disabled={status === "saving" || status === "loading" || !loaded}
        >
          Save marks
        </button>
        {status === "error" && !loaded && (
          <button type="button" className="btn-secondary px-3 text-xs" onClick={() => setReloadKey((k) => k + 1)}>
            Retry
          </button>
        )}
        <span className="text-xs text-ink-secondary" role="status" aria-live="polite">{message}</span>
      </div>
    </div>
  );
}
