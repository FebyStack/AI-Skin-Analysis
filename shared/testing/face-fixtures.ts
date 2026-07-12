import type { FaceReport } from "../face";
import { FACE_DIMENSIONS } from "../face";

export function goldenFaceReport(): FaceReport {
    const dim = (evidence: string) => ({
        score: 0.4,
        confidence: 0.8,
        perZone: [{ zone: "forehead" as const, score: 0.4 }],
        evidence,
    });

    return {
        kind: "face-v2",
        overall: { score: 0.45, confidence: 0.8 },
        dimensions: Object.fromEntries(
            FACE_DIMENSIONS.map((d) => [
                d,
                dim(`${d} via zone pixel metrics`),
            ])
        ) as FaceReport["dimensions"],
        capture: {
            angles: [
                {
                    angle: "front",
                    quality: { ok: true, issues: [] },
                },
            ],
        },
        recommendations: {
            skincare: ["Daily broad-spectrum sunscreen."],
            treatments: [],
        },
        explanation: null,
        disclaimer: "This is not a medical diagnosis.",
        pipelineVersion: 1,
        modelVersions: {
            "face-landmarker": "dev",
        },
    };
}