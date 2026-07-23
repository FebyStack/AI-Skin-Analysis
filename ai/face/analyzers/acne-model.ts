// Learned acne-severity analyzer (optional). Loads an ONNX EfficientNet-B0 trained
// by ai/training/acne; when the model file is absent it returns null and the
// deterministic acneAnalyzer stays in charge (offline-safe, never blocks).
//
// Trainable improvement loop: retrain on datasets + labeled app scans, export a
// new /models/acne/model.onnx, and this picks it up on next load. Only ever
// overrides the `acne` dimension — the other 10 analyzers are untouched.
import { pickExecutionProviders, configureOrt } from "../../classifier/classifier";
import { resolveModelSource, type ModelCacheProvider } from "../models/cached-blob";
import type { DimensionScore, FaceReport } from "../../../shared/face";
import type { Pixels } from "../types";

export const ACNE_MODEL_URL =
  import.meta.env?.VITE_ACNE_MODEL_URL ?? "/models/acne/model.onnx";
export const ACNE_MODEL_VERSION = "efficientnet-b0-acne";
export const ACNE_CLASSES = ["clear", "mild", "moderate", "severe", "very-severe"];
// Below this top-class probability the model is treated as unsure (e.g. an
// out-of-distribution face like a child) and we KEEP the deterministic analyzer
// rather than override it with a shaky guess. Override via VITE_ACNE_MIN_CONF.
const ACNE_MIN_CONFIDENCE = Number(import.meta.env?.VITE_ACNE_MIN_CONF ?? "0.40");

const INPUT = 224;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

type OrtSession = import("onnxruntime-web").InferenceSession;

let sessionPromise: Promise<OrtSession | null> | null = null;
let cacheProvider: ModelCacheProvider | null = null;
export function setAcneCacheProvider(provider: ModelCacheProvider | null): void {
  cacheProvider = provider;
}

export function ensureAcneModel(): Promise<OrtSession | null> {
  sessionPromise ??= loadSession();
  return sessionPromise;
}

async function loadSession(): Promise<OrtSession | null> {
  const source = await resolveModelSource("acne", ACNE_MODEL_URL, cacheProvider, () => undefined);
  try {
    if (source.url === ACNE_MODEL_URL) {
      const probe = await fetch(ACNE_MODEL_URL, { method: "HEAD" });
      const ct = probe.headers.get("content-type") ?? "";
      if (!probe.ok || ct.includes("text/html")) {
        source.release();
        return null; // no model yet → deterministic fallback
      }
    }
    const ort = await import("onnxruntime-web");
    configureOrt(ort);
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

// Class probabilities for one face crop, or null if no model.
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

// Run the model on one or more face crops (multi-angle: front + 45s + profiles)
// and average the class probabilities → acne DimensionScore, or null if no model.
export async function analyzeAcneFromPixels(views: Pixels | Pixels[]): Promise<DimensionScore | null> {
  const session = await ensureAcneModel();
  if (!session) return null;
  const list = Array.isArray(views) ? views : [views];
  const all = (await Promise.all(list.map((px) => classProbs(session, px)))).filter(
    (p): p is number[] => p !== null,
  );
  if (all.length === 0) return null;
  const probs = all[0].map((_, c) => all.reduce((a, p) => a + p[c], 0) / all.length);
  // Expected severity (ordinal) → 0..1 score; confidence = top probability.
  const expected = probs.reduce((a, p, i) => a + p * i, 0) / (ACNE_CLASSES.length - 1);
  const confidence = Math.max(...probs);
  const predicted = ACNE_CLASSES[probs.indexOf(confidence)];
  return {
    score: Math.max(0, Math.min(1, expected)),
    confidence,
    perZone: [],
    evidence: `learned acne-severity model (${ACNE_MODEL_VERSION}) — predicted "${predicted}" across ${all.length} view(s)`,
  };
}

// Override the acne dimension with the model's result when available; otherwise
// leave the deterministic report untouched. Records the model version used.
export async function refineAcneWithModel(report: FaceReport, views: Pixels | Pixels[]): Promise<FaceReport> {
  const learned = await analyzeAcneFromPixels(views);
  if (!learned || learned.confidence < ACNE_MIN_CONFIDENCE) return report; // unsure → keep deterministic
  return {
    ...report,
    dimensions: { ...report.dimensions, acne: learned },
    modelVersions: { ...report.modelVersions, acne: ACNE_MODEL_VERSION },
  };
}
