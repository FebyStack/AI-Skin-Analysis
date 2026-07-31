// Single multi-head face model — one ONNX for every learned facial task.
//
// Replaces the separate acne + skintype models in the browser: one ~15MB download
// and ONE forward pass per view instead of one model and one pass per task. That
// halves both the payload and the inference work on a phone, where the old setup
// could stall the save. Falls back silently (deterministic analyzers keep the
// report) when the model is absent or the run fails.
//
// Outputs are logits_<task> in the order of ai/training/multi/tasks.py TASKS.
import { pickExecutionProviders, configureOrt } from "../../classifier/classifier";
import { resolveModelSource } from "../models/cached-blob";
import { SKIN_TYPES, type FaceReport, type SkinType } from "../../../shared/face";
import type { Pixels } from "../types";

export const FACE_MODEL_URL =
  import.meta.env?.VITE_FACE_MODEL_URL ?? "/models/face/model.onnx";
export const FACE_MODEL_VERSION = "efficientnet-b0-multihead";

// MUST match ai/training/multi/tasks.py (class order and task order).
export const ACNE_CLASSES = ["clear", "mild", "moderate", "severe", "very-severe"];
const SKINTYPE_CLASSES: SkinType[] = [...SKIN_TYPES];

const INPUT = 224;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];
// Unsure predictions keep the deterministic analyzer rather than assert a guess.
const ACNE_MIN_CONF = Number(import.meta.env?.VITE_ACNE_MIN_CONF ?? "0.40");
const SKINTYPE_MIN_CONF = Number(import.meta.env?.VITE_SKINTYPE_MIN_CONF ?? "0.45");

type OrtSession = import("onnxruntime-web").InferenceSession;

let sessionPromise: Promise<OrtSession | null> | null = null;

export function ensureFaceModel(): Promise<OrtSession | null> {
  sessionPromise ??= loadSession();
  return sessionPromise;
}

async function loadSession(): Promise<OrtSession | null> {
  const source = await resolveModelSource("face", FACE_MODEL_URL, null, () => undefined);
  try {
    if (source.url === FACE_MODEL_URL) {
      const probe = await fetch(FACE_MODEL_URL, { method: "HEAD" });
      const ct = probe.headers.get("content-type") ?? "";
      if (!probe.ok || ct.includes("text/html")) {
        source.release();
        return null; // not trained/exported yet → deterministic fallback
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

/** Pixels are already cropped+scaled to 224 by the caller; this just normalizes. */
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

function meanProbs(runs: number[][][], task: number): number[] | null {
  const rows = runs.map((r) => r[task]).filter(Boolean);
  if (rows.length === 0) return null;
  return rows[0].map((_, c) => rows.reduce((a, p) => a + p[c], 0) / rows.length);
}

/**
 * One pass per view over the shared model; returns per-task averaged probabilities.
 * Views are processed sequentially so a phone never holds several inferences at once.
 */
async function runAllViews(views: Pixels[]): Promise<number[][][] | null> {
  const session = await ensureFaceModel();
  if (!session) return null;
  const ort = await import("onnxruntime-web");
  const runs: number[][][] = [];
  for (const px of views) {
    try {
      const tensor = new ort.Tensor("float32", preprocess(px), [1, 3, INPUT, INPUT]);
      const out = await session.run({ [session.inputNames[0]]: tensor });
      runs.push(session.outputNames.map((n) => softmax(out[n].data as Float32Array)));
    } catch {
      /* skip this view */
    }
  }
  return runs.length > 0 ? runs : null;
}

/**
 * Fill in acne (0..1 dimension) + skinType from one model in one pass per view.
 * Each is applied only when its own confidence gate passes.
 */
export async function refineFaceWithModel(
  report: FaceReport,
  views: Pixels | Pixels[],
): Promise<FaceReport> {
  const list = Array.isArray(views) ? views : [views];
  const runs = await runAllViews(list);
  if (!runs) return report;

  let next = report;

  const acne = meanProbs(runs, 0);
  if (acne) {
    const confidence = Math.max(...acne);
    if (confidence >= ACNE_MIN_CONF) {
      const expected = acne.reduce((a, p, i) => a + p * i, 0) / (ACNE_CLASSES.length - 1);
      const predicted = ACNE_CLASSES[acne.indexOf(confidence)];
      next = {
        ...next,
        dimensions: {
          ...next.dimensions,
          acne: {
            score: Math.max(0, Math.min(1, expected)),
            confidence,
            perZone: [],
            source: "model",
            evidence: `learned face model (${FACE_MODEL_VERSION}) — acne "${predicted}" across ${runs.length} view(s)`,
          },
        },
        modelVersions: { ...next.modelVersions, acne: FACE_MODEL_VERSION },
      };
    }
  }

  const skin = meanProbs(runs, 1);
  if (skin) {
    const confidence = Math.max(...skin);
    if (confidence >= SKINTYPE_MIN_CONF) {
      next = {
        ...next,
        skinType: {
          type: SKINTYPE_CLASSES[skin.indexOf(confidence)] ?? "normal",
          confidence,
          evidence: `learned face model (${FACE_MODEL_VERSION}) across ${runs.length} view(s)`,
        },
        modelVersions: { ...next.modelVersions, skinType: FACE_MODEL_VERSION },
      };
    }
  }
  return next;
}
