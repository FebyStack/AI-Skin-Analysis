import { useState, type ReactNode } from "react";
import type { ScanConsent } from "@shared/training-governance";

// Two INDEPENDENT consents, captured before every scan.
//   • Analysis consent is required — no scan without it.
//   • Training consent is optional and is the only gate into the Training Queue.
// They are deliberately not bundled: agreeing to be analyzed is not agreeing to
// have your images kept for model training.
export function ScanConsentGate({
  children,
  onConsent,
}: {
  children: ReactNode;
  onConsent: (c: ScanConsent) => void;
}) {
  const [analysis, setAnalysis] = useState(false);
  const [training, setTraining] = useState(false);
  const [done, setDone] = useState(false);

  if (done) return <>{children}</>;

  return (
    <div className="card mx-auto max-w-md animate-rise p-6">
      <h2 className="font-serif text-xl font-semibold tracking-tight text-ink">Before we scan</h2>
      <p className="mt-2 text-sm leading-relaxed text-ink-secondary">
        Analysis runs on this device. <strong className="font-semibold text-ink">This is not a
        diagnosis</strong> — it helps decide whether to see a professional.
      </p>

      <div className="mt-5 space-y-3">
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-hairline bg-surface p-3">
          <input
            type="checkbox"
            checked={analysis}
            onChange={(e) => setAnalysis(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[color:var(--gold,#c9a24b)]"
          />
          <span className="text-sm text-ink">
            Consent for AI Skin Analysis
            <span className="mt-0.5 block text-xs text-ink-tertiary">
              Required. Your photos are analyzed to produce this report.
            </span>
          </span>
        </label>

        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-hairline bg-surface p-3">
          <input
            type="checkbox"
            checked={training}
            onChange={(e) => setTraining(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[color:var(--gold,#c9a24b)]"
          />
          <span className="text-sm text-ink">
            Consent to use anonymized images for future AI training
            <span className="mt-0.5 block text-xs text-ink-tertiary">
              Optional. You can be scanned without agreeing to this — declining only means your
              images are never used to improve the model.
            </span>
          </span>
        </label>
      </div>

      <button
        onClick={() => {
          onConsent({ analysis, training });
          setDone(true);
        }}
        disabled={!analysis}
        className="btn-primary mt-5 w-full disabled:opacity-40"
      >
        {analysis ? "Continue" : "Analysis consent is required"}
      </button>
    </div>
  );
}
