import type { FaceAngle } from "@shared/face";
import { detectGeometry } from "@ai/face/landmarks/mediapipe";
import { analyzeView } from "@ai/face/pipeline";
import type { AnalyzedView, Pixels } from "@ai/face/types";

export function makeAnalyzeFrame(video: () => HTMLVideoElement | null) {
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
        return analyzeView({ angle, pixels, geometry });
    };
}