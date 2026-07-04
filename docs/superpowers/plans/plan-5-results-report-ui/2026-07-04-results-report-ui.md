# Results & Report UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a completed scan into what the practitioner sees: the dual-AI verdict merge, a staged analysis loading screen, the full report view (summary, 12-dimension grid, facial map, findings with agreement badges, skin type), and a printable/downloadable report.

**Architecture:** `verdict.ts` merges the on-device classifier findings with the LLM report (pure, exhaustively tested — the highest-stakes logic in the app). A `use-analysis` hook owns the scan pipeline end-to-end (quality gate → classifier → api → verdict → machine), reporting stage events that drive the loading screen. Presentational components render from the stored `ScanWire` + `Verdict`, so the same components later render history items (Plan 6). PDF export uses a print stylesheet + `window.print()` — dependency-free, works offline, and the browser's "Save as PDF" produces the file.

**Tech Stack:** existing stack (React, Tailwind, Zustand, Vitest). No new dependencies.

**Prerequisites:** Plan 3 merged (analysis engine + contracts, 112 tests green). Plan 4 provides `/api/analyze` + `analyze-client.ts`; for local dev without the api, Task 3's hook takes an injectable `analyze` function (tests use fakes; a dev fallback returns a partial scan).

**Test counts are approximate** (baseline 112 at drafting; Plan 4 may land first and raise it). All tests passing is the requirement; counts are checkpoints, not gates.

---

## File Structure

- Create: `src/features/skin-analysis/ml/verdict.ts` (+ test) — merge rules
- Modify: `src/features/skin-analysis/store/scan-machine.ts` (+ test) — `results` payload + `resultsReady`/`newScan`
- Create: `src/features/skin-analysis/hooks/use-analysis.ts` (+ test) — pipeline orchestration + stage events
- Create: `src/features/skin-analysis/components/results/AnalysisProgress.tsx` (+ test) — staged loading screen
- Create: `src/features/skin-analysis/components/results/FacialMap.tsx` (+ test) — zone-marker SVG
- Create: `src/features/skin-analysis/components/results/DimensionGrid.tsx` (+ test)
- Create: `src/features/skin-analysis/components/results/FindingsList.tsx` (+ test)
- Create: `src/features/skin-analysis/components/results/ReportView.tsx` (+ test) — composition + print/download
- Modify: `src/features/skin-analysis/components/capture/CaptureFlow.tsx` — wire loading + results
- Modify: `src/index.css` — print stylesheet

---

## Task 1: Verdict merge (`verdict.ts`)

**Files:**
- Create: `src/features/skin-analysis/ml/verdict.ts`
- Create: `src/features/skin-analysis/ml/verdict.test.ts`

- [ ] **Step 1: Failing test** `src/features/skin-analysis/ml/verdict.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mergeFindings, buildVerdict, combineConfidence } from "./verdict";
import type { Finding } from "../types";
import type { AnalysisReport } from "../api/contract";
import golden from "../../../../server/analysis/fixtures/golden-report.json";

const report = golden as unknown as AnalysisReport;

const classifierAcne: Finding = {
  id: "acne",
  label: "Acne",
  source: "classifier",
  confidence: 0.6,
  severity: "mild",
};
const classifierLesion: Finding = {
  id: "suspicious-lesion",
  label: "Lesion needing evaluation",
  source: "classifier",
  confidence: 0.5,
  severity: "attention",
};
const classifierEczema: Finding = {
  id: "eczema",
  label: "Eczema",
  source: "classifier",
  confidence: 0.4,
  severity: "moderate",
};

describe("combineConfidence", () => {
  it("is higher than either input and capped below 1", () => {
    const c = combineConfidence(0.7, 0.6);
    expect(c).toBeGreaterThan(0.7);
    expect(c).toBeLessThan(1);
  });
});

describe("mergeFindings", () => {
  it("marks findings present in both sources as agree with combined confidence", () => {
    const merged = mergeFindings([classifierAcne], report.findings);
    const acne = merged.find((f) => f.id === "acne");
    expect(acne?.agreement).toBe("agree");
    expect(acne?.confidence).toBeGreaterThan(0.72); // combined > llm alone
  });

  it("labels llm-only and classifier-only findings", () => {
    const merged = mergeFindings([classifierEczema], report.findings);
    expect(merged.find((f) => f.id === "eczema")?.agreement).toBe("classifier-only");
    expect(merged.find((f) => f.id === "acne")?.agreement).toBe("llm-only");
  });

  it("escalates attention findings from either source (safety override)", () => {
    const merged = mergeFindings([classifierLesion], report.findings);
    const lesion = merged.find((f) => f.id === "suspicious-lesion");
    expect(lesion?.escalated).toBe(true);
    expect(lesion?.severity).toBe("attention");
  });

  it("keeps the higher severity when sources agree but differ in severity", () => {
    const moderateAcne = { ...classifierAcne, severity: "moderate" as const };
    const merged = mergeFindings([moderateAcne], report.findings);
    expect(merged.find((f) => f.id === "acne")?.severity).toBe("moderate");
  });

  it("sorts escalated findings first, then by confidence", () => {
    const merged = mergeFindings([classifierLesion, classifierAcne], report.findings);
    expect(merged[0].id).toBe("suspicious-lesion");
  });
});

describe("buildVerdict", () => {
  it("builds a full verdict from a report plus classifier findings", () => {
    const v = buildVerdict(report, [classifierAcne]);
    expect(v.summary).toBe(report.summary);
    expect(v.disclaimerShown).toBe(true);
    expect(v.degraded).toBeUndefined();
    expect(v.findings.some((f) => f.agreement === "agree")).toBe(true);
  });

  it("builds a classifier-only degraded verdict when the report is null (partial scan)", () => {
    const v = buildVerdict(null, [classifierAcne, classifierLesion]);
    expect(v.degraded).toBe("classifier-only");
    expect(v.findings).toHaveLength(2);
    expect(v.findings.every((f) => f.agreement === "classifier-only")).toBe(true);
    expect(v.summary).toMatch(/partial/i);
  });

  it("builds an llm-only degraded verdict when classifier findings are absent", () => {
    const v = buildVerdict(report, []);
    expect(v.degraded).toBe("llm-only");
  });
});
```

- [ ] **Step 2: Run to verify failure** (cannot resolve ./verdict).

- [ ] **Step 3: Implement** `src/features/skin-analysis/ml/verdict.ts`:

```ts
import type { Finding, MergedFinding, Severity, Verdict } from "../types";
import type { AnalysisReport, WireFinding } from "../api/contract";

const SEVERITY_RANK: Record<Severity, number> = {
  info: 0,
  mild: 1,
  moderate: 2,
  attention: 3,
};

function maxSeverity(a: Severity, b: Severity): Severity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

// Independent-signals combination: agreement raises confidence, capped < 1.
export function combineConfidence(a: number, b: number): number {
  return Math.min(0.99, 1 - (1 - a) * (1 - b));
}

export function mergeFindings(
  classifier: Finding[],
  llm: WireFinding[],
): MergedFinding[] {
  const byId = new Map<string, MergedFinding>();

  for (const f of llm) {
    byId.set(f.id, {
      id: f.id,
      label: f.label,
      source: "llm",
      confidence: f.confidence,
      severity: f.severity,
      note: f.note,
      region: f.region,
      agreement: "llm-only",
      escalated: f.severity === "attention",
    });
  }

  for (const c of classifier) {
    const existing = byId.get(c.id);
    if (existing) {
      const severity = maxSeverity(existing.severity, c.severity);
      byId.set(c.id, {
        ...existing,
        agreement: "agree",
        confidence: combineConfidence(existing.confidence, c.confidence),
        severity,
        escalated: severity === "attention",
      });
    } else {
      byId.set(c.id, {
        ...c,
        agreement: "classifier-only",
        escalated: c.severity === "attention",
      });
    }
  }

  return [...byId.values()].sort((a, b) => {
    if (a.escalated !== b.escalated) return a.escalated ? -1 : 1;
    return b.confidence - a.confidence;
  });
}

const PARTIAL_SUMMARY =
  "Partial analysis — the AI review is pending (offline or unavailable). " +
  "These are the on-device classifier's findings only; re-analyze when online.";

export function buildVerdict(
  report: AnalysisReport | null,
  classifierFindings: Finding[],
): Verdict {
  if (!report) {
    return {
      summary: PARTIAL_SUMMARY,
      findings: mergeFindings(classifierFindings, []),
      disclaimerShown: true,
      degraded: "classifier-only",
    };
  }
  return {
    summary: report.summary,
    findings: mergeFindings(classifierFindings, report.findings),
    disclaimerShown: true,
    degraded: classifierFindings.length === 0 ? "llm-only" : undefined,
  };
}
```

NOTE: `MergedFinding` extends `Finding`, which now has optional `region` (Plan 3 Task 1) — the llm branch carries it through.

- [ ] **Step 4: Run — PASS (10 tests). Full suite green. Commit:**

```bash
git add src/features/skin-analysis/ml/verdict.ts src/features/skin-analysis/ml/verdict.test.ts
git commit -m "feat: dual-AI verdict merge with safety escalation"
```

---

## Task 2: Machine gains results payload and reset-to-new-scan

**Files:**
- Modify: `src/features/skin-analysis/store/scan-machine.ts`
- Modify: `src/features/skin-analysis/store/scan-machine.test.ts`

- [ ] **Step 1: Failing tests.** Append to `scan-machine.test.ts` (extend the type import line with `Verdict`):

```ts
describe("scan machine — results", () => {
  beforeEach(() => useScanMachine.getState().reset());

  const verdict: Verdict = {
    summary: "ok",
    findings: [],
    disclaimerShown: true,
  };

  it("resultsReady carries the verdict into the results state", () => {
    useScanMachine.getState().grantConsent();
    useScanMachine.getState().cameraReady();
    useScanMachine.getState().captured(sample);
    useScanMachine.getState().resultsReady(verdict, "scan-1");
    expect(useScanMachine.getState().state).toBe("results");
    expect(useScanMachine.getState().verdict?.summary).toBe("ok");
    expect(useScanMachine.getState().scanId).toBe("scan-1");
  });

  it("reset clears the verdict and scanId", () => {
    useScanMachine.getState().resultsReady(verdict, "scan-1");
    useScanMachine.getState().reset();
    expect(useScanMachine.getState().verdict).toBeNull();
    expect(useScanMachine.getState().scanId).toBeNull();
  });
});
```

The `Verdict` type import comes from `../types`.

- [ ] **Step 2: Run to verify failure** (resultsReady not a function).

- [ ] **Step 3: Implement in `scan-machine.ts`:**
- Extend the type import: `import type { CaptureResult, CaptureSource, QualityIssue, Verdict } from "../types";`
- Add to `ScanStore`: `verdict: Verdict | null;`, `scanId: string | null;`, `resultsReady(verdict: Verdict, scanId: string): void;`
- Add initial state fields: `verdict: null,`, `scanId: null,`
- Add action: `resultsReady: (verdict, scanId) => set({ state: "results", verdict, scanId }),`
- Extend `reset` to also clear them: `reset: () => set({ state: "idle", error: null, capture: null, captureSource: "camera", verdict: null, scanId: null }),`

- [ ] **Step 4: Run — PASS. Full suite green. Commit:**

```bash
git add src/features/skin-analysis/store/scan-machine.ts src/features/skin-analysis/store/scan-machine.test.ts
git commit -m "feat: results state carries verdict and scan id"
```

---

## Task 3: `use-analysis` — pipeline orchestration with stage events

**Files:**
- Create: `src/features/skin-analysis/hooks/use-analysis.ts`
- Create: `src/features/skin-analysis/hooks/use-analysis.test.ts`

The pure core `runAnalysisPipeline` is fully tested with fakes; the hook is a thin binding.

- [ ] **Step 1: Failing test** `src/features/skin-analysis/hooks/use-analysis.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { runAnalysisPipeline, type AnalysisStage } from "./use-analysis";
import type { CaptureResult, Finding } from "../types";
import type { ScanWire } from "../api/analyze-client";
import golden from "../../../../server/analysis/fixtures/golden-report.json";
import type { AnalysisReport } from "../api/contract";

const capture: CaptureResult = {
  blob: new Blob(["x"], { type: "image/jpeg" }),
  mimeType: "image/jpeg",
  mode: "face",
  source: "camera",
  width: 100,
  height: 100,
};

const classifierFinding: Finding = {
  id: "acne",
  label: "Acne",
  source: "classifier",
  confidence: 0.6,
  severity: "mild",
};

function scanWith(report: AnalysisReport | null, partial: boolean): ScanWire {
  return {
    id: "scan-1",
    patientId: "p-1",
    mode: "face",
    createdAt: 1,
    imageWidth: 100,
    imageHeight: 100,
    report,
    partial,
    classifierFindings: [],
    promptVersion: report ? 2 : null,
  };
}

describe("runAnalysisPipeline", () => {
  it("runs classifier → analyze → verdict, emitting stages in order", async () => {
    const stages: AnalysisStage[] = [];
    const result = await runAnalysisPipeline(capture, "p-1", {
      classify: vi.fn(async () => [classifierFinding]),
      analyze: vi.fn(async () => scanWith(golden as unknown as AnalysisReport, false)),
      onStage: (s) => stages.push(s),
    });
    expect(stages).toEqual(["classifier", "analyzing", "crosscheck", "report"]);
    expect(result.scan.id).toBe("scan-1");
    expect(result.verdict.findings.some((f) => f.agreement === "agree")).toBe(true);
  });

  it("continues with an empty classifier result when the classifier fails", async () => {
    const result = await runAnalysisPipeline(capture, "p-1", {
      classify: vi.fn(async () => {
        throw new Error("no model");
      }),
      analyze: vi.fn(async () => scanWith(golden as unknown as AnalysisReport, false)),
      onStage: () => {},
    });
    expect(result.verdict.degraded).toBe("llm-only");
  });

  it("produces a classifier-only verdict for a partial scan", async () => {
    const result = await runAnalysisPipeline(capture, "p-1", {
      classify: vi.fn(async () => [classifierFinding]),
      analyze: vi.fn(async () => scanWith(null, true)),
      onStage: () => {},
    });
    expect(result.verdict.degraded).toBe("classifier-only");
  });

  it("propagates analyze failures (caller maps to machine error)", async () => {
    await expect(
      runAnalysisPipeline(capture, "p-1", {
        classify: vi.fn(async () => []),
        analyze: vi.fn(async () => {
          throw new Error("api down");
        }),
        onStage: () => {},
      }),
    ).rejects.toThrow(/api down/);
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement** `src/features/skin-analysis/hooks/use-analysis.ts`:

```ts
import { useCallback } from "react";
import type { CaptureResult, Finding, Verdict } from "../types";
import type { ScanWire } from "../api/analyze-client";
import { analyzeCapture } from "../api/analyze-client";
import { buildVerdict } from "../ml/verdict";
import { useClassifier } from "./use-classifier";
import { useScanMachine } from "../store/scan-machine";

export type AnalysisStage = "classifier" | "analyzing" | "crosscheck" | "report";

export interface PipelineHooks {
  classify: (blob: Blob) => Promise<Finding[]>;
  analyze: (capture: CaptureResult, patientId: string, findings: Finding[]) => Promise<ScanWire>;
  onStage: (stage: AnalysisStage) => void;
}

export interface PipelineResult {
  scan: ScanWire;
  verdict: Verdict;
}

export async function runAnalysisPipeline(
  capture: CaptureResult,
  patientId: string,
  hooks: PipelineHooks,
): Promise<PipelineResult> {
  hooks.onStage("classifier");
  let classifierFindings: Finding[] = [];
  try {
    classifierFindings = await hooks.classify(capture.blob);
  } catch {
    // Classifier unavailable (missing model / old device) → LLM-only verdict.
  }

  hooks.onStage("analyzing");
  const scan = await hooks.analyze(capture, patientId, classifierFindings);

  hooks.onStage("crosscheck");
  const verdict = buildVerdict(scan.report, classifierFindings);

  hooks.onStage("report");
  return { scan, verdict };
}

export function useAnalysis(onStage: (stage: AnalysisStage) => void) {
  const classify = useClassifier();
  const machine = useScanMachine();

  return useCallback(
    async (capture: CaptureResult, patientId: string) => {
      try {
        const { scan, verdict } = await runAnalysisPipeline(capture, patientId, {
          classify,
          analyze: (c, pid, findings) => analyzeCapture(c, pid, findings),
          onStage,
        });
        machine.resultsReady(verdict, scan.id);
      } catch {
        machine.analysisFailed();
      }
    },
    [classify, machine, onStage],
  );
}
```

- [ ] **Step 4: Run — PASS (4 tests). Full suite green. Commit:**

```bash
git add src/features/skin-analysis/hooks/use-analysis.ts src/features/skin-analysis/hooks/use-analysis.test.ts
git commit -m "feat: analysis pipeline hook with stage events"
```

---

## Task 4: Staged loading screen

**Files:**
- Create: `src/features/skin-analysis/components/results/AnalysisProgress.tsx`
- Create: `src/features/skin-analysis/components/results/AnalysisProgress.test.tsx`

- [ ] **Step 1: Failing test:**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AnalysisProgress, STAGE_LABELS } from "./AnalysisProgress";

describe("AnalysisProgress", () => {
  it("renders all stages with the current one marked active", () => {
    render(<AnalysisProgress stage="analyzing" />);
    for (const label of Object.values(STAGE_LABELS)) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    const active = screen.getByText(STAGE_LABELS.analyzing).closest("li");
    expect(active).toHaveAttribute("aria-current", "step");
  });

  it("announces progress to screen readers", () => {
    render(<AnalysisProgress stage="classifier" />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement** `AnalysisProgress.tsx`:

```tsx
import type { AnalysisStage } from "../../hooks/use-analysis";

export const STAGE_LABELS: Record<AnalysisStage | "quality", string> = {
  quality: "Checking image quality",
  classifier: "Mapping skin surface",
  analyzing: "Running deep analysis",
  crosscheck: "Cross-checking with second AI",
  report: "Preparing the report",
};

const ORDER: (AnalysisStage | "quality")[] = [
  "quality",
  "classifier",
  "analyzing",
  "crosscheck",
  "report",
];

export function AnalysisProgress({ stage }: { stage: AnalysisStage | "quality" }) {
  const currentIdx = ORDER.indexOf(stage);
  return (
    <div
      role="status"
      aria-label={`Analyzing: ${STAGE_LABELS[stage]}`}
      className="mx-auto flex min-h-64 max-w-sm flex-col items-center justify-center gap-6 motion-reduce:transition-none"
    >
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-clinical-soft border-t-clinical motion-reduce:animate-none" />
      <ol className="w-full space-y-2">
        {ORDER.map((s, i) => (
          <li
            key={s}
            aria-current={s === stage ? "step" : undefined}
            className={`flex items-center gap-2 text-sm ${
              i < currentIdx
                ? "text-stone-400 line-through"
                : s === stage
                  ? "font-semibold text-clinical"
                  : "text-stone-500"
            }`}
          >
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                i <= currentIdx ? "bg-clinical" : "bg-stone-300"
              }`}
            />
            {STAGE_LABELS[s]}
          </li>
        ))}
      </ol>
    </div>
  );
}
```

- [ ] **Step 4: Run — PASS (2 tests). Commit:**

```bash
git add src/features/skin-analysis/components/results/
git commit -m "feat: staged analysis loading screen"
```

---

## Task 5: Facial map

**Files:**
- Create: `src/features/skin-analysis/components/results/FacialMap.tsx`
- Create: `src/features/skin-analysis/components/results/FacialMap.test.tsx`

- [ ] **Step 1: Failing test:**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FacialMap } from "./FacialMap";
import type { MergedFinding } from "../../types";

const finding = (id: string, region: MergedFinding["region"], severity: MergedFinding["severity"]): MergedFinding => ({
  id,
  label: id,
  source: "llm",
  confidence: 0.5,
  severity,
  region,
  agreement: "llm-only",
  escalated: severity === "attention",
});

describe("FacialMap", () => {
  it("renders a marker for each finding's zone with an accessible label", () => {
    render(<FacialMap findings={[finding("acne", "left-cheek", "mild")]} />);
    expect(screen.getByLabelText(/left-cheek: acne/i)).toBeInTheDocument();
  });

  it("marks escalated zones distinctly", () => {
    render(<FacialMap findings={[finding("suspicious-lesion", "chin", "attention")]} />);
    const marker = screen.getByLabelText(/chin: suspicious-lesion/i);
    expect(marker.getAttribute("fill")).toBe("#f59e0b");
  });

  it("ignores findings without a region", () => {
    render(<FacialMap findings={[finding("acne", undefined, "mild")]} />);
    expect(screen.queryByLabelText(/acne/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement** `FacialMap.tsx` (stylized face; zone marker positions in one map):

```tsx
import type { FaceZone } from "../../types";
import type { MergedFinding } from "../../types";

const ZONE_POS: Record<Exclude<FaceZone, "other">, { cx: number; cy: number }> = {
  forehead: { cx: 100, cy: 52 },
  periorbital: { cx: 100, cy: 88 },
  nose: { cx: 100, cy: 115 },
  "left-cheek": { cx: 62, cy: 118 },
  "right-cheek": { cx: 138, cy: 118 },
  chin: { cx: 100, cy: 168 },
};

export function FacialMap({ findings }: { findings: MergedFinding[] }) {
  const placed = findings.filter(
    (f): f is MergedFinding & { region: Exclude<FaceZone, "other"> } =>
      f.region !== undefined && f.region !== "other",
  );
  return (
    <svg viewBox="0 0 200 220" className="mx-auto w-48" role="img" aria-label="Facial map">
      {/* face outline */}
      <ellipse cx="100" cy="110" rx="70" ry="95" fill="#fffdf9" stroke="#ede5d8" strokeWidth="2" />
      {/* eyes / nose / mouth hints */}
      <ellipse cx="72" cy="88" rx="10" ry="5" fill="#ede5d8" />
      <ellipse cx="128" cy="88" rx="10" ry="5" fill="#ede5d8" />
      <path d="M96 100 Q100 122 104 100" fill="none" stroke="#ede5d8" strokeWidth="2" />
      <path d="M80 148 Q100 160 120 148" fill="none" stroke="#ede5d8" strokeWidth="2" />
      {placed.map((f) => {
        const pos = ZONE_POS[f.region];
        return (
          <circle
            key={`${f.id}-${f.region}`}
            cx={pos.cx}
            cy={pos.cy}
            r={8}
            fill={f.escalated ? "#f59e0b" : "#0f766e"}
            fillOpacity={0.75}
            stroke="#ffffff"
            strokeWidth="2"
            role="img"
            aria-label={`${f.region}: ${f.label}`}
          />
        );
      })}
    </svg>
  );
}
```

- [ ] **Step 4: Run — PASS (3 tests). Commit:**

```bash
git add src/features/skin-analysis/components/results/FacialMap.tsx src/features/skin-analysis/components/results/FacialMap.test.tsx
git commit -m "feat: facial map with zone markers"
```

---

## Task 6: Dimension grid and findings list

**Files:**
- Create: `src/features/skin-analysis/components/results/DimensionGrid.tsx` (+ test)
- Create: `src/features/skin-analysis/components/results/FindingsList.tsx` (+ test)

- [ ] **Step 1: Failing tests.** `DimensionGrid.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DimensionGrid } from "./DimensionGrid";
import golden from "../../../../../server/analysis/fixtures/golden-report.json";
import type { AnalysisReport } from "../../api/contract";

const report = golden as unknown as AnalysisReport;

describe("DimensionGrid", () => {
  it("renders all 12 dimensions with notes", () => {
    render(<DimensionGrid dimensions={report.dimensions} />);
    expect(screen.getByText(/oiliness/i)).toBeInTheDocument();
    expect(screen.getByText(report.dimensions.acne.note)).toBeInTheDocument();
  });

  it("labels proxy dimensions as visual proxies", () => {
    render(<DimensionGrid dimensions={report.dimensions} />);
    expect(screen.getAllByText(/visual proxy/i).length).toBeGreaterThanOrEqual(3);
  });
});
```

`FindingsList.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FindingsList } from "./FindingsList";
import type { MergedFinding } from "../../types";

const base: Omit<MergedFinding, "id" | "agreement" | "escalated"> = {
  label: "Mild acne",
  source: "llm",
  confidence: 0.7,
  severity: "mild",
};

describe("FindingsList", () => {
  it("shows an agreement badge when both AIs agree", () => {
    render(
      <FindingsList
        findings={[{ ...base, id: "acne", agreement: "agree", escalated: false }]}
      />,
    );
    expect(screen.getByText(/2 analyses agree/i)).toBeInTheDocument();
  });

  it("shows single-source badges", () => {
    render(
      <FindingsList
        findings={[
          { ...base, id: "a", agreement: "llm-only", escalated: false },
          { ...base, id: "b", agreement: "classifier-only", escalated: false },
        ]}
      />,
    );
    expect(screen.getByText(/AI analysis only/i)).toBeInTheDocument();
    expect(screen.getByText(/flagged by classifier/i)).toBeInTheDocument();
  });

  it("marks escalated findings with the professional-referral row style", () => {
    render(
      <FindingsList
        findings={[
          { ...base, id: "l", severity: "attention", agreement: "agree", escalated: true },
        ]}
      />,
    );
    expect(screen.getByText(/worth a professional look/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failures.**

- [ ] **Step 3: Implement.** `DimensionGrid.tsx`:

```tsx
import { DIMENSION_KEYS, PROXY_DIMENSIONS, type AnalysisReport } from "../../api/contract";

const LABELS: Record<(typeof DIMENSION_KEYS)[number], string> = {
  "hydration-appearance": "Hydration",
  oiliness: "Oiliness",
  pigmentation: "Pigmentation",
  spots: "Spots",
  pores: "Pores",
  blackheads: "Blackheads",
  "wrinkles-texture": "Wrinkles & texture",
  acne: "Acne",
  inflammation: "Inflammation",
  redness: "Redness",
  sensitivity: "Sensitivity",
  "elasticity-appearance": "Elasticity",
};

export function DimensionGrid({ dimensions }: { dimensions: AnalysisReport["dimensions"] }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {DIMENSION_KEYS.map((key) => {
        const d = dimensions[key];
        const isProxy = (PROXY_DIMENSIONS as readonly string[]).includes(key);
        return (
          <div key={key} className="rounded-xl border border-stone-200 bg-white p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-stone-900">{LABELS[key]}</span>
              {isProxy && (
                <span className="rounded-full bg-clinical-soft px-2 py-0.5 text-[10px] font-semibold text-clinical">
                  visual proxy
                </span>
              )}
            </div>
            <div className="mt-2 h-1.5 rounded bg-stone-100">
              <div
                className="h-full rounded bg-clinical"
                style={{ width: `${Math.round(d.score * 100)}%` }}
              />
            </div>
            <p className="mt-2 text-xs leading-relaxed text-stone-600">{d.note}</p>
          </div>
        );
      })}
    </div>
  );
}
```

`FindingsList.tsx`:

```tsx
import type { MergedFinding } from "../../types";

const BADGES = {
  agree: { text: "✓ 2 analyses agree", cls: "bg-clinical-soft text-clinical border-clinical/30" },
  "llm-only": { text: "AI analysis only", cls: "bg-stone-100 text-stone-600 border-stone-200" },
  "classifier-only": {
    text: "Flagged by classifier",
    cls: "bg-stone-100 text-stone-600 border-stone-200",
  },
  conflict: { text: "⚑ Analyses differ", cls: "bg-amber-50 text-amber-700 border-amber-200" },
} as const;

export function FindingsList({ findings }: { findings: MergedFinding[] }) {
  if (findings.length === 0) {
    return <p className="text-sm text-stone-500">No notable findings.</p>;
  }
  return (
    <ul className="space-y-3">
      {findings.map((f) => {
        const badge = BADGES[f.agreement];
        return (
          <li
            key={f.id}
            className={`rounded-xl border bg-white p-4 ${
              f.escalated ? "border-flag" : "border-stone-200"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-bold text-stone-900">{f.label}</span>
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${badge.cls}`}>
                {badge.text}
              </span>
            </div>
            <div className="mt-2 h-1.5 rounded bg-stone-100">
              <div
                className="h-full rounded bg-clinical"
                style={{ width: `${Math.round(f.confidence * 100)}%` }}
              />
            </div>
            {f.note && <p className="mt-2 text-xs text-stone-600">{f.note}</p>}
            {f.escalated && (
              <p className="mt-2 text-xs font-semibold text-amber-700">
                Worth a professional look — a dermatologist can evaluate this properly.
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 4: Run — PASS (5 tests). Commit:**

```bash
git add src/features/skin-analysis/components/results/DimensionGrid.tsx src/features/skin-analysis/components/results/DimensionGrid.test.tsx src/features/skin-analysis/components/results/FindingsList.tsx src/features/skin-analysis/components/results/FindingsList.test.tsx
git commit -m "feat: dimension grid and findings list with agreement badges"
```

---

## Task 7: ReportView composition + print/download

**Files:**
- Create: `src/features/skin-analysis/components/results/ReportView.tsx` (+ test)
- Modify: `src/index.css`

- [ ] **Step 1: Failing test** `ReportView.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReportView } from "./ReportView";
import { buildVerdict } from "../../ml/verdict";
import golden from "../../../../../server/analysis/fixtures/golden-report.json";
import type { AnalysisReport } from "../../api/contract";

const report = golden as unknown as AnalysisReport;

describe("ReportView", () => {
  it("renders summary, skin type, dimensions, findings, and the disclaimer", () => {
    render(
      <ReportView report={report} verdict={buildVerdict(report, [])} onNewScan={() => {}} />,
    );
    expect(screen.getByText(report.summary)).toBeInTheDocument();
    expect(screen.getByText(/combination/i)).toBeInTheDocument();
    expect(screen.getByText(/fitzpatrick/i)).toBeInTheDocument();
    expect(screen.getByText(/not a diagnosis/i)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /facial map/i })).toBeInTheDocument();
  });

  it("shows the partial banner for degraded verdicts", () => {
    render(
      <ReportView report={null} verdict={buildVerdict(null, [])} onNewScan={() => {}} />,
    );
    expect(screen.getByText(/partial analysis/i)).toBeInTheDocument();
  });

  it("offers Download PDF (print) and New scan actions", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    const onNewScan = vi.fn();
    render(<ReportView report={report} verdict={buildVerdict(report, [])} onNewScan={onNewScan} />);
    await userEvent.click(screen.getByRole("button", { name: /download pdf/i }));
    expect(print).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /new scan/i }));
    expect(onNewScan).toHaveBeenCalled();
    print.mockRestore();
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement** `ReportView.tsx`:

```tsx
import type { Verdict } from "../../types";
import type { AnalysisReport } from "../../api/contract";
import { FacialMap } from "./FacialMap";
import { DimensionGrid } from "./DimensionGrid";
import { FindingsList } from "./FindingsList";

export function ReportView({
  report,
  verdict,
  onNewScan,
}: {
  report: AnalysisReport | null;
  verdict: Verdict;
  onNewScan: () => void;
}) {
  return (
    <div data-print-root className="mx-auto max-w-2xl space-y-6">
      {verdict.degraded === "classifier-only" && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800" role="status">
          Partial analysis — AI review pending. Re-analyze when back online.
        </div>
      )}

      <section className="rounded-2xl border border-warm-border bg-warm-surface p-5">
        <h2 className="text-xs font-bold uppercase tracking-wider text-clinical">Scan result</h2>
        <p className="mt-2 text-lg font-bold text-stone-900">{verdict.summary}</p>
        {report && (
          <p className="mt-2 text-sm text-stone-600">
            Skin type: <strong>{report.skinType.sebum}</strong>
            {report.skinType.sensitivityCues && ", sensitivity cues present"} · Fitzpatrick ~
            {report.skinType.fitzpatrickApprox} (approximate)
          </p>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-sm font-bold text-stone-900">Facial map</h3>
        <FacialMap findings={verdict.findings} />
        {report && report.zoneObservations.length > 0 && (
          <ul className="mt-2 space-y-1">
            {report.zoneObservations.map((z) => (
              <li key={z.zone} className="text-xs text-stone-600">
                <strong className="text-stone-800">{z.zone}:</strong> {z.observation}
              </li>
            ))}
          </ul>
        )}
      </section>

      {report && (
        <section>
          <h3 className="mb-2 text-sm font-bold text-stone-900">Report dimensions</h3>
          <DimensionGrid dimensions={report.dimensions} />
        </section>
      )}

      <section>
        <h3 className="mb-2 text-sm font-bold text-stone-900">Findings</h3>
        <FindingsList findings={verdict.findings} />
      </section>

      <p className="rounded-xl bg-clinical-soft p-3 text-xs text-stone-700">
        <strong>This is not a diagnosis.</strong> This tool helps decide whether to see a
        professional — it cannot replace one.
      </p>

      <div className="flex gap-3 print:hidden">
        <button
          onClick={() => window.print()}
          className="flex-1 rounded-lg bg-clinical py-3 text-sm font-semibold text-white"
        >
          Download PDF
        </button>
        <button
          onClick={onNewScan}
          className="flex-1 rounded-lg border border-clinical py-3 text-sm font-semibold text-clinical"
        >
          New scan
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Append the print stylesheet to `src/index.css`:**

```css
@media print {
  body * {
    visibility: hidden;
  }
  [data-print-root],
  [data-print-root] * {
    visibility: visible;
  }
  [data-print-root] {
    position: absolute;
    inset: 0;
    padding: 1cm;
  }
}
```

- [ ] **Step 5: Run — PASS (3 tests). Commit:**

```bash
git add src/features/skin-analysis/components/results/ReportView.tsx src/features/skin-analysis/components/results/ReportView.test.tsx src/index.css
git commit -m "feat: report view with facial map, dimensions, and print-to-PDF"
```

---

## Task 8: Wire the flow — loading screen + results in CaptureFlow

**Files:**
- Modify: `src/features/skin-analysis/components/capture/CaptureFlow.tsx`
- Modify: `src/features/skin-analysis/components/capture/CaptureFlow.test.tsx`

CaptureFlow gains a `patientId` prop (Plan 6 passes the real one; `SkinAnalysisPage` passes a placeholder until then).

- [ ] **Step 1: Failing test.** Append to `CaptureFlow.test.tsx` (mock `use-analysis`'s dependencies is unnecessary — drive the machine directly):

```tsx
import { buildVerdict } from "../../ml/verdict";

describe("CaptureFlow — results rendering", () => {
  beforeEach(() => useScanMachine.getState().reset());

  it("renders the loading stages while analyzing", () => {
    useScanMachine.getState().grantConsent();
    useScanMachine.getState().cameraReady();
    useScanMachine.getState().captured({
      blob: new Blob(["x"], { type: "image/jpeg" }),
      mimeType: "image/jpeg",
      mode: "face",
      source: "camera",
      width: 10,
      height: 10,
    });
    render(<CaptureFlow mode="face" patientId="p-1" />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText(/running deep analysis/i)).toBeInTheDocument();
  });

  it("renders the report when results are ready", () => {
    useScanMachine.getState().resultsReady(buildVerdict(null, []), "scan-1");
    render(<CaptureFlow mode="face" patientId="p-1" />);
    expect(screen.getByText(/partial analysis/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /new scan/i })).toBeInTheDocument();
  });
});
```

Also update every existing `render(<CaptureFlow mode="face" />)` call in this file to `render(<CaptureFlow mode="face" patientId="p-1" />)`.

- [ ] **Step 2: Run to verify failure** (patientId prop unknown / loading UI absent).

- [ ] **Step 3: Modify `CaptureFlow.tsx`:**
- Signature: `export function CaptureFlow({ mode, patientId }: { mode: CaptureMode; patientId: string })`.
- Add local stage state + analysis hook:

```tsx
  const [stage, setStage] = useState<AnalysisStage | "quality">("quality");
  const runAnalysis = useAnalysis(setStage);
```

(with `import { useState } from "react";`, `import { useAnalysis, type AnalysisStage } from "../../hooks/use-analysis";`, `import { AnalysisProgress } from "../results/AnalysisProgress";`, `import { ReportView } from "../results/ReportView";`)
- In `process()`: replace the `classify(...).catch(...)` line with:

```tsx
      setStage("quality");
      machine.captured(result);
      void runAnalysis(result, patientId);
```

(remove the now-unused `useClassifier` import and `classify` variable — the hook owns classification.)
- Replace the analyzing placeholder block with:

```tsx
      {machine.state === "analyzing" && <AnalysisProgress stage={stage} />}
```

- Add a results branch at the top of the non-idle render (before the error blocks):

```tsx
  if (machine.state === "results" && machine.verdict) {
    return (
      <ReportView report={null} verdict={machine.verdict} onNewScan={machine.reset} />
    );
  }
```

NOTE: `report` is passed as `null` here because the machine stores only the verdict; the full `AnalysisReport` (dimensions/zones/skin type) rendering from the live flow lands in Plan 6 when scans are fetched back by id — the verdict's findings/summary/partial banner render now. Add `// TODO(plan-6): fetch scan by machine.scanId to render dimensions + facial zones from the stored report`.
- Update `SkinAnalysisPage.tsx`: pass `patientId="walk-in"` with `// TODO(plan-6): real patient selection`.

- [ ] **Step 4: Run full suite — all passing. `npm run verify` green. Commit:**

```bash
git add src/features/skin-analysis/components/capture/CaptureFlow.tsx src/features/skin-analysis/components/capture/CaptureFlow.test.tsx src/features/skin-analysis/SkinAnalysisPage.tsx
git commit -m "feat: wire staged loading and report view into the scan flow"
```

---

## Definition of Done

- `npm run verify` fully green.
- `verdict.ts` merge rules exhaustively tested: agree/llm-only/classifier-only, combined confidence, severity max, attention escalation from either source, escalated-first ordering, partial (classifier-only) and llm-only degraded verdicts.
- Loading screen shows the five real pipeline stages, advances on actual events, `role="status"`, reduced-motion respected.
- Report view renders summary, skin type, facial map with zone markers (escalated = amber), 12-dimension grid with visual-proxy labels, findings with agreement badges, non-diagnosis disclaimer; partial scans show the pending banner.
- Download PDF triggers print with a print stylesheet isolating the report; New scan resets.

## What this plan intentionally defers

- Real patient selection + fetching stored scans/reports by id (full report from history) — Plan 6.
- Before/after comparison and trends — Plan 6.
- QR capture UI — Plan 6.
