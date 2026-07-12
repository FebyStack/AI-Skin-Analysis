import type { FaceAnalysisZone } from "../../../shared/face";
import { maskForZone } from "../landmarks/zones";
import type { FaceGeometry } from "../types";
import { PARSE, PARSE_EXCLUDE } from "./labels";

/** Per-pixel class ids at capture resolution (width × height). */
export type LabelMap = Uint8Array;

const ZONE_ALLOWED: Record<FaceAnalysisZone, ReadonlySet<number>> = {
    forehead: new Set([PARSE.skin]),
    nose: new Set([PARSE.skin, PARSE.nose]),
    "left-cheek": new Set([PARSE.skin]),
    "right-cheek": new Set([PARSE.skin]),
    chin: new Set([PARSE.skin]),
    periorbital: new Set([PARSE.skin]),
    "under-eye": new Set([PARSE.skin]),
};

const ZONE_EXTRA_EXCLUDE: Record<FaceAnalysisZone, ReadonlySet<number>> = {
    forehead: new Set([PARSE.l_brow, PARSE.r_brow, PARSE.l_eye, PARSE.r_eye]),
    nose: new Set([PARSE.l_eye, PARSE.r_eye, PARSE.mouth, PARSE.u_lip, PARSE.l_lip]),
    "left-cheek": new Set([PARSE.l_eye, PARSE.r_eye, PARSE.l_brow, PARSE.r_brow]),
    "right-cheek": new Set([PARSE.l_eye, PARSE.r_eye, PARSE.l_brow, PARSE.r_brow]),
    chin: new Set([PARSE.mouth, PARSE.u_lip, PARSE.l_lip]),
    periorbital: new Set([PARSE.l_eye, PARSE.r_eye, PARSE.l_brow, PARSE.r_brow]),
    "under-eye": new Set([PARSE.l_eye, PARSE.r_eye]),
};

/** Intersect landmark zone polygon with parsed skin labels. */
export function zoneMaskFromParsing(
    zone: FaceAnalysisZone,
    labelMap: LabelMap,
    geometry: FaceGeometry,
    width: number,
    height: number,
): Uint8Array {
    const poly = maskForZone(zone, geometry, width, height);
    const allowed = ZONE_ALLOWED[zone];
    const extra = ZONE_EXTRA_EXCLUDE[zone];
    const out = new Uint8Array(width * height);
    for (let p = 0; p < width * height; p++) {
        if (!poly[p]) continue;
        const id = labelMap[p];
        if (PARSE_EXCLUDE.has(id) || extra.has(id)) continue;
        if (allowed.has(id)) out[p] = 1;
    }
    return out;
}

export function masksFromParsing(
    labelMap: LabelMap,
    geometry: FaceGeometry,
    width: number,
    height: number,
    zones: FaceAnalysisZone[],
): Partial<Record<FaceAnalysisZone, Uint8Array>> {
    const out: Partial<Record<FaceAnalysisZone, Uint8Array>> = {};
    for (const zone of zones) {
        out[zone] = zoneMaskFromParsing(zone, labelMap, geometry, width, height);
    }
    return out;
}

/** Upsample low-res argmax labels to capture resolution (nearest neighbour). */
export function upscaleLabelMap(
    labels: Uint8Array,
    srcW: number,
    srcH: number,
    dstW: number,
    dstH: number,
): LabelMap {
    const out = new Uint8Array(dstW * dstH);
    for (let y = 0; y < dstH; y++) {
        const sy = Math.min(srcH - 1, Math.floor((y / dstH) * srcH));
        for (let x = 0; x < dstW; x++) {
            const sx = Math.min(srcW - 1, Math.floor((x / dstW) * srcW));
            out[y * dstW + x] = labels[sy * srcW + sx];
        }
    }
    return out;
}

/** Argmax over CHW logits → H×W label map. */
export function argmaxLogits(logits: Float32Array, classes: number, h: number, w: number): Uint8Array {
    const out = new Uint8Array(h * w);
    for (let i = 0; i < h * w; i++) {
        let best = 0;
        let bestV = -Infinity;
        for (let c = 0; c < classes; c++) {
            const v = logits[c * h * w + i];
            if (v > bestV) {
                bestV = v;
                best = c;
            }
        }
        out[i] = best;
    }
    return out;
}
