import type { FaceReport, FaceDimension } from "@shared/face";
import { FACE_DIMENSIONS } from "@shared/face";
import { ZoneMap } from "./ZoneMap";
import { useReveal } from "@/motion/useReveal";

interface Props {
  report: FaceReport;
}

export function FaceReportView({ report }: Props) {
  // Staggered reveal of the report sections. GSAP animates *from* an offset, so
  // every section is in the DOM and readable even if motion is suppressed.
  const scope = useReveal<HTMLDivElement>([report]);

  return (
    <div ref={scope} className="mx-auto max-w-5xl space-y-6 px-4">
      {/* Overall */}
      <section data-reveal className="card p-6 text-center">
        <h2 className="text-[1.0625rem] font-semibold text-ink">Overall Skin Score</h2>
        <div className="mt-3 font-mono text-6xl font-bold tabular-nums text-gold-bright">
          {Math.round(report.overall.score * 100)}
        </div>
        <p className="mt-2 text-sm text-ink-secondary">
          Confidence: <span className="font-mono tabular-nums">{Math.round(report.overall.confidence * 100)}%</span>
        </p>
      </section>

      {/* Plain-language summary (Gemini when online, deterministic builtin offline) */}
      {report.explanation && (
        <section data-reveal className="card p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-[1.0625rem] font-semibold text-ink">Summary</h2>
            <span className="text-[10px] uppercase tracking-[0.1em] text-ink-tertiary">
              {report.explanation.source === "gemini" ? "AI summary" : "On-device"}
            </span>
          </div>
          <p className="mt-2 text-[0.95rem] leading-relaxed text-ink">{report.explanation.patientSummary}</p>
          {report.explanation.education && (
            <p className="mt-3 text-sm leading-relaxed text-ink-secondary">{report.explanation.education}</p>
          )}
        </section>
      )}

      {/* Skin type — only when the trained skintype model produced it */}
      {report.skinType && (
        <section data-reveal className="card p-6 text-center">
          <h2 className="text-[1.0625rem] font-semibold text-ink">Skin Type</h2>
          <div className="mt-2 font-serif text-3xl font-semibold capitalize text-gold-bright">
            {report.skinType.type}
          </div>
          <p className="mt-1 text-sm text-ink-secondary">
            Confidence: <span className="font-mono tabular-nums">{Math.round(report.skinType.confidence * 100)}%</span>
          </p>
        </section>
      )}

      {/* Dimensions */}
      <section data-reveal>
        <h2 className="mb-4 font-serif text-xl font-semibold tracking-tight text-ink">Skin Dimensions</h2>
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {FACE_DIMENSIONS.map((dimension) => (
            <DimensionCard
              key={dimension}
              name={dimension}
              score={report.dimensions[dimension].score}
              confidence={report.dimensions[dimension].confidence}
              source={report.dimensions[dimension].source}
            />
          ))}
        </ul>
      </section>

      {/* Zone map — where on the face each dimension concentrates */}
      <div data-reveal>
        <ZoneMap report={report} />
      </div>

      {/* Recommendations */}
      <section data-reveal className="card p-6">
        <h2 className="text-[1.0625rem] font-semibold text-ink">Recommendations</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-ink-secondary marker:text-gold">
          {report.recommendations.skincare.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>

        {report.recommendations.treatments.length > 0 && (
          <>
            <h3 className="mt-5 font-medium text-ink">Professional options</h3>
            <ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-ink-secondary marker:text-gold">
              {report.recommendations.treatments.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </>
        )}
      </section>

      {/* Disclaimer */}
      <section className="border-t border-hairline pt-4 text-xs leading-relaxed text-ink-tertiary">
        {report.disclaimer}
      </section>
    </div>
  );
}

function DimensionCard({
  name,
  score,
  confidence,
  source,
}: {
  name: FaceDimension;
  score: number;
  confidence: number;
  source?: "model" | "heuristic";
}) {
  // Only a trained head produces a real confidence. For the rest `confidence`
  // is zone coverage, and printing it as "Confidence: 100%" overstated a pixel
  // estimate as a certainty.
  const modelled = source === "model";
  return (
    <li className="card p-4">
      <h3 className="font-medium capitalize text-ink">{name}</h3>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
        <div
          className={`h-full rounded-full ${modelled ? "bg-gold" : "bg-gold/40"}`}
          style={{ width: `${score * 100}%` }}
        />
      </div>
      <p className="mt-2 text-sm text-ink">
        Score: <span className="font-mono tabular-nums">{Math.round(score * 100)}%</span>
      </p>
      <p className="text-xs text-ink-tertiary">
        {modelled ? (
          <>
            Confidence: <span className="font-mono tabular-nums">{Math.round(confidence * 100)}%</span>
          </>
        ) : (
          "Visual estimate — not a trained measurement"
        )}
      </p>
    </li>
  );
}
