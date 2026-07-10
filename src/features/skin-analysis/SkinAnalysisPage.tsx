import { useState } from "react";
import { ConsentGate } from "./components/consent/ConsentGate";
import { CaptureFlow } from "./components/capture/CaptureFlow";
import type { CaptureMode } from "./types";

export function SkinAnalysisPage() {
  const [mode, setMode] = useState<CaptureMode>("face");

  return (
    <main className="mx-auto min-h-screen max-w-2xl px-4 py-8">
      <h1 className="text-center text-2xl font-bold text-stone-900">AI Skin Analysis</h1>
      <p className="mt-1 text-center text-sm text-stone-500">
        A guide to whether you should see a professional — not a diagnosis.
      </p>
      <div className="mt-6">
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
            <CaptureFlow mode={mode} patientId="walk-in" /> {/* TODO(plan-6): real patient selection */}
          </div>
        </ConsentGate>
      </div>
    </main>
  );
}
