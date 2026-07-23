import type { FaceAngle } from "@shared/face";
import { detectGeometry } from "@ai/face/landmarks/mediapipe";
import { analyzeView } from "@ai/face/pipeline";
import { ensureFaceParser, FACE_PARSING_VERSION } from "@ai/face/segmentation/parser";
import type { AnalyzedView, FaceGeometry, Pixels } from "@ai/face/types";

export function makeAnalyzeFrame(
    video: () => HTMLVideoElement | null,
    // Tap: lets the capture flow keep the face geometry per angle (e.g. to crop
    // saved frames to the face bbox before the learned models see them).
    onGeometry?: (angle: FaceAngle, geometry: FaceGeometry | null) => void,
) {
    void ensureFaceParser();
    return async (angle: FaceAngle): Promise<AnalyzedView> => {
        const el = video();
        if (!el) return { angle, quality: { ok: false, issues: ["no-face"] }, zones: {} };
        const canvas = document.createElement("canvas");
        canvas.width = el.videoWidth; canvas.height = el.videoHeight;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(el, 0, 0);
        const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const pixels: Pixels = { data, width, height };
        const geometry = await detectGeometry(el, performance.now());
        onGeometry?.(angle, geometry);
        return analyzeView({ angle, pixels, geometry });
    };
}

export const FACE_MODEL_VERSIONS = {
    "face-landmarker": "mediapipe-face-mesh-v2",
    "face-parsing": FACE_PARSING_VERSION,
} as const;
