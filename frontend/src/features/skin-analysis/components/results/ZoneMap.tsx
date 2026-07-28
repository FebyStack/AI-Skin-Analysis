import { Suspense, lazy, useMemo, useState } from "react";
import type { FaceDimension, FaceReport } from "@shared/face";
import { FACE_DIMENSIONS } from "@shared/face";
import { isMemoryConstrained } from "@ai/face/segmentation/parser";
import { SEVERITY_COLOR, severityOf } from "@/motion/tokens";
import type { ZoneScore } from "./FaceZoneMap3D";

// three.js is ~150KB gzipped — it must never sit in the main bundle, and it is
// only ever fetched on a device that will actually render it.
const FaceZoneMap3D = lazy(() => import("./FaceZoneMap3D"));

/** WebGL on a machine with headroom. Low-memory phones keep the 2D bars. */
function can3D(): boolean {
  if (typeof window === "undefined") return false;
  if (isMemoryConstrained()) return false;
  try {
    const c = document.createElement("canvas");
    return Boolean(c.getContext("webgl2") ?? c.getContext("webgl"));
  } catch {
    return false;
  }
}

/** Always rendered: the zone data as text + bars. The 3D view is a garnish on top. */
function ZoneBars({ zones, label }: { zones: ZoneScore[]; label: string }) {
  return (
    <ul className="space-y-2">
      {zones.map((z) => (
        <li key={z.zone} className="grid grid-cols-[7rem_1fr_2.5rem] items-center gap-2">
          <span className="truncate text-xs capitalize text-ink-secondary">
            {z.zone.replace(/-/g, " ")}
          </span>
          <span className="h-1.5 rounded-full bg-surface">
            <span
              className="block h-full rounded-full transition-[width] duration-500 ease-spring"
              style={{ width: `${Math.round(z.score * 100)}%`, background: SEVERITY_COLOR[severityOf(z.score)] }}
            />
          </span>
          <span className="text-right text-xs tabular-nums text-ink-tertiary">
            {Math.round(z.score * 100)}
          </span>
        </li>
      ))}
      <li className="sr-only">These are {label} scores per facial zone, 0 to 100.</li>
    </ul>
  );
}

/**
 * Where the analysis lands on the face, per dimension. The bars are the source
 * of truth and are always present; the 3D head is an optional spatial read of
 * the same numbers for clinicians showing results to a patient.
 */
export function ZoneMap({ report }: { report: FaceReport }) {
  const [dimension, setDimension] = useState<FaceDimension>(FACE_DIMENSIONS[0]);
  // Capability is a property of the device, not of the render — check it once.
  const [enabled3D] = useState(can3D);

  const zones = useMemo<ZoneScore[]>(
    () => report.dimensions[dimension]?.perZone ?? [],
    [report, dimension],
  );

  if (zones.length === 0) return null;

  return (
    <section className="card p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[1.0625rem] font-semibold text-ink">Zone map</h2>
        <label className="text-xs text-ink-tertiary">
          <span className="sr-only">Dimension</span>
          <select
            value={dimension}
            onChange={(e) => setDimension(e.target.value as FaceDimension)}
            className="field-select capitalize"
          >
            {FACE_DIMENSIONS.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-4 grid gap-5 md:grid-cols-2 md:items-center">
        <ZoneBars zones={zones} label={dimension} />
        {enabled3D && (
          <Suspense
            fallback={<div className="h-40 animate-pulse rounded-2xl border border-hairline bg-surface/40" />}
          >
            <FaceZoneMap3D zones={zones} label={dimension} />
          </Suspense>
        )}
      </div>
    </section>
  );
}
