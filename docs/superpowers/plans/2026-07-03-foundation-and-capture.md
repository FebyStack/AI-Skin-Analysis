# Foundation & Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the portable skin-analysis feature module and deliver a working, cross-platform capture flow — consent-gated camera (phone/PC) plus photo upload with metadata stripping — that produces a validated in-memory image ready for analysis.

**Architecture:** A Vite + React + TypeScript app with all feature code isolated under `src/features/skin-analysis/`. Capture is driven by an explicit Zustand state machine; camera access uses `getUserMedia` with front/rear selection and an upload fallback. All logic units (`redact`, `consent`, `scan-machine`) are pure/testable without a real browser camera. This plan builds the foundation the later plans (ML, LLM proxy, verdict, history) plug into via `types.ts`.

**Tech Stack:** Vite, React 18, TypeScript, Tailwind CSS, Zustand, Vitest, @testing-library/react, jsdom.

---

## File Structure

Files created in this plan:

- `package.json`, `vite.config.ts`, `tsconfig.json`, `tailwind.config.js`, `postcss.config.js`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/index.css` — app scaffold
- `vitest.config.ts`, `src/test/setup.ts` — test harness
- `src/features/skin-analysis/types.ts` — the shared contract (Finding, ScanResult, Verdict, CaptureResult)
- `src/features/skin-analysis/privacy/consent.ts` — versioned consent state (pure)
- `src/features/skin-analysis/privacy/redact.ts` — EXIF/GPS stripping (pure)
- `src/features/skin-analysis/store/scan-machine.ts` — capture state machine (Zustand)
- `src/features/skin-analysis/hooks/use-camera.ts` — getUserMedia lifecycle + device selection
- `src/features/skin-analysis/components/consent/ConsentGate.tsx` — blocks flow until accepted
- `src/features/skin-analysis/components/capture/CameraFeed.tsx` — live video + capture button
- `src/features/skin-analysis/components/capture/UploadDropzone.tsx` — upload fallback
- `src/features/skin-analysis/components/capture/CaptureFlow.tsx` — orchestrates consent → capture
- `src/features/skin-analysis/SkinAnalysisPage.tsx` — the single exported entry point
- Test files colocated under `__tests__/` or as `*.test.ts(x)` beside each unit

---

## Task 1: Scaffold the Vite + React + TypeScript app

**Files:**
- Create: `package.json`
- Create: `vite.config.ts`
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `index.html`
- Create: `src/main.tsx`
- Create: `src/App.tsx`
- Create: `src/index.css`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "ai-skin-analysis",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "lint": "eslint ."
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "zustand": "^4.5.5"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.5.0",
    "@testing-library/react": "^16.0.1",
    "@testing-library/user-event": "^14.5.2",
    "@types/react": "^18.3.11",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.3.2",
    "autoprefixer": "^10.4.20",
    "eslint": "^9.12.0",
    "jsdom": "^25.0.1",
    "postcss": "^8.4.47",
    "tailwindcss": "^3.4.13",
    "typescript": "^5.6.2",
    "vite": "^5.4.8",
    "vitest": "^2.1.2"
  }
}
```

- [ ] **Step 2: Create `vite.config.ts`**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
});
```

- [ ] **Step 3: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] }
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

- [ ] **Step 4: Create `tsconfig.node.json`**

```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true,
    "strict": true
  },
  "include": ["vite.config.ts", "vitest.config.ts"]
}
```

- [ ] **Step 5: Create `index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>AI Skin Analysis</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: Create `src/index.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 7: Create `src/App.tsx`**

```tsx
import { SkinAnalysisPage } from "@/features/skin-analysis/SkinAnalysisPage";

export default function App() {
  return <SkinAnalysisPage />;
}
```

- [ ] **Step 8: Create `src/main.tsx`**

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 9: Install dependencies**

Run: `npm install`
Expected: dependencies installed, `node_modules/` created, no errors.

> Note: `SkinAnalysisPage` does not exist yet — the app won't build until Task 8. That's expected; later tasks build up to it. Do not run `npm run dev` until Task 8.

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json vite.config.ts tsconfig.json tsconfig.node.json index.html src/main.tsx src/App.tsx src/index.css
git commit -m "chore: scaffold Vite + React + TS app"
```

---

## Task 2: Configure Tailwind and the test harness

**Files:**
- Create: `tailwind.config.js`
- Create: `postcss.config.js`
- Create: `vitest.config.ts`
- Create: `src/test/setup.ts`

- [ ] **Step 1: Create `tailwind.config.js`**

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        clinical: { DEFAULT: "#0f766e", soft: "#f0fdfa" },
        warm: { surface: "#fffdf9", border: "#ede5d8" },
        flag: "#f59e0b",
      },
    },
  },
  plugins: [],
};
```

- [ ] **Step 2: Create `postcss.config.js`**

```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
});
```

- [ ] **Step 4: Create `src/test/setup.ts`**

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 5: Verify the test runner starts**

Run: `npx vitest run`
Expected: Vitest runs and reports "No test files found" (exit 0 or the "no tests" message). This confirms config is valid.

- [ ] **Step 6: Commit**

```bash
git add tailwind.config.js postcss.config.js vitest.config.ts src/test/setup.ts
git commit -m "chore: configure Tailwind and Vitest harness"
```

---

## Task 3: Define the shared type contract

**Files:**
- Create: `src/features/skin-analysis/types.ts`
- Test: `src/features/skin-analysis/types.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { isFinding, type Finding, type CaptureResult } from "./types";

describe("type guards", () => {
  it("accepts a well-formed Finding", () => {
    const f: Finding = {
      id: "acne",
      label: "Mild acne",
      source: "llm",
      confidence: 0.7,
      severity: "mild",
    };
    expect(isFinding(f)).toBe(true);
  });

  it("rejects an object missing required fields", () => {
    expect(isFinding({ id: "x" })).toBe(false);
  });

  it("rejects out-of-range confidence", () => {
    expect(
      isFinding({ id: "x", label: "y", source: "llm", confidence: 2, severity: "mild" }),
    ).toBe(false);
  });

  it("models a CaptureResult carrying a Blob and mode", () => {
    const c: CaptureResult = {
      blob: new Blob(["x"], { type: "image/jpeg" }),
      mimeType: "image/jpeg",
      mode: "face",
      source: "camera",
      width: 640,
      height: 480,
    };
    expect(c.mode).toBe("face");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/skin-analysis/types.test.ts`
Expected: FAIL — cannot resolve `./types`.

- [ ] **Step 3: Write minimal implementation**

```ts
export type FindingSource = "classifier" | "llm";
export type Severity = "info" | "mild" | "moderate" | "attention";
export type CaptureMode = "face" | "closeup";
export type CaptureSource = "camera" | "upload";

export interface Finding {
  id: string;
  label: string;
  source: FindingSource;
  confidence: number; // 0..1
  severity: Severity;
  note?: string;
}

export type Agreement = "agree" | "llm-only" | "classifier-only" | "conflict";

export interface MergedFinding extends Finding {
  agreement: Agreement;
  escalated: boolean;
}

export interface Verdict {
  summary: string;
  findings: MergedFinding[];
  disclaimerShown: true;
  degraded?: "classifier-only" | "llm-only";
}

export interface ScanResult {
  createdAt: number;
  mode: CaptureMode;
  verdict: Verdict;
}

export interface CaptureResult {
  blob: Blob;
  mimeType: string;
  mode: CaptureMode;
  source: CaptureSource;
  width: number;
  height: number;
}

export function isFinding(x: unknown): x is Finding {
  if (typeof x !== "object" || x === null) return false;
  const f = x as Record<string, unknown>;
  return (
    typeof f.id === "string" &&
    typeof f.label === "string" &&
    (f.source === "classifier" || f.source === "llm") &&
    typeof f.confidence === "number" &&
    f.confidence >= 0 &&
    f.confidence <= 1 &&
    (f.severity === "info" ||
      f.severity === "mild" ||
      f.severity === "moderate" ||
      f.severity === "attention")
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/skin-analysis/types.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/skin-analysis/types.ts src/features/skin-analysis/types.test.ts
git commit -m "feat: add shared type contract for skin-analysis"
```

---

## Task 4: Versioned consent logic

**Files:**
- Create: `src/features/skin-analysis/privacy/consent.ts`
- Test: `src/features/skin-analysis/privacy/consent.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { CONSENT_VERSION, hasValidConsent, recordConsent, revokeConsent } from "./consent";

describe("consent", () => {
  beforeEach(() => localStorage.clear());

  it("reports no consent initially", () => {
    expect(hasValidConsent()).toBe(false);
  });

  it("reports valid consent after recording the current version", () => {
    recordConsent();
    expect(hasValidConsent()).toBe(true);
  });

  it("invalidates consent recorded under an older version", () => {
    localStorage.setItem(
      "skin-analysis.consent",
      JSON.stringify({ version: CONSENT_VERSION - 1, at: Date.now() }),
    );
    expect(hasValidConsent()).toBe(false);
  });

  it("revokes consent", () => {
    recordConsent();
    revokeConsent();
    expect(hasValidConsent()).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/skin-analysis/privacy/consent.test.ts`
Expected: FAIL — cannot resolve `./consent`.

- [ ] **Step 3: Write minimal implementation**

```ts
export const CONSENT_VERSION = 1;
const KEY = "skin-analysis.consent";

interface ConsentRecord {
  version: number;
  at: number;
}

export function hasValidConsent(): boolean {
  const raw = localStorage.getItem(KEY);
  if (!raw) return false;
  try {
    const rec = JSON.parse(raw) as ConsentRecord;
    return rec.version === CONSENT_VERSION;
  } catch {
    return false;
  }
}

export function recordConsent(): void {
  const rec: ConsentRecord = { version: CONSENT_VERSION, at: Date.now() };
  localStorage.setItem(KEY, JSON.stringify(rec));
}

export function revokeConsent(): void {
  localStorage.removeItem(KEY);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/skin-analysis/privacy/consent.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/skin-analysis/privacy/consent.ts src/features/skin-analysis/privacy/consent.test.ts
git commit -m "feat: add versioned consent logic"
```

---

## Task 5: EXIF/GPS stripping via canvas re-encode

**Files:**
- Create: `src/features/skin-analysis/privacy/redact.ts`
- Test: `src/features/skin-analysis/privacy/redact.test.ts`

Strategy: re-encoding an image through a canvas discards all EXIF/metadata (canvas output carries only pixels). We test the pure orchestration by injecting a decode+encode boundary so the test needs no real image codec.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { stripMetadata, type ImageCodec } from "./redact";

const fakeCodec: ImageCodec = {
  async decode(blob) {
    return { width: 10, height: 20, source: blob };
  },
  async encode(_bitmap, mimeType) {
    // Simulate a clean, metadata-free re-encode.
    return new Blob(["clean-pixels"], { type: mimeType });
  },
};

describe("stripMetadata", () => {
  it("returns a re-encoded blob with the requested mime type and dimensions", async () => {
    const dirty = new Blob(["jpeg-with-exif-gps"], { type: "image/jpeg" });
    const result = await stripMetadata(dirty, "image/jpeg", fakeCodec);
    expect(result.mimeType).toBe("image/jpeg");
    expect(result.width).toBe(10);
    expect(result.height).toBe(20);
    expect(await result.blob.text()).toBe("clean-pixels");
  });

  it("rejects non-image blobs", async () => {
    const bad = new Blob(["not-an-image"], { type: "application/pdf" });
    await expect(stripMetadata(bad, "image/jpeg", fakeCodec)).rejects.toThrow(
      /not an image/i,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/skin-analysis/privacy/redact.test.ts`
Expected: FAIL — cannot resolve `./redact`.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { CaptureResult } from "../types";

export interface DecodedBitmap {
  width: number;
  height: number;
  source: unknown;
}

export interface ImageCodec {
  decode(blob: Blob): Promise<DecodedBitmap>;
  encode(bitmap: DecodedBitmap, mimeType: string): Promise<Blob>;
}

export interface RedactResult {
  blob: Blob;
  mimeType: string;
  width: number;
  height: number;
}

export async function stripMetadata(
  input: Blob,
  mimeType: string,
  codec: ImageCodec,
): Promise<RedactResult> {
  if (!input.type.startsWith("image/")) {
    throw new Error("File is not an image");
  }
  const bitmap = await codec.decode(input);
  const clean = await codec.encode(bitmap, mimeType);
  return { blob: clean, mimeType, width: bitmap.width, height: bitmap.height };
}

export function toCaptureResult(
  r: RedactResult,
  mode: CaptureResult["mode"],
  source: CaptureResult["source"],
): CaptureResult {
  return {
    blob: r.blob,
    mimeType: r.mimeType,
    mode,
    source,
    width: r.width,
    height: r.height,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/skin-analysis/privacy/redact.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Create the real browser codec (used by components, not unit-tested)**

Append to `src/features/skin-analysis/privacy/redact.ts`:

```ts
export const canvasCodec: ImageCodec = {
  async decode(blob) {
    const bitmap = await createImageBitmap(blob);
    return { width: bitmap.width, height: bitmap.height, source: bitmap };
  },
  async encode(bitmap, mimeType) {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas unavailable");
    ctx.drawImage(bitmap.source as CanvasImageSource, 0, 0);
    const blob: Blob | null = await new Promise((res) =>
      canvas.toBlob(res, mimeType, 0.92),
    );
    if (!blob) throw new Error("Canvas encode failed");
    return blob;
  },
};
```

- [ ] **Step 6: Run tests again to confirm nothing broke**

Run: `npx vitest run src/features/skin-analysis/privacy/redact.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add src/features/skin-analysis/privacy/redact.ts src/features/skin-analysis/privacy/redact.test.ts
git commit -m "feat: strip EXIF/GPS via canvas re-encode"
```

---

## Task 6: Capture state machine (Zustand)

**Files:**
- Create: `src/features/skin-analysis/store/scan-machine.ts`
- Test: `src/features/skin-analysis/store/scan-machine.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { useScanMachine } from "./scan-machine";
import type { CaptureResult } from "../types";

const sample: CaptureResult = {
  blob: new Blob(["x"], { type: "image/jpeg" }),
  mimeType: "image/jpeg",
  mode: "face",
  source: "camera",
  width: 640,
  height: 480,
};

describe("scan machine", () => {
  beforeEach(() => useScanMachine.getState().reset());

  it("starts idle", () => {
    expect(useScanMachine.getState().state).toBe("idle");
  });

  it("grants consent → permission", () => {
    useScanMachine.getState().grantConsent();
    expect(useScanMachine.getState().state).toBe("permission");
  });

  it("permission granted → framing", () => {
    useScanMachine.getState().grantConsent();
    useScanMachine.getState().cameraReady();
    expect(useScanMachine.getState().state).toBe("framing");
  });

  it("permission denied → error(denied) and can fall back to upload", () => {
    useScanMachine.getState().grantConsent();
    useScanMachine.getState().cameraDenied();
    expect(useScanMachine.getState().state).toBe("error");
    expect(useScanMachine.getState().error).toBe("denied");
    useScanMachine.getState().chooseUpload();
    expect(useScanMachine.getState().state).toBe("framing");
    expect(useScanMachine.getState().captureSource).toBe("upload");
  });

  it("captured image → analyzing carries the result", () => {
    useScanMachine.getState().grantConsent();
    useScanMachine.getState().cameraReady();
    useScanMachine.getState().captured(sample);
    expect(useScanMachine.getState().state).toBe("analyzing");
    expect(useScanMachine.getState().capture).toEqual(sample);
  });

  it("reset returns to idle and clears capture", () => {
    useScanMachine.getState().grantConsent();
    useScanMachine.getState().cameraReady();
    useScanMachine.getState().captured(sample);
    useScanMachine.getState().reset();
    expect(useScanMachine.getState().state).toBe("idle");
    expect(useScanMachine.getState().capture).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/skin-analysis/store/scan-machine.test.ts`
Expected: FAIL — cannot resolve `./scan-machine`.

- [ ] **Step 3: Write minimal implementation**

```ts
import { create } from "zustand";
import type { CaptureResult, CaptureSource } from "../types";

export type ScanState =
  | "idle"
  | "permission"
  | "framing"
  | "capturing"
  | "analyzing"
  | "results"
  | "error";

export type ScanError = "denied" | "no-camera" | "low-light" | "blur" | "analysis-failed";

interface ScanStore {
  state: ScanState;
  error: ScanError | null;
  captureSource: CaptureSource;
  capture: CaptureResult | null;
  grantConsent(): void;
  cameraReady(): void;
  cameraDenied(): void;
  noCamera(): void;
  chooseUpload(): void;
  captured(result: CaptureResult): void;
  analysisFailed(): void;
  reset(): void;
}

export const useScanMachine = create<ScanStore>((set) => ({
  state: "idle",
  error: null,
  captureSource: "camera",
  capture: null,
  grantConsent: () => set({ state: "permission", error: null }),
  cameraReady: () => set({ state: "framing", captureSource: "camera" }),
  cameraDenied: () => set({ state: "error", error: "denied" }),
  noCamera: () => set({ state: "error", error: "no-camera" }),
  chooseUpload: () => set({ state: "framing", captureSource: "upload", error: null }),
  captured: (result) => set({ state: "analyzing", capture: result }),
  analysisFailed: () => set({ state: "error", error: "analysis-failed" }),
  reset: () =>
    set({ state: "idle", error: null, capture: null, captureSource: "camera" }),
}));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/skin-analysis/store/scan-machine.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/skin-analysis/store/scan-machine.ts src/features/skin-analysis/store/scan-machine.test.ts
git commit -m "feat: add capture state machine"
```

---

## Task 7: Camera hook with cross-platform device selection

**Files:**
- Create: `src/features/skin-analysis/hooks/use-camera.ts`
- Test: `src/features/skin-analysis/hooks/use-camera.test.ts`

The hook's pure core — choosing `facingMode` from capture mode and detecting insecure context — is extracted as a testable function; the React effect wrapping `getUserMedia` is thin.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { cameraConstraints, isSecureContextForCamera } from "./use-camera";

describe("cameraConstraints", () => {
  it("uses the front camera for face mode", () => {
    expect(cameraConstraints("face").video).toMatchObject({ facingMode: "user" });
  });

  it("uses the rear camera for closeup mode", () => {
    expect(cameraConstraints("closeup").video).toMatchObject({
      facingMode: "environment",
    });
  });
});

describe("isSecureContextForCamera", () => {
  it("allows https", () => {
    expect(isSecureContextForCamera("https:", "example.com")).toBe(true);
  });

  it("allows localhost over http", () => {
    expect(isSecureContextForCamera("http:", "localhost")).toBe(true);
  });

  it("blocks http on a remote host", () => {
    expect(isSecureContextForCamera("http:", "example.com")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/skin-analysis/hooks/use-camera.test.ts`
Expected: FAIL — cannot resolve `./use-camera`.

- [ ] **Step 3: Write minimal implementation**

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import type { CaptureMode } from "../types";

export function cameraConstraints(mode: CaptureMode): MediaStreamConstraints {
  return {
    video: {
      facingMode: mode === "face" ? "user" : "environment",
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
    audio: false,
  };
}

export function isSecureContextForCamera(protocol: string, hostname: string): boolean {
  if (protocol === "https:") return true;
  return hostname === "localhost" || hostname === "127.0.0.1";
}

export type CameraStatus = "idle" | "starting" | "live" | "denied" | "no-camera";

export function useCamera(mode: CaptureMode) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<CameraStatus>("idle");

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const start = useCallback(async () => {
    if (!isSecureContextForCamera(location.protocol, location.hostname)) {
      setStatus("no-camera");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("no-camera");
      return;
    }
    setStatus("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia(cameraConstraints(mode));
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setStatus("live");
    } catch (err) {
      const name = (err as DOMException)?.name;
      setStatus(name === "NotAllowedError" ? "denied" : "no-camera");
    }
  }, [mode]);

  useEffect(() => stop, [stop]);

  return { videoRef, status, start, stop };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/skin-analysis/hooks/use-camera.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/skin-analysis/hooks/use-camera.ts src/features/skin-analysis/hooks/use-camera.test.ts
git commit -m "feat: add cross-platform camera hook"
```

---

## Task 8: Consent, capture, and upload components + page entry point

**Files:**
- Create: `src/features/skin-analysis/components/consent/ConsentGate.tsx`
- Create: `src/features/skin-analysis/components/capture/CameraFeed.tsx`
- Create: `src/features/skin-analysis/components/capture/UploadDropzone.tsx`
- Create: `src/features/skin-analysis/components/capture/CaptureFlow.tsx`
- Create: `src/features/skin-analysis/SkinAnalysisPage.tsx`
- Test: `src/features/skin-analysis/components/consent/ConsentGate.test.tsx`
- Test: `src/features/skin-analysis/components/capture/UploadDropzone.test.tsx`

- [ ] **Step 1: Write the failing ConsentGate test**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConsentGate } from "./ConsentGate";

describe("ConsentGate", () => {
  beforeEach(() => localStorage.clear());

  it("shows the privacy explainer and blocks until accepted", async () => {
    const onAccept = vi.fn();
    render(<ConsentGate onAccept={onAccept}>protected</ConsentGate>);
    expect(screen.queryByText("protected")).not.toBeInTheDocument();
    expect(screen.getByText(/not a diagnosis/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /i understand/i }));
    expect(onAccept).toHaveBeenCalled();
    expect(screen.getByText("protected")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify failure**

Run: `npx vitest run src/features/skin-analysis/components/consent/ConsentGate.test.tsx`
Expected: FAIL — cannot resolve `./ConsentGate`.

- [ ] **Step 3: Implement `ConsentGate.tsx`**

```tsx
import { useState, type ReactNode } from "react";
import { hasValidConsent, recordConsent } from "../../privacy/consent";

export function ConsentGate({
  children,
  onAccept,
}: {
  children: ReactNode;
  onAccept?: () => void;
}) {
  const [accepted, setAccepted] = useState(hasValidConsent());

  if (accepted) return <>{children}</>;

  const accept = () => {
    recordConsent();
    setAccepted(true);
    onAccept?.();
  };

  return (
    <div className="mx-auto max-w-md rounded-2xl border border-warm-border bg-warm-surface p-5">
      <h2 className="text-lg font-bold text-stone-900">Before we scan</h2>
      <ul className="mt-3 space-y-2 text-sm text-stone-600">
        <li>Your photo is analyzed on your device; only an opt-in copy is sent to the AI service over a secure connection, and it is never stored.</li>
        <li>History, if you save it, stays on this device only.</li>
        <li><strong>This is not a diagnosis.</strong> It helps you decide whether to see a professional.</li>
      </ul>
      <button
        onClick={accept}
        className="mt-4 w-full rounded-lg bg-clinical py-3 text-sm font-semibold text-white"
      >
        I understand — continue
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run the ConsentGate test to verify pass**

Run: `npx vitest run src/features/skin-analysis/components/consent/ConsentGate.test.tsx`
Expected: PASS.

- [ ] **Step 5: Write the failing UploadDropzone test**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UploadDropzone } from "./UploadDropzone";

describe("UploadDropzone", () => {
  it("passes a selected image file to onFile", async () => {
    const onFile = vi.fn();
    render(<UploadDropzone onFile={onFile} />);
    const file = new File(["img"], "photo.jpg", { type: "image/jpeg" });
    const input = screen.getByLabelText(/upload a photo/i) as HTMLInputElement;
    await userEvent.upload(input, file);
    expect(onFile).toHaveBeenCalledWith(file);
  });

  it("ignores non-image files", async () => {
    const onFile = vi.fn();
    render(<UploadDropzone onFile={onFile} />);
    const file = new File(["x"], "doc.pdf", { type: "application/pdf" });
    const input = screen.getByLabelText(/upload a photo/i) as HTMLInputElement;
    await userEvent.upload(input, file);
    expect(onFile).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run it to verify failure**

Run: `npx vitest run src/features/skin-analysis/components/capture/UploadDropzone.test.tsx`
Expected: FAIL — cannot resolve `./UploadDropzone`.

- [ ] **Step 7: Implement `UploadDropzone.tsx`**

```tsx
export function UploadDropzone({ onFile }: { onFile: (file: File) => void }) {
  const handle = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith("image/")) onFile(file);
  };

  return (
    <label className="flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-warm-border bg-warm-surface p-6 text-center">
      <span className="text-sm font-medium text-stone-700">Upload a photo</span>
      <span className="mt-1 text-xs text-stone-500">or use your camera</span>
      <input
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        aria-label="Upload a photo"
        onChange={handle}
      />
    </label>
  );
}
```

- [ ] **Step 8: Run the UploadDropzone test to verify pass**

Run: `npx vitest run src/features/skin-analysis/components/capture/UploadDropzone.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 9: Implement `CameraFeed.tsx`** (no unit test — thin DOM/media wrapper)

```tsx
import { useEffect, useRef } from "react";
import { useCamera } from "../../hooks/use-camera";
import { stripMetadata, canvasCodec, toCaptureResult } from "../../privacy/redact";
import type { CaptureMode, CaptureResult } from "../../types";

export function CameraFeed({
  mode,
  onCapture,
  onUnavailable,
}: {
  mode: CaptureMode;
  onCapture: (r: CaptureResult) => void;
  onUnavailable: (reason: "denied" | "no-camera") => void;
}) {
  const { videoRef, status, start } = useCamera(mode);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    start();
  }, [start]);

  useEffect(() => {
    if (status === "denied") onUnavailable("denied");
    if (status === "no-camera") onUnavailable("no-camera");
  }, [status, onUnavailable]);

  const snap = async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    const raw: Blob | null = await new Promise((res) =>
      canvas.toBlob(res, "image/jpeg", 0.92),
    );
    if (!raw) return;
    const clean = await stripMetadata(raw, "image/jpeg", canvasCodec);
    onCapture(toCaptureResult(clean, mode, "camera"));
  };

  return (
    <div className="flex flex-col items-center gap-3">
      <video
        ref={videoRef}
        playsInline
        muted
        className="aspect-[3/4] w-full max-w-sm rounded-2xl bg-black object-cover sm:aspect-video"
      />
      <canvas ref={canvasRef} className="hidden" />
      <button
        onClick={snap}
        disabled={status !== "live"}
        className="rounded-lg bg-clinical px-6 py-3 text-sm font-semibold text-white disabled:opacity-40"
      >
        Capture
      </button>
    </div>
  );
}
```

- [ ] **Step 10: Implement `CaptureFlow.tsx`** (orchestrates machine + camera/upload)

```tsx
import { useCallback } from "react";
import { useScanMachine } from "../../store/scan-machine";
import { CameraFeed } from "./CameraFeed";
import { UploadDropzone } from "./UploadDropzone";
import { stripMetadata, canvasCodec, toCaptureResult } from "../../privacy/redact";
import type { CaptureMode, CaptureResult } from "../../types";

export function CaptureFlow({ mode }: { mode: CaptureMode }) {
  const machine = useScanMachine();

  const onCapture = useCallback(
    (r: CaptureResult) => machine.captured(r),
    [machine],
  );

  const onUpload = useCallback(
    async (file: File) => {
      const clean = await stripMetadata(file, "image/jpeg", canvasCodec);
      machine.captured(toCaptureResult(clean, mode, "upload"));
    },
    [machine, mode],
  );

  const onUnavailable = useCallback(
    (reason: "denied" | "no-camera") =>
      reason === "denied" ? machine.cameraDenied() : machine.noCamera(),
    [machine],
  );

  if (machine.state === "idle") {
    return (
      <button
        onClick={machine.grantConsent}
        className="rounded-lg bg-clinical px-6 py-3 text-sm font-semibold text-white"
      >
        Start scan
      </button>
    );
  }

  const useUpload = machine.captureSource === "upload" || machine.state === "error";

  return (
    <div className="flex flex-col items-center gap-4">
      {useUpload ? (
        <>
          {machine.error === "denied" && (
            <p className="text-sm text-stone-600">
              Camera unavailable — upload a photo instead.
            </p>
          )}
          <UploadDropzone onFile={onUpload} />
        </>
      ) : (
        <CameraFeed mode={mode} onCapture={onCapture} onUnavailable={onUnavailable} />
      )}
      {machine.state === "analyzing" && (
        <p className="text-sm text-clinical">Analyzing… (pipeline lands in a later plan)</p>
      )}
    </div>
  );
}
```

- [ ] **Step 11: Implement `SkinAnalysisPage.tsx`** (the single exported entry point)

```tsx
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
            <CaptureFlow mode={mode} />
          </div>
        </ConsentGate>
      </div>
    </main>
  );
}
```

- [ ] **Step 12: Run the full test suite**

Run: `npm test`
Expected: PASS — all suites (types, consent, redact, scan-machine, use-camera, ConsentGate, UploadDropzone).

- [ ] **Step 13: Typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: no type errors; Vite build succeeds.

- [ ] **Step 14: Manual smoke test (camera)**

Run: `npm run dev`, open the printed `localhost` URL. Accept consent, confirm the camera preview appears (grant permission), click Capture, and confirm the "Analyzing…" placeholder shows. On a device with no camera, confirm it falls back to the upload dropzone.
Expected: both camera capture and upload paths reach the "analyzing" state.

- [ ] **Step 15: Commit**

```bash
git add src/features/skin-analysis/components src/features/skin-analysis/SkinAnalysisPage.tsx
git commit -m "feat: consent-gated cross-platform capture flow"
```

---

## Task 9: Wire the responsive/build sanity into CI script

**Files:**
- Modify: `package.json` (add a `verify` script)

- [ ] **Step 1: Add a combined verify script**

In `package.json` `scripts`, add:

```json
"verify": "npm run typecheck && npm run test && npm run build"
```

- [ ] **Step 2: Run it**

Run: `npm run verify`
Expected: typecheck passes, all tests pass, build succeeds.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: add verify script (typecheck + test + build)"
```

---

## Definition of Done

- `npm run verify` passes: typecheck, all unit tests, production build.
- On a phone browser: consent gate → live rear/front camera → capture → analyzing placeholder.
- On a desktop browser with a webcam: same flow; without a webcam, automatic upload fallback.
- Uploaded and captured images pass through `stripMetadata` before entering state (no EXIF/GPS downstream).
- All feature code is under `src/features/skin-analysis/` and reachable only via the exported `SkinAnalysisPage`.

## What this plan intentionally defers (later plans)

- Quality gate (MediaPipe) and ONNX classifier — Plan 2.
- Supabase Edge Function, provider adapter, critique pass, guardrails, rate limiting — Plan 3.
- `verdict.ts` merge and results UI — Plan 4.
- IndexedDB history, full responsive/a11y audit, Lovable integration route — Plan 5.
