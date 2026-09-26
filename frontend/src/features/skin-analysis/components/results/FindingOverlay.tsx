import { useMemo, useState } from "react";
import type { FaceReport, MarkKind } from "@shared/face";

const LABEL: Record<MarkKind, string> = {
  acne: "Acne spots", "dark-spot": "Dark spots", redness: "Redness", shine: "Shine",
  "under-eye": "Under-eye", wrinkle: "Wrinkles", "eye-bag": "Eye bags",
};

/** Staff view: the captured photos with each finding's position drawn on top. */
export function FindingOverlay({ report, images }: { report: FaceReport; images: { angle: string; url: string }[] }) {
  const marks = report.marks ?? [];
  const [angle, setAngle] = useState(
    () => images.find((i) => marks.some((m) => m.angle === i.angle))?.angle ?? images[0]?.angle,
  );
  const [hidden, setHidden] = useState<Set<MarkKind>>(new Set());
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const kinds = useMemo(() => [...new Set(marks.map((m) => m.kind))], [marks]);
  const image = images.find((i) => i.angle === angle);
  if (!image) return null;
  const here = marks.filter((m) => m.angle === angle);
  const shown = here.filter((m) => !hidden.has(m.kind));

  const toggle = (k: MarkKind) =>
    setHidden((h) => {
      const next = new Set(h);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  return (
    <section className="card mx-auto mt-6 max-w-3xl p-5" aria-label="Finding locations">
      <h3 className="text-base font-semibold text-ink">Where findings are</h3>
      <p className="mt-1 text-xs text-ink-secondary">
        Staff view. Model markers are estimates until clinic accuracy is measured.
      </p>

      {images.length > 1 && (
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Photo angle">
          {images.map((i) => (
            <button
              key={i.angle}
              type="button"
              aria-pressed={i.angle === angle}
              onClick={() => { setAngle(i.angle); setSize(null); }}
              className={`min-h-[32px] px-3 text-xs ${i.angle === angle ? "btn-primary" : "btn-secondary"}`}
            >
              {i.angle}
            </button>
          ))}
        </div>
      )}

      <div className="relative mt-3">
        <img
          src={image.url}
          alt={`${image.angle} photo`}
          className="block w-full rounded-xl"
          onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
        />
        {size && (
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full text-gold"
            viewBox={`0 0 ${size.w} ${size.h}`}
            aria-hidden="true"
          >
            {shown.map((m, i) =>
              m.shape.type === "box" ? (
                <circle
                  key={i}
                  cx={(m.shape.x + m.shape.w / 2) * size.w}
                  cy={(m.shape.y + m.shape.h / 2) * size.h}
                  r={Math.max(6, (Math.max(m.shape.w * size.w, m.shape.h * size.h) / 2) * 1.3)}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={Math.max(2, size.w / 400)}
                />
              ) : null,
            )}
          </svg>
        )}
      </div>

      {here.length === 0 ? (
        <p className="mt-3 text-xs text-ink-tertiary">No spots marked on this photo.</p>
      ) : (
        <ul className="mt-3 flex flex-wrap gap-2">
          {kinds.map((k) => (
            <li key={k}>
              <button type="button" aria-pressed={!hidden.has(k)} onClick={() => toggle(k)} className="btn-secondary min-h-[32px] px-3 text-xs">
                {LABEL[k]}: {here.filter((m) => m.kind === k).length} on this photo
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
