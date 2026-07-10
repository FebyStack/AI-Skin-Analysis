# Responsive Lesion UI + Decommission Implementation Plan (Plan 9)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use `- [ ]`. Spec: `docs/superpowers/specs/2026-07-10-ai-classifier-architecture.md`. Depends on Plan 7 (wire contract, close-up route, `/api/scans/:id/explain`, health `llm` field).

**Goal:** Render close-up lesion results (classification + explanation) responsively on phones/iPads/desktops, auto-upgrade the offline built-in explanation to Gemini on reconnect, and remove the now-dead browser ONNX classifier.

**Architecture:** A `use-connectivity` hook (navigator.onLine hint + `/api/health` poll) drives a banner and the reconnect upgrade. A `LesionResult` view renders the two wire shapes, fluid single-column→two-column at `md`. The browser classifier + its worker/hook and the `verdict` merge retire; `use-analysis` keeps only classify-on-server → render.

**Tech Stack:** React 18, Tailwind (existing breakpoints), Vitest + Testing Library, preview tool for responsive verification.

**Conventions:** frontend imports domain types from `@shared/contract`; components colocate tests. Verify visual/responsive work live in the preview tool (not just unit tests). Commit per task.

---

### Task 1: `use-connectivity` hook

**Files:**
- Create: `frontend/src/features/skin-analysis/hooks/use-connectivity.ts`
- Test: `frontend/src/features/skin-analysis/hooks/use-connectivity.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// use-connectivity.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useConnectivity } from "./use-connectivity";

describe("useConnectivity", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("reflects the server llm status from /api/health", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ ok: true, llm: "offline" }), { status: 200 }));
    const { result } = renderHook(() => useConnectivity(fetchFn as typeof fetch, 1000));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await waitFor(() => expect(result.current.llmOnline).toBe(false));
  });

  it("fires onReconnect when llm flips offline→online", async () => {
    let status = "offline";
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ ok: true, llm: status }), { status: 200 }));
    const onReconnect = vi.fn();
    renderHook(() => useConnectivity(fetchFn as typeof fetch, 1000, onReconnect));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });   // first poll: offline
    status = "online";
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); }); // second poll: online
    await waitFor(() => expect(onReconnect).toHaveBeenCalledTimes(1));
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run frontend/src/features/skin-analysis/hooks/use-connectivity.test.ts` → FAIL
- [ ] **Step 3: Implement**

```typescript
// use-connectivity.ts
import { useEffect, useRef, useState } from "react";

// Server-truth connectivity: /api/health.llm (backend probes Gemini). navigator.onLine is only a
// fast hint to poll sooner — it lies behind captive portals.
export function useConnectivity(
  fetchFn: typeof fetch = fetch,
  intervalMs = 15_000,
  onReconnect?: () => void,
) {
  const [llmOnline, setLlmOnline] = useState(true);
  const prev = useRef(true);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const res = await fetchFn("/api/health", { credentials: "include" });
        const online = res.ok && (await res.json()).llm === "online";
        if (!alive) return;
        if (online && !prev.current) onReconnect?.();
        prev.current = online;
        setLlmOnline(online);
      } catch {
        if (alive) { prev.current = false; setLlmOnline(false); }
      }
    };
    poll();
    const id = setInterval(poll, intervalMs);
    const hint = () => poll();
    window.addEventListener("online", hint);
    window.addEventListener("offline", hint);
    return () => {
      alive = false;
      clearInterval(id);
      window.removeEventListener("online", hint);
      window.removeEventListener("offline", hint);
    };
  }, [fetchFn, intervalMs, onReconnect]);

  return { llmOnline };
}
```

- [ ] **Step 4: Run to verify pass**, then **Step 5: Commit** — `git commit -am "feat(ui): use-connectivity hook (health poll + reconnect callback)"`

---

### Task 2: Explain-upgrade API client

**Files:**
- Modify: `frontend/src/features/skin-analysis/api/analyze-client.ts` (append `requestExplanation`)
- Test: `frontend/src/features/skin-analysis/api/explain-client.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// explain-client.test.ts
import { describe, it, expect } from "vitest";
import { requestExplanation } from "./analyze-client";

describe("requestExplanation", () => {
  it("returns the upgraded explanation on 200", async () => {
    const fetchFn = async () => new Response(JSON.stringify({ explanation: { source: "gemini", patientSummary: "x" } }), { status: 200 });
    const e = await requestExplanation("scan-1", fetchFn as typeof fetch);
    expect(e?.source).toBe("gemini");
  });
  it("returns null on 503 (still offline)", async () => {
    const fetchFn = async () => new Response("", { status: 503 });
    expect(await requestExplanation("scan-1", fetchFn as typeof fetch)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL
- [ ] **Step 3: Implement (append to analyze-client.ts)**

```typescript
import type { LesionExplanation } from "@shared/contract";

export async function requestExplanation(
  scanId: string,
  fetchFn: typeof fetch = fetch,
): Promise<LesionExplanation | null> {
  const res = await fetchFn(`/api/scans/${scanId}/explain`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) return null; // 503 = still offline; caller keeps the builtin explanation
  const data = (await res.json()) as { explanation?: LesionExplanation };
  return data.explanation ?? null;
}
```

- [ ] **Step 4: Run to verify pass**, then **Step 5: Commit** — `git commit -am "feat(ui): requestExplanation client for offline→online upgrade"`

---

### Task 3: Responsive `LesionResult` view

**Files:**
- Create: `frontend/src/features/skin-analysis/components/results/LesionResult.tsx`
- Test: `frontend/src/features/skin-analysis/components/results/LesionResult.test.tsx`

Renders `{ classification, explanation }` from a `LesionScanReport`. Responsive rules: single column on phones, two columns (`md:grid-cols-2`) on tablet/desktop; confidence bars full-width; referral banner prominent; offline banner when `explanation.source === "builtin"`; touch targets ≥ 44px.

- [ ] **Step 1: Write the failing test**

```typescript
// LesionResult.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { LesionResult } from "./LesionResult";
import type { LesionScanReport } from "@shared/contract";

const report: LesionScanReport = {
  kind: "lesion",
  classification: {
    prediction: "Melanoma", confidence: 0.93,
    topPredictions: [
      { label: "Melanoma", confidence: 0.93 },
      { label: "Nevus", confidence: 0.05 },
      { label: "Basal Cell Carcinoma", confidence: 0.02 },
    ],
    abstain: false, quality: { ok: true, issues: [] },
    model: { name: "efficientnet-b0", version: "1.0.0" },
  },
  explanation: {
    patientSummary: "The analysis suggests melanoma features; a professional must confirm.",
    education: "Melanoma education.",
    referral: { recommended: true, urgency: "urgent", reason: "possible melanoma" },
    disclaimer: "This is not a diagnosis.", promptVersion: 1, source: "gemini",
  },
};

describe("LesionResult", () => {
  it("shows top predictions with confidences", () => {
    render(<LesionResult report={report} llmOnline onRequestExplanation={vi.fn()} />);
    expect(screen.getByText("Melanoma")).toBeInTheDocument();
    expect(screen.getByText(/93%/)).toBeInTheDocument();
  });
  it("always shows referral guidance when recommended", () => {
    render(<LesionResult report={report} llmOnline onRequestExplanation={vi.fn()} />);
    expect(screen.getByText(/see a (professional|doctor|dermatolog)/i)).toBeInTheDocument();
  });
  it("shows the offline banner for builtin explanations", () => {
    const offline = { ...report, explanation: { ...report.explanation, source: "builtin" as const } };
    render(<LesionResult report={offline} llmOnline={false} onRequestExplanation={vi.fn()} />);
    expect(screen.getByText(/offline/i)).toBeInTheDocument();
  });
  it("always shows the non-diagnosis disclaimer", () => {
    render(<LesionResult report={report} llmOnline onRequestExplanation={vi.fn()} />);
    expect(screen.getByText(/not a diagnosis/i)).toBeInTheDocument();
  });
  it("renders inconclusive UI when abstaining (no scary label headline)", () => {
    const abstain = { ...report, classification: { ...report.classification, abstain: true } };
    render(<LesionResult report={abstain} llmOnline onRequestExplanation={vi.fn()} />);
    expect(screen.getByText(/inconclusive/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /^Melanoma$/ })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL
- [ ] **Step 3: Implement**

```tsx
// LesionResult.tsx
import type { LesionScanReport } from "@shared/contract";

const URGENCY_STYLES: Record<string, string> = {
  urgent: "bg-red-50 border-red-300 text-red-900",
  soon: "bg-amber-50 border-amber-300 text-amber-900",
  routine: "bg-stone-50 border-stone-300 text-stone-800",
};

export function LesionResult({
  report,
  llmOnline,
  onRequestExplanation,
}: {
  report: LesionScanReport;
  llmOnline: boolean;
  onRequestExplanation: () => void;
}) {
  const { classification: c, explanation: e } = report;
  const pct = (n: number) => `${Math.round(n * 100)}%`;

  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-6">
      {/* Headline: abstain shows inconclusive, never a scary label */}
      <header className="text-center">
        {c.abstain ? (
          <h2 className="text-xl font-bold text-stone-900 sm:text-2xl">Inconclusive analysis</h2>
        ) : (
          <h2 className="text-xl font-bold text-stone-900 sm:text-2xl">{c.prediction}</h2>
        )}
        <p className="mt-1 text-sm text-stone-500">Automated visual assessment · model {c.model.version}</p>
      </header>

      {e.referral.recommended && (
        <div className={`mt-4 rounded-xl border p-4 text-sm ${URGENCY_STYLES[e.referral.urgency]}`} role="alert">
          <strong className="font-semibold">Please see a professional</strong> — {e.referral.reason}
        </div>
      )}

      {e.source === "builtin" && (
        <div className="mt-3 flex flex-col gap-2 rounded-lg bg-stone-100 p-3 text-sm text-stone-600 sm:flex-row sm:items-center sm:justify-between">
          <span>Enhanced AI explanation is unavailable offline — showing built-in guidance.</span>
          {llmOnline && (
            <button
              onClick={onRequestExplanation}
              className="min-h-[44px] rounded-lg bg-clinical px-4 text-white"
            >
              Get enhanced explanation
            </button>
          )}
        </div>
      )}

      {/* Fluid: 1 col on phones, 2 cols from md up (iPad/desktop) */}
      <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold text-stone-700">Top matches</h3>
          <ul className="mt-2 space-y-2">
            {c.topPredictions.map((t) => (
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
            <p className="mt-1 text-sm leading-relaxed text-stone-700">{e.patientSummary}</p>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-stone-700">Learn more</h3>
            <p className="mt-1 text-sm leading-relaxed text-stone-700">{e.education}</p>
          </div>
        </div>
      </div>

      <p className="mt-6 border-t border-stone-200 pt-4 text-xs text-stone-400">{e.disclaimer}</p>
    </section>
  );
}
```

- [ ] **Step 4: Run to verify pass** → all pass.
- [ ] **Step 5: Commit** — `git commit -am "feat(ui): responsive LesionResult view (1col→2col, referral/offline banners)"`

---

### Task 4: Wire LesionResult into the flow + reconnect upgrade

**Files:**
- Modify: `frontend/src/features/skin-analysis/components/capture/CaptureFlow.tsx` (render LesionResult for closeup lesion reports; wire connectivity + upgrade)
- Modify: `frontend/src/features/skin-analysis/hooks/use-analysis.ts` (return the server report; drop classifier branch — see Task 5)
- Test: `frontend/src/features/skin-analysis/components/capture/CaptureFlow.lesion.test.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
// CaptureFlow.lesion.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { LesionResultContainer } from "./LesionResultContainer";
import type { LesionScanReport } from "@shared/contract";

const builtin: LesionScanReport = {
  kind: "lesion",
  classification: { prediction: "Nevus", confidence: 0.8, topPredictions: [{ label: "Nevus", confidence: 0.8 }], abstain: false, quality: { ok: true, issues: [] }, model: { name: "efficientnet-b0", version: "1.0.0" } },
  explanation: { patientSummary: "builtin summary", education: "edu", referral: { recommended: false, urgency: "routine", reason: "r" }, disclaimer: "This is not a diagnosis.", promptVersion: 1, source: "builtin" },
};

describe("LesionResultContainer reconnect upgrade", () => {
  it("swaps builtin → gemini explanation when reconnect fires", async () => {
    const requestExplanation = vi.fn(async () => ({ ...builtin.explanation, source: "gemini" as const, patientSummary: "enhanced summary" }));
    render(<LesionResultContainer scanId="s1" initialReport={builtin} requestExplanationFn={requestExplanation} forceReconnect />);
    await waitFor(() => expect(screen.getByText("enhanced summary")).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL
- [ ] **Step 3: Implement — extract a small container so the upgrade logic is testable**

```tsx
// LesionResultContainer.tsx
import { useCallback, useEffect, useState } from "react";
import type { LesionExplanation, LesionScanReport } from "@shared/contract";
import { LesionResult } from "../results/LesionResult";
import { requestExplanation as defaultRequest } from "../../api/analyze-client";
import { useConnectivity } from "../../hooks/use-connectivity";

export function LesionResultContainer({
  scanId,
  initialReport,
  requestExplanationFn = defaultRequest,
  forceReconnect = false, // test seam
}: {
  scanId: string;
  initialReport: LesionScanReport;
  requestExplanationFn?: (id: string) => Promise<LesionExplanation | null>;
  forceReconnect?: boolean;
}) {
  const [report, setReport] = useState(initialReport);

  const upgrade = useCallback(async () => {
    if (report.explanation.source === "gemini") return;
    const explanation = await requestExplanationFn(scanId);
    if (explanation && explanation.source === "gemini") {
      setReport((r) => ({ ...r, explanation }));
    }
  }, [report.explanation.source, requestExplanationFn, scanId]);

  const { llmOnline } = useConnectivity(fetch, 15_000, upgrade);
  useEffect(() => { if (forceReconnect) void upgrade(); }, [forceReconnect, upgrade]);

  return <LesionResult report={report} llmOnline={llmOnline} onRequestExplanation={upgrade} />;
}
```

In `CaptureFlow.tsx`, where results render, dispatch on the report shape: if `scan.report?.kind === "lesion"`, render `<LesionResultContainer scanId={scan.id} initialReport={scan.report} />`; else the existing face `ReportView`.

- [ ] **Step 4: Run to verify pass**, then **Step 5: Commit** — `git commit -am "feat(ui): lesion result container with reconnect explanation upgrade"`

---

### Task 5: Decommission browser classifier

**Files:**
- Delete: `ai/classifier/*` (classifier.ts, labels.ts, worker-protocol.ts + tests), `frontend/src/features/skin-analysis/ml/classify.worker.ts`, `frontend/src/features/skin-analysis/hooks/use-classifier.ts` (+ test), `ai/shared/verdict.ts` (+ test)
- Modify: `frontend/src/features/skin-analysis/hooks/use-analysis.ts` (remove classify step + verdict merge; keep classify-on-server → render)
- Modify: `vite.config.ts` (drop `worker.format` if nothing else needs it — verify first), `tsconfig`/alias references to `@ai/classifier`
- Remove: `@mediapipe/tasks-vision`, `onnxruntime-web` from `package.json` if unused elsewhere (grep first)

- [ ] **Step 1: Confirm what's dead**

Run: `grep -rn "use-classifier\|classify.worker\|@ai/classifier\|ml/verdict\|onnxruntime-web\|@mediapipe" frontend backend ai shared --include='*.ts' --include='*.tsx' | grep -v '\.test\.'`
Expected: references only in the files listed above (and `use-analysis.ts`). If anything else references them, STOP and reassess.

- [ ] **Step 2: Update `use-analysis.ts`** — the pipeline becomes: capture → POST /api/analyze (server classifies) → render `scan.report`. Remove `runAnalysisPipeline`'s classifier + `buildVerdict` calls and the `useClassifier` import. Face mode already flows through `/api/analyze`; both modes now share the single server path.

```typescript
// use-analysis.ts — new pipeline (replaces classifier/verdict version)
import { useCallback } from "react";
import type { CaptureResult } from "../types";
import { analyzeCapture } from "../api/analyze-client";
import { useScanMachine } from "../store/scan-machine";

export function useAnalysis() {
  const machine = useScanMachine();
  return useCallback(
    async (capture: CaptureResult, patientId: string) => {
      try {
        const scan = await analyzeCapture(capture, patientId, []); // no client-side findings anymore
        machine.resultsReady(scan); // store now carries the ScanWire incl. report
      } catch (err) {
        console.error("Analysis failed:", err);
        machine.analysisFailed();
      }
    },
    [machine],
  );
}
```
(Adjust `scan-machine.ts` `resultsReady` to store the `ScanWire`; drop `Verdict`/`buildVerdict` types. Update any `use-analysis.test.ts` expectations to the new signature.)

- [ ] **Step 3: Delete the dead files**

```bash
git rm ai/classifier/classifier.ts ai/classifier/classifier.test.ts \
       ai/classifier/labels.ts ai/classifier/labels.test.ts \
       ai/classifier/worker-protocol.ts ai/classifier/worker-protocol.test.ts \
       ai/shared/verdict.ts ai/shared/verdict.test.ts \
       frontend/src/features/skin-analysis/ml/classify.worker.ts \
       frontend/src/features/skin-analysis/hooks/use-classifier.ts \
       frontend/src/features/skin-analysis/hooks/use-classifier.test.ts 2>/dev/null || true
```
Then remove now-unused deps: `npm rm onnxruntime-web @mediapipe/tasks-vision` (only after the grep in Step 1 shows no other users). Drop the ONNX model files: `git rm frontend/public/models/skin-classifier.onnx.data` and the README note.

- [ ] **Step 4: Gate** — `npm run typecheck && npm run typecheck:server && npx vitest run`. Fix dangling imports until green. The 2 pre-existing face-mode failures may now be gone (verdict/quality-gate tests deleted) — note the new baseline count.
- [ ] **Step 5: Commit** — `git commit -am "refactor: decommission browser ONNX classifier + verdict merge (server owns inference)"`

---

### Task 6: Responsive verification (live)

- [ ] **Step 1:** `FAKE_CLASSIFIER=1 npm run dev:lite`; log in; run a close-up analysis (upload path).
- [ ] **Step 2:** Preview tool — `preview_resize` to mobile (375×812), tablet (768×1024), desktop (1280×800). At each width confirm via `preview_snapshot`/`preview_screenshot`:
  - single column on mobile, two columns from tablet up
  - referral banner and disclaimer visible without horizontal scroll
  - the offline "Get enhanced explanation" button ≥ 44px tall (`preview_inspect` height)
- [ ] **Step 3:** Toggle offline: set `FAKE` explain provider to throw (or block network) → builtin banner appears; restore → button upgrades in place.
- [ ] **Step 4:** `preview_screenshot` at each breakpoint as the completion evidence.
- [ ] **Step 5: Commit** any tweaks — `git commit -am "test(ui): responsive lesion result verified at phone/tablet/desktop"`

---

## Self-review checklist
- [ ] Responsive: 1-col phone → 2-col md+ ✓ · touch targets ≥44px ✓ · no horizontal scroll ✓ (spec §7)
- [ ] Offline banner + reconnect upgrade in place ✓ · abstain shows inconclusive, never a scary headline ✓
- [ ] Disclaimer + referral always render ✓
- [ ] Browser classifier / worker / verdict fully removed; grep clean; deps pruned ✓
- [ ] Full suite green; note the new baseline test count after deletions
