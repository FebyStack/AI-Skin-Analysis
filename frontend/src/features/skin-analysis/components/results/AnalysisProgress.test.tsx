import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AnalysisProgress, STAGE_LABELS } from "./AnalysisProgress";

describe("AnalysisProgress", () => {
  it("renders all stages with the current one marked active", () => {
    render(<AnalysisProgress stage="analyzing" />);
    for (const label of Object.values(STAGE_LABELS)) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    const active = screen.getByText(STAGE_LABELS.analyzing).closest("li");
    expect(active).toHaveAttribute("aria-current", "step");
  });

  it("announces progress to screen readers", () => {
    render(<AnalysisProgress stage="classifier" />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
