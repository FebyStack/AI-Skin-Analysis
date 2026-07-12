import { describe, it, expect } from "vitest";
import { createSequence, instructionFor } from "./sequence";
import { FACE_ANGLES } from "../../../shared/face";

describe("capture sequence", () => {
    it("walks the five angles in order", () => {
        let s = createSequence();
        expect(s.current).toBe("front");
        for (const angle of FACE_ANGLES) {
            expect(s.current).toBe(angle);
            s = s.accept({ ok: true, issues: [] });
        }
        expect(s.done).toBe(true);
        expect(s.captured).toHaveLength(5);
    });
    it("failed validation stays on the same angle with retake guidance", () => {
        let s = createSequence();
        s = s.accept({ ok: false, issues: ["too-dark"] });
        expect(s.current).toBe("front");
        expect(s.lastIssues).toEqual(["too-dark"]);
        expect(s.captured).toHaveLength(0);
    });
    it("instructions exist for every angle and every issue", () => {
        for (const angle of FACE_ANGLES) expect(instructionFor(angle).length).toBeGreaterThan(5);
        for (const issue of ["no-face", "wrong-orientation", "too-dark", "too-bright", "blur", "face-too-small", "low-resolution"])
            expect(instructionFor("front", issue).length).toBeGreaterThan(5);
    });
});