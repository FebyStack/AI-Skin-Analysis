import type { LesionAnalysis, LesionExplanation, ReferralUrgency } from "@shared/lesion";

interface Props {
  analysis: LesionAnalysis;
  explanation: LesionExplanation;
}

const URGENCY_STYLES: Record<ReferralUrgency, string> = {
  urgent: "bg-urgent-surface border-urgent-edge text-urgent",
  soon: "bg-soon-surface border-soon-edge text-soon",
  routine: "bg-routine-surface border-routine-edge text-routine",
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
    <section className="mx-auto w-full max-w-3xl animate-rise space-y-6 px-4 py-6">
      <header className="text-center">
        <h2 className="font-serif text-[clamp(1.5rem,3vw,2rem)] font-semibold tracking-tight text-ink">
          {primary?.predicted ?? "Inconclusive analysis"}
        </h2>
        <p className="mt-1.5 text-sm text-ink-secondary">
          Automated visual assessment · <span className="font-mono text-xs">{analysis.model.classifier}</span>
        </p>
      </header>

      {lowLocalization && (
        <div className="rounded-2xl border border-soon-edge bg-soon-surface p-4 text-sm text-soon" role="status">
          <strong className="font-semibold">This result covers the whole photo</strong>, not a specific
          spot — we couldn't automatically identify a single lesion to focus on. For a more precise
          result, try a closer, well-lit photo centered on the area of concern.
        </div>
      )}

      {explanation.referral.recommended && (
        <div
          className={`rounded-2xl border p-4 text-sm ${URGENCY_STYLES[explanation.referral.urgency]}`}
          role="alert"
        >
          <strong className="font-semibold">Please see a professional</strong> — {explanation.referral.reason}
        </div>
      )}

      {explanation.source === "builtin" && (
        <div className="rounded-xl border border-hairline bg-surface p-3 text-sm text-ink-secondary">
          Showing built-in guidance — enhanced AI explanation is unavailable offline.
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="card p-5">
          <h3 className="text-[1.0625rem] font-semibold text-ink">Top matches</h3>
          <ul className="mt-4 space-y-3">
            {(primary?.top ?? []).map((t) => (
              <li key={t.label}>
                <div className="flex justify-between text-sm">
                  <span className="text-ink">{t.label}</span>
                  <span className="font-mono tabular-nums text-ink-secondary">{pct(t.confidence)}</span>
                </div>
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.08]">
                  <div className="h-full rounded-full bg-gold" style={{ width: pct(t.confidence) }} />
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="card space-y-4 p-5">
          <div>
            <h3 className="text-[1.0625rem] font-semibold text-ink">What this means</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-secondary">{explanation.patientSummary}</p>
          </div>
          <div className="border-t border-hairline pt-4">
            <h3 className="text-[1.0625rem] font-semibold text-ink">Learn more</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-secondary">{explanation.education}</p>
          </div>
        </div>
      </div>

      <p className="border-t border-hairline pt-4 text-xs leading-relaxed text-ink-tertiary">{explanation.disclaimer}</p>
    </section>
  );
}
