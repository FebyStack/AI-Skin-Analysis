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
const SEVERITY_MIN_CONF = Number(import.meta.env?.VITE_SEVERITY_MIN_CONF ?? "0.45");

/** Must match SEVERITY_CLASSES in ai/training/dimension/labels.py, in order. */
const SEVERITY_CLASSES = ["none", "mild", "moderate", "severe"] as const;
/** Must match SEVERITY_DIMENSIONS in ai/training/dimension/ingest.py. */
const SEVERITY_DIMENSIONS = [
  "redness", "pigmentation", "oiliness", "texture", "pores",
  "fine-lines", "wrinkles", "dryness", "under-eye", "tone-consistency",
] as const;

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

/** Averaged probabilities for one task, looked up by OUTPUT NAME. */
function meanProbs(runs: Record<string, number[]>[], task: string): number[] | null {
  const rows = runs.map((r) => r[`logits_${task}`]).filter(Boolean);
  if (rows.length === 0) return null;
  return rows[0].map((_, c) => rows.reduce((a, p) => a + p[c], 0) / rows.length);
}

/**
 * One pass per view over the shared model; returns per-task averaged probabilities.
 * Views are processed sequentially so a phone never holds several inferences at once.
 */
async function runAllViews(views: Pixels[]): Promise<Record<string, number[]>[] | null> {
  const session = await ensureFaceModel();
  if (!session) return null;
  const ort = await import("onnxruntime-web");
  const runs: Record<string, number[]>[] = [];
  for (const px of views) {
    try {
      const tensor = new ort.Tensor("float32", preprocess(px), [1, 3, INPUT, INPUT]);
      const out = await session.run({ [session.inputNames[0]]: tensor });
      // Keyed by name, not position. Training adds a head per newly-trainable
      // dimension, so output ORDER shifts between exports — reading by index
      // would silently feed skintype logits into acne the day a head is added.
      const byName: Record<string, number[]> = {};
      for (const n of session.outputNames) byName[n] = softmax(out[n].data as Float32Array);
      runs.push(byName);
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

  const acne = meanProbs(runs, "acne");
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

  const skin = meanProbs(runs, "skintype");
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
  // Any severity dimension whose head shipped in this export. Nothing to change
  // here when a new one is trained — it appears as logits_<dimension> and is
  // picked up automatically, tagged source:"model" so the UI shows a real
  // confidence instead of the "estimate" chip.
  for (const dim of SEVERITY_DIMENSIONS) {
    const probs = meanProbs(runs, dim);
    if (!probs) continue;
    const confidence = Math.max(...probs);
    if (confidence < SEVERITY_MIN_CONF) continue;
    const idx = probs.indexOf(confidence);
    // Ordinal expectation over none/mild/moderate/severe → the 0..1 score the
    // report already uses, so downstream thresholds keep working.
    const expected = probs.reduce((a, p, i) => a + p * i, 0) / (probs.length - 1);
    next = {
      ...next,
      dimensions: {
        ...next.dimensions,
        [dim]: {
          score: Math.max(0, Math.min(1, expected)),
          confidence,
          perZone: next.dimensions[dim]?.perZone ?? [],
          source: "model",
          evidence: `learned face model (${FACE_MODEL_VERSION}) — ${dim} "${SEVERITY_CLASSES[idx]}" across ${runs.length} view(s)`,
        },
      },
      modelVersions: { ...next.modelVersions, [dim]: FACE_MODEL_VERSION },
    };
  }

  return next;
}
