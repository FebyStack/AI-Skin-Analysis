import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FacialMap } from "./FacialMap";
import type { MergedFinding } from "../../types";

const finding = (id: string, region: MergedFinding["region"], severity: MergedFinding["severity"]): MergedFinding => ({
  id,
  label: id,
  source: "llm",
  confidence: 0.5,
  severity,
  region,
  agreement: "llm-only",
  escalated: severity === "attention",
});

describe("FacialMap", () => {
  it("renders a marker for each finding's zone with an accessible label", () => {
    render(<FacialMap findings={[finding("acne", "left-cheek", "mild")]} />);
    expect(screen.getByLabelText(/left-cheek: acne/i)).toBeInTheDocument();
  });

  it("marks escalated zones distinctly", () => {
    render(<FacialMap findings={[finding("suspicious-lesion", "chin", "attention")]} />);
    const marker = screen.getByLabelText(/chin: suspicious-lesion/i);
    expect(marker.getAttribute("fill")).toBe("#f59e0b");
  });

  it("ignores findings without a region", () => {
    render(<FacialMap findings={[finding("acne", undefined, "mild")]} />);
    expect(screen.queryByLabelText(/acne/i)).not.toBeInTheDocument();
  });
});
