import { useState } from "react";
import { QUALITY_MIN_SCORE, type QualityResult } from "@shared/image-quality";
import { ConfirmDialog } from "./ConfirmDialog";
import { CheckIcon, CrossIcon, WarningIcon } from "../ui/icons";

export interface QueueAngle {
  angle: string;
  qualityScore: QualityResult | null;
}

const ZOOMS = [1, 1.5, 2, 3];

function QualityPanel({ result }: { result: QualityResult | null }) {
  if (!result) {
    return <p className="text-xs text-ink-tertiary">No quality metrics for this capture.</p>;
  }
  const low = result.score < QUALITY_MIN_SCORE;
  return (
    <div>
      <ul className="space-y-1">
        {result.checks.map((c) => (
          <li key={c.key} className="flex items-center justify-between gap-2 text-xs">
            <span className="flex items-center gap-1.5">
              <span className={c.ok ? "text-ok" : "text-urgent"}>{c.ok ? <CheckIcon /> : <CrossIcon />}</span>
              <span className="text-ink-secondary">{c.label}</span>
            </span>
            <span className="font-mono tabular-nums text-ink-tertiary">{c.detail}</span>
          </li>
        ))}
      </ul>
      <div className="mt-3 border-t border-hairline pt-2">
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-ink-secondary">Overall Quality</span>
          <span
            className={`font-mono text-lg font-semibold tabular-nums ${
              low ? "text-urgent" : "text-gold-bright"
            }`}
          >
            {result.score}/100
          </span>
        </div>
        {low && (
          <p className="mt-1 flex items-center gap-1 text-[11px] text-urgent"><WarningIcon size={10} />
            Below the {QUALITY_MIN_SCORE}/100 threshold — consider retaking before approving.
          </p>
        )}
      </div>
    </div>
  );
}

export function ImageManager({
  scanId,
  angles,
  onImageDeleted,
  onScanDeleted,
  wasExported,
}: {
  scanId: string;
  angles: QueueAngle[];
  onImageDeleted: (angle: string) => void;
  onScanDeleted: () => void;
  wasExported: boolean;
}) {
  const [active, setActive] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [confirm, setConfirm] = useState<"image" | "scan" | null>(null);
  const [busy, setBusy] = useState(false);

  const current = angles[Math.min(active, angles.length - 1)];
  const src = current ? `/api/face-scans/${scanId}/images/${current.angle}` : "";

  const deleteImage = async () => {
    if (!current) return;
    setBusy(true);
    const r = await fetch(`/api/training-queue/${scanId}/images/${current.angle}`, {
      method: "DELETE",
      credentials: "include",
    });
    setBusy(false);
    setConfirm(null);
    if (r.ok) {
      setActive(0);
      onImageDeleted(current.angle);
    }
  };

  const deleteScan = async () => {
    setBusy(true);
    const r = await fetch(`/api/training-queue/${scanId}`, {
      method: "DELETE",
      credentials: "include",
    });
    setBusy(false);
    setConfirm(null);
    if (r.ok) onScanDeleted();
  };

  if (angles.length === 0) {
    return <p className="text-sm text-ink-secondary">All images for this scan have been archived.</p>;
  }

  return (
    <div className="grid gap-4 sm:grid-cols-[1fr_13rem]">
      <div>
        {/* Viewer */}
        <div className="relative aspect-[3/4] w-full overflow-hidden rounded-xl border border-hairline bg-black">
          <img
            src={src}
            alt={current?.angle ?? ""}
            className="h-full w-full object-contain transition-transform"
            style={{ transform: `scale(${zoom}) rotate(${rotation}deg)` }}
          />
        </div>

        {/* Viewer controls */}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            {ZOOMS.map((z) => (
              <button
                key={z}
                onClick={() => setZoom(z)}
                className={`min-h-[32px] rounded-lg px-2 text-xs font-medium ${
                  zoom === z
                    ? "bg-gold text-gold-ink"
                    : "border border-hairline-strong bg-surface-raised text-ink-secondary"
                }`}
              >
                {z}×
              </button>
            ))}
          </div>
          <button
            onClick={() => setRotation((r) => (r + 90) % 360)}
            className="btn-secondary min-h-[32px] px-2 text-xs"
          >
            Rotate 90°
          </button>
          <a
            href={src}
            download={`${scanId}-${current?.angle ?? "image"}.jpg`}
            className="btn-secondary min-h-[32px] px-2 text-xs"
          >
            Download Original
          </a>
          <button
            onClick={() => setConfirm("image")}
            disabled={busy}
            className="min-h-[32px] rounded-lg border border-urgent-edge bg-urgent-surface px-2 text-xs font-medium text-urgent disabled:opacity-50"
          >
            Archive Image
          </button>
          <button
            onClick={() => setConfirm("scan")}
            disabled={busy}
            className="min-h-[32px] rounded-lg border border-urgent-edge bg-urgent-surface px-2 text-xs font-medium text-urgent disabled:opacity-50"
          >
            Delete Scan
          </button>
        </div>

        {/* Angle switcher */}
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {angles.map((a, i) => {
            const low = a.qualityScore && a.qualityScore.score < QUALITY_MIN_SCORE;
            return (
              <button
                key={a.angle}
                onClick={() => {
                  setActive(i);
                  setZoom(1);
                  setRotation(0);
                }}
                className={`shrink-0 rounded-lg border p-1 ${
                  i === active ? "border-gold" : "border-hairline"
                }`}
              >
                <img
                  src={`/api/face-scans/${scanId}/images/${a.angle}`}
                  alt={a.angle}
                  className="h-16 w-12 rounded object-cover"
                />
                <span className="mt-0.5 block text-center text-[10px] text-ink-tertiary">
                  {low && <WarningIcon size={9} />}
                  {a.angle}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Quality for the selected angle */}
      <section className="card p-3">
        <h4 className="mb-2 text-sm font-semibold text-ink">Image Quality</h4>
        <QualityPanel result={current?.qualityScore ?? null} />
      </section>

      {confirm === "image" && (
        <ConfirmDialog
          title="Archive only this image?"
          body="It is removed from this scan but recoverable from the Archive for 30 days, after which it is deleted permanently. The other angles are kept."
          onCancel={() => setConfirm(null)}
          onConfirm={deleteImage}
        />
      )}
      {confirm === "scan" && (
        <ConfirmDialog
          title="Delete the entire scan session?"
          body="This removes all images, AI predictions and reviewer annotations."
          warning={
            wasExported
              ? "This scan has already been used for training. It will be excluded from future training but cannot be removed from already-trained models."
              : null
          }
          onCancel={() => setConfirm(null)}
          onConfirm={deleteScan}
        />
      )}
    </div>
  );
}
