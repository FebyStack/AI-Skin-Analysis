import { pickExecutionProviders } from "../../classifier/classifier";
import { NUM_PARSE_CLASSES } from "./labels";
import { argmaxLogits, upscaleLabelMap, type LabelMap } from "./masks";
import type { Pixels } from "../types";

export const FACE_PARSING_MODEL_URL =
    import.meta.env?.VITE_FACE_PARSING_MODEL_URL ?? "/models/face-parsing/model_quantized.onnx";

export const FACE_PARSING_VERSION = "jonathandinu/face-parsing@segformer-b5-quantized";

/** SegFormer preprocessor: 512×512, ImageNet normalisation. */
export const PARSER_INPUT_SIZE = 512;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

type OrtModule = typeof import("onnxruntime-web");
type OrtSession = import("onnxruntime-web").InferenceSession;

let sessionPromise: Promise<OrtSession | null> | null = null;

/** Preload ONNX session; returns null when model file is absent (offline / dev without weights). */
export function ensureFaceParser(): Promise<OrtSession | null> {
    sessionPromise ??= loadSession();
    return sessionPromise;
}

async function loadSession(): Promise<OrtSession | null> {
    try {
        const probe = await fetch(FACE_PARSING_MODEL_URL, { method: "HEAD" });
        const ct = probe.headers.get("content-type") ?? "";
        if (!probe.ok || ct.includes("text/html")) return null;

        const ort = await import("onnxruntime-web");
        const hasWebGpu = typeof navigator !== "undefined" && "gpu" in navigator;
        return ort.InferenceSession.create(FACE_PARSING_MODEL_URL, {
            executionProviders: pickExecutionProviders(hasWebGpu),
        });
    } catch {
        return null;
    }
}

export function preprocessForParser(ort: OrtModule, rgba: Uint8ClampedArray, width: number, height: number) {
    const size = PARSER_INPUT_SIZE;
    const chw = new Float32Array(3 * size * size);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const sx = Math.floor((x / size) * width);
            const sy = Math.floor((y / size) * height);
            const si = (sy * width + sx) * 4;
            const di = y * size + x;
            const r = (rgba[si] / 255 - MEAN[0]) / STD[0];
            const g = (rgba[si + 1] / 255 - MEAN[1]) / STD[1];
            const b = (rgba[si + 2] / 255 - MEAN[2]) / STD[2];
            chw[di] = r;
            chw[size * size + di] = g;
            chw[2 * size * size + di] = b;
        }
    }
    return new ort.Tensor("float32", chw, [1, 3, size, size]);
}

export async function parseFaceLabels(pixels: Pixels): Promise<LabelMap | null> {
    const session = await ensureFaceParser();
    if (!session) return null;

    const ort = await import("onnxruntime-web");
    const input = preprocessForParser(ort, pixels.data, pixels.width, pixels.height);
    const inputName = session.inputNames[0];
    const outputName = session.outputNames[0];
    const result = await session.run({ [inputName]: input });
    const logits = result[outputName].data as Float32Array;
    const dims = result[outputName].dims;
    // [1, classes, h, w]
    const h = dims.length >= 4 ? Number(dims[2]) : PARSER_INPUT_SIZE / 4;
    const w = dims.length >= 4 ? Number(dims[3]) : PARSER_INPUT_SIZE / 4;
    const classes = dims.length >= 2 ? Number(dims[1]) : NUM_PARSE_CLASSES;
    const small = argmaxLogits(logits, classes, h, w);
    return upscaleLabelMap(small, w, h, pixels.width, pixels.height);
}

/** Reset cached session (tests). */
export function resetFaceParserCache(): void {
    sessionPromise = null;
}
