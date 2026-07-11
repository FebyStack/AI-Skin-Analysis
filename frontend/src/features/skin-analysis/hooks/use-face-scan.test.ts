import { describe, it, expect, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useFaceScan } from "./use-face-scan";
import type { AnalyzedView } from "../../../../../ai/face/types";

const okView = (angle: AnalyzedView["angle"]): AnalyzedView =>
    ({ angle, quality: { ok: true, issues: [] }, zones: {} });

describe("useFaceScan", () => {
    it("advances through angles on successful captures and finishes with a report", async () => {
        const analyze = vi.fn(async (angle) => okView(angle));
        const { result } = renderHook(() => useFaceScan({ analyzeFrame: analyze }));
        expect(result.current.currentAngle).toBe("front");
        for (let i = 0; i < 5; i++) await act(() => result.current.captureCurrent());
        await waitFor(() => expect(result.current.report).not.toBeNull());
        expect(result.current.report!.kind).toBe("face-v2");
        expect(analyze).toHaveBeenCalledTimes(5);
    });
    it("failed validation keeps the angle and exposes retake guidance", async () => {
        const analyze = vi.fn(async (angle) => ({ angle, quality: { ok: false, issues: ["blur"] }, zones: {} }));
        const { result } = renderHook(() => useFaceScan({ analyzeFrame: analyze }));
        await act(() => result.current.captureCurrent());
        expect(result.current.currentAngle).toBe("front");
        expect(result.current.instruction).toMatch(/steady/i);
    });
});