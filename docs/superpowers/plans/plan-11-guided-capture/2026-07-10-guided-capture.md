# Guided Multi-Angle Capture Implementation Plan (Plan 11 / Phase B)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Spec: `docs/superpowers/specs/2026-07-10-face-analysis-architecture.md`. Depends on Plan 10 (pipeline core).

**Goal:** Face-ID-style guided capture: 5-angle sequence with live instructions, per-image validation + retake loop, MediaPipe landmarks wired for real, ending in an on-device `FaceReport` — responsive at 375/768/1280.

**Architecture:** A pure `guidance` state machine (`ai/face/guidance/`) drives the sequence; a thin MediaPipe wrapper (`ai/face/landmarks/mediapipe.ts`) produces `FaceGeometry` from video frames; React components render state and never contain sequencing logic. Report rendering = `FaceReportView` (responsive grid).

**Tech Stack:** @mediapipe/tasks-vision (already a dependency), React 18, Tailwind, vitest + Testing Library; preview tool for live/responsive verification.

---

### Task 1: Capture-sequence state machine (pure)

**Files:** Create `ai/face/guidance/sequence.ts` · Test `ai/face/guidance/sequence.test.ts`

- [ ] **Step 1 — failing test:**

```typescript
// ai/face/guidance/sequence.test.ts
import { describe, it, expect } from "vitest";
import { createSequence, instructionFor } from "./sequence";
import { FACE_ANGLES } from "../../../shared/face";

describe("capture sequence", () => {
  it("walks the five angles in order", () => {
    let s = createSequence();
    expect(s.current).toBe("front");
    for (const angle of FACE_ANGLES) {
      expect(s.current).toBe(angle);
      s = s.accept({ ok: true, issues: [] });
    }
    expect(s.done).toBe(true);
    expect(s.captured).toHaveLength(5);
  });
  it("failed validation stays on the same angle with retake guidance", () => {
    let s = createSequence();
    s = s.accept({ ok: false, issues: ["too-dark"] });
    expect(s.current).toBe("front");
    expect(s.lastIssues).toEqual(["too-dark"]);
    expect(s.captured).toHaveLength(0);
  });
  it("instructions exist for every angle and every issue", () => {
    for (const angle of FACE_ANGLES) expect(instructionFor(angle).length).toBeGreaterThan(5);
    for (const issue of ["no-face", "wrong-orientation", "too-dark", "too-bright", "blur", "face-too-small", "low-resolution"])
      expect(instructionFor("front", issue).length).toBeGreaterThan(5);
  });
});
```

- [ ] **Step 2 — run, FAIL.**
- [ ] **Step 3 — implement:**

```typescript
// ai/face/guidance/sequence.ts
// Pure capture-sequence state machine. UI renders it; it never touches the DOM.
import { FACE_ANGLES, type AngleQuality, type FaceAngle } from "../../../shared/face";

export interface SequenceState {
  current: FaceAngle;
  index: number;               // 0..4
  captured: FaceAngle[];
  lastIssues: string[];        // from the most recent failed validation
  done: boolean;
  accept(quality: AngleQuality): SequenceState;
}

export function createSequence(index = 0, captured: FaceAngle[] = [], lastIssues: string[] = []): SequenceState {
  const done = index >= FACE_ANGLES.length;
  return {
    current: FACE_ANGLES[Math.min(index, FACE_ANGLES.length - 1)],
    index, captured, lastIssues, done,
    accept(quality: AngleQuality): SequenceState {
      if (done) return this;
      return quality.ok
        ? createSequence(index + 1, [...captured, FACE_ANGLES[index]], [])
        : createSequence(index, captured, quality.issues);
    },
  };
}

const ANGLE_INSTRUCTIONS: Record<FaceAngle, string> = {
  front: "Look straight ahead and position your face inside the frame.",
  "left-45": "Turn your head slightly to the left.",
  "right-45": "Turn your head slightly to the right.",
  "left-profile": "Turn fully to the left so we see your profile.",
  "right-profile": "Turn fully to the right so we see your profile.",
};

const ISSUE_INSTRUCTIONS: Record<string, string> = {
  "no-face": "We can't see a face — position your face inside the frame.",
  "wrong-orientation": "Adjust your head to match the requested angle.",
  "too-dark": "Find better lighting — face a window or lamp.",
  "too-bright": "Too much light — turn away from the direct light source.",
  blur: "Hold the camera steady and try again.",
  "face-too-small": "Move closer so your face fills more of the frame.",
  "low-resolution": "Camera resolution is too low — try the rear camera or another device.",
};

export function instructionFor(angle: FaceAngle, issue?: string): string {
  return (issue && ISSUE_INSTRUCTIONS[issue]) || ANGLE_INSTRUCTIONS[angle];
}
```

- [ ] **Step 4 — PASS.** **Step 5 — commit** `feat(face): capture-sequence state machine + guidance strings`

---

### Task 2: MediaPipe Face Landmarker wrapper + model asset

**Files:** Create `ai/face/landmarks/mediapipe.ts` · asset `frontend/public/models/face_landmarker.task` (downloaded) · Test `ai/face/landmarks/mediapipe.test.ts` (pose math only)

- [ ] **Step 1:** Download the model (one-time, gitignored — add `*.task` to `.gitignore`):
`curl -L -o frontend/public/models/face_landmarker.task https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task`
(≈3.7 MB. Serving path `/models/face_landmarker.task`; Phase D moves distribution to the manifest channel.)

- [ ] **Step 2 — failing test (pose math is pure; the wasm loader itself is verified live in Task 5):**

```typescript
// ai/face/landmarks/mediapipe.test.ts
import { describe, it, expect } from "vitest";
import { matrixToPose } from "./mediapipe";

describe("matrixToPose", () => {
  it("identity matrix → zero pose", () => {
    const I = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
    const p = matrixToPose(I);
    expect(Math.abs(p.yawDeg)).toBeLessThan(1e-6);
    expect(Math.abs(p.pitchDeg)).toBeLessThan(1e-6);
  });
  it("rotation about Y → yaw", () => {
    const a = (45 * Math.PI) / 180;
    const R = [Math.cos(a),0,Math.sin(a),0, 0,1,0,0, -Math.sin(a),0,Math.cos(a),0, 0,0,0,1];
    expect(matrixToPose(R).yawDeg).toBeCloseTo(45, 1);
  });
});
```

- [ ] **Step 3 — implement:**

```typescript
// ai/face/landmarks/mediapipe.ts
// Thin wrapper: video/image frame → FaceGeometry | null. Loader is lazy + cached.
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import type { FaceGeometry } from "../types";

export const LANDMARKER_MODEL_URL = "/models/face_landmarker.task";
const WASM_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm"; // Phase D: self-host via model channel

let landmarkerPromise: Promise<FaceLandmarker> | null = null;

export function getLandmarker(): Promise<FaceLandmarker> {
  landmarkerPromise ??= (async () => {
    const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
    return FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: LANDMARKER_MODEL_URL },
      runningMode: "VIDEO",
      numFaces: 1,
      outputFacialTransformationMatrixes: true,
    });
  })();
  return landmarkerPromise;
}

/** 4x4 row-major transformation matrix → yaw/pitch/roll degrees. Pure, unit-tested. */
export function matrixToPose(m: number[]): { yawDeg: number; pitchDeg: number; rollDeg: number } {
  const deg = (r: number) => (r * 180) / Math.PI;
  const yaw = Math.asin(Math.max(-1, Math.min(1, m[2])));
  const pitch = Math.atan2(-m[6], m[10]);
  const roll = Math.atan2(-m[1], m[0]);
  return { yawDeg: deg(yaw), pitchDeg: deg(pitch), rollDeg: deg(roll) };
}

export async function detectGeometry(video: HTMLVideoElement, timestampMs: number): Promise<FaceGeometry | null> {
  const lm = await getLandmarker();
  const res = lm.detectForVideo(video, timestampMs);
  const landmarks = res.faceLandmarks?.[0];
  if (!landmarks || landmarks.length === 0) return null;
  const matrix = res.facialTransformationMatrixes?.[0]?.data;
  const pose = matrix ? matrixToPose([...matrix]) : { yawDeg: 0, pitchDeg: 0, rollDeg: 0 };
  return { landmarks: landmarks.map((l) => ({ x: l.x, y: l.y, z: l.z })), ...pose };
}
```

- [ ] **Step 4 — PASS** (pose tests). **Step 5 — commit** `feat(face): mediapipe landmarker wrapper (lazy load, pose from matrix)`

---

### Task 3: `use-face-scan` hook — camera frames → sequence → report

**Files:** Create `frontend/src/features/skin-analysis/hooks/use-face-scan.ts` · Test `frontend/src/features/skin-analysis/hooks/use-face-scan.test.ts`

The hook owns: sequence state, per-frame guidance (live geometry polling ~5 fps), capture (grab frame → `analyzeView` via injected pipeline), retake on failed validation, final `buildFaceReport`. All external effects are injectable for tests.

- [ ] **Step 1 — failing test:**

```typescript
// use-face-scan.test.ts
import { describe, it, expect, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useFaceScan } from "./use-face-scan";
import type { AnalyzedView } from "../../../../../ai/face/types";

const okView = (angle: AnalyzedView["angle"]): AnalyzedView =>
  ({ angle, quality: { ok: true, issues: [] }, zones: {} });

describe("useFaceScan", () => {
  it("advances through angles on successful captures and finishes with a report", async () => {
    const analyze = vi.fn(async (angle) => okView(angle));
    const { result } = renderHook(() => useFaceScan({ analyzeFrame: analyze }));
    expect(result.current.currentAngle).toBe("front");
    for (let i = 0; i < 5; i++) await act(() => result.current.captureCurrent());
    await waitFor(() => expect(result.current.report).not.toBeNull());
    expect(result.current.report!.kind).toBe("face-v2");
    expect(analyze).toHaveBeenCalledTimes(5);
  });
  it("failed validation keeps the angle and exposes retake guidance", async () => {
    const analyze = vi.fn(async (angle) => ({ angle, quality: { ok: false, issues: ["blur"] }, zones: {} }));
    const { result } = renderHook(() => useFaceScan({ analyzeFrame: analyze }));
    await act(() => result.current.captureCurrent());
    expect(result.current.currentAngle).toBe("front");
    expect(result.current.instruction).toMatch(/steady/i);
  });
});
```

- [ ] **Step 2 — FAIL.**
- [ ] **Step 3 — implement:**

```typescript
// use-face-scan.ts
import { useCallback, useMemo, useState } from "react";
import type { FaceAngle, FaceReport } from "@shared/face";
import { createSequence, instructionFor } from "@ai/face/guidance/sequence";
import { buildFaceReport } from "@ai/face/pipeline";
import type { AnalyzedView } from "@ai/face/types";

export interface FaceScanDeps {
  /** Grab + analyze the current camera frame for the requested angle (real impl wires
   *  video → pixels + detectGeometry → analyzeView). Injected for tests. */
  analyzeFrame: (angle: FaceAngle) => Promise<AnalyzedView>;
  modelVersions?: Record<string, string>;
}

export function useFaceScan({ analyzeFrame, modelVersions = { "face-landmarker": "v1" } }: FaceScanDeps) {
  const [seq, setSeq] = useState(() => createSequence());
  const [views, setViews] = useState<AnalyzedView[]>([]);
  const [report, setReport] = useState<FaceReport | null>(null);
  const [busy, setBusy] = useState(false);

  const captureCurrent = useCallback(async () => {
    if (seq.done || busy) return;
    setBusy(true);
    try {
      const view = await analyzeFrame(seq.current);
      const next = seq.accept(view.quality);
      setSeq(next);
      if (view.quality.ok) {
        const all = [...views, view];
        setViews(all);
        if (next.done) setReport(buildFaceReport(all, modelVersions));
      }
    } finally {
      setBusy(false);
    }
  }, [seq, views, busy, analyzeFrame, modelVersions]);

  const instruction = useMemo(
    () => instructionFor(seq.current, seq.lastIssues[0]),
    [seq],
  );

  return {
    currentAngle: seq.current, stepIndex: seq.index, totalSteps: 5,
    done: seq.done, instruction, lastIssues: seq.lastIssues,
    busy, report, captureCurrent,
    reset: () => { setSeq(createSequence()); setViews([]); setReport(null); },
  };
}
```

- [ ] **Step 4 — PASS.** **Step 5 — commit** `feat(ui): use-face-scan hook (sequence, retake, report assembly)`

---

### Task 4: Guided capture UI + real frame adapter

**Files:** Create `frontend/src/features/skin-analysis/components/capture/GuidedFaceScan.tsx`, `frontend/src/features/skin-analysis/components/capture/frame-adapter.ts` · Modify `CaptureFlow.tsx` (face mode → GuidedFaceScan) · Test `GuidedFaceScan.test.tsx`

- [ ] **Step 1 — failing test (UI states, fake deps):**

```typescript
// GuidedFaceScan.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GuidedFaceScan } from "./GuidedFaceScan";

describe("GuidedFaceScan", () => {
  it("shows step progress and the current instruction", () => {
    render(<GuidedFaceScan analyzeFrame={vi.fn(async (a) => ({ angle: a, quality: { ok: true, issues: [] }, zones: {} }))} onComplete={vi.fn()} />);
    expect(screen.getByText(/step 1 of 5/i)).toBeInTheDocument();
    expect(screen.getByText(/look straight ahead/i)).toBeInTheDocument();
  });
  it("failed capture shows retake guidance", async () => {
    render(<GuidedFaceScan analyzeFrame={vi.fn(async (a) => ({ angle: a, quality: { ok: false, issues: ["too-dark"] }, zones: {} }))} onComplete={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /capture/i }));
    expect(await screen.findByText(/better lighting/i)).toBeInTheDocument();
  });
  it("calls onComplete with the report after five good captures", async () => {
    const onComplete = vi.fn();
    render(<GuidedFaceScan analyzeFrame={vi.fn(async (a) => ({ angle: a, quality: { ok: true, issues: [] }, zones: {} }))} onComplete={onComplete} />);
    for (let i = 0; i < 5; i++) await userEvent.click(screen.getByRole("button", { name: /capture/i }));
    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ kind: "face-v2" }));
  });
});
```

- [ ] **Step 2 — FAIL.**
- [ ] **Step 3 — implement:** `GuidedFaceScan` renders: camera feed (reuse existing `CameraFeed`/`useCamera`), an oval framing overlay (`aspect-[3/4] max-h-[60vh]` responsive), step dots (`Step {n} of 5`), the instruction line (`aria-live="polite"`), a `min-h-[44px]` Capture button (busy-disabled), retake banner on `lastIssues`. `frame-adapter.ts` exports the real `analyzeFrame`:

```typescript
// frame-adapter.ts — real deps for useFaceScan
import type { FaceAngle } from "@shared/face";
import { detectGeometry } from "@ai/face/landmarks/mediapipe";
import { analyzeView } from "@ai/face/pipeline";
import type { AnalyzedView, Pixels } from "@ai/face/types";

export function makeAnalyzeFrame(video: () => HTMLVideoElement | null) {
  return async (angle: FaceAngle): Promise<AnalyzedView> => {
    const el = video();
    if (!el) return { angle, quality: { ok: false, issues: ["no-face"] }, zones: {} };
    const canvas = document.createElement("canvas");
    canvas.width = el.videoWidth; canvas.height = el.videoHeight;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(el, 0, 0);
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const pixels: Pixels = { data, width, height };
    const geometry = await detectGeometry(el, performance.now());
    return analyzeView({ angle, pixels, geometry });
  };
}
```
Wire into `CaptureFlow.tsx`: face mode renders `GuidedFaceScan` (upload path stays for closeup/back-compat); on complete → Phase C persistence (for now: results state renders the report via Task 5's view).

- [ ] **Step 4 — PASS + full suite green.** **Step 5 — commit** `feat(ui): guided 5-angle capture with live guidance + retake loop`

---

### Task 5: FaceReport view (responsive) + live verification

**Files:** Create `frontend/src/features/skin-analysis/components/results/FaceReportView.tsx` · Test `FaceReportView.test.tsx`

- [ ] **Step 1 — failing test:** render golden report (reuse `goldenFaceReport()` from `shared/face.test.ts` — export it from a fixture module `shared/testing/face-fixtures.ts` to avoid importing a test file): overall score ring, 11 dimension rows with score bars + confidence, recommendations list, disclaimer always present, per-zone details expandable.

```typescript
// FaceReportView.test.tsx (core assertions)
import { render, screen } from "@testing-library/react";
import { FaceReportView } from "./FaceReportView";
import { goldenFaceReport } from "../../../../../../shared/testing/face-fixtures";

it("renders overall score, all dimensions, recommendations, disclaimer", () => {
  render(<FaceReportView report={goldenFaceReport()} />);
  expect(screen.getByText(/overall/i)).toBeInTheDocument();
  expect(screen.getAllByRole("listitem").length).toBeGreaterThanOrEqual(11);
  expect(screen.getByText(/sunscreen/i)).toBeInTheDocument();
  expect(screen.getByText(/not a medical diagnosis/i)).toBeInTheDocument();
});
```

- [ ] **Step 2 — FAIL. Step 3 — implement:** layout `grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3` (dimensions cards), overall banner full-width, score bars like LesionResult pattern, confidence as subtle percentage, `max-w-5xl mx-auto px-4`. Move `goldenFaceReport` into `shared/testing/face-fixtures.ts`, re-export in the contract test.
- [ ] **Step 4 — PASS + typecheck.**
- [ ] **Step 5 — LIVE verification (required):** `npm run dev` + backend lite; complete a guided scan with the real camera (or upload-fallback path); `preview_resize` 375/768/1280 + screenshots: no horizontal scroll, capture button ≥44px, overlay fits `60vh` on phone. MediaPipe loads (network tab shows the .task + wasm fetch) and a real frame produces geometry.
- [ ] **Step 6 — commit** `feat(ui): responsive FaceReportView + live capture verification`

---

## Self-review checklist
- [ ] Spec capture sequence + on-screen guide strings ✓ · retake loop ✓ · Face-ID feel (overlay, steps, live instruction) ✓
- [ ] All sequencing logic pure/tested; components dumb ✓
- [ ] Responsive at 375/768/1280 with evidence screenshots ✓
- [ ] MediaPipe lazy-loaded; no analysis code imports DOM ✓
