import { useCallback, useState } from "react";
import { UploadDropzone } from "../capture/UploadDropzone";
import { LesionResultView } from "../results/LesionResultView";
import {
  listLesionScans,
  LesionAuthError,
  type LesionResult,
  type LesionScanWire,
} from "../../api/lesion-client";
import { saveLesionScan } from "../../pwa/save-flow";
import { scanPatientId } from "../../store/patient-store";

type View = "idle" | "analyzing" | "result" | "history" | "error";

export function LesionScanFlow() {
  const [view, setView] = useState<View>("idle");
  const [result, setResult] = useState<LesionResult | null>(null);
  const [history, setHistory] = useState<LesionScanWire[]>([]);
  const [error, setError] = useState<string>("");

  const onUpload = useCallback(async (file: File) => {
    setView("analyzing");
    setError("");
    try {
      const outcome = await saveLesionScan(file, file.type || "image/jpeg", scanPatientId());
      if (outcome.result) {
        setResult(outcome.result);
        setView("result");
      } else {
        // Queued offline — no result to render yet; nudge the user to history.
        setError("You're offline — your scan is queued and will sync when back online.");
        setView("error");
      }
    } catch (err) {
      if (err instanceof LesionAuthError) {
        setError("Your session expired — please log in again.");
      } else {
        setError(err instanceof Error ? err.message : "Analysis failed.");
      }
      setView("error");
    }
  }, []);

  const openHistory = useCallback(async () => {
    setView("analyzing");
    try {
      setHistory(await listLesionScans(scanPatientId()));
      setView("history");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load history.");
      setView("error");
    }
  }, []);

  const reset = useCallback(() => {
    setResult(null);
    setView("idle");
  }, []);

  if (view === "analyzing") {
    return <p className="py-8 text-center text-sm text-ink-secondary">Analyzing…</p>;
  }

  if (view === "result" && result) {
    return (
      <div className="w-full">
        <LesionResultView analysis={result.analysis} explanation={result.explanation} />
        <div className="mt-6 flex justify-center gap-3">
          <button onClick={reset} className="btn-primary px-6">New scan</button>
          <button onClick={openHistory} className="btn-secondary px-6">History</button>
        </div>
      </div>
    );
  }

  if (view === "history") {
    return (
      <div className="mx-auto w-full max-w-3xl animate-rise px-4 py-6">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-serif text-xl font-semibold tracking-tight text-ink">Scan history</h2>
          <button onClick={reset} className="btn-primary">New scan</button>
        </div>
        {history.length === 0 ? (
          <div className="card p-10 text-center">
            <p className="text-sm text-ink-secondary">No saved scans yet.</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {history.map((s) => (
              <li key={s.id}>
                <button
                  onClick={() => {
                    if (s.report?.kind === "lesion") {
                      setResult({ scan: s, analysis: s.report.analysis, explanation: s.report.explanation });
                      setView("result");
                    }
                  }}
                  className="card flex w-full items-center justify-between p-4 text-left transition-colors hover:bg-surface-raised"
                >
                  <span className="font-medium text-ink">
                    {s.report?.kind === "lesion" ? s.report.analysis.lesions[0]?.classification.predicted ?? "Inconclusive" : "—"}
                  </span>
                  <span className="font-mono text-xs text-ink-tertiary">{new Date(s.createdAt).toLocaleString()}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  // idle + error
  return (
    <div className="flex w-full flex-col items-center gap-4">
      {view === "error" && (
        <p className="max-w-md rounded-xl border border-soon-edge bg-soon-surface p-3 text-sm text-soon" role="alert">
          {error}
        </p>
      )}
      <UploadDropzone onFile={onUpload} />
      <button onClick={openHistory} className="text-sm font-medium text-gold-bright underline-offset-2 hover:underline">
        View scan history
      </button>
    </div>
  );
}
