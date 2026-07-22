// Learned skin-type classifier (optional). Loads an ONNX EfficientNet-B0 trained
// by ai/training/skintype; when the model file is absent it returns null and the
// report simply omits skinType (offline-safe, never blocks). Categorical, so it
// fills FaceReport.skinType rather than overriding a 0..1 dimension.
import { pickExecutionProviders } from "../../classifier/classifier";
import { resolveModelSource, type ModelCacheProvider } from "../models/cached-blob";
import { SKIN_TYPES, type SkinType, type SkinTypeResult, type FaceReport } from "../../../shared/face";
import type { Pixels } from "../types";

export const SKINTYPE_MODEL_URL =
  import.meta.env?.VITE_SKINTYPE_MODEL_URL ?? "/models/skintype/model.onnx";
export const SKINTYPE_MODEL_VERSION = "efficientnet-b0-skintype";
// Class order MUST match ai/training/skintype/labels.py SKIN_TYPE_CLASSES.
export const SKINTYPE_CLASSES: SkinType[] = [...SKIN_TYPES];

const INPUT = 224;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

type OrtSession = import("onnxruntime-web").InferenceSession;

let sessionPromise: Promise<OrtSession | null> | null = null;
let cacheProvider: ModelCacheProvider | null = null;
export function setSkinTypeCacheProvider(provider: ModelCacheProvider | null): void {
  cacheProvider = provider;
}

export function ensureSkinTypeModel(): Promise<OrtSession | null> {
  sessionPromise ??= loadSession();
  return sessionPromise;
}

async function loadSession(): Promise<OrtSession | null> {
  const source = await resolveModelSource("skintype", SKINTYPE_MODEL_URL, cacheProvider, () => undefined);
  try {
    if (source.url === SKINTYPE_MODEL_URL) {
      const probe = await fetch(SKINTYPE_MODEL_URL, { method: "HEAD" });
      const ct = probe.headers.get("content-type") ?? "";
      if (!probe.ok || ct.includes("text/html")) {
        source.release();
        return null; // no model yet → skinType omitted
      }
    }
    const ort = await import("onnxruntime-web");
    const hasWebGpu = typeof navigator !== "undefined" && "gpu" in navigator;
    return await ort.InferenceSession.create(source.url, {
      executionProviders: pickExecutionProviders(hasWebGpu),
    });
  } catch {
    return null;
  } finally {
    source.release?.();
  }
}

// Nearest-neighbour resize of RGBA pixels → normalized CHW Float32 (1x3x224x224).
function preprocess(px: Pixels): Float32Array {
  const out = new Float32Array(3 * INPUT * INPUT);
  const { data, width, height } = px;
  for (let y = 0; y < INPUT; y++) {
    const sy = Math.min(height - 1, (y * height / INPUT) | 0);
    for (let x = 0; x < INPUT; x++) {
      const sx = Math.min(width - 1, (x * width / INPUT) | 0);
      const i = (sy * width + sx) * 4;
      for (let c = 0; c < 3; c++) {
        out[c * INPUT * INPUT + y * INPUT + x] = (data[i + c] / 255 - MEAN[c]) / STD[c];
      }
    }
  }
  return out;
}

function softmax(logits: Float32Array | number[]): number[] {
  const max = Math.max(...logits);
  const exps = Array.from(logits, (l) => Math.exp(l - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

// Run the model on a full-face crop → SkinTypeResult, or null if no model.
export async function analyzeSkinTypeFromPixels(px: Pixels): Promise<SkinTypeResult | null> {
  const session = await ensureSkinTypeModel();
  if (!session) return null;
  try {
    const ort = await import("onnxruntime-web");
    const tensor = new ort.Tensor("float32", preprocess(px), [1, 3, INPUT, INPUT]);
    const output = await session.run({ [session.inputNames[0]]: tensor });
    const logits = output[session.outputNames[0]].data as Float32Array;
    const probs = softmax(logits);
    const confidence = Math.max(...probs);
    const type = SKINTYPE_CLASSES[probs.indexOf(confidence)] ?? "normal";
    return {
      type,
      confidence,
      evidence: `learned skin-type model (${SKINTYPE_MODEL_VERSION})`,
    };
  } catch {
    return null;
  }
}

// Fill in report.skinType from the model when available; otherwise leave the
// report untouched (skinType stays undefined). Records the model version used.
export async function refineSkinTypeWithModel(report: FaceReport, frontPixels: Pixels): Promise<FaceReport> {
  const learned = await analyzeSkinTypeFromPixels(frontPixels);
  if (!learned) return report;
  return {
    ...report,
    skinType: learned,
    modelVersions: { ...report.modelVersions, skinType: SKINTYPE_MODEL_VERSION },
  };
}
