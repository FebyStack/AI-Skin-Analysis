import { useEffect, useState } from "react";
import { ConsentGate } from "./components/consent/ConsentGate";
import { GuidedFaceFlow } from "./components/capture/GuidedFaceFlow";
import { LesionScanFlow } from "./components/lesion/LesionScanFlow";
import { HistoryView } from "./components/history/HistoryView";
import { PatientBar } from "./components/patients/PatientBar";
import { installOnlineSync, syncPending } from "./pwa/sync";
import { requestPersistence } from "./pwa/local-store";
import type { CaptureMode } from "./types";

type View = "scan" | "history";

export function SkinAnalysisPage() {
  const [mode, setMode] = useState<CaptureMode>("face");
  const [view, setView] = useState<View>("scan");

  useEffect(() => {
    // Best-effort: ask the browser not to evict our IndexedDB store.
    void requestPersistence();
    // Fire the pending queue immediately + on every 'online' event.
    void syncPending().catch(() => undefined);
    return installOnlineSync();
  }, []);

  return (
    <main className="mx-auto min-h-screen max-w-2xl px-4 py-8">
      <h1 className="text-center text-2xl font-bold text-stone-900">AI Skin Analysis</h1>
      <p className="mt-1 text-center text-sm text-stone-500">
        A guide to whether you should see a professional — not a diagnosis.
      </p>

      <div className="mt-6">
        <PatientBar />
      </div>

      <div className="mt-2 flex justify-center gap-2">
        {(["scan", "history"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`min-h-[36px] rounded-full px-4 text-sm font-medium ${
              view === v ? "bg-clinical text-white" : "bg-clinical-soft text-clinical"
            }`}
          >
            {v === "scan" ? "Scan" : "History"}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {view === "history" ? (
          <HistoryView onBack={() => setView("scan")} />
        ) : (
          <ConsentGate>
            <div className="flex justify-center gap-2">
              {(["face", "closeup"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`rounded-full px-4 py-1.5 text-sm font-medium ${
                    mode === m ? "bg-clinical text-white" : "bg-clinical-soft text-clinical"
                  }`}
                >
                  {m === "face" ? "Face" : "Body / close-up"}
                </button>
              ))}
            </div>
            <div className="mt-6 flex justify-center">
              {mode === "closeup" ? <LesionScanFlow /> : <GuidedFaceFlow />}
            </div>
          </ConsentGate>
        )}
      </div>
    </main>
  );
}
