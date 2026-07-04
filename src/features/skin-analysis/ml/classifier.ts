import type { Finding } from "../types";
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

// --- Real ONNX session wrapper (integration; not unit-tested) ---

export interface InferenceFn {
  (rgba: Uint8ClampedArray, width: number, height: number): Promise<number[]>;
}

export const MODEL_INPUT_SIZE = 224;
export const CLASSIFIER_THRESHOLD = 0.3;

// Model URL is configured at build time; a real DermNet/HAM10000-class ONNX
// export (output length === LABELS.length) is placed under public/models/.
const MODEL_URL =
  import.meta.env?.VITE_CLASSIFIER_MODEL_URL ?? "/models/skin-classifier.onnx";

export async function createOnnxInference(): Promise<InferenceFn> {
  const ort = await import("onnxruntime-web");
  const hasWebGpu = typeof navigator !== "undefined" && "gpu" in navigator;
  const session = await ort.InferenceSession.create(MODEL_URL, {
    executionProviders: pickExecutionProviders(hasWebGpu),
  });

  return async (rgba, width, height) => {
    const tensor = preprocess(ort, rgba, width, height);
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

// Nearest-neighbour resize to MODEL_INPUT_SIZE, NCHW float32, 0..1 normalised.
function preprocess(
  ort: typeof import("onnxruntime-web"),
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
) {
  const size = MODEL_INPUT_SIZE;
  const chw = new Float32Array(3 * size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sx = Math.floor((x / size) * width);
      const sy = Math.floor((y / size) * height);
      const si = (sy * width + sx) * 4;
      const di = y * size + x;
      chw[di] = rgba[si] / 255;
      chw[size * size + di] = rgba[si + 1] / 255;
      chw[2 * size * size + di] = rgba[si + 2] / 255;
    }
  }
  return new ort.Tensor("float32", chw, [1, 3, size, size]);
}
