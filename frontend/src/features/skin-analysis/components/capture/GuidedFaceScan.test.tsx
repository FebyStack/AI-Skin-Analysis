import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GuidedFaceScan } from "./GuidedFaceScan";

describe("GuidedFaceScan", () => {
    it("shows step progress and the current instruction", () => {
        render(<GuidedFaceScan analyzeFrame={vi.fn(async (a) => ({ angle: a, quality: { ok: true, issues: [] }, zones: {} }))} onComplete={vi.fn()} />);
        expect(screen.getByText(/step 1 of 5/i)).toBeInTheDocument();
        expect(screen.getByText(/look straight ahead/i)).toBeInTheDocument();
    });
    it("failed capture shows retake guidance", async () => {
        render(<GuidedFaceScan analyzeFrame={vi.fn(async (a) => ({ angle: a, quality: { ok: false, issues: ["too-dark"] }, zones: {} }))} onComplete={vi.fn()} />);
        await userEvent.click(screen.getByRole("button", { name: /capture/i }));
        expect(await screen.findByText(/better lighting/i)).toBeInTheDocument();
    });
    it("calls onComplete with the report after five good captures", async () => {
        const onComplete = vi.fn();
        render(<GuidedFaceScan analyzeFrame={vi.fn(async (a) => ({ angle: a, quality: { ok: true, issues: [] }, zones: {} }))} onComplete={onComplete} />);
        for (let i = 0; i < 5; i++) await userEvent.click(screen.getByRole("button", { name: /capture/i }));
        expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ kind: "face-v2" }));
    });
});