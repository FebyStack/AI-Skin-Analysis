// Acne-lesion detector (YOLO11n, one class) — pinpoints for the staff overlay.
// ONNX contract (verified 2026-09-26, ultralytics 8.4.92, nms=True): input `images`
// [1,3,640,640] RGB 0..1 letterboxed with grey 114; output `output0` [1,300,6] rows
// x1,y1,x2,y2,score,class in 640-px letterbox space; unused rows are zero.
// No shipped model → detectAcne returns null and the report carries no `marks`.
import { pickExecutionProviders, configureOrt } from "../../classifier/classifier";
import type { FaceAngle, FindingMark } from "../../../shared/face";
import type { Pixels } from "../types";

export const DETECTOR_URL =
  import.meta.env?.VITE_ACNE_DETECTOR_URL ?? "/models/acne-detector/model.onnx";
export const DETECTOR_VERSION = "yolo11n-acne";
const SIZE = 640;
const PAD = 114;
const MIN_CONF = Number(import.meta.env?.VITE_ACNE_BOX_MIN_CONF ?? "0.35");

/** The face region of one captured frame, resized so its longer side is 640. */
export interface DetectorInput {
  angle: FaceAngle;
  crop: Pixels;                                         // RGBA
  rect: { x: number; y: number; w: number; h: number }; // face rect in full-frame pixels
  frame: { w: number; h: number };                      // full captured frame size
}

export interface Letterbox { scale: number; padX: number; padY: number }

/** Scale that fits a w×h rect into 640, and the centring padding (as ultralytics does). */
export function letterbox(w: number, h: number): Letterbox {
  const scale = SIZE / Math.max(w, h);
  return {
    scale,
    padX: Math.floor((SIZE - Math.round(w * scale)) / 2),
    padY: Math.floor((SIZE - Math.round(h * scale)) / 2),
  };
}

/** Shades-of-Grey (p=6), in place on RGBA — mirrors ai/training/transforms.py shades_of_gray. */
export function shadesOfGrey(px: Pixels, p = 6): void {
  const d = px.data;
  const n = px.width * px.height;
  const acc = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) acc[c] += Math.pow(d[i * 4 + c], p);
  const illum = acc.map((a) => Math.pow(a / n, 1 / p));
  const norm = Math.hypot(illum[0], illum[1], illum[2]) + 1e-6;
  const k = illum.map((v) => (v / norm) * Math.sqrt(3));
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) d[i * 4 + c] = Math.min(255, Math.floor(d[i * 4 + c] / k[c]));
  }
}

/** RGBA crop → NCHW float32 640×640, crop placed at the letterbox offset on grey 114. */
export function toTensorData(crop: Pixels, lb: Letterbox): Float32Array {
  const plane = SIZE * SIZE;
  const out = new Float32Array(3 * plane).fill(PAD / 255);
  for (let y = 0; y < crop.height && y + lb.padY < SIZE; y++) {
    for (let x = 0; x < crop.width && x + lb.padX < SIZE; x++) {
      const s = (y * crop.width + x) * 4;
      const t = (y + lb.padY) * SIZE + (x + lb.padX);
      out[t] = crop.data[s] / 255;
      out[plane + t] = crop.data[s + 1] / 255;
      out[2 * plane + t] = crop.data[s + 2] / 255;
    }
  }
  return out;
}

/** Detector rows → acne marks in normalised full-frame coordinates (score ≥ minConf). */
export function rowsToMarks(rows: Float32Array, input: DetectorInput, lb: Letterbox, minConf = MIN_CONF): FindingMark[] {
  const toFrame = (v: number, pad: number, offset: number) => (v - pad) / lb.scale + offset;
  const marks: FindingMark[] = [];
  for (let i = 0; i + 5 < rows.length; i += 6) {
    const score = rows[i + 4];
    if (!(score >= minConf)) continue;
    const x1 = Math.max(0, toFrame(rows[i], lb.padX, input.rect.x));
    const y1 = Math.max(0, toFrame(rows[i + 1], lb.padY, input.rect.y));
    const x2 = Math.min(input.frame.w, toFrame(rows[i + 2], lb.padX, input.rect.x));
    const y2 = Math.min(input.frame.h, toFrame(rows[i + 3], lb.padY, input.rect.y));
    if (x2 <= x1 || y2 <= y1) continue;
    marks.push({
      kind: "acne", angle: input.angle, source: "model", confidence: Math.min(1, score),
      shape: {
        type: "box",
        x: x1 / input.frame.w, y: y1 / input.frame.h,
        w: (x2 - x1) / input.frame.w, h: (y2 - y1) / input.frame.h,
      },
    });
  }
  return marks;
}

type OrtSession = import("onnxruntime-web").InferenceSession;
let sessionPromise: Promise<OrtSession | null> | null = null;

export function ensureAcneDetector(): Promise<OrtSession | null> {
  sessionPromise ??= (async () => {
    try {
      const probe = await fetch(DETECTOR_URL, { method: "HEAD" });
      if (!probe.ok || (probe.headers.get("content-type") ?? "").includes("text/html")) return null;
      const ort = await import("onnxruntime-web");
      configureOrt(ort);
      return await ort.InferenceSession.create(DETECTOR_URL, {
        executionProviders: pickExecutionProviders(typeof navigator !== "undefined" && "gpu" in navigator),
        logSeverityLevel: 3,
      });
    } catch {
      return null; // not shipped yet, or unreadable
    }
  })();
  return sessionPromise;
}

/** Acne marks for the inputs, one view at a time (iOS memory). Null = no detector. Never throws. */
export async function detectAcne(inputs: DetectorInput[]): Promise<FindingMark[] | null> {
  const session = await ensureAcneDetector();
  if (!session) return null;
  const ort = await import("onnxruntime-web");
  const marks: FindingMark[] = [];
  for (const input of inputs) {
    try {
      shadesOfGrey(input.crop); // before padding, as in training
      const lb = letterbox(input.rect.w, input.rect.h);
      const tensor = new ort.Tensor("float32", toTensorData(input.crop, lb), [1, 3, SIZE, SIZE]);
      const out = await session.run({ [session.inputNames[0]]: tensor });
      marks.push(...rowsToMarks(out[session.outputNames[0]].data as Float32Array, input, lb));
    } catch {
      /* skip this view */
    }
  }
  return marks;
}
