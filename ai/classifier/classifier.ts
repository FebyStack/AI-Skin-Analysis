import type { Finding } from "../../shared/types";
import { labelAt, LABELS } from "./labels";

export function softmax(logits: number[]): number[] {
  const max = Math.max(...logits);
  const exps = logits.map((l) => Math.exp(l - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

const TOP_K = 3;

export function logitsToFindings(logits: number[], threshold: number): Finding[] {
  const probs = softmax(logits);
  return probs
    .map((confidence, index) => ({ info: labelAt(index), confidence }))
    .filter(({ info, confidence }) => info.id !== "clear" && confidence >= threshold)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, TOP_K)
    .map(({ info, confidence }) => ({
      id: info.id,
      label: info.label,
      source: "classifier" as const,
      confidence,
      severity: info.severity,
    }));
}

export function pickExecutionProviders(hasWebGpu: boolean): string[] {
  return hasWebGpu ? ["webgpu", "wasm"] : ["wasm"];
}

// onnxruntime-web can't locate its own .wasm under Vite (the request 404s to the
// SPA index.html → "Unexpected response MIME type. Expected 'application/wasm'"),
// so every ONNX model silently failed to its fallback. Point wasm loading at the
// CDN for the pinned version — same approach MediaPipe already uses. Call once
// before any InferenceSession.create. Override with VITE_ORT_WASM_PATHS (e.g. a
// self-hosted "/ort/" for full offline). Update the version on ort upgrades.
let ortConfigured = false;
export function configureOrt(ort: typeof import("onnxruntime-web")): void {
  if (ortConfigured) return;
  ortConfigured = true;
  ort.env.wasm.wasmPaths =
    import.meta.env?.VITE_ORT_WASM_PATHS ?? "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/";
  // Silence benign W-level notes (e.g. "some nodes not assigned to preferred EP"
  // when ORT puts shape ops on CPU) — they surface as red console errors.
  ort.env.logLevel = "error";
}

// --- Real ONNX session wrapper (integration; not unit-tested) ---

export interface InferenceFn {
  (rgba: Uint8ClampedArray, width: number, height: number): Promise<number[]>;
}

// Must match IMG_SIZE and NORM in ai/training/transforms.py (pinned by classifier.test.ts).
export const MODEL_INPUT_SIZE = 224;
export const NORM = { mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225] };
export const CLASSIFIER_THRESHOLD = 0.3;

// Model URL is configured at build time; a real DermNet/HAM10000-class ONNX
// export (output length === LABELS.length) is placed under public/models/.
const MODEL_URL =
  import.meta.env?.VITE_CLASSIFIER_MODEL_URL ?? "/models/skin-classifier.onnx";

export async function createOnnxInference(modelUrl?: string): Promise<InferenceFn> {
  const url = modelUrl ?? MODEL_URL;

  // Pre-flight: verify the model file exists before loading the heavy ONNX
  // runtime — this avoids noisy WASM compile errors in the console when the
  // model hasn't been placed in public/models/ yet.
  // NOTE: Vite's SPA fallback returns 200 OK with text/html for missing files,
  // so we must also check the content-type header.
  const probe = await fetch(url, { method: "HEAD" });
  const ct = probe.headers.get("content-type") ?? "";
  if (!probe.ok || ct.includes("text/html")) {
    throw new Error(
      `Classifier model not found at ${url} (status=${probe.status}, type=${ct}). ` +
        "Place an ONNX model there or set VITE_CLASSIFIER_MODEL_URL.",
    );
  }

  const ort = await import("onnxruntime-web");
  configureOrt(ort);
  const hasWebGpu = typeof navigator !== "undefined" && "gpu" in navigator;
  const session = await ort.InferenceSession.create(url, {
    executionProviders: pickExecutionProviders(hasWebGpu),
    logSeverityLevel: 3, // errors only — hides benign EP-assignment warnings
  });

  return async (rgba, width, height) => {
    const size = MODEL_INPUT_SIZE;
    const tensor = new ort.Tensor("float32", preprocess(rgba, width, height), [1, 3, size, size]);
    const inputName = session.inputNames[0];
    const outputName = session.outputNames[0];
    const result = await session.run({ [inputName]: tensor });
    const data = result[outputName].data as Float32Array;
    if (data.length !== LABELS.length) {
      throw new Error(
        `Model output length ${data.length} != label count ${LABELS.length}`,
      );
    }
    return Array.from(data);
  };
}

// RGBA → NCHW float32, reproducing serve_transforms() (default, no colour
// constancy): A.Resize is cv2 bilinear with pixel-centre alignment, then
// A.Normalize. The exported graph is the bare network — it does not normalise.
export function preprocess(rgba: Uint8ClampedArray, width: number, height: number): Float32Array {
  const size = MODEL_INPUT_SIZE;
  const plane = size * size;
  const out = new Float32Array(3 * plane);
  for (let y = 0; y < size; y++) {
    const fy = Math.min(Math.max((y + 0.5) * (height / size) - 0.5, 0), height - 1);
    const y0 = Math.floor(fy);
    const y1 = Math.min(y0 + 1, height - 1);
    const wy = fy - y0;
    for (let x = 0; x < size; x++) {
      const fx = Math.min(Math.max((x + 0.5) * (width / size) - 0.5, 0), width - 1);
      const x0 = Math.floor(fx);
      const x1 = Math.min(x0 + 1, width - 1);
      const wx = fx - x0;
      const i00 = (y0 * width + x0) * 4;
      const i01 = (y0 * width + x1) * 4;
      const i10 = (y1 * width + x0) * 4;
      const i11 = (y1 * width + x1) * 4;
      for (let c = 0; c < 3; c++) {
        const top = rgba[i00 + c] + (rgba[i01 + c] - rgba[i00 + c]) * wx;
        const bottom = rgba[i10 + c] + (rgba[i11 + c] - rgba[i10 + c]) * wx;
        const v = top + (bottom - top) * wy;
        out[c * plane + y * size + x] = (v / 255 - NORM.mean[c]) / NORM.std[c];
      }
    }
  }
  return out;
}
