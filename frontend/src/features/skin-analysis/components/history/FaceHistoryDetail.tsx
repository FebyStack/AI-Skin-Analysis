import { useEffect, useState } from "react";
import { listImagesFor } from "../../pwa/local-store";
import { FACE_DIMENSIONS, type FaceReport } from "@shared/face";
import { FindingOverlay } from "../results/FindingOverlay";

export interface HistoryRef {
  id: string;
  source: "local" | "server";
  createdAt: number;
  report: unknown;
}

interface AngleImage {
  angle: string;
  url: string; // server endpoint URL or blob: object URL (revoked on unmount)
}

// Photos live in Postgres (scan_images bytea) for synced scans and in IndexedDB
// for offline ones — resolve either into displayable URLs.
async function resolveImages(scanId: string, source: "local" | "server"): Promise<AngleImage[]> {
  if (source === "server") {
    try {
      const res = await fetch(`/api/face-scans/${scanId}`, { credentials: "include" });
      if (!res.ok) return [];
      const j = (await res.json()) as { angles?: { angle: string }[] };
      return (j.angles ?? []).map((a) => ({
        angle: a.angle,
        url: `/api/face-scans/${scanId}/images/${a.angle}`,
      }));
    } catch {
      return [];
    }
  }
  const imgs = await listImagesFor(scanId).catch(() => []);
  return imgs.map((i) => ({ angle: i.angle, url: URL.createObjectURL(i.jpeg) }));
}

function frontish(images: AngleImage[]): AngleImage | undefined {
  return images.find((i) => i.angle === "front") ?? images[0];
}

const asReport = (r: unknown): FaceReport | null =>
  r && typeof r === "object" && (r as FaceReport).dimensions ? (r as FaceReport) : null;

export function FaceHistoryDetail({ scan, previous }: { scan: HistoryRef; previous: HistoryRef | null }) {
  const [images, setImages] = useState<AngleImage[]>([]);
  const [prevFront, setPrevFront] = useState<AngleImage | null>(null);

  useEffect(() => {
    let alive = true;
    const created: string[] = [];
    (async () => {
      const own = await resolveImages(scan.id, scan.source);
      if (!alive) return;
      created.push(...own.filter((i) => i.url.startsWith("blob:")).map((i) => i.url));
      setImages(own);
      if (previous) {
        const prev = await resolveImages(previous.id, previous.source);
        if (!alive) return;
        const f = frontish(prev) ?? null;
        if (f?.url.startsWith("blob:")) created.push(f.url);
        setPrevFront(f);
      }
    })();
    return () => {
      alive = false;
      created.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [scan.id, scan.source, previous?.id]);

  const report = asReport(scan.report);
  const prevReport = previous ? asReport(previous.report) : null;
  const front = frontish(images);
  const delta =
    report && prevReport ? Math.round((report.overall.score - prevReport.overall.score) * 100) : null;

  return (
    <div className="border-t border-hairline px-4 pb-4 pt-3">
      {/* Before / after — previous scan of the same patient vs this one */}
      {previous && prevFront && front && (
        <div className="mb-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-gold">Before / after</p>
          <div className="grid grid-cols-2 gap-3">
            {[
              { img: prevFront, label: "Before", date: previous.createdAt, r: prevReport },
              { img: front, label: "After", date: scan.createdAt, r: report },
            ].map(({ img, label, date, r }) => (
              <figure key={label}>
                <img src={img.url} alt={`${label} — front`} className="aspect-[3/4] w-full rounded-xl object-cover" />
                <figcaption className="mt-1 text-xs text-ink-secondary">
                  {label} · <span className="font-mono">{new Date(date).toLocaleDateString()}</span>
                  {r && <> · overall {Math.round(r.overall.score * 100)}%</>}
                </figcaption>
              </figure>
            ))}
          </div>
          {delta !== null && (
            <p className="mt-2 text-xs text-ink-secondary">
              Overall change: <span className="font-mono">{delta > 0 ? `+${delta}` : delta}%</span>
              {delta < 0 ? " (improved)" : delta > 0 ? " (more pronounced)" : " (no change)"}
            </p>
          )}
        </div>
      )}

      {/* All captured angles */}
      {images.length > 0 ? (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {images.map((i) => (
            <figure key={i.angle} className="shrink-0">
              <img src={i.url} alt={i.angle} className="h-24 w-[4.5rem] rounded-lg object-cover" />
              <figcaption className="mt-0.5 text-center text-[10px] text-ink-tertiary">{i.angle}</figcaption>
            </figure>
          ))}
        </div>
      ) : (
        <p className="text-xs text-ink-tertiary">No images available for this scan.</p>
      )}

      {report?.marks !== undefined ? <FindingOverlay report={report} images={images} /> : null}

      {/* Results */}
      {report && (
        <div className="mt-3">
          {report.skinType && (
            <p className="mb-2 text-xs text-ink-secondary">
              Skin type: <span className="capitalize text-ink">{report.skinType.type}</span>
            </p>
          )}
          <ul className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
            {FACE_DIMENSIONS.map((d) => (
              <li key={d} className="flex items-center justify-between gap-2 text-xs">
                <span className="capitalize text-ink-secondary">{d}</span>
                <span className="font-mono tabular-nums text-ink">
                  {Math.round(report.dimensions[d].score * 100)}%
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
