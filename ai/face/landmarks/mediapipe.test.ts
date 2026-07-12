import { describe, it, expect } from "vitest";
import { matrixToPose } from "./mediapipe";

describe("matrixToPose", () => {
    it("identity matrix → zero pose", () => {
        const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
        const p = matrixToPose(I);
        expect(Math.abs(p.yawDeg)).toBeLessThan(1e-6);
        expect(Math.abs(p.pitchDeg)).toBeLessThan(1e-6);
    });
    it("rotation about Y → yaw", () => {
        const a = (45 * Math.PI) / 180;
        const R = [Math.cos(a), 0, Math.sin(a), 0, 0, 1, 0, 0, -Math.sin(a), 0, Math.cos(a), 0, 0, 0, 0, 1];
        expect(matrixToPose(R).yawDeg).toBeCloseTo(45, 1);
    });
});