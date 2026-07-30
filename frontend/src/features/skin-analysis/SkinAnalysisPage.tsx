import { useEffect, useState } from "react";
import { ScanConsentGate } from "./components/consent/ScanConsentGate";
import { setScanConsent } from "./privacy/scan-consent";
import { GuidedFaceFlow } from "./components/capture/GuidedFaceFlow";
import { LesionScanFlow } from "./components/lesion/LesionScanFlow";
import { HistoryView } from "./components/history/HistoryView";
import { TrainingDashboard } from "./components/training/TrainingDashboard";
import { TrainingQueue } from "./components/queue/TrainingQueue";
import { PatientBar } from "./components/patients/PatientBar";
import { Wordmark } from "./components/brand/Wordmark";
import { Segmented } from "./components/ui/Segmented";
import { installOnlineSync, syncPending } from "./pwa/sync";
import { requestPersistence } from "./pwa/local-store";
import type { CaptureMode } from "./types";
import type { SessionRole } from "./hooks/use-auth";

type View = "scan" | "history" | "queue" | "training";

const VIEWS: View[] = ["scan", "history", "queue", "training"];

/** Deep-linkable view, so "the page where I make invite links" is a real URL. */
function viewFromUrl(): View | null {
  if (typeof window === "undefined") return null;
  const v = new URL(window.location.href).searchParams.get("view");
  return VIEWS.includes(v as View) ? (v as View) : null;
}

export function SkinAnalysisPage({ role = "clinic" }: { role?: SessionRole }) {
  const isInvite = role === "invite";
  const [mode, setMode] = useState<CaptureMode>("face");
  // Deep link wins on load; invite sessions are pinned to the scan flow.
  const [view, setView] = useState<View>(() => (role === "invite" ? "scan" : viewFromUrl() ?? "scan"));

  // Keep ?view= in step with the tab so the URL stays shareable and reloadable.
  useEffect(() => {
    if (role === "invite" || typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (view === "scan") url.searchParams.delete("view");
    else url.searchParams.set("view", view);
    window.history.replaceState({}, "", url.toString());
  }, [view, role]);

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

        {!isInvite && (
          <div className="mt-6">
            <PatientBar />
          </div>
        )}

        <div className="mt-4 flex justify-center">
          <Segmented
            ariaLabel="View"
            value={view}
            onChange={setView}
            options={
              // An invite link is scoped to its own scan; the clinic views are
              // hidden here and refused by the server regardless.
              isInvite
                ? [{ value: "scan", label: "Scan" }]
                : [
                    { value: "scan", label: "Scan" },
                    { value: "history", label: "History" },
                    { value: "queue", label: "Queue" },
                    { value: "training", label: "Training" },
                  ]
            }
          />
        </div>

        <div className="mt-8 animate-rise">
          {view !== "scan" && isInvite ? null : view === "history" ? (
            <HistoryView onBack={() => setView("scan")} />
          ) : view === "queue" ? (
            <TrainingQueue />
          ) : view === "training" ? (
            <TrainingDashboard />
          ) : (
            <ScanConsentGate onConsent={setScanConsent}>
              <div className="flex justify-center">
                <Segmented
                  ariaLabel="Capture mode"
                  value={mode}
                  onChange={setMode}
                  options={
                    isInvite
                      ? [{ value: "face", label: "Face" }]
                      : [
                          { value: "face", label: "Face" },
                          { value: "closeup", label: "Body / close-up" },
                        ]
                  }
                />
              </div>
              <div className="mt-8 flex justify-center">
                {mode === "closeup" && !isInvite ? <LesionScanFlow /> : <GuidedFaceFlow isInvite={isInvite} />}
              </div>
            </ScanConsentGate>
          )}
        </div>
      </main>
    </div>
  );
}
