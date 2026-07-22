import { useEffect, useState } from "react";
import { ConsentGate } from "./components/consent/ConsentGate";
import { GuidedFaceFlow } from "./components/capture/GuidedFaceFlow";
import { LesionScanFlow } from "./components/lesion/LesionScanFlow";
import { HistoryView } from "./components/history/HistoryView";
import { PatientBar } from "./components/patients/PatientBar";
import { Wordmark } from "./components/brand/Wordmark";
import { Segmented } from "./components/ui/Segmented";
import { installOnlineSync, syncPending } from "./pwa/sync";
import { requestPersistence } from "./pwa/local-store";
import type { CaptureMode } from "./types";

type View = "scan" | "history";

export function SkinAnalysisPage() {
  const [mode, setMode] = useState<CaptureMode>("face");
  const [view, setView] = useState<View>("scan");

  useEffect(() => {
    void requestPersistence();
    void syncPending().catch(() => undefined);
    return installOnlineSync();
  }, []);

  return (
    <div className="min-h-[100dvh] bg-canvas">
      <header className="border-b border-hairline px-4 py-4">
        <div className="mx-auto flex max-w-2xl items-center justify-center">
          <Wordmark size="sm" />
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
        <div className="text-center">
          <h1 className="font-serif text-[clamp(1.5rem,4vw,2rem)] font-semibold tracking-tight text-ink">
            Skin Analysis
          </h1>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-secondary">
            A guide to whether you should see a professional — not a diagnosis.
          </p>
        </div>

        <div className="mt-6">
          <PatientBar />
        </div>

        <div className="mt-4 flex justify-center">
          <Segmented
            ariaLabel="View"
            value={view}
            onChange={setView}
            options={[
              { value: "scan", label: "Scan" },
              { value: "history", label: "History" },
            ]}
          />
        </div>

        <div className="mt-8 animate-rise">
          {view === "history" ? (
            <HistoryView onBack={() => setView("scan")} />
          ) : (
            <ConsentGate>
              <div className="flex justify-center">
                <Segmented
                  ariaLabel="Capture mode"
                  value={mode}
                  onChange={setMode}
                  options={[
                    { value: "face", label: "Face" },
                    { value: "closeup", label: "Body / close-up" },
                  ]}
                />
              </div>
              <div className="mt-8 flex justify-center">
                {mode === "closeup" ? <LesionScanFlow /> : <GuidedFaceFlow />}
              </div>
            </ConsentGate>
          )}
        </div>
      </main>
    </div>
  );
}
