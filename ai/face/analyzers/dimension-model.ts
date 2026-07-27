// Learned per-dimension analyzers (redness, wrinkles, pores, pigmentation, ...).
// One generic implementation: each dimension's ONNX lives at /models/<dim>/model.onnx
// and overrides only that dimension when present and confident. Absent or unsure →
// the deterministic pixel-math analyzer stays in charge (offline-safe, never blocks).
//
// Class order matches ai/training/dimension/labels.py. Score is the ordinal
// expectation over classes, so binary ["absent","present"] yields exactly
// P(present) — a calibrated 0..1 dimension score.
import { pickExecutionProviders, configureOrt } from "../../classifier/classifier";
import { resolveModelSource, type ModelCacheProvider } from "../models/cached-blob";
import type { DimensionScore, FaceDimension, FaceReport } from "../../../shared/face";
import type { Pixels } from "../types";

/** Dimensions that can have a trained model — keep in sync with labels.py. */
export const MODELED_DIMENSIONS = ["redness", "wrinkles", "pores", "pigmentation"] as const;
export type ModeledDimension = (typeof MODELED_DIMENSIONS)[number];

const PRESENCE_CLASSES = ["absent", "present"];
const INPUT = 224;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];
// Below this top-class probability the model is unsure → keep the deterministic
// analyzer rather than override with a shaky guess. Override per-deploy.
const MIN_CONFIDENCE = Number(import.meta.env?.VITE_DIMENSION_MIN_CONF ?? "0.55");

type OrtSession = import("onnxruntime-web").InferenceSession;

const sessions = new Map<string, Promise<OrtSession | null>>();
let cacheProvider: ModelCacheProvider | null = null;
export function setDimensionCacheProvider(provider: ModelCacheProvider | null): void {
  cacheProvider = provider;
}

function modelUrl(dim: string): string {
  return `/models/${dim}/model.onnx`;
}

export function ensureDimensionModel(dim: string): Promise<OrtSession | null> {
  let p = sessions.get(dim);
  if (!p) {
    p = loadSession(dim);
    sessions.set(dim, p);
  }
  return p;
}

async function loadSession(dim: string): Promise<OrtSession | null> {
  const url = modelUrl(dim);
  const source = await resolveModelSource(dim, url, cacheProvider, () => undefined);
  try {
    if (source.url === url) {
      const probe = await fetch(url, { method: "HEAD" });
      const ct = probe.headers.get("content-type") ?? "";
      if (!probe.ok || ct.includes("text/html")) {
        source.release();
        return null; // no model for this dimension yet → deterministic fallback
      }
    }
    const ort = await import("onnxruntime-web");
    configureOrt(ort);
    const hasWebGpu = typeof navigator !== "undefined" && "gpu" in navigator;
    return await ort.InferenceSession.create(source.url, {
      executionProviders: pickExecutionProviders(hasWebGpu),
      logSeverityLevel: 3,
    });
  } catch {
    return null;
  } finally {
    source.release?.();
  }
}

/** Nearest-neighbour resize of RGBA pixels → normalized CHW Float32 (1x3x224x224). */
function preprocess(px: Pixels): Float32Array {
  const out = new Float32Array(3 * INPUT * INPUT);
  const { data, width, height } = px;
  for (let y = 0; y < INPUT; y++) {
    const sy = Math.min(height - 1, ((y * height) / INPUT) | 0);
    for (let x = 0; x < INPUT; x++) {
      const sx = Math.min(width - 1, ((x * width) / INPUT) | 0);
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

async function classProbs(session: OrtSession, px: Pixels): Promise<number[] | null> {
  try {
    const ort = await import("onnxruntime-web");
    const tensor = new ort.Tensor("float32", preprocess(px), [1, 3, INPUT, INPUT]);
    const output = await session.run({ [session.inputNames[0]]: tensor });
    return softmax(output[session.outputNames[0]].data as Float32Array);
  } catch {
    return null;
  }
}

/** Score one dimension from one or more face crops, or null if no model. */
export async function analyzeDimension(
  dim: string,
  views: Pixels | Pixels[],
): Promise<DimensionScore | null> {
  const session = await ensureDimensionModel(dim);
  if (!session) return null;
  const list = Array.isArray(views) ? views : [views];
  const all = (await Promise.all(list.map((px) => classProbs(session, px)))).filter(
    (p): p is number[] => p !== null,
  );
  if (all.length === 0) return null;
  const probs = all[0].map((_, c) => all.reduce((a, p) => a + p[c], 0) / all.length);
  const expected = probs.reduce((a, p, i) => a + p * i, 0) / Math.max(probs.length - 1, 1);
  const confidence = Math.max(...probs);
  const predicted = PRESENCE_CLASSES[probs.indexOf(confidence)] ?? "present";
  return {
    score: Math.max(0, Math.min(1, expected)),
    confidence,
    perZone: [],
    evidence: `learned ${dim} model — "${predicted}" across ${all.length} view(s)`,
  };
}

/**
 * Override every dimension that has a trained, confident model. Dimensions
 * without a model (or below the confidence gate) keep their deterministic score.
 */
export async function refineDimensionsWithModels(
  report: FaceReport,
  views: Pixels | Pixels[],
): Promise<FaceReport> {
  const dimensions = { ...report.dimensions };
  const modelVersions = { ...report.modelVersions };
  let changed = false;

  for (const dim of MODELED_DIMENSIONS) {
    const learned = await analyzeDimension(dim, views);
    if (!learned || learned.confidence < MIN_CONFIDENCE) continue;
    dimensions[dim as FaceDimension] = learned;
    modelVersions[dim] = `efficientnet-b0-${dim}`;
    changed = true;
  }
  return changed ? { ...report, dimensions, modelVersions } : report;
}
