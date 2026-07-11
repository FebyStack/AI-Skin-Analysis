import { useCallback, useState } from "react";
import { UploadDropzone } from "../capture/UploadDropzone";
import { LesionResultView } from "../results/LesionResultView";
import {
  analyzeLesion,
  listLesionScans,
  LesionAuthError,
  type LesionResult,
  type LesionScanWire,
} from "../../api/lesion-client";

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
      const res = await analyzeLesion(file, file.type || "image/jpeg");
      setResult(res);
      setView("result");
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
      setHistory(await listLesionScans());
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
    return <p className="py-8 text-center text-sm text-stone-500">Analyzing…</p>;
  }

  if (view === "result" && result) {
    return (
      <div className="w-full">
        <LesionResultView analysis={result.analysis} explanation={result.explanation} />
        <div className="mt-4 flex justify-center gap-3">
          <button onClick={reset} className="min-h-[44px] rounded-lg bg-clinical px-6 text-sm font-semibold text-white">
            New scan
          </button>
          <button onClick={openHistory} className="min-h-[44px] rounded-lg border border-stone-300 px-6 text-sm font-medium text-stone-700">
            History
          </button>
        </div>
      </div>
    );
  }

  if (view === "history") {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-stone-900">Scan history</h2>
          <button onClick={reset} className="min-h-[44px] rounded-lg bg-clinical px-4 text-sm font-semibold text-white">
            New scan
          </button>
        </div>
        {history.length === 0 ? (
          <p className="py-8 text-center text-sm text-stone-500">No saved scans yet.</p>
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
                  className="flex w-full items-center justify-between rounded-xl border border-stone-200 p-4 text-left hover:bg-stone-50"
                >
                  <span className="font-medium text-stone-800">
                    {s.report?.kind === "lesion" ? s.report.analysis.lesions[0]?.classification.predicted ?? "Inconclusive" : "—"}
                  </span>
                  <span className="text-xs text-stone-400">{new Date(s.createdAt).toLocaleString()}</span>
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
        <p className="max-w-md rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="alert">
          {error}
        </p>
      )}
      <UploadDropzone onFile={onUpload} />
      <button onClick={openHistory} className="text-sm font-medium text-clinical underline-offset-2 hover:underline">
        View scan history
      </button>
    </div>
  );
}
