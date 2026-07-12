import type { Verdict } from "../../types";
import type { AnalysisReport } from "@shared/contract";
import { FacialMap } from "./FacialMap";
import { DimensionGrid } from "./DimensionGrid";
import { FindingsList } from "./FindingsList";
import { DerivedViews } from "./DerivedViews";
import { INCONCLUSIVE_DETAIL } from "@ai/shared/verdict";

export function ReportView({
  report,
  verdict,
  onNewScan,
  capturedBlob,
  reportUnavailable,
}: {
  report: AnalysisReport | null;
  verdict: Verdict;
  onNewScan: () => void;
  capturedBlob?: Blob;
  reportUnavailable?: boolean;
}) {
  const showConditionDetails = !verdict.inconclusive;

  return (
    <div data-print-root className="mx-auto max-w-2xl space-y-6">
      {verdict.degraded === "classifier-only" && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800" role="status">
          Partial analysis — AI review pending. Re-analyze when back online.
        </div>
      )}
      {reportUnavailable && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800" role="alert">
          Couldn't load the full report right now — the summary below is still accurate. Try
          reloading in a moment.
        </div>
      )}

      <section className="rounded-2xl border border-warm-border bg-warm-surface p-5">
        <h2 className="text-xs font-bold uppercase tracking-wider text-clinical">Scan result</h2>
        <p className="mt-2 text-lg font-bold text-stone-900">{verdict.summary}</p>
        {verdict.inconclusive && (
          <p className="mt-2 text-sm leading-relaxed text-stone-600">{INCONCLUSIVE_DETAIL}</p>
        )}
        {report && showConditionDetails && (
          <p className="mt-2 text-sm text-stone-600">
            Skin type: <strong>{report.skinType.sebum}</strong>
            {report.skinType.sensitivityCues && ", sensitivity cues present"} · Fitzpatrick ~
            {report.skinType.fitzpatrickApprox} (approximate)
          </p>
        )}
      </section>

      {showConditionDetails && (
        <section>
          <h3 className="mb-2 text-sm font-bold text-stone-900">Facial map</h3>
          <FacialMap findings={verdict.findings} />
          {report && report.zoneObservations.length > 0 && (
            <ul className="mt-2 space-y-1">
              {report.zoneObservations.map((z) => (
                <li key={z.zone} className="text-xs text-stone-600">
                  <strong className="text-stone-800">{z.zone}:</strong> {z.observation}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {capturedBlob && (
        <section>
          <h3 className="mb-2 text-sm font-bold text-stone-900">Imaging views</h3>
          <DerivedViews blob={capturedBlob} />
        </section>
      )}

      {report && showConditionDetails && (
        <section>
          <h3 className="mb-2 text-sm font-bold text-stone-900">Report dimensions</h3>
          <DimensionGrid dimensions={report.dimensions} />
        </section>
      )}

      {showConditionDetails && (
        <section>
          <h3 className="mb-2 text-sm font-bold text-stone-900">Findings</h3>
          <FindingsList findings={verdict.findings} />
        </section>
      )}

      <p className="rounded-xl bg-clinical-soft p-3 text-xs text-stone-700">
        <strong>This is not a diagnosis.</strong> This tool helps decide whether to see a
        professional — it cannot replace one.
      </p>

      <div className="flex gap-3 print:hidden">
        <button
          onClick={() => window.print()}
          className="flex-1 rounded-lg bg-clinical py-3 text-sm font-semibold text-white"
        >
          Download PDF
        </button>
        <button
          onClick={onNewScan}
          className="flex-1 rounded-lg border border-clinical py-3 text-sm font-semibold text-clinical"
        >
          New scan
        </button>
      </div>
    </div>
  );
}
