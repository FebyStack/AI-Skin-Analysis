import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import type { FaceGeometry } from "../types";

export const LANDMARKER_MODEL_URL = "/models/face_landmarker.task";
const WASM_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm"; // Phase D: self-host via model channel

// v3.1: register as a ModelManager "mediapipe" loader so version reporting + future
// manifest-driven updates flow through one place. getLandmarker() stays the call site.
let landmarkerPromise: Promise<FaceLandmarker> | null = null;

export function getLandmarker(): Promise<FaceLandmarker> {
    landmarkerPromise ??= (async () => {
        const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
        return FaceLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: LANDMARKER_MODEL_URL },
            runningMode: "VIDEO",
            numFaces: 1,
            outputFacialTransformationMatrixes: true,
        });
    })();
    return landmarkerPromise;
}

/** 4x4 row-major transformation matrix → yaw/pitch/roll degrees. Pure, unit-tested. */
export function matrixToPose(m: number[]): { yawDeg: number; pitchDeg: number; rollDeg: number } {
    const deg = (r: number) => (r * 180) / Math.PI;
    const yaw = Math.asin(Math.max(-1, Math.min(1, m[2])));
    const pitch = Math.atan2(-m[6], m[10]);
    const roll = Math.atan2(-m[1], m[0]);
    return { yawDeg: deg(yaw), pitchDeg: deg(pitch), rollDeg: deg(roll) };
}

export async function detectGeometry(video: HTMLVideoElement, timestampMs: number): Promise<FaceGeometry | null> {
    const lm = await getLandmarker();
    const res = lm.detectForVideo(video, timestampMs);
    const landmarks = res.faceLandmarks?.[0];
    if (!landmarks || landmarks.length === 0) return null;
    const matrix = res.facialTransformationMatrixes?.[0]?.data;
    const pose = matrix ? matrixToPose([...matrix]) : { yawDeg: 0, pitchDeg: 0, rollDeg: 0 };
    return { landmarks: landmarks.map((l) => ({ x: l.x, y: l.y, z: l.z })), ...pose };
}