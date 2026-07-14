import type { LesionAnalysis, LesionExplanation, ReferralUrgency } from "@shared/lesion";

interface Props {
  analysis: LesionAnalysis;
  explanation: LesionExplanation;
}

const URGENCY_STYLES: Record<ReferralUrgency, string> = {
  urgent: "bg-red-50 border-red-300 text-red-900",
  soon: "bg-amber-50 border-amber-300 text-amber-900",
  routine: "bg-stone-50 border-stone-300 text-stone-800",
};

const pct = (n: number) => `${Math.round(n * 100)}%`;

// Below this, the classification ran on the whole photo, not a detected/cropped
// lesion — worth a real, visible caveat, not just small print in the header.
const LOW_LOCALIZATION_THRESHOLD = 0.5;

export function LesionResultView({ analysis, explanation }: Props) {
  // First lesion drives the headline; whole-image fallback means one entry.
  const primary = analysis.lesions[0]?.classification;
  const localization = analysis.lesions[0]?.localizationConfidence ?? 1;
  const lowLocalization = analysis.wholeImageFallback || localization < LOW_LOCALIZATION_THRESHOLD;

  return (
    <section className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6">
      <header className="text-center">
        <h2 className="text-xl font-bold text-stone-900 sm:text-2xl">
          {primary?.predicted ?? "Inconclusive analysis"}
        </h2>
        <p className="mt-1 text-sm text-stone-500">
          Automated visual assessment · model {analysis.model.classifier}
        </p>
      </header>

      {lowLocalization && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" role="status">
          <strong className="font-semibold">This result covers the whole photo</strong>, not a specific
          spot — we couldn't automatically identify a single lesion to focus on. For a more precise
          result, try a closer, well-lit photo centered on the area of concern.
        </div>
      )}

      {explanation.referral.recommended && (
        <div
          className={`rounded-xl border p-4 text-sm ${URGENCY_STYLES[explanation.referral.urgency]}`}
          role="alert"
        >
          <strong className="font-semibold">Please see a professional</strong> — {explanation.referral.reason}
        </div>
      )}

      {explanation.source === "builtin" && (
        <div className="rounded-lg bg-stone-100 p-3 text-sm text-stone-600">
          Showing built-in guidance — enhanced AI explanation is unavailable offline.
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold text-stone-700">Top matches</h3>
          <ul className="mt-2 space-y-2">
            {(primary?.top ?? []).map((t) => (
              <li key={t.label}>
                <div className="flex justify-between text-sm">
                  <span className="text-stone-800">{t.label}</span>
                  <span className="tabular-nums text-stone-500">{pct(t.confidence)}</span>
                </div>
                <div className="mt-1 h-2 w-full rounded-full bg-stone-200">
                  <div className="h-2 rounded-full bg-clinical" style={{ width: pct(t.confidence) }} />
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-stone-700">What this means</h3>
            <p className="mt-1 text-sm leading-relaxed text-stone-700">{explanation.patientSummary}</p>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-stone-700">Learn more</h3>
            <p className="mt-1 text-sm leading-relaxed text-stone-700">{explanation.education}</p>
          </div>
        </div>
      </div>

      <p className="border-t border-stone-200 pt-4 text-xs text-stone-400">{explanation.disclaimer}</p>
    </section>
  );
}
